// ページ側 (MAIN world) で fetch / XHR をフックし、X のタイムライン API の応答を横取りする。
// 描画より先にツイートを content script に渡すことで、画面に入る前に判定を終わらせる。
(function () {
  const TARGET = /\/i\/api\/graphql\//;

  function publish(json) {
    try {
      const tweets = globalThis.__jevParseX(json);
      if (tweets.length) window.postMessage({ source: 'jev-x', type: 'tweets', tweets }, location.origin);
    } catch {
      // 解析に失敗しても X の動作には影響させない。
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url && TARGET.test(url)) res.clone().json().then(publish, () => {});
    } catch {
      // 無視
    }
    return res;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' && TARGET.test(url)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === 'json') publish(this.response);
          else if (this.responseType === '' || this.responseType === 'text') publish(JSON.parse(this.responseText));
        } catch {
          // 無視
        }
      });
    }
    return originalOpen.call(this, method, url, ...rest);
  };
})();
