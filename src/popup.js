import { DEFAULT_SETTINGS } from './defaults.js';

const $ = (id) => document.getElementById(id);

async function load() {
  const { settings: stored } = await chrome.storage.sync.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  const { usage, status, apiKey } = await chrome.storage.local.get(['usage', 'status', 'apiKey']);

  $('enabled').checked = settings.enabled;
  $('displayMode').value = settings.displayMode;

  const list = $('categories');
  list.replaceChildren();
  settings.categories.forEach((cat, i) => {
    const label = document.createElement('label');
    label.className = 'row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = cat.enabled;
    box.addEventListener('change', () => save((s) => (s.categories[i].enabled = box.checked)));
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = cat.color;
    label.append(box, dot, cat.name);
    list.append(label);
  });

  const isToday = usage?.date === new Date().toLocaleDateString('sv');
  const count = isToday ? usage.count : 0;
  const tokens = isToday ? usage.tokens : 0;
  $('usage').textContent = `今日の判定: ${count} 件 / ${tokens.toLocaleString()} トークン (約 $${((tokens / 1e6) * 0.042).toFixed(4)})`;

  const error = !apiKey ? 'API キーが未設定です。「詳細設定」から入力してください。' : status?.error;
  $('error').hidden = !error;
  $('error').textContent = error || '';
}

async function save(mutate) {
  const { settings: stored } = await chrome.storage.sync.get('settings');
  const settings = structuredClone({ ...DEFAULT_SETTINGS, ...(stored || {}) });
  mutate(settings);
  await chrome.storage.sync.set({ settings });
}

$('enabled').addEventListener('change', (e) => save((s) => (s.enabled = e.target.checked)));
$('displayMode').addEventListener('change', (e) => save((s) => (s.displayMode = e.target.value)));
$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
