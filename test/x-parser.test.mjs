import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = {};
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../src/x-parser.js', import.meta.url), 'utf8'), context);
// vm 側の配列は別レルムなので、比較できるよう手元の配列に移す。
const parse = (json) => Array.from(context.__jevParseX(json));

const user = (name, screen_name) => ({ user_results: { result: { __typename: 'User', core: { name, screen_name } } } });
const tweet = (id, text, extra = {}) => ({
  __typename: 'Tweet',
  rest_id: id,
  core: user('Alice', 'alice'),
  legacy: { full_text: text, entities: { hashtags: [] }, ...extra.legacy },
  ...extra.root,
});
const entry = (itemContent) => ({ content: { entryType: 'TimelineTimelineItem', itemContent } });

test('タイムラインからツイートを取り出す', () => {
  const json = {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                entry({ itemType: 'TimelineTweet', tweet_results: { result: tweet('1', 'Claude で遊んだ', { legacy: { entities: { hashtags: [{ text: 'AI' }] } } }) } }),
                entry({
                  itemType: 'TimelineTweet',
                  tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: tweet('2', 'VRChat のワールド紹介') } },
                }),
              ],
            },
          ],
        },
      },
    },
  };
  const out = parse(json);
  assert.deepEqual(out.map((t) => t.id), ['1', '2']);
  assert.equal(out[0].author, 'Alice (@alice)');
  assert.deepEqual([...out[0].hashtags], ['AI']);
  assert.equal(out[1].text, 'VRChat のワールド紹介');
});

test('広告 (promotedMetadata) は無視する', () => {
  const json = {
    entries: [
      entry({ itemType: 'TimelineTweet', promotedMetadata: { advertiser_results: {} }, tweet_results: { result: tweet('9', '広告です') } }),
      entry({ itemType: 'TimelineTweet', tweet_results: { result: tweet('3', '通常ツイート') } }),
    ],
  };
  assert.deepEqual(parse(json).map((t) => t.id), ['3']);
});

test('リツイートは元ツイートを、引用は本文として取り出す', () => {
  const original = tweet('10', '元ツイート');
  const quoted = tweet('20', '引用元の本文');
  const json = [
    tweet('11', 'RT @bob: 元ツ...', { legacy: { retweeted_status_result: { result: original } } }),
    tweet('12', 'これいいね', { root: { quoted_status_result: { result: quoted } } }),
  ];
  const out = parse(json);
  assert.deepEqual(out.map((t) => t.id), ['10', '12']);
  assert.equal(out[1].quoted_text, '引用元の本文');
});

test('長文ツイートは note_tweet の本文を使う', () => {
  const long = tweet('30', '短縮された本文…', {
    root: { note_tweet: { note_tweet_results: { result: { text: '長文の全文' } } } },
  });
  assert.equal(parse(long)[0].text, '長文の全文');
});
