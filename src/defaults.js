// 初期設定。保存された設定が無いときに使う。
export const DEFAULT_SETTINGS = {
  enabled: true,
  // 対象外のツイート。none: そのまま / dim: 薄く表示 / collapse: 折りたたみ / hide: 非表示
  displayMode: 'none',
  // ミュートカテゴリに該当したツイート。dim / collapse / hide
  muteMode: 'collapse',
  // カテゴリにしきい値が無いときに使う全体のしきい値
  threshold: 0.8,
  weakThreshold: 0.5,
  dailyLimit: 3000,
  // 有益さ (Score 0〜2) を判定して 💡 を付ける
  usefulness: true,
  // 有益さが低い (0.8 未満) ツイートは、強調を弱い強調に落とす
  usefulOnly: false,
  // ラベルの横に 👍 / 👎 を出す
  feedbackButtons: true,
  categories: [
    {
      id: 'ai',
      name: 'AI',
      color: '#8b5cf6',
      enabled: true,
      kind: 'highlight', // highlight: 強調 / mute: 薄く・隠す
      threshold: null, // null なら全体のしきい値
      instructions:
        'Is this post mainly about artificial intelligence, such as generative AI, LLMs, AI chatbots (ChatGPT, Claude, Gemini), AI image/video/music generation, AI tools and how to use them, or AI news and research?',
      criteriaTrue: 'AI の技術・製品・使い方・ニュース・研究・AI で作った作品が話題の中心になっている',
      criteriaFalse: 'AI に一言触れているだけ、または無関係 (例: AIR、愛、家電の「AI搭載」広告、人名のアイ)',
      keywords: [],
      accounts: [],
      subtags: [
        { name: '画像・動画生成', description: 'AI による画像・イラスト・動画・音楽の生成' },
        { name: 'LLM・チャット', description: 'ChatGPT、Claude、Gemini などの対話 AI や大規模言語モデル' },
        { name: 'ツール・使い方', description: 'AI ツールの使い方、プロンプト、活用のコツ、開発での利用' },
        { name: 'ニュース・発表', description: '新しいモデルや製品の発表、企業の動き、業界ニュース' },
        { name: '研究・論文', description: '論文、研究成果、ベンチマーク、技術的な解説' },
      ],
    },
    {
      id: 'vrc',
      name: 'VRC',
      color: '#06b6d4',
      enabled: true,
      kind: 'highlight',
      threshold: null,
      instructions:
        'Is this post mainly about VRChat or social VR, such as VRChat worlds, avatars, avatar customization (アバター改変), VRChat events, photos taken in VRChat, or VR headsets used for VRChat?',
      criteriaTrue: 'VRChat やソーシャル VR の体験・ワールド・アバター・イベント・撮影・機材が話題の中心になっている',
      criteriaFalse: 'VR と無関係、または VR 以外のゲームやメタバースの話題',
      keywords: ['VRChat'],
      accounts: [],
      subtags: [
        { name: 'ワールド', description: 'VRChat のワールドの紹介・制作・探索' },
        { name: 'アバター・改変', description: 'アバターの購入・改変・衣装・制作' },
        { name: 'イベント・交流', description: 'VRChat 内のイベント、集会、フレンドとの交流' },
        { name: '撮影・写真', description: 'VRChat で撮った写真やスクリーンショット、撮影テクニック' },
        { name: '機材・技術', description: 'VR ヘッドセット、トラッカー、PC、Unity や SDK などの技術' },
      ],
    },
    {
      id: 'valorant',
      name: 'VALORANT',
      color: '#ff4655',
      enabled: true,
      kind: 'highlight',
      threshold: null,
      instructions:
        'Is this post mainly about VALORANT (the tactical FPS game by Riot Games), such as gameplay, clips, ranked matches, agents, maps, strategies, patches, esports tournaments (VCT) and pro teams, or finding teammates?',
      criteriaTrue: 'VALORANT のプレイ・クリップ・ランク・エージェント・マップ・戦術・アップデート・大会 (VCT) やプロチーム・募集が話題の中心になっている',
      criteriaFalse: 'VALORANT 以外のゲーム (Apex、CS2、オーバーウォッチなど)、または「valor (勇気)」などゲームと無関係な話題',
      keywords: ['VALORANT', 'ヴァロラント'],
      accounts: [],
      subtags: [
        { name: 'プレイ・クリップ', description: '自分や配信者のプレイ、クリップ、ハイライト、ランクの報告' },
        { name: 'エージェント・戦術', description: 'エージェント、マップ、定点、立ち回り、設定などの攻略' },
        { name: '大会・プロ', description: 'VCT などの大会、プロチームや選手、試合結果' },
        { name: 'アップデート', description: 'パッチノート、新エージェント・新マップ、スキン、公式の発表' },
        { name: '募集・交流', description: 'フルパやカスタムの募集、コミュニティ、フレンド募集' },
      ],
    },
    {
      id: 'drama',
      name: '炎上・政治',
      color: '#6b7280',
      enabled: false,
      kind: 'mute',
      threshold: null,
      instructions:
        'Is this post mainly about online drama, flame wars, attacking or criticizing a person, or political arguments?',
      criteriaTrue: '炎上、誰かへの批判や攻撃、政治的な主張や論争が話題の中心になっている',
      criteriaFalse: 'ニュースを淡々と伝えているだけ、または無関係',
      keywords: [],
      accounts: [],
      subtags: [],
    },
    {
      id: 'quake',
      name: '地震',
      color: '#b45309',
      enabled: true,
      kind: 'mute',
      threshold: null,
      instructions:
        'Is this post mainly about earthquakes, such as earthquake alerts and reports, seismic intensity (震度), tsunami warnings, aftershocks, earthquake damage, or earthquake predictions?',
      criteriaTrue: '地震の発生・速報・震度・津波・余震・被害・地震予知や予言が話題の中心になっている',
      criteriaFalse: '地震に一言触れているだけ、または地震と無関係な話題 (例: 「業界に激震」のような比喩、ゲーム内の揺れ)',
      keywords: ['緊急地震速報', '地震速報', '震度'],
      accounts: [],
      subtags: [],
    },
  ],
};

