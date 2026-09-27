// Jev の日本語ツイート判定の精度と速度を測る PoC。
//   TYPESAFE_API_KEY を環境変数に入れて実行する:  npm run poc [-- samples.json]
// samples.json の形式: [{ "text": "...", "author": "(任意)", "label": "ai" | "vrc" | "valorant" | "other" }]
import { readFileSync } from 'node:fs';
import { buildBatchRequest, buildRequest, callJev, extractScores } from '../src/jev.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  console.error('環境変数 TYPESAFE_API_KEY を設定してから実行してください。');
  process.exit(1);
}

const file = process.argv[2] || new URL('./samples.example.json', import.meta.url);
const samples = JSON.parse(readFileSync(file, 'utf8')).map((s, i) => ({ id: String(i), ...s }));
const cats = DEFAULT_SETTINGS.categories.filter((c) => c.enabled && c.kind !== 'mute');
const THRESHOLD = DEFAULT_SETTINGS.threshold;
const CONCURRENCY = 8;

const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

function predict(scores) {
  const [best] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return best && best[1] >= THRESHOLD ? best[0] : 'other';
}

function report(title, rows, latencies) {
  const correct = rows.filter((r) => r.pred === r.label).length;
  console.log(`\n=== ${title}`);
  console.log(`精度: ${correct}/${rows.length} (${((correct / rows.length) * 100).toFixed(1)}%)  しきい値 ${THRESHOLD}`);
  console.log(`応答時間: p50 ${percentile(latencies, 0.5)}ms / p95 ${percentile(latencies, 0.95)}ms / 最大 ${Math.max(...latencies)}ms`);
  for (const r of rows.filter((r) => r.pred !== r.label)) {
    const s = Object.entries(r.scores).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ');
    console.log(`  × 正解 ${r.label} / 判定 ${r.pred} [${s}] ${r.text.slice(0, 50).replace(/\n/g, ' ')}`);
  }
}

async function single() {
  const rows = [];
  const latencies = [];
  const queue = [...samples];
  async function worker() {
    for (let s; (s = queue.shift()); ) {
      const t0 = performance.now();
      const res = await callJev(apiKey, buildRequest(s, cats));
      latencies.push(Math.round(performance.now() - t0));
      const scores = extractScores(res, cats);
      rows.push({ ...s, scores, pred: predict(scores) });
    }
  }
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  report(`1 件 1 リクエスト (${CONCURRENCY} 並列, 全体 ${Math.round(performance.now() - t0)}ms)`, rows, latencies);
}

async function batch(size = 20) {
  const rows = [];
  const latencies = [];
  for (let i = 0; i < samples.length; i += size) {
    const chunk = samples.slice(i, i + size);
    const t0 = performance.now();
    const res = await callJev(apiKey, buildBatchRequest(chunk, cats));
    latencies.push(Math.round(performance.now() - t0));
    chunk.forEach((s, j) => {
      const scores = extractScores(res, cats, `t${j}_`);
      rows.push({ ...s, scores, pred: predict(scores) });
    });
  }
  report(`${size} 件まとめて 1 リクエスト`, rows, latencies);
}

await single();
await batch();
