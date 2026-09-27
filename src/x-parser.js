// X の GraphQL 応答 (HomeTimeline, SearchTimeline, TweetDetail など) からツイートを取り出す。
// ページ側 (MAIN world) で読み込み、globalThis.__jevParseX として公開する。
// 広告 (promotedMetadata を持つ項目) は無視する。
(function () {
  function unwrap(result) {
    if (!result) return null;
    if (result.__typename === 'TweetWithVisibilityResults') return result.tweet || null;
    return result;
  }

  function fullText(t) {
    return t?.note_tweet?.note_tweet_results?.result?.text || t?.legacy?.full_text || '';
  }

  function author(t) {
    const u = t?.core?.user_results?.result;
    if (!u) return '';
    const name = u.core?.name ?? u.legacy?.name ?? '';
    const screenName = u.core?.screen_name ?? u.legacy?.screen_name ?? '';
    return screenName ? `${name} (@${screenName})` : name;
  }

  function cardTitle(t) {
    const values = t?.card?.legacy?.binding_values;
    if (!Array.isArray(values)) return '';
    return values.find((b) => b.key === 'title')?.value?.string_value || '';
  }

  function toTweet(t) {
    const legacy = t.legacy || {};
    const quoted = unwrap(t.quoted_status_result?.result);
    return {
      id: String(t.rest_id),
      author: author(t),
      text: fullText(t),
      quoted_text: quoted ? fullText(quoted) : '',
      link_card_title: cardTitle(t),
      image_alt: (legacy.extended_entities?.media || []).map((m) => m.ext_alt_text).filter(Boolean),
      hashtags: (legacy.entities?.hashtags || []).map((h) => h.text).filter(Boolean),
    };
  }

  function parse(root) {
    const out = new Map();
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (node.promotedMetadata) return;
      if (node.__typename === 'Tweet' && node.rest_id && node.legacy) {
        // リツイートは元ツイートを判定する (画面にも元ツイートの ID で描画される)。
        const retweeted = unwrap(node.legacy.retweeted_status_result?.result);
        if (retweeted) {
          walk(retweeted);
        } else if (!out.has(node.rest_id)) {
          out.set(node.rest_id, toTweet(node));
        }
        return;
      }
      for (const key in node) walk(node[key]);
    })(root);
    return [...out.values()];
  }

  globalThis.__jevParseX = parse;
})();
