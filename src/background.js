import { loadSettings } from './defaults.js';
import { buildRequest, callJev, configHash, extractResult } from './jev.js';

const MAX_CONCURRENCY = 8;
const MAX_CACHE = 5000;
const MAX_HITS = 500; // 見逃しリストに残す件数
const MAX_FEEDBACK = 500; // 判定ログに残す件数

const cache = new Map(); // `${tweetId}:${configHash}` -> { scores, sub, useful }
const inflight = new Map(); // 同上 -> Promise
let active = 0;
const waiters = [];
let usage = null; // { date, count, tokens }

chrome.runtime.onInstalled.addListener(() => loadSettings());

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
  const settings = await loadSettings();
  const categories = settings.categories.filter((c) => c.enabled);
  if (!categories.length) return { scores: {}, sub: {}, useful: null };

  const opts = { usefulness: settings.usefulness };
  const key = `${tweet.id}:${configHash(categories, opts)}`;
  if (cache.has(key)) return cache.get(key);
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
      const response = await callJev(apiKey, buildRequest(tweet, categories, opts));
      const result = extractResult(response, categories);
      cache.set(key, result);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      u.tokens += response?.usage?.input_tokens || 0;
      chrome.storage.local.set({ usage: u });
      setStatus(null);
      return result;
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

// storage.local の配列に、ツイート ID で重複を除いて先頭に追加する。
// 複数タブから同時に来ても取りこぼさないよう、書き込みを直列にする。
let writeChain = Promise.resolve();
function prepend(storageKey, item, max) {
  writeChain = writeChain.then(async () => {
    const list = (await chrome.storage.local.get(storageKey))[storageKey] || [];
    const rest = list.filter((x) => x.id !== item.id);
    const next = item.vote === null ? rest : [item, ...rest].slice(0, max); // vote: null は取り消し
    await chrome.storage.local.set({ [storageKey]: next });
  }).catch(() => {});
  return writeChain;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getSettings') {
    loadSettings().then(sendResponse);
    return true;
  }
  if (msg?.type === 'classify' && msg.tweet?.id) {
    classify(msg.tweet).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg?.type === 'recordHit' && msg.item?.id) {
    // 一度記録したツイートは、既読などの状態を残すため上書きしない。
    writeChain = writeChain.then(async () => {
      const { hits = [] } = await chrome.storage.local.get('hits');
      if (hits.some((h) => h.id === msg.item.id)) return;
      await chrome.storage.local.set({ hits: [msg.item, ...hits].slice(0, MAX_HITS) });
    }).catch(() => {});
    return false;
  }
  if (msg?.type === 'feedback' && msg.item?.id) {
    prepend('feedback', msg.item, MAX_FEEDBACK);
    return false;
  }
  return false;
});
