// 見逃しリスト: 強調されたツイートを溜めておき、あとから開けるようにする。
import { loadSettings } from './defaults.js';

const $ = (id) => document.getElementById(id);
const USEFUL_MARK = 1.4;

let hits = [];
let categories = [];
let filter = 'all'; // 'all' | カテゴリ ID

function timeAgo(at) {
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m} 分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 時間前`;
  return `${Math.floor(h / 24)} 日前`;
}

function renderFilters() {
  const counts = {};
  for (const h of hits) for (const c of h.cats) counts[c.id] = (counts[c.id] || 0) + 1;
  const buttons = [{ id: 'all', name: 'すべて', color: '', n: hits.length }];
  for (const c of categories) if (counts[c.id]) buttons.push({ ...c, n: counts[c.id] });
  if (!buttons.some((b) => b.id === filter)) filter = 'all';
  $('filters').replaceChildren(
    ...buttons.map((b) => {
      const el = document.createElement('button');
      el.className = `filter${b.id === filter ? ' on' : ''}`;
      if (b.color) el.style.setProperty('--c', b.color);
      el.textContent = `${b.name} ${b.n}`;
      el.addEventListener('click', () => {
        filter = b.id;
        render();
      });
      return el;
    }),
  );
}

function visible() {
  const q = $('query').value.trim().toLowerCase();
  return hits.filter(
    (h) =>
      (filter === 'all' || h.cats.some((c) => c.id === filter)) &&
      (!$('usefulOnly').checked || (h.useful ?? 0) >= USEFUL_MARK) &&
      (!$('unreadOnly').checked || !h.read) &&
      (!q || `${h.text}\n${h.author}`.toLowerCase().includes(q)),
  );
}

function renderItem(h) {
  const li = document.createElement('li');
  li.className = `hit${h.read ? ' read' : ''}`;
  li.style.setProperty('--c', h.cats[0]?.color || '#888');

  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const c of h.cats) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.setProperty('--c', c.color);
    chip.textContent = `${c.name}${c.sub ? ` · ${c.sub}` : ''}`;
    chips.append(chip);
  }
  if ((h.useful ?? 0) >= USEFUL_MARK) {
    const u = document.createElement('span');
    u.className = 'chip useful';
    u.textContent = '💡 有益';
    chips.append(u);
  }
  const time = document.createElement('span');
  time.className = 'muted';
  time.textContent = timeAgo(h.at);
  chips.append(time);

  const author = document.createElement('div');
  author.className = 'author';
  author.textContent = h.author;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = h.text;

  li.append(chips, author, text);
  li.title = 'クリックで開く (Ctrl/中クリックで新しいタブ)';
  li.addEventListener('click', (ev) => open(h, ev.ctrlKey || ev.metaKey));
  li.addEventListener('auxclick', (ev) => ev.button === 1 && open(h, true));
  return li;
}

function render() {
  renderFilters();
  const list = visible();
  $('count').textContent = `${hits.filter((h) => !h.read).length} 件未読`;
  $('list').replaceChildren(...list.map(renderItem));
  $('empty').hidden = hits.length > 0;
}

async function open(h, newTab) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (newTab || !tab) chrome.tabs.create({ url: h.url, active: !newTab });
  else chrome.tabs.update(tab.id, { url: h.url });
  const { hits: stored = [] } = await chrome.storage.local.get('hits');
  await chrome.storage.local.set({ hits: stored.map((x) => (x.id === h.id ? { ...x, read: true } : x)) });
}

async function load() {
  const [{ hits: stored = [] }, settings] = await Promise.all([chrome.storage.local.get('hits'), loadSettings()]);
  hits = stored;
  categories = settings.categories;
  render();
}

$('query').addEventListener('input', render);
$('usefulOnly').addEventListener('change', render);
$('unreadOnly').addEventListener('change', render);
$('clear').addEventListener('click', async () => {
  if (!confirm('見逃しリストを全部消します。よろしいですか？')) return;
  await chrome.storage.local.set({ hits: [] });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.hits || changes.settings)) load();
});
setInterval(render, 60000); // 「◯分前」を更新する

load();
