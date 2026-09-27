import { loadSettings, saveSettings } from './defaults.js';

const $ = (id) => document.getElementById(id);

async function load() {
  const settings = await loadSettings();
  const { usage, status, apiKey } = await chrome.storage.local.get(['usage', 'status', 'apiKey']);

  $('enabled').checked = settings.enabled;
  $('displayMode').value = settings.displayMode;
  $('muteMode').value = settings.muteMode;

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
    label.append(box, dot, cat.kind === 'mute' ? `🔇 ${cat.name}` : cat.name);
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
  const settings = structuredClone(await loadSettings());
  mutate(settings);
  await saveSettings(settings);
}

$('enabled').addEventListener('change', (e) => save((s) => (s.enabled = e.target.checked)));
$('displayMode').addEventListener('change', (e) => save((s) => (s.displayMode = e.target.value)));
$('muteMode').addEventListener('change', (e) => save((s) => (s.muteMode = e.target.value)));
// sidePanel.open はクリック直後に呼ぶ必要があるので、ウィンドウ ID は先に取っておく。
let windowId = null;
chrome.windows.getCurrent().then((w) => (windowId = w.id));
$('openPanel').addEventListener('click', () => {
  if (windowId == null) return;
  chrome.sidePanel.open({ windowId }).then(() => window.close());
});
$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
