import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from './defaults.js';
import { callJev, MODEL } from './jev.js';

const $ = (id) => document.getElementById(id);
const LIST_KEYS = ['keywords', 'accounts'];
const FLAG_KEYS = ['usefulness', 'usefulOnly', 'feedbackButtons'];
const EXAMPLE_MAX = 80; // 例に追加するときの本文の長さ

// ---- カテゴリ ----------------------------------------------------------------

const subtagsToText = (subtags) => (subtags || []).map((t) => (t.description ? `${t.name}: ${t.description}` : t.name)).join('\n');

function textToSubtags(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.+?)\s*[:：]\s*(.*)$/);
      return m ? { name: m[1].trim(), description: m[2].trim() } : { name: line, description: '' };
    });
}

function renderCategory(cat) {
  const node = $('categoryTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.id = cat.id;
  for (const input of node.querySelectorAll('[data-k]')) {
    const k = input.dataset.k;
    if (input.type === 'checkbox') input.checked = !!cat[k];
    else if (LIST_KEYS.includes(k)) input.value = (cat[k] || []).join(', ');
    else if (k === 'subtags') input.value = subtagsToText(cat.subtags);
    else if (k === 'threshold') input.value = typeof cat.threshold === 'number' ? cat.threshold : '';
    else input.value = cat[k] || '';
  }
  node.querySelector('[data-action="remove"]').addEventListener('click', () => node.remove());
  node.querySelector('[data-action="up"]').addEventListener('click', () => node.previousElementSibling?.before(node));
  node.querySelector('[data-action="down"]').addEventListener('click', () => node.nextElementSibling?.after(node));
  $('categories').append(node);
}

function readCategories() {
  return [...$('categories').children].map((node) => {
    const cat = { id: node.dataset.id };
    for (const input of node.querySelectorAll('[data-k]')) {
      const k = input.dataset.k;
      if (input.type === 'checkbox') cat[k] = input.checked;
      else if (LIST_KEYS.includes(k)) cat[k] = input.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
      else if (k === 'subtags') cat[k] = textToSubtags(input.value);
      else if (k === 'threshold') cat[k] = input.value.trim() === '' ? null : Number(input.value);
      else cat[k] = input.value.trim();
    }
    return cat;
  });
}

function fill(settings) {
  $('threshold').value = settings.threshold;
  $('weakThreshold').value = settings.weakThreshold;
  $('dailyLimit').value = settings.dailyLimit;
  for (const k of FLAG_KEYS) $(k).checked = !!settings[k];
  $('categories').replaceChildren();
  settings.categories.forEach(renderCategory);
}

// ---- API キー ----------------------------------------------------------------

async function showKeyState() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  $('keyState').textContent = apiKey ? '保存済み' : '未設定';
}

// 保存済みのキーで Jev に 1 回だけ問い合わせ、結果をポップアップのエラー表示にも反映する。
async function testKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) return showKeyState();
  $('keyState').textContent = '接続テスト中…';
  try {
    await callJev(apiKey, {
      model: MODEL,
      state: 'VRChat でアバター改変した',
      questions: { ping: { type: 'noul', instructions: 'Is this text about VRChat?' } },
    }, { retries: 0 });
    await chrome.storage.local.set({ status: { error: null, at: Date.now() } });
    $('keyState').textContent = '保存済み (接続テスト OK)';
  } catch (e) {
    const message = e.status === 401 ? 'API キーが無効です (401)。キーを確認してください。' : e.message || String(e);
    await chrome.storage.local.set({ status: { error: message, at: Date.now() } });
    $('keyState').textContent = `保存済み (接続テスト失敗: ${message})`;
  }
}

async function load() {
  fill(await loadSettings());
  showKeyState();
  renderLog();
}

$('saveKey').addEventListener('click', async () => {
  const value = $('apiKey').value.trim();
  if (!value) return;
  await chrome.storage.local.set({ apiKey: value });
  $('apiKey').value = '';
  testKey();
});

$('testKey').addEventListener('click', testKey);

$('clearKey').addEventListener('click', async () => {
  await chrome.storage.local.remove(['apiKey', 'status']);
  showKeyState();
});

$('addCategory').addEventListener('click', () => {
  renderCategory({
    id: `c${Date.now().toString(36)}`,
    name: '',
    color: '#f59e0b',
    enabled: true,
    kind: 'highlight',
    threshold: null,
    instructions: 'Is this post mainly about ...?',
    criteriaTrue: '',
    criteriaFalse: '',
    keywords: [],
    accounts: [],
    subtags: [],
  });
});

function flash(text) {
  $('saved').textContent = text;
  setTimeout(() => ($('saved').textContent = ''), 3000);
}

