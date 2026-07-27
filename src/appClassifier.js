const GAME_PACKAGES = [
  'com.tencent.tmgp.sgame',
  'com.tencent.tmgp.pubgmhd',
  'com.mihoyo',
  'com.hypergryph',
  'com.netease',
  'com.supercell',
  'com.roblox',
  'com.mojang',
];

const GAME_KEYWORDS = [
  'game', 'pvp', 'moba', 'pubg', 'sgame', 'mihoyo', 'hypergryph', 'supercell',
  'kings', 'arena', 'battle', 'dungeon', 'kingdom', 'honkai', 'genshin',
  'arknights', 'roblox', 'mojang', '王者荣耀', '和平精英', '原神', '崩坏',
  '明日方舟', '蛋仔派对', '第五人格', '迷你世界', '我的世界',
];

const NOVEL_KEYWORDS = [
  'novel', 'reader', 'read', 'book', 'qidian', 'fanqie', 'hongxiu',
  'zongheng', 'ireader', 'shuqi', 'qqreader', 'yuedu', '小说', '阅读',
  '书旗', '起点', '番茄', '七猫', '掌阅', '纵横', '红袖', '晋江',
];

const STUDY_KEYWORDS = [
  'edu', 'study', 'learn', 'class', 'course', 'homework', 'exam', 'dict',
  'translate', 'calculator', 'note', 'english', 'math', 'xueersi',
  'yuanfudao', 'zuoyebang',
];

const VIDEO_KEYWORDS = [
  'video', 'tv', 'live', 'bilibili', 'douyin', 'tiktok', 'youtube',
  'kuaishou', 'iqiyi', 'youku', 'movie',
];

const SOCIAL_KEYWORDS = [
  'social', 'chat', 'message', 'weixin', 'wechat', 'tencent.mm',
  'tencent.mobileqq', 'sina.weibo', 'moments', 'friend', 'talk', 'telegram',
];

const BROWSER_KEYWORDS = [
  'browser', 'chrome', 'firefox', 'safari', 'edge', 'opera', 'uc', 'sogou',
  'baidu.searchbox', 'webview', 'webkit',
];

const NETDISK_KEYWORDS = ['baidu.netdisk', '网盘'];

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyApp(packageName = '', appName = '', fallback = '其他') {
  const lp = packageName.toLowerCase();
  const ln = appName.toLowerCase();
  const text = `${lp} ${ln}`;

  if (hasAny(text, SOCIAL_KEYWORDS)) return '社交';
  if (GAME_PACKAGES.some((prefix) => lp.startsWith(prefix)) || hasAny(text, GAME_KEYWORDS)) return '游戏';
  if (hasAny(text, NOVEL_KEYWORDS)) return '小说';
  if (hasAny(text, VIDEO_KEYWORDS)) return '视频';
  if (hasAny(text, STUDY_KEYWORDS)) return '学习';
  if (hasAny(text, BROWSER_KEYWORDS)) return '浏览器';
  if (hasAny(text, NETDISK_KEYWORDS)) return '网盘';

  return fallback || '其他';
}

function normalizeRecord(record) {
  return {
    ...record,
    category: classifyApp(record.package_name, record.app_name, record.category),
  };
}

module.exports = { classifyApp, normalizeRecord };
