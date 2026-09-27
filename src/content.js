// X のページ (isolated world)。
// inject.js から受け取ったツイートを service worker に判定させ、描画されたツイートに結果を反映する。
(() => {
  const FALLBACK_DELAY_MS = 300;
  const USEFUL_MARK = 1.4; // 有益さ (0〜2) がこれ以上なら 💡 を付ける
  const USEFUL_LOW = 0.8; // 「有益なものだけ強調」のとき、これ未満は弱い強調にする

  // tweetId -> { tweet, kw: Set<catId>, scores, sub, useful, pending, failed, recorded }
  const entries = new Map();
  const votes = new Map(); // tweetId -> 'up' | 'down'
  const early = []; // 設定を読み込む前に届いたツイート
  const fallbackWaiting = new Set();
  let settings = null;
  let categoriesKey = '';
  let scanQueued = false;

  const norm = (s) => (s || '').normalize('NFKC').toLowerCase();
  const activeCategories = () => (settings?.enabled ? settings.categories.filter((c) => c.enabled) : []);
  const isValidTweet = (t) => t && /^\d+$/.test(t.id) && typeof t.text === 'string';
  const handleOf = (tweet) => (tweet.author || '').match(/@(\w+)\)$/)?.[1] || '';

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
    const handle = norm(handleOf(tweet));
    for (const cat of activeCategories()) {
      const byKeyword = (cat.keywords || []).some((k) => k && haystack.includes(norm(k)));
      const byAccount = handle && (cat.accounts || []).some((a) => norm(a.replace(/^@/, '')) === handle);
      if (byKeyword || byAccount) hits.add(cat.id);
    }
    return hits;
  }

  // 確率としきい値から、強調するカテゴリとミュートするカテゴリを決める。
  function evaluate(entry) {
    const hits = [];
    const mutes = [];
    for (const cat of activeCategories()) {
      const kw = entry.kw.has(cat.id);
      const p = kw ? 1 : entry.scores?.[cat.id];
      if (p == null) continue;
      const threshold = typeof cat.threshold === 'number' ? cat.threshold : settings.threshold;
      if (cat.kind === 'mute') {
        if (p >= threshold) mutes.push({ cat, p, kw });
        continue;
      }
      let strong = p >= threshold;
      if (strong && !kw && settings.usefulness && settings.usefulOnly && entry.useful != null && entry.useful < USEFUL_LOW) {
        strong = false;
      }
      if (strong || p >= Math.min(settings.weakThreshold, threshold)) {
        hits.push({ cat, p, kw, strong, sub: entry.sub?.[cat.id] || null });
      }
    }
    hits.sort((a, b) => b.strong - a.strong || b.p - a.p);
    mutes.sort((a, b) => b.p - a.p);
    return { hits, mutes };
  }

  function register(tweet) {
    if (!isValidTweet(tweet)) return;
    let entry = entries.get(tweet.id);
    if (!entry) {
      entry = { tweet, kw: keywordHits(tweet), scores: null, sub: null, useful: null, pending: false, failed: false };
      entries.set(tweet.id, entry);
      record(entry);
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
        if (res?.scores) {
          entry.scores = res.scores;
          entry.sub = res.sub || {};
          entry.useful = res.useful ?? null;
          record(entry);
        } else {
          entry.failed = true;
        }
      })
      .catch(() => {
        entry.failed = true;
      })
      .finally(() => {
        entry.pending = false;
        record(entry);
        refresh(entry.tweet.id);
      });
  }

  // ---- 見逃しリスト / フィードバック ---------------------------------------

  function itemOf(entry, hits) {
    const { tweet } = entry;
    const handle = handleOf(tweet);
    return {
      id: tweet.id,
      url: `https://x.com/${handle || 'i'}/status/${tweet.id}`,
      author: tweet.author || '',
      text: [tweet.text, tweet.quoted_text && `> ${tweet.quoted_text}`].filter(Boolean).join('\n').slice(0, 400),
      cats: hits.map((h) => ({
        id: h.cat.id,
        name: h.cat.name,
        color: h.cat.color,
        p: Math.round(h.p * 100) / 100,
        kw: h.kw,
        strong: h.strong,
        sub: h.sub,
      })),
      useful: entry.useful,
      at: Date.now(),
    };
  }

  // 強調したツイートを見逃しリストに入れる (判定が揃ってから 1 回だけ)。
  function record(entry) {
    if (entry.recorded) return;
    const needsJev = activeCategories().some((c) => !entry.kw.has(c.id));
    if (needsJev && !entry.scores) {
      // キーワード一致だけ先に分かっているときは、ミュート判定と小分類を待つ。
      if (!entry.failed) return;
    }
    const { hits, mutes } = evaluate(entry);
    const strong = hits.filter((h) => h.strong);
    if (mutes.length || !strong.length) return;
    entry.recorded = true;
    send({ type: 'recordHit', item: itemOf(entry, strong) }).catch(() => {});
  }

  function vote(id, value) {
    const entry = entries.get(id);
    if (!entry) return;
    const next = votes.get(id) === value ? null : value; // 同じボタンをもう一度押すと取り消し
    if (next) votes.set(id, next);
    else votes.delete(id);
    const { hits } = evaluate(entry);
    const item = next
      ? {
          ...itemOf(entry, hits),
          vote: next,
          scores: Object.fromEntries(
            activeCategories().map((c) => [c.id, entry.kw.has(c.id) ? 1 : Math.round((entry.scores?.[c.id] ?? 0) * 100) / 100]),
          ),
        }
      : { id, vote: null };
    send({ type: 'feedback', item }).catch(() => {});
    refresh(id);
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
    article.classList.remove('jev-hit', 'jev-weak', 'jev-miss', 'jev-muted', 'jev-expanded');
    article.style.removeProperty('--jev-color');
    article.style.removeProperty('--jev-bar');
    article.style.removeProperty('--jev-strength');
    article.querySelector(':scope > .jev-badge')?.remove();
    article.closest('[data-testid="cellInnerDiv"]')?.classList.remove('jev-cell-miss', 'jev-cell-muted');
    delete article.dataset.jevSig;
  }

  // カテゴリ色の上で読める文字色 (黒か白) を選ぶ。
  function textColorOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#0f1419' : '#fff';
  }

  function tooltip(entry) {
    const lines = activeCategories().map((c) => {
      const p = entry.kw.has(c.id) ? 'キーワード一致' : entry.scores?.[c.id]?.toFixed(2) ?? '-';
      const sub = entry.sub?.[c.id] ? ` (${entry.sub[c.id]})` : '';
      return `${c.kind === 'mute' ? '🔇 ' : ''}${c.name}: ${p}${sub}`;
    });
    if (entry.useful != null) lines.push(`有益さ: ${entry.useful.toFixed(2)} / 2`);
    return lines.join('\n');
  }

  function chip(cat, label, className) {
    const el = document.createElement('span');
    el.className = className;
    el.style.setProperty('--c', cat.color);
    el.style.setProperty('--fg', textColorOn(cat.color));
    el.textContent = label;
    return el;
  }

  // 背景の濃さ (%)。弱い強調は薄く一定、強調は確率がしきい値から 1 に近づくほど濃くする。
  function strengthOf(hit) {
    if (!hit.strong) return 4;
    if (hit.kw) return 14;
    const th = typeof hit.cat.threshold === 'number' ? hit.cat.threshold : settings.threshold;
    const t = th >= 1 ? 1 : Math.min(1, Math.max(0, (hit.p - th) / (1 - th)));
    return Math.round(8 + 12 * t);
  }

  function feedbackButtons(id) {
    const wrap = document.createElement('span');
    const current = votes.get(id);
    wrap.className = current ? 'jev-fb voted' : 'jev-fb';
    for (const [value, text, title] of [
      ['up', '👍', '合っている (興味あり)'],
      ['down', '👎', '違う'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.jevVote = value;
      b.textContent = text;
      b.title = title;
      if (current === value) b.classList.add('on');
      wrap.append(b);
    }
    return wrap;
  }

  function render(article, entry) {
    const { hits, mutes } = evaluate(entry);
    const state = mutes.length ? 'mute' : hits.length ? 'hit' : entry.scores ? 'miss' : 'pending';
    const useful = entry.useful != null && entry.useful >= USEFUL_MARK && settings.usefulness;
    const badge = article.querySelector(':scope > .jev-badge');
    const sig = [
      state,
      hits.map((h) => `${h.cat.id}:${h.strong}:${h.sub}:${strengthOf(h)}`).join(','),
      mutes.map((m) => m.cat.id).join(','),
      useful,
      votes.get(entry.tweet.id) || '',
      settings.feedbackButtons,
    ].join('|');
    if (article.dataset.jevSig === sig && (state === 'miss' || state === 'pending' || badge)) return;

    clear(article);
    article.dataset.jevSig = sig;
    if (state === 'pending') return;

    const cell = article.closest('[data-testid="cellInnerDiv"]');
    if (state === 'miss') {
      article.classList.add('jev-miss');
      cell?.classList.add('jev-cell-miss');
      return;
    }

    const el = document.createElement('div');
    el.className = 'jev-badge';
    el.title = tooltip(entry);

    if (state === 'mute') {
      article.classList.add('jev-muted');
      cell?.classList.add('jev-cell-muted');
      for (const m of mutes) el.append(chip(m.cat, `🔇 ${m.cat.name}`, 'jev-chip mute'));
      article.append(el);
      return;
    }

    const top = hits[0];
    article.classList.add('jev-hit');
    if (!top.strong) article.classList.add('jev-weak');
    article.style.setProperty('--jev-color', top.cat.color);
    article.style.setProperty('--jev-strength', strengthOf(top));
    // 複数カテゴリに該当したら、左の帯をカテゴリ色で縞に分ける。
    const colors = hits.map((h) => h.cat.color);
    article.style.setProperty(
      '--jev-bar',
      colors.length > 1
        ? `linear-gradient(${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`
        : colors[0],
    );

    // 右上の隙間に小さなタグを並べる。👍 / 👎 はタグにカーソルを当てたときだけ左に出る。
    if (settings.feedbackButtons) el.append(feedbackButtons(entry.tweet.id));
    for (const h of hits) {
      const label = `${h.cat.name}${h.strong ? '' : '?'}${h.sub ? ` · ${h.sub}` : ''}`;
      el.append(chip(h.cat, label, h.strong ? 'jev-chip' : 'jev-chip weak'));
    }
    if (useful) {
      const u = document.createElement('span');
      u.className = 'jev-useful';
      u.textContent = '💡';
      el.append(u);
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
    const root = document.documentElement;
    root.dataset.jevMode = settings.enabled ? settings.displayMode : 'none';
    root.dataset.jevMute = settings.enabled ? settings.muteMode : 'none';
    // 判定のやり直しが要る設定 (カテゴリの中身、有益さの ON/OFF) が変わったら結果を捨てる。
    const key = JSON.stringify([activeCategories(), settings.usefulness]);
    if (key !== categoriesKey) {
      categoriesKey = key;
      for (const entry of entries.values()) {
        entry.kw = keywordHits(entry.tweet);
        entry.scores = null;
        entry.sub = null;
        entry.useful = null;
        entry.failed = false;
        entry.recorded = false;
      }
    }
    document.querySelectorAll('article[data-jev-sig]').forEach(clear);
    scanSoon();
  }

  async function loadVotes() {
    const { feedback = [] } = await chrome.storage.local.get('feedback');
    votes.clear();
    for (const f of feedback) if (f.vote) votes.set(f.id, f.vote);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) loadSettings();
    if (changes.apiKey) {
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

  document.addEventListener(
    'click',
    (ev) => {
      // 👍 / 👎: ツイート詳細へ遷移させずに記録する。
      const button = ev.target.closest?.('.jev-fb button');
      if (button) {
        ev.preventDefault();
        ev.stopPropagation();
        const id = button.closest('article')?.dataset.jevId;
        if (id) vote(id, button.dataset.jevVote);
        return;
      }
      // 折りたたみ: 最初のクリックは展開だけにして、ツイート詳細へ遷移させない。
      const article = ev.target.closest?.('article.jev-miss, article.jev-muted');
      if (!article || article.classList.contains('jev-expanded')) return;
      const root = document.documentElement.dataset;
      const collapsed = article.classList.contains('jev-muted') ? root.jevMute === 'collapse' : root.jevMode === 'collapse';
      if (!collapsed) return;
      ev.preventDefault();
      ev.stopPropagation();
      article.classList.add('jev-expanded');
    },
    true,
  );

  new MutationObserver(scanSoon).observe(document.documentElement, { childList: true, subtree: true });

  Promise.all([loadSettings(), loadVotes().catch(() => {})]).then(() => {
    early.splice(0).forEach(register);
  });
})();