// 後から初期カテゴリに加えたもの。既存の設定にも 1 回だけ足す (消したものは戻さない)。
export const DEFAULTS_VERSION = 3;
const ADDED_CATEGORIES = { 2: ['valorant'], 3: ['quake'] };

// 古い設定に無い項目を補う。
export function normalizeSettings(stored) {
  const s = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  const from = stored ? stored.defaultsVersion || 1 : DEFAULTS_VERSION;
  for (let v = from + 1; v <= DEFAULTS_VERSION; v++) {
    for (const id of ADDED_CATEGORIES[v] || []) {
      if (s.categories.some((c) => c.id === id)) continue;
      const cat = DEFAULT_SETTINGS.categories.find((c) => c.id === id);
      const muteAt = s.categories.findIndex((c) => c.kind === 'mute');
      const at = cat.kind === 'mute' || muteAt < 0 ? s.categories.length : muteAt; // 強調はミュートより前、ミュートは末尾
      s.categories = [...s.categories];
      s.categories.splice(at, 0, cat);
    }
  }
  s.defaultsVersion = DEFAULTS_VERSION;
  s.categories = (s.categories || []).map((c) => ({
    kind: 'highlight',
    threshold: null,
    keywords: [],
    accounts: [],
    subtags: [],
    ...c,
  }));
  return s;
}

// 設定は storage.local に置く (storage.sync は 1 項目 8KB までで、カテゴリの例を増やすと溢れるため)。
// 以前 storage.sync に保存していた設定があれば、最初の読み込み時に移す。
export async function loadSettings() {
  let { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    settings = (await chrome.storage.sync.get('settings')).settings;
    if (settings) await chrome.storage.local.set({ settings });
  }
  const normalized = normalizeSettings(settings);
  if (settings && settings.defaultsVersion !== normalized.defaultsVersion) await saveSettings(normalized);
  return normalized;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
