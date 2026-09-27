import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchRequest, buildRequest, configHash, extractResult, extractScores, stateOf } from '../src/jev.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/defaults.js';

const cats = DEFAULT_SETTINGS.categories.filter((c) => c.id === 'ai' || c.id === 'vrc');
const mute = DEFAULT_SETTINGS.categories.find((c) => c.kind === 'mute');
const tw = { id: '1', author: 'A (@a)', text: 'hello', quoted_text: '', link_card_title: '', image_alt: [], hashtags: [] };

test('state には空でないフィールドだけを入れ、ID は送らない', () => {
  assert.deepEqual(stateOf(tw), { author: 'A (@a)', text: 'hello' });
});

test('カテゴリごとに Noul の質問を作る', () => {
  const req = buildRequest(tw, cats);
  assert.equal(req.model, 'jev-latest');
  assert.deepEqual(Object.keys(req.questions), ['cat_ai', 'sub_ai', 'cat_vrc', 'sub_vrc']);
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

test('小分類は Choice で聞き、「どれでもない」を入れる', () => {
  const q = buildRequest(tw, cats).questions.sub_ai;
  assert.equal(q.type, 'choice');
  assert.ok(q.criteria['画像・動画生成']);
  assert.ok(q.criteria.other);
});

test('ミュートカテゴリには小分類を付けない。有益さは設定が ON のときだけ聞く', () => {
  const withMute = [...cats, { ...mute, subtags: [{ name: 'x', description: '' }] }];
  assert.equal(buildRequest(tw, withMute).questions.sub_drama, undefined);
  assert.equal(buildRequest(tw, cats).questions.useful, undefined);
  const q = buildRequest(tw, cats, { usefulness: true }).questions.useful;
  assert.equal(q.type, 'score');
  assert.equal(q.criteria.length, 3);
  assert.equal(buildRequest(tw, [mute], { usefulness: true }).questions.useful, undefined);
});

test('応答から確率・小分類・有益さを取り出す。other は小分類に使わない', () => {
  const res = {
    answers: {
      cat_ai: { type: 'noul', noul: 0.9 },
      sub_ai: { type: 'choice', choice: 'LLM・チャット' },
      cat_vrc: { type: 'noul', noul: 0.1 },
      sub_vrc: { type: 'choice', choice: 'other' },
      useful: { type: 'score', score: 1.6 },
    },
  };
  assert.deepEqual(extractResult(res, cats), { scores: { ai: 0.9, vrc: 0.1 }, sub: { ai: 'LLM・チャット' }, useful: 1.6 });
  assert.equal(extractResult({ answers: {} }, cats).useful, null);
});

test('小分類や有益さの ON/OFF が変わるとハッシュが変わる', () => {
  const sub = cats.map((c) => ({ ...c, subtags: [] }));
  assert.notEqual(configHash(cats), configHash(sub));
  assert.notEqual(configHash(cats), configHash(cats, { usefulness: true }));
});

test('古い設定には種類・しきい値・小分類を補う', () => {
  const s = normalizeSettings({ categories: [{ id: 'x', name: 'X' }] });
  assert.equal(s.categories[0].kind, 'highlight');
  assert.equal(s.categories[0].threshold, null);
  assert.deepEqual(s.categories[0].subtags, []);
  assert.equal(s.muteMode, 'collapse');
});

test('後から加えた初期カテゴリ (VALORANT、地震) は既存の設定に 1 回だけ足す', () => {
  const old = { categories: [{ id: 'ai', name: 'AI' }, { id: 'drama', name: 'D', kind: 'mute' }] };
  const s = normalizeSettings(old);
  assert.deepEqual(s.categories.map((c) => c.id), ['ai', 'valorant', 'drama', 'quake']);
  // 足したあとに消した場合は戻さない
  const removed = normalizeSettings({ ...s, categories: s.categories.filter((c) => c.id !== 'valorant') });
  assert.deepEqual(removed.categories.map((c) => c.id), ['ai', 'drama', 'quake']);
  // VALORANT だけ入っている設定 (バージョン 2) には地震だけ足す
  const v2 = normalizeSettings({ defaultsVersion: 2, categories: [{ id: 'ai', name: 'AI' }] });
  assert.deepEqual(v2.categories.map((c) => c.id), ['ai', 'quake']);
});

test('v3 までの AI カテゴリにはキーワードを足し、初期値のままの判定文だけ広げる', () => {
  const oldAi = {
    id: 'ai',
    name: 'AI',
    instructions:
      'Is this post mainly about artificial intelligence, such as generative AI, LLMs, AI chatbots (ChatGPT, Claude, Gemini), AI image/video/music generation, AI tools and how to use them, or AI news and research?',
    criteriaTrue: '自分で書き換えた条件',
    keywords: ['claude', '自作ワード'],
  };
  const s = normalizeSettings({ defaultsVersion: 3, categories: [oldAi] });
  const ai = s.categories.find((c) => c.id === 'ai');
  const def = DEFAULT_SETTINGS.categories.find((c) => c.id === 'ai');
  assert.equal(ai.instructions, def.instructions);
  assert.equal(ai.criteriaTrue, '自分で書き換えた条件');
  assert.ok(ai.keywords.includes('ChatGPT') && ai.keywords.includes('自作ワード'));
  assert.equal(ai.keywords.filter((k) => k.toLowerCase() === 'claude').length, 1);
  // 移行済みの設定には再度足さない
  const again = normalizeSettings({ ...s, categories: [{ ...ai, keywords: ['自作ワード'] }] });
  assert.deepEqual(again.categories[0].keywords, ['自作ワード']);
});
