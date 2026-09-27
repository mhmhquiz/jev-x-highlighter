// X のページ (isolated world)。
// inject.js から受け取ったツイートを service worker に判定させ、描画されたツイートに結果を反映する。
(() => {
  const FALLBACK_DELAY_MS = 300;

  const entries = new Map(); // tweetId -> { tweet, kw: Set<catId>, scores, pending, failed }
  const early = []; // 設定を読み込む前に届いたツイート
  const fallbackWaiting = new Set();
  let settings = null;
  let categoriesKey = '';
  let scanQueued = false;

  const norm = (s) => (s || '').normalize('NFKC').toLowerCase();
  const activeCategories = () => (settings?.enabled ? settings.categories.filter((c) => c.enabled) : []);
  const isValidTweet = (t) => t && /^\d+$/.test(t.id) && typeof t.text === 'string';

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch (e) {
      return Promise.reject(e); // 拡張の再読み込み後など
    }
  }

  // ---- 判定 ----------------------------------------------------------------

  function keywordHits(tweet) {
    const hits = new Set();
    const haystack = norm(
      [tweet.text, tweet.quoted_text, tweet.link_card_title, ...(tweet.hashtags || []).map((h) => `#${h}`)].join('\n'),
    );
    const handle = norm((tweet.author || '').match(/@(\w+)\)$/)?.[1]);
    for (const cat of activeCategories()) {
      const byKeyword = (cat.keywords || []).some((k) => k && haystack.includes(norm(k)));
      const byAccount = handle && (cat.accounts || []).some((a) => norm(a.replace(/^@/, '')) === handle);
      if (byKeyword || byAccount) hits.add(cat.id);
    }
    return hits;
  }

  function register(tweet) {
    if (!isValidTweet(tweet)) return;
    let entry = entries.get(tweet.id);
    if (!entry) {
      entry = { tweet, kw: keywordHits(tweet), scores: null, pending: false, failed: false };
      entries.set(tweet.id, entry);
    }
    request(entry);
  }

  function request(entry) {
    if (entry.scores || entry.pending || entry.failed || !activeCategories().length) return;
    entry.pending = true;
    const key = categoriesKey;
    send({ type: 'classify', tweet: entry.tweet })
      .then((res) => {
        if (key !== categoriesKey) return; // 途中で設定が変わった
        if (res?.scores) entry.scores = res.scores;
        else entry.failed = true;
      })
      .catch(() => {
        entry.failed = true;
      })
      .finally(() => {
        entry.pending = false;
        refresh(entry.tweet.id);
      });
  }

  // ---- 描画 ----------------------------------------------------------------

  function getTweetId(article) {
    // 広告には投稿日時へのリンクが無いので、ここで null になり無視される。
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      if (!a.querySelector('time')) continue;
      const m = a.getAttribute('href').match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function tweetFromDom(article, id) {
    const texts = article.querySelectorAll('[data-testid="tweetText"]');
    return {
      id,
      author: (article.querySelector('[data-testid="User-Name"]')?.innerText || '').replace(/\s+/g, ' '),
      text: texts[0]?.innerText || '',
      quoted_text: texts[1]?.innerText || '',
      link_card_title: '',
      image_alt: [],
      hashtags: [],
    };
  }

  function clear(article) {
    article.classList.remove('jev-hit', 'jev-weak', 'jev-miss', 'jev-expanded');
    article.style.removeProperty('--jev-color');
    article.querySelector(':scope > .jev-badge')?.remove();
    article.closest('[data-testid="cellInnerDiv"]')?.classList.remove('jev-cell-miss');
    delete article.dataset.jevSig;
  }

  function render(article, entry) {
    const hits = [];
    for (const cat of activeCategories()) {
      const p = entry.kw.has(cat.id) ? 1 : entry.scores?.[cat.id];
      if (p == null) continue;
      if (p >= settings.threshold) hits.push({ cat, p, strong: true });
      else if (p >= settings.weakThreshold) hits.push({ cat, p, strong: false });
    }
    hits.sort((a, b) => b.p - a.p);

    const state = hits.length ? 'hit' : entry.scores ? 'miss' : 'pending';
    const badge = article.querySelector(':scope > .jev-badge');
    const sig = `${state}|${hits.map((h) => `${h.cat.id}:${h.strong}`).join(',')}`;
    if (article.dataset.jevSig === sig && (state !== 'hit' || badge)) return;

    clear(article);
    article.dataset.jevSig = sig;
    if (state === 'pending') return;

    if (state === 'miss') {
      article.classList.add('jev-miss');
      article.closest('[data-testid="cellInnerDiv"]')?.classList.add('jev-cell-miss');
      return;
    }

    const top = hits[0];
    article.classList.add('jev-hit');
    if (!top.strong) article.classList.add('jev-weak');
    article.style.setProperty('--jev-color', top.cat.color);

    const el = document.createElement('div');
    el.className = 'jev-badge';
    el.title = activeCategories()
      .map((c) => {
        const p = entry.kw.has(c.id) ? 'キーワード一致' : entry.scores?.[c.id]?.toFixed(2) ?? '-';
        return `${c.name}: ${p}`;
      })
      .join('\n');
    for (const h of hits) {
      const chip = document.createElement('span');
      chip.textContent = h.strong ? h.cat.name : `${h.cat.name}?`;
      if (!h.strong) chip.className = 'weak';
      chip.style.setProperty('--c', h.cat.color);
      el.append(chip);
    }
    article.append(el);
  }

  function scheduleFallback(article, id) {
    if (fallbackWaiting.has(id)) return;
    fallbackWaiting.add(id);
    // API の横取りが先に届くのを少し待ち、それでも無ければ DOM から本文を読む。
    setTimeout(() => {
      fallbackWaiting.delete(id);
      if (!entries.has(id) && article.isConnected && article.dataset.jevId === id) {
        register(tweetFromDom(article, id));
      }
      scanSoon();
    }, FALLBACK_DELAY_MS);
  }

  function scan() {
    scanQueued = false;
    if (!settings) return;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const id = getTweetId(article);
      if (article.dataset.jevId !== (id || '')) {
        clear(article); // X が要素を使い回した
        article.dataset.jevId = id || '';
      }
      if (!id) continue;
      const entry = entries.get(id);
      if (!entry) {
        scheduleFallback(article, id);
        continue;
      }
      request(entry);
      render(article, entry);
    }
  }

  function scanSoon() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  function refresh(id) {
    for (const article of document.querySelectorAll(`article[data-jev-id="${id}"]`)) {
      const entry = entries.get(id);
      if (entry) render(article, entry);
    }
  }

  // ---- 設定 ----------------------------------------------------------------

  async function loadSettings() {
    settings = await send({ type: 'getSettings' });
    document.documentElement.dataset.jevMode = settings.enabled ? settings.displayMode : 'none';
    const key = JSON.stringify(activeCategories());
    if (key !== categoriesKey) {
      categoriesKey = key;
      for (const entry of entries.values()) {
        entry.kw = keywordHits(entry.tweet);
        entry.scores = null;
        entry.failed = false;
      }
    }
    document.querySelectorAll('article[data-jev-sig]').forEach(clear);
    scanSoon();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) loadSettings();
    if (area === 'local' && changes.apiKey) {
      for (const entry of entries.values()) entry.failed = false;
      scanSoon();
    }
  });

  // ---- 起動 ----------------------------------------------------------------

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'jev-x' || ev.data.type !== 'tweets') return;
    if (!Array.isArray(ev.data.tweets)) return;
    if (!settings) early.push(...ev.data.tweets);
    else ev.data.tweets.forEach(register);
  });

  // 折りたたみモード: 最初のクリックは展開だけにして、ツイート詳細へ遷移させない。
  document.addEventListener(
    'click',
    (ev) => {
      if (document.documentElement.dataset.jevMode !== 'collapse') return;
      const article = ev.target.closest?.('article.jev-miss');
      if (!article || article.classList.contains('jev-expanded')) return;
      ev.preventDefault();
      ev.stopPropagation();
      article.classList.add('jev-expanded');
    },
    true,
  );

  new MutationObserver(scanSoon).observe(document.documentElement, { childList: true, subtree: true });

  loadSettings().then(() => {
    early.splice(0).forEach(register);
  });
})();