$('save').addEventListener('click', async () => {
  const stored = await loadSettings();
  const settings = normalizeSettings({
    ...stored,
    threshold: Number($('threshold').value),
    weakThreshold: Number($('weakThreshold').value),
    dailyLimit: Number($('dailyLimit').value),
    ...Object.fromEntries(FLAG_KEYS.map((k) => [k, $(k).checked])),
    categories: readCategories().filter((c) => c.name),
  });
  await saveSettings(settings);
  flash('保存しました');
});

$('reset').addEventListener('click', async () => {
  if (!confirm('カテゴリとしきい値を初期設定に戻します。よろしいですか？')) return;
  await saveSettings(DEFAULT_SETTINGS);
  fill(DEFAULT_SETTINGS);
});

// ---- 判定ログ (👍 / 👎) ----------------------------------------------------

// カテゴリごとの正解率。👍 = 表示したカテゴリが合っていた、👎 = 違っていた。
function renderStats(feedback) {
  const byCat = new Map();
  for (const f of feedback) {
    for (const c of f.cats || []) {
      const s = byCat.get(c.id) || { name: c.name, color: c.color, up: 0, down: 0 };
      s[f.vote]++;
      byCat.set(c.id, s);
    }
  }
  $('stats').replaceChildren(
    ...[...byCat.values()].map((s) => {
      const el = document.createElement('span');
      el.className = 'stat';
      el.style.setProperty('--c', s.color);
      const total = s.up + s.down;
      el.textContent = `${s.name}: 正解率 ${Math.round((s.up / total) * 100)}% (👍 ${s.up} / 👎 ${s.down})`;
      return el;
    }),
  );
}

function logRow(f, categories) {
  const tr = document.createElement('tr');

  const vote = document.createElement('td');
  vote.textContent = f.vote === 'up' ? '👍' : '👎';

  const tweet = document.createElement('td');
  const link = document.createElement('a');
  link.href = f.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = f.text?.slice(0, 120) || '(本文なし)';
  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = `${f.author} · ${new Date(f.at).toLocaleString()}`;
  tweet.append(link, meta);

  const judged = document.createElement('td');
  judged.className = 'muted';
  const shown = (f.cats || []).map((c) => `${c.name}${c.sub ? `·${c.sub}` : ''}`).join(', ') || '(なし)';
  const scores = Object.entries(f.scores || {})
    .map(([id, p]) => `${categories.find((c) => c.id === id)?.name || id} ${p.toFixed(2)}`)
    .join(' / ');
  judged.textContent = `表示: ${shown}\n${scores}${f.useful != null ? ` / 有益さ ${f.useful.toFixed(2)}` : ''}`;

  const action = document.createElement('td');
  const select = document.createElement('select');
  for (const c of categories) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    select.append(o);
  }
  if (f.cats?.[0]) select.value = f.cats[0].id;
  const add = document.createElement('button');
  add.className = 'small';
  add.textContent = f.vote === 'up' ? '該当する例に' : '該当しない例に';
  add.addEventListener('click', () => {
    const ok = addExample(select.value, f.vote === 'up' ? 'criteriaTrue' : 'criteriaFalse', f.text);
    add.textContent = ok ? '追記しました' : '追記済み';
    add.disabled = true;
  });
  action.append(select, add);

  tr.append(vote, tweet, judged, action);
  return tr;
}

async function renderLog() {
  const [{ feedback = [] }, settings] = await Promise.all([chrome.storage.local.get('feedback'), loadSettings()]);
  renderStats(feedback);
  const filter = $('logFilter').value;
  const rows = feedback.filter((f) => filter === 'all' || f.vote === filter);
  $('log').replaceChildren(...rows.map((f) => logRow(f, settings.categories)));
  $('logEmpty').hidden = feedback.length > 0;
}

// 編集中のカテゴリ欄に例を追記する (Jev は学習できないので、説明文の例を育てて精度を上げる)。
function addExample(catId, key, text) {
  const node = [...$('categories').children].find((n) => n.dataset.id === catId);
  const area = node?.querySelector(`[data-k="${key}"]`);
  if (!area) return false;
  const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, EXAMPLE_MAX);
  const line = `例:「${snippet}」`;
  if (area.value.includes(line)) return false;
  area.value = area.value.trim() ? `${area.value.trim()}\n${line}` : line;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flash('カテゴリ欄に追記しました。「保存」を押すと反映されます');
  return true;
}

$('logFilter').addEventListener('change', renderLog);
$('clearLog').addEventListener('click', async () => {
  if (!confirm('判定ログを全部消します。よろしいですか？')) return;
  await chrome.storage.local.set({ feedback: [] });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.feedback) renderLog();
});

load();
