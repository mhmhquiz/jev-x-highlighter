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

export const SUBTAG_OTHER = 'other';
export const USEFUL_MAX = 2;

// 小分類 (Choice)。カテゴリに該当する前提で聞き、該当しないときは使わない。
function subtagQuestion(cat) {
  const criteria = {};
  for (const t of cat.subtags) criteria[t.name] = t.description || t.name;
  criteria[SUBTAG_OTHER] = 'None of the sub-topics above fit';
  return {
    type: 'choice',
    instructions: `Assume this post is about "${cat.name}" (${cat.instructions}). Which sub-topic does it mainly belong to?`,
    criteria,
  };
}

// 有益さ (Score 0〜2)。
const USEFUL_QUESTION = {
  type: 'score',
  instructions: 'How much concrete, useful information does this post give a reader who is interested in its topic?',
  criteria: [
    'No real information: casual chat, feelings, jokes, or reactions only',
    'Some information: briefly mentions a fact, product, or personal experience',
    'Concrete and useful: specific news, how-to steps, tips, results, or resources worth saving',
  ],
};

const hasSubtags = (cat) => cat.kind !== 'mute' && (cat.subtags || []).some((t) => t.name);

// 1 ツイート = 1 リクエスト。カテゴリごとの Noul と小分類の Choice、有益さの Score を並べる
// (Jev 側で並列評価されるので、質問を増やしても遅くならない)。
export function buildRequest(tweet, categories, { usefulness = false, model = MODEL } = {}) {
  const questions = {};
  for (const cat of categories) {
    questions[`cat_${cat.id}`] = noulQuestion(cat);
    if (hasSubtags(cat)) questions[`sub_${cat.id}`] = subtagQuestion({ ...cat, subtags: cat.subtags.filter((t) => t.name) });
  }
  if (usefulness && categories.some((c) => c.kind !== 'mute')) questions.useful = USEFUL_QUESTION;
  return { model, state: stateOf(tweet), questions };
}

// 応答を { scores: {catId: 確率}, sub: {catId: 小分類名}, useful: 0〜2 | null } にする。
export function extractResult(response, categories) {
  const answers = response?.answers || {};
  const sub = {};
  for (const cat of categories) {
    const choice = answers[`sub_${cat.id}`]?.choice;
    if (choice && choice !== SUBTAG_OTHER) sub[cat.id] = choice;
  }
  const useful = answers.useful?.score;
  return { scores: extractScores(response, categories), sub, useful: typeof useful === 'number' ? useful : null };
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
export function configHash(categories, { usefulness = false } = {}) {
  const s = JSON.stringify([
    usefulness,
    categories.map((c) => [c.id, c.name, c.kind, c.instructions, c.criteriaTrue, c.criteriaFalse, c.subtags]),
  ]);
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
