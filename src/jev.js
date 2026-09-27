// Jev (TypeSafe AI) の呼び出し。service worker と PoC スクリプトで共用する。
// https://docs.typesafe.ai/api

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-latest';

const STATE_FIELDS = ['author', 'text', 'quoted_text', 'link_card_title', 'image_alt', 'hashtags'];

export class JevError extends Error {
  constructor(status, detail) {
    super(`Jev API ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

// ツイートから、判定に必要なフィールドだけを残す (余計な文脈は精度を下げるため)。
export function stateOf(tweet) {
  const state = {};
  for (const key of STATE_FIELDS) {
    const v = tweet[key];
    if (Array.isArray(v) ? v.length : v) state[key] = v;
  }
  return state;
}

function noulQuestion(cat, instructions = cat.instructions) {
  const q = { type: 'noul', instructions };
  const criteria = {};
  if (cat.criteriaTrue) criteria.true = cat.criteriaTrue;
  if (cat.criteriaFalse) criteria.false = cat.criteriaFalse;
  if (Object.keys(criteria).length) q.criteria = criteria;
  return q;
}

// 1 ツイート = 1 リクエスト。カテゴリごとの Noul を並べる (Jev 側で並列評価される)。
export function buildRequest(tweet, categories, model = MODEL) {
  const questions = {};
  for (const cat of categories) questions[`cat_${cat.id}`] = noulQuestion(cat);
  return { model, state: stateOf(tweet), questions };
}

// 複数ツイートを 1 リクエストにまとめる方式 (PoC で比較する用)。
export function buildBatchRequest(tweets, categories, model = MODEL) {
  const questions = {};
  tweets.forEach((_, i) => {
    for (const cat of categories) {
      questions[`t${i}_${cat.id}`] = noulQuestion(cat, `About \`tweets[${i}]\` only: ${cat.instructions}`);
    }
  });
  return { model, state: { tweets: tweets.map(stateOf) }, questions };
}

export function extractScores(response, categories, prefix = 'cat_') {
  const scores = {};
  for (const cat of categories) scores[cat.id] = response?.answers?.[`${prefix}${cat.id}`]?.noul ?? 0;
  return scores;
}

// 判定に影響する設定だけのハッシュ。変わったらキャッシュを捨てる。
export function configHash(categories) {
  const s = JSON.stringify(categories.map((c) => [c.id, c.instructions, c.criteriaTrue, c.criteriaFalse]));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 / 529 は指数バックオフで再試行する。
export async function callJev(apiKey, body, { timeoutMs = 8000, retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 529) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }
    const detail = await res.text().catch(() => '');
    throw new JevError(res.status, detail.slice(0, 300));
  }
}
