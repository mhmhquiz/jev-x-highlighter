import { DEFAULT_SETTINGS } from './defaults.js';

const $ = (id) => document.getElementById(id);
const LIST_KEYS = ['keywords', 'accounts'];

function renderCategory(cat) {
  const node = $('categoryTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.id = cat.id;
  for (const input of node.querySelectorAll('[data-k]')) {
    const k = input.dataset.k;
    if (input.type === 'checkbox') input.checked = !!cat[k];
    else if (LIST_KEYS.includes(k)) input.value = (cat[k] || []).join(', ');
    else input.value = cat[k] || '';
  }
  node.querySelector('[data-action="remove"]').addEventListener('click', () => node.remove());
  $('categories').append(node);
}

function readCategories() {
  return [...$('categories').children].map((node) => {
    const cat = { id: node.dataset.id };
    for (const input of node.querySelectorAll('[data-k]')) {
      const k = input.dataset.k;
      if (input.type === 'checkbox') cat[k] = input.checked;
      else if (LIST_KEYS.includes(k)) cat[k] = input.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
      else cat[k] = input.value.trim();
    }
    return cat;
  });
}

function fill(settings) {
  $('threshold').value = settings.threshold;
  $('weakThreshold').value = settings.weakThreshold;
  $('dailyLimit').value = settings.dailyLimit;
  $('categories').replaceChildren();
  settings.categories.forEach(renderCategory);
}

async function showKeyState() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  $('keyState').textContent = apiKey ? '保存済み' : '未設定';
}

async function load() {
  const { settings } = await chrome.storage.sync.get('settings');
  fill({ ...DEFAULT_SETTINGS, ...(settings || {}) });
  showKeyState();
}

$('saveKey').addEventListener('click', async () => {
  const value = $('apiKey').value.trim();
  if (!value) return;
  await chrome.storage.local.set({ apiKey: value });
  $('apiKey').value = '';
  showKeyState();
});

$('clearKey').addEventListener('click', async () => {
  await chrome.storage.local.remove('apiKey');
  showKeyState();
});

$('addCategory').addEventListener('click', () => {
  renderCategory({
    id: `c${Date.now().toString(36)}`,
    name: '',
    color: '#f59e0b',
    enabled: true,
    instructions: 'Is this post mainly about ...?',
    criteriaTrue: '',
    criteriaFalse: '',
    keywords: [],
    accounts: [],
  });
});

$('save').addEventListener('click', async () => {
  const { settings: stored } = await chrome.storage.sync.get('settings');
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    threshold: Number($('threshold').value),
    weakThreshold: Number($('weakThreshold').value),
    dailyLimit: Number($('dailyLimit').value),
    categories: readCategories().filter((c) => c.name),
  };
  await chrome.storage.sync.set({ settings });
  $('saved').textContent = '保存しました';
  setTimeout(() => ($('saved').textContent = ''), 2000);
});

$('reset').addEventListener('click', async () => {
  if (!confirm('カテゴリとしきい値を初期設定に戻します。よろしいですか？')) return;
  await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  fill(DEFAULT_SETTINGS);
});

load();
