import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchRequest, buildRequest, configHash, extractScores, stateOf } from '../src/jev.js';
import { DEFAULT_SETTINGS } from '../src/defaults.js';

const cats = DEFAULT_SETTINGS.categories;
const tw = { id: '1', author: 'A (@a)', text: 'hello', quoted_text: '', link_card_title: '', image_alt: [], hashtags: [] };

test('state には空でないフィールドだけを入れ、ID は送らない', () => {
  assert.deepEqual(stateOf(tw), { author: 'A (@a)', text: 'hello' });
});

test('カテゴリごとに Noul の質問を作る', () => {
  const req = buildRequest(tw, cats);
  assert.equal(req.model, 'jev-latest');
  assert.deepEqual(Object.keys(req.questions), ['cat_ai', 'cat_vrc']);
  assert.equal(req.questions.cat_ai.type, 'noul');
  assert.ok(req.questions.cat_ai.criteria.true);
});

test('まとめて判定するリクエストは tweets[i] を指す', () => {
  const req = buildBatchRequest([tw, tw], cats);
  assert.equal(req.state.tweets.length, 2);
  assert.match(req.questions.t1_vrc.instructions, /`tweets\[1\]`/);
});

test('応答から確率を取り出す', () => {
  const res = { answers: { cat_ai: { type: 'noul', noul: 0.91 } } };
  assert.deepEqual(extractScores(res, cats), { ai: 0.91, vrc: 0 });
});

test('判定に関わる設定が変わるとハッシュが変わる', () => {
  const changed = cats.map((c) => ({ ...c, instructions: `${c.instructions}!` }));
  const colorOnly = cats.map((c) => ({ ...c, color: '#000000' }));
  assert.notEqual(configHash(cats), configHash(changed));
  assert.equal(configHash(cats), configHash(colorOnly));
});
