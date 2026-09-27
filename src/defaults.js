// 初期設定。storage.sync の "settings" が無いときに使う。
export const DEFAULT_SETTINGS = {
  enabled: true,
  // none: そのまま / dim: 薄く表示 / collapse: 折りたたみ / hide: 非表示
  displayMode: 'none',
  threshold: 0.8,
  weakThreshold: 0.5,
  dailyLimit: 3000,
  categories: [
    {
      id: 'ai',
      name: 'AI',
      color: '#8b5cf6',
      enabled: true,
      instructions:
        'Is this post mainly about artificial intelligence, such as generative AI, LLMs, AI chatbots (ChatGPT, Claude, Gemini), AI image/video/music generation, AI tools and how to use them, or AI news and research?',
      criteriaTrue: 'AI の技術・製品・使い方・ニュース・研究・AI で作った作品が話題の中心になっている',
      criteriaFalse: 'AI に一言触れているだけ、または無関係 (例: AIR、愛、家電の「AI搭載」広告、人名のアイ)',
      keywords: [],
      accounts: [],
    },
    {
      id: 'vrc',
      name: 'VRC',
      color: '#06b6d4',
      enabled: true,
      instructions:
        'Is this post mainly about VRChat or social VR, such as VRChat worlds, avatars, avatar customization (アバター改変), VRChat events, photos taken in VRChat, or VR headsets used for VRChat?',
      criteriaTrue: 'VRChat やソーシャル VR の体験・ワールド・アバター・イベント・撮影・機材が話題の中心になっている',
      criteriaFalse: 'VR と無関係、または VR 以外のゲームやメタバースの話題',
      keywords: ['VRChat'],
      accounts: [],
    },
  ],
};
