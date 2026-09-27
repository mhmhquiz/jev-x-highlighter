import { DEFAULT_SETTINGS } from './defaults.js';
import { buildRequest, callJev, configHash, extractScores } from './jev.js';

const MAX_CONCURRENCY = 8;
const MAX_CACHE = 5000;

const cache = new Map(); // `${tweetId}:${configHash}` -> scores
const inflight = new Map(); // 同上 -> Promise
let active = 0;
const waiters = [];
let usage = null; // { date, count, tokens }

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
});

async function acquire() {
  while (active >= MAX_CONCURRENCY) await new Promise((r) => waiters.push(r));
  active++;
}

function release() {
  active--;
  waiters.shift()?.();
}

function today() {
  return new Date().toLocaleDateString('sv'); // YYYY-MM-DD (ローカル日付)
}

async function loadUsage() {
  const date = today();
  if (usage?.date === date) return usage;
  const stored = (await chrome.storage.local.get('usage')).usage;
  usage = stored?.date === date ? stored : { date, count: 0, tokens: 0 };
  return usage;
}

function setStatus(error) {
  chrome.storage.local.set({ status: { error: error || null, at: Date.now() } });
}

async function classify(tweet) {
  const settings = await getSettings();
  const categories = settings.categories.filter((c) => c.enabled);
  if (!categories.length) return { scores: {} };

  const key = `${tweet.id}:${configHash(categories)}`;
  if (cache.has(key)) return { scores: cache.get(key) };
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) {
      setStatus('API キーが未設定です。設定画面で入力してください。');
      return { error: 'no_key' };
    }
    const u = await loadUsage();
    if (u.count >= settings.dailyLimit) {
      setStatus(`今日の判定上限 (${settings.dailyLimit} 件) に達しました。`);
      return { error: 'limit' };
    }
    u.count++;
    await acquire();
    try {
      const response = await callJev(apiKey, buildRequest(tweet, categories));
      const scores = extractScores(response, categories);
      cache.set(key, scores);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      u.tokens += response?.usage?.input_tokens || 0;
      chrome.storage.local.set({ usage: u });
      setStatus(null);
      return { scores };
    } catch (e) {
      u.count--;
      setStatus(e.message || String(e));
      return { error: 'api' };
    } finally {
      release();
    }
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }
  if (msg?.type === 'classify' && msg.tweet?.id) {
    classify(msg.tweet).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true;
  }
  return false;
});
