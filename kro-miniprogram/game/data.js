/**
 * Kingdom Rush Origins（王国保卫战：起源）— 微信小程序版内容数据模块
 * ------------------------------------------------------------------
 * 数据忠实性原则：
 *   所有中文名 / 英文名 / 开场剧情 / 技能描述 / 漫画对白 / 成就名，
 *   均取自逆向报告 KRO_逆向分析报告.md 与 strings/en_kv.json、zh_kv.json、
 *   zh-Hans.lua.txt 的真实原文（LuaJIT 字符串常量取证结果）。
 *   逆向报告明确指出：逐塔造价 / 伤害 / 射程 / 攻速、逐敌血量 / 护甲等
 *   精确数值内联在字节码立即数中，未经反编译无法可靠配对。
 *   因此本文件中的 cost / damage / hp / speed / armor / bounty / range / rate
 *   等数值为「可玩平衡值」，仅用于让塔防引擎可直接运行；名称与文本忠实原作。
 *
 * 纯数据 + 少量纯函数；无外部依赖，不调用 wx / 云 API，不操作 DOM。
 * CommonJS：module.exports = { ... }
 */

// ===================================================================
// 内部工具函数：确定性生成关卡路径与建塔点（结果在模块加载时固化为纯数据）
// 逻辑坐标：x ∈ [0,1000]，y ∈ [0,600]，路径自左边缘进入、右边缘出口离开。
// ===================================================================
function _rng(seed) {
  var s = (seed * 2654435761) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function _distToPolyline(px, py, path) {
  var best = Infinity;
  for (var i = 0; i < path.length - 1; i++) {
    var a = path[i], b = path[i + 1];
    var dx = b.x - a.x, dy = b.y - a.y;
    var l2 = dx * dx + dy * dy || 1;
    var t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    var qx = a.x + dx * t, qy = a.y + dy * t;
    var d = Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
    if (d < best) best = d;
  }
  return best;
}

// 蛇形蜿蜒折线，x 单调递增，保证从左边缘到右边缘
function _makePath(seed, turns) {
  var r = _rng(seed);
  var n = turns || 8;
  var pts = [];
  var phase = r() * Math.PI * 2;
  pts.push({ x: 0, y: 90 + Math.round(r() * 420) });
  for (var i = 1; i < n; i++) {
    var x = Math.round((i * 1000) / n);
    var wave = Math.sin(i * 1.9 + phase) * 170;
    var y = 300 + wave + (r() - 0.5) * 80;
    y = Math.max(70, Math.min(530, Math.round(y)));
    pts.push({ x: x, y: y });
  }
  pts.push({ x: 1000, y: 90 + Math.round(r() * 420) });
  return pts;
}

// 在路径两侧法线方向布置建塔点；剔除落在路径上与相互重叠者
function _makeSlots(path, seed, target) {
  var r = _rng(seed + 7777);
  var cand = [];
  for (var i = 0; i < path.length - 1; i++) {
    var a = path[i], b = path[i + 1];
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    for (var s = 0; s < 2; s++) {
      var sign = s === 0 ? 1 : -1;
      for (var k = 0; k < 3; k++) {
        var t = 0.3 + k * 0.2;
        var off = 70 + r() * 20;
        var x = Math.round(Math.max(40, Math.min(960, a.x + dx * t + nx * sign * off)));
        var y = Math.round(Math.max(40, Math.min(560, a.y + dy * t + ny * sign * off)));
        cand.push({ x: x, y: y });
      }
    }
  }
  for (var m = cand.length - 1; m > 0; m--) {
    var j = Math.floor(r() * (m + 1));
    var tmp = cand[m]; cand[m] = cand[j]; cand[j] = tmp;
  }
  var out = [];
  for (var c = 0; c < cand.length; c++) {
    var p = cand[c];
    if (_distToPolyline(p.x, p.y, path) < 52) continue;
    var overlap = false;
    for (var o = 0; o < out.length; o++) {
      var q = out[o];
      if (Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)) < 66) {
        overlap = true; break;
      }
    }
    if (overlap) continue;
    out.push(p);
    if (out.length >= (target || 10)) break;
  }
  return out;
}

// ===================================================================
// THEMES — 7+ 个场景主题，手绘卡通奇幻高饱和配色
// ===================================================================
var THEMES = {
  elven_woods: {
    nameZh: '精灵森林', nameEn: 'Elven Woods',
    sky: '#8ed6c8', ground: '#4f8f3a', path: '#c9a86a', accent: '#f2d24b', fog: '#bfe8d0'
  },
  faerie_grove: {
    nameZh: '妖精林地', nameEn: 'Faerie Grove',
    sky: '#b98ee0', ground: '#5aa06a', path: '#d8c39a', accent: '#ff7fd1', fog: '#e6c8f5'
  },
  ancient_metropolis: {
    nameZh: '古城遗迹', nameEn: 'Ancient Metropolis',
    sky: '#d9c27a', ground: '#8a7a9c', path: '#e6d3a3', accent: '#c9a227', fog: '#efe0b0'
  },
  bittering_rancor: {
    nameZh: '苦涩怨恨', nameEn: 'Bittering Rancor',
    sky: '#7a3b6b', ground: '#3f2a4d', path: '#9c7b8a', accent: '#e0457b', fog: '#a05f86'
  },
  forgotten_treasures: {
    nameZh: '秘宝之境', nameEn: 'Forgotten Treasures',
    sky: '#7fd0e0', ground: '#3f7fa0', path: '#d6e6ea', accent: '#66e0ff', fog: '#bfeef7'
  },
  hulking_rage: {
    nameZh: '狂暴之地', nameEn: 'Hulking Rage',
    sky: '#e0783c', ground: '#6b3a2a', path: '#b98a5a', accent: '#ffcf4b', fog: '#f0a066'
  },
  mactans_malicia: {
    nameZh: '蛛巢与暮光', nameEn: 'Mactans / Malicia',
    sky: '#5a2a5e', ground: '#2e2038', path: '#8a6a7a', accent: '#d63c7a', fog: '#8c5a8f'
  },
  tainted_pit: {
    nameZh: '污染矿坑', nameEn: 'Tainted Pit',
    sky: '#8c3b2e', ground: '#3a2420', path: '#7a5a4a', accent: '#ff5a2a', fog: '#c06040'
  }
};

// ===================================================================
// LEVELS — 22 主线关 + 2 无尽关
// history 为真实的 LEVEL_n_HISTORY（中文原文），来源 strings/zh_kv.json
// ===================================================================
var _levelDefs = [
  { id: 1, nameZh: '灰鸦港口', nameEn: 'Gray Ravens', history: '将军，一批豺狼人正向我们逼近！', theme: 'elven_woods', seed: 11, turns: 8, waves: 10, bossId: null, endless: false },
  { id: 2, nameZh: '高桥', nameEn: 'The High Cross', history: '那批豺狼人的先遣队只能算是练练手。探子回报有更多豺狼人正准备通过古桥。', theme: 'elven_woods', seed: 22, turns: 9, waves: 11, bossId: null, endless: false },
  { id: 3, nameZh: '瀑布小径', nameEn: 'Waterfalls Trail', history: '正如我们所料，敌人大军过桥失败，此刻来到下游试图展开侧面袭击，将军。', theme: 'elven_woods', seed: 33, turns: 9, waves: 12, bossId: null, endless: false },
  { id: 4, nameZh: '红杉阻击战', nameEn: 'Redwood Stand', history: '豺狼人丘陵肯定空空如也，因为每一只这种丑恶的生物似乎都跑来入侵我们的领土了！', theme: 'faerie_grove', seed: 44, turns: 10, waves: 12, bossId: null, endless: false },
  { id: 5, nameZh: '皇家庭园', nameEn: 'Royal Gardens', history: '大事不妙，将军！', theme: 'faerie_grove', seed: 55, turns: 10, waves: 13, bossId: null, endless: false },
  { id: 6, nameZh: '狮鹫驿站', nameEn: 'Gryphon Point', history: '看来，暮光精灵的女王玛丽西娅就是这场浩劫的元凶。她派来了整个豺狼人部族，就是为了杀害艾莉瑞雅 —— 艾纳妮最后的血脉。他们将我们包围起来，整个狮鹫山脉的高原都能听到他们的咆哮声。', theme: 'ancient_metropolis', seed: 66, turns: 10, waves: 13, bossId: null, endless: false },
  { id: 7, nameZh: '石环阵', nameEn: 'Rockhenge', history: '战争越演越烈，我们边打边撤退，让入侵者每得到一寸我们所让出的领土都付出沉重的代价。', theme: 'elven_woods', seed: 77, turns: 11, waves: 14, bossId: null, endless: false },
  { id: 8, nameZh: '格林堡之战', nameEn: 'Grimmsburg', history: '令人生畏的森林守护者虽然加入了我们这一边，但还是有不少妖灵选择了投靠敌人；阵阵逼近的狂暴嘶吼，令大家感到很不安...', theme: 'faerie_grove', seed: 88, turns: 11, waves: 14, bossId: null, endless: false },
  { id: 9, nameZh: '水晶之湖', nameEn: 'The Crystal Lake', history: '渡过水晶之湖的决定让德鲁伊盟友感到很不安，我听到他们窃窃私语谈论有关格鲁斯兰巨蟒的传言，但他们拒绝进一步谈论此事。', theme: 'forgotten_treasures', seed: 99, turns: 11, waves: 15, bossId: null, endless: false },
  { id: 10, nameZh: '奇迹仙境', nameEn: 'Neverwonder', history: '尽管我们身经百战，但如今早已濒临崩溃边缘。', theme: 'faerie_grove', seed: 110, turns: 12, waves: 15, bossId: null, endless: false },
  { id: 11, nameZh: '罪恶精灵王庭', nameEn: 'The Unseelie Court', history: '在罪恶精灵王庭，既没有安稳的避难之所，也没有休整的宁静之地，精灵们已近穷途末路。敌人占了领皇宫，玛丽西娅也自封为罪恶精灵女王。', theme: 'bittering_rancor', seed: 121, turns: 12, waves: 16, bossId: null, endless: false },
  { id: 12, nameZh: '追本溯源', nameEn: 'The Ascent', history: '我们仍然无法想像到底要面对多么恐怖的敌人。最毒不过黑寡妇，古代蜘蛛女王之一。', theme: 'ancient_metropolis', seed: 132, turns: 12, waves: 16, bossId: 'spider_goddess', endless: false },
  { id: 13, nameZh: '奥术都市', nameEn: 'Arcane Quarters', history: '漂浮的城市与浮空的残骸，连接成最让人无法想像的危险阶梯。', theme: 'ancient_metropolis', seed: 143, turns: 13, waves: 16, bossId: null, endless: false },
  { id: 14, nameZh: '黑寡妇避难所', nameEn: "Mactans' Retreat", history: '暮光精灵丝毫不放过任何一次伏击我们的机会，通往城市中心的道路上，布满了敌我双方的尸体。', theme: 'mactans_malicia', seed: 154, turns: 13, waves: 17, bossId: 'malicia', endless: false },
  { id: 15, nameZh: '艾纳妮神殿', nameEn: 'Shrine of Elynie', history: '将军，敌人已在我们的女神雕像周围部署军队！此时此刻，黑寡妇与玛丽西娅正全力以赴，夺取强大的“艾纳妮之泪”。整个神殿都充满那泪滴中的上古神力；那股力量不仅造就了我族，如今也让我们疲惫不堪的士兵们重获力量。', theme: 'faerie_grove', seed: 165, turns: 13, waves: 17, bossId: null, endless: false },
  { id: 16, nameZh: '加拉里安之墙', nameEn: "Galadrian's Wall", history: '将军，我们已经抵达食人魔领地的边境。神秘食人魔带领豺狼人部族试图侵入我国国境，只有少数几支卫队仍在废墟城墙边死守。', theme: 'hulking_rage', seed: 176, turns: 13, waves: 18, bossId: null, endless: false },
  { id: 17, nameZh: '血石矿场', nameEn: 'Blood Quarry', history: '这里就是食人魔提取腐化矿物，供养其魔法的地方。如果我们切断他们的血曜石补给，就能削弱他们的术士。', theme: 'hulking_rage', seed: 187, turns: 14, waves: 18, bossId: null, endless: false },
  { id: 18, nameZh: '歼灭者王座', nameEn: "Beheader's Seat", history: '食人魔及其豺狼人盟友已经撤退到他们残忍的国王歼灭者布拉姆所在的村庄。这将是一场没有宽恕的恶战，将军。', theme: 'hulking_rage', seed: 198, turns: 14, waves: 19, bossId: 'bram', endless: false },
  { id: 19, nameZh: '暮色森林岗哨', nameEn: 'Duskwood Outpost', history: '将军，我们必须立即向暮光精灵的首都推进。玛丽西娅手下最后一个忠实的将领正在准备一道可怕而强大的法术，能够摧毁眼前的一切。', theme: 'bittering_rancor', seed: 209, turns: 14, waves: 19, bossId: 'twilight_brute', endless: false },
  { id: 20, nameZh: '都尔德郊原', nameEn: 'Duredhel Outskirts', history: '这是最后的攻坚战了，将军！', theme: 'bittering_rancor', seed: 220, turns: 15, waves: 20, bossId: 'bajninmen', endless: false },
  { id: 21, nameZh: '矮人国之门', nameEn: 'Dwaraman Gates', history: '战争已经结束，又或者只是我们想当然...', theme: 'ancient_metropolis', seed: 231, turns: 15, waves: 20, bossId: null, endless: false },
  { id: 22, nameZh: '污染矿坑', nameEn: 'Tainted Pit', history: '将军！', theme: 'tainted_pit', seed: 242, turns: 15, waves: 20, bossId: 'godieth', endless: false },
  { id: 81, nameZh: '勇士之墓', nameEn: "Valor's Rest", history: '战斗号角响彻呼啸沼泽，豺狼人部族纷纷响应邪恶者嘻嗬的号召，集结于战旗之下。将军，我们必须不惜一切代价拖住他们！', theme: 'elven_woods', seed: 313, turns: 14, waves: 20, bossId: 'hihi_enha', endless: true },
  { id: 82, nameZh: '暮光入侵', nameEn: 'Twilight Invasion', history: '将军，暮光精灵入侵造成首都陷落的情况绝不能再次发生！再度体验那场惊心动魄的战斗，这样我们就能学会将来如何保卫自己的城市。', theme: 'bittering_rancor', seed: 414, turns: 15, waves: 20, bossId: 'malicia', endless: true }
];

var LEVELS = _levelDefs.map(function (d) {
  var path = _makePath(d.seed, d.turns);
  return {
    id: d.id,
    nameZh: d.nameZh,
    nameEn: d.nameEn,
    history: d.history,
    theme: d.theme,
    path: path,
    slots: _makeSlots(path, d.seed, 10 + (d.id % 4)),
    waves: d.waves,
    bossId: d.bossId,
    endless: d.endless
  };
});

// ===================================================================
// TOWERS — 4 大基础塔系（每系 3 级）+ 四级专精分支
// 中文名取自 strings/zh_kv.json 真实译文；数值为可玩平衡值。
// ===================================================================
var TOWERS = [
  // —— 弓箭 Archer ——
  {
    id: 'archer_1',
    nameZh: '猎人之树',
    nameEn: 'Hunter Arbor',
    family: 'archer',
    tier: 1,
    branch: null,
    cost: 70,
    damage: 12,
    range: 110,
    rate: 1.0,
    dmgType: 'physical',
    color: '#8fbc5a',
    desc: '精灵弓手埋伏在树屋中，等待入侵者进入射程。',
    skill: { nameZh: '爆裂箭矢', nameEn: 'Burst Arrows', desc: '发射爆炸魔法箭，造成160点魔法范围伤害。', unlockTier: 2 }
  },
  {
    id: 'archer_2',
    nameZh: '看护者之树',
    nameEn: 'Watcher Arbor',
    family: 'archer',
    tier: 2,
    branch: null,
    cost: 110,
    damage: 20,
    range: 125,
    rate: 1.05,
    dmgType: 'physical',
    color: '#7fae50',
    desc: '看护者目光敏锐，射程与伤害进一步提升。',
    skill: { nameZh: '睡眠箭矢', nameEn: 'Slumber Arrows', desc: '射出使敌人沉睡4秒的箭矢。', unlockTier: 2 }
  },
  {
    id: 'archer_3',
    nameZh: '看守者之树',
    nameEn: 'Sentinel Arbor',
    family: 'archer',
    tier: 3,
    branch: null,
    cost: 160,
    damage: 31,
    range: 140,
    rate: 1.1,
    dmgType: 'physical',
    color: '#6f9e48',
    desc: '看守者守护森林边境，箭无虚发。',
    skill: { nameZh: '猎人印记', nameEn: "Hunter's Mark", desc: '标记目标，使其5秒内受到双倍伤害。', unlockTier: 3 }
  },
  {
    id: 'archer_golden',
    nameZh: '黄金长弓塔',
    nameEn: 'Golden Longbows',
    family: 'archer',
    tier: 4,
    branch: 'golden',
    cost: 250,
    damage: 46,
    range: 155,
    rate: 1.2,
    dmgType: 'physical',
    color: '#e6c34a',
    desc: '黄金长弓兵纪律严明、百步穿杨，致敌于死地。',
    skill: { nameZh: '血色审判', nameEn: 'Crimson Sentence', desc: '提高即死几率，标记目标使其受到致命打击。', unlockTier: 4 }
  },
  {
    id: 'archer_arcane',
    nameZh: '奥术弓手塔',
    nameEn: 'Arcane Archers',
    family: 'archer',
    tier: 4,
    branch: 'arcane',
    cost: 250,
    damage: 38,
    range: 155,
    rate: 1.15,
    dmgType: 'magic',
    color: '#a06fd0',
    desc: '奥术箭矢附带魔法，削弱敌人魔法抗性。',
    skill: { nameZh: '爆裂箭矢', nameEn: 'Burst Arrows', desc: '发射爆炸魔法箭，造成160点魔法范围伤害。', unlockTier: 4 }
  },

  // —— 法师 Mage ——
  {
    id: 'mage_1',
    nameZh: '秘法师高台',
    nameEn: 'Mystic Dais',
    family: 'mage',
    tier: 1,
    branch: null,
    cost: 100,
    damage: 18,
    range: 120,
    rate: 0.8,
    dmgType: 'magic',
    color: '#7c6fd0',
    desc: '秘法师从高台引导奥术能量轰击敌人。',
    skill: { nameZh: '时间加速', nameEn: 'Timelapse', desc: '操控时间，加速自身施法与攻击。', unlockTier: 2 }
  },
  {
    id: 'mage_2',
    nameZh: '奥术师高台',
    nameEn: 'Arcanist Dais',
    family: 'mage',
    tier: 2,
    branch: null,
    cost: 150,
    damage: 28,
    range: 135,
    rate: 0.85,
    dmgType: 'magic',
    color: '#6f62c0',
    desc: '奥术师对魔法能量的掌控更为纯熟。',
    skill: { nameZh: '改变现实', nameEn: 'Alter Reality', desc: '将敌人传送回路径起点。', unlockTier: 3 }
  },
  {
    id: 'mage_3',
    nameZh: '异能师高台',
    nameEn: 'Eldritch Dais',
    family: 'mage',
    tier: 3,
    branch: null,
    cost: 210,
    damage: 42,
    range: 150,
    rate: 0.9,
    dmgType: 'magic',
    color: '#5f52b0',
    desc: '异能师窥探现实之外的诡异力量。',
    skill: { nameZh: '改变现实', nameEn: 'Alter Reality', desc: '将敌人传送回路径起点。', unlockTier: 3 }
  },
  {
    id: 'mage_high_elven',
    nameZh: '高等精灵法师',
    nameEn: 'High Elven Mage',
    family: 'mage',
    tier: 4,
    branch: 'high_elven',
    cost: 300,
    damage: 40,
    range: 165,
    rate: 1.1,
    dmgType: 'magic',
    color: '#9ad0e8',
    desc: '发射三连能量弹，无视任何物理防护。',
    skill: { nameZh: '时间操控', nameEn: 'Timelapse', desc: '高阶时间操控，令敌人动作迟滞。', unlockTier: 4 }
  },
  {
    id: 'mage_wild_magus',
    nameZh: '狂野魔术师',
    nameEn: 'Wild Magus',
    family: 'mage',
    tier: 4,
    branch: 'wild_magus',
    cost: 300,
    damage: 52,
    range: 150,
    rate: 0.85,
    dmgType: 'magic',
    color: '#c060a0',
    desc: '运用原始而狂野的魔法摧毁一切。',
    skill: { nameZh: '破坏守卫', nameEn: 'Ward Breaker', desc: '击碎敌人的魔法护盾与防护。', unlockTier: 4 }
  },

  // —— 兵营 Barracks ——
  {
    id: 'barracks_1',
    nameZh: '防御者兵营',
    nameEn: 'Defender Barracks',
    family: 'barracks',
    tier: 1,
    branch: null,
    cost: 70,
    damage: 8,
    range: 60,
    rate: 1.0,
    dmgType: 'physical',
    color: '#b06a4a',
    desc: '训练精灵防御者，阻截并攻击来袭敌人。',
    skill: { nameZh: '剑舞', nameEn: 'Blade Dance', desc: '最多连续斩击4次，造成40~56点伤害。', unlockTier: 2 }
  },
  {
    id: 'barracks_2',
    nameZh: '看守者兵营',
    nameEn: 'Warden Barracks',
    family: 'barracks',
    tier: 2,
    branch: null,
    cost: 110,
    damage: 14,
    range: 60,
    rate: 1.0,
    dmgType: 'physical',
    color: '#a05f40',
    desc: '看守者接受过剑术和弓术训练，是高度全能型单位。',
    skill: { nameZh: '完美闪避', nameEn: 'Perfect Parry', desc: '无相无形，水柔至臻，完美格挡攻击。', unlockTier: 2 }
  },
  {
    id: 'barracks_3',
    nameZh: '游侠兵营',
    nameEn: 'Ranger Barracks',
    family: 'barracks',
    tier: 3,
    branch: null,
    cost: 160,
    damage: 22,
    range: 65,
    rate: 1.05,
    dmgType: 'physical',
    color: '#905538',
    desc: '游侠配备双刃剑，堪称开路先锋！',
    skill: { nameZh: '旋刃', nameEn: 'Swirling Edge', desc: '咏剑士攻击伤害提高5点，攻击速度提高20%。', unlockTier: 3 }
  },
  {
    id: 'barracks_bladesinger',
    nameZh: '咏剑士殿堂',
    nameEn: 'Bladesinger Hall',
    family: 'barracks',
    tier: 4,
    branch: 'bladesinger',
    cost: 250,
    damage: 34,
    range: 70,
    rate: 1.1,
    dmgType: 'physical',
    color: '#d08a3a',
    desc: '武僧将战斗视为艺术形式，完美只是刚刚开始。',
    skill: { nameZh: '剑舞', nameEn: 'Blade Dance', desc: '最多连续斩击4次，造成40~56点伤害。', unlockTier: 4 }
  },

  // —— 投石 / 德鲁伊 Rock Thrower ——
  {
    id: 'rock_1',
    nameZh: '石环阵',
    nameEn: 'Stone Circle',
    family: 'rock',
    tier: 1,
    branch: null,
    cost: 90,
    damage: 22,
    range: 120,
    rate: 0.65,
    dmgType: 'physical',
    color: '#8a8f6a',
    desc: '石环德鲁伊猛投岩石，造成范围伤害。',
    skill: { nameZh: '痛击', nameEn: 'Clobber', desc: '震地造成75点伤害，并击晕附近所有敌人1秒。', unlockTier: 2 }
  },
  {
    id: 'rock_2',
    nameZh: '巨石环阵',
    nameEn: 'Boulder Circle',
    family: 'rock',
    tier: 2,
    branch: null,
    cost: 140,
    damage: 34,
    range: 135,
    rate: 0.7,
    dmgType: 'physical',
    color: '#7a805a',
    desc: '投出重型巨石，碾压更大范围！',
    skill: { nameZh: '自然之友', nameEn: "Nature's Friend", desc: '呼唤神秘符文巨熊，阻截并攻击敌人。', unlockTier: 3 }
  },
  {
    id: 'rock_3',
    nameZh: '石柱环阵',
    nameEn: 'Menhir Circle',
    family: 'rock',
    tier: 3,
    branch: null,
    cost: 200,
    damage: 50,
    range: 150,
    rate: 0.72,
    dmgType: 'physical',
    color: '#6a704a',
    desc: '竖立远古石柱，引导大地之力。',
    skill: { nameZh: '烈焰坚果', nameEn: 'Fiery Nuts', desc: '投掷燃烧的坚果，造成持续范围伤害。', unlockTier: 3 }
  },
  {
    id: 'rock_arch_druid',
    nameZh: '大德鲁伊巨石阵',
    nameEn: 'Arch-Druid Henge',
    family: 'rock',
    tier: 4,
    branch: 'arch_druid',
    cost: 290,
    damage: 70,
    range: 170,
    rate: 0.75,
    dmgType: 'physical',
    color: '#4f9e6a',
    desc: '大德鲁伊驾驭自然之力，投掷符文巨石。',
    skill: { nameZh: '自然之友', nameEn: "Nature's Friend", desc: '额外呼唤一头神秘符文巨熊，阻截并攻击敌人。', unlockTier: 4 }
  },
  {
    id: 'rock_weirdwood',
    nameZh: '怪异树木',
    nameEn: 'Weirdwood',
    family: 'rock',
    tier: 4,
    branch: 'weirdwood',
    cost: 290,
    damage: 60,
    range: 160,
    rate: 0.8,
    dmgType: 'physical',
    color: '#6a9e3e',
    desc: '唤醒会移动的怪异树木，吞噬入侵者。',
    skill: { nameZh: '痛击', nameEn: 'Clobber', desc: '震地造成75点伤害，并击晕附近所有敌人1秒。', unlockTier: 4 }
  },
  { id: 'rock_forest_keepers', nameZh: '森林守护者', nameEn: 'Forest Keepers', family: 'rock', tier: 4, branch: 'forest_keepers', cost: 320, damage: 55, range: 165, rate: 0.85, dmgType: 'physical', color: '#3f8f5a', desc: '令人生畏的森林守护者加入战斗，坚守阵地。', skill: { nameZh: '自然之怒', nameEn: "Nature's Wrath", desc: '生长出密集尖刺藤蔓，对范围内敌人造成60点伤害。', unlockTier: 4 } }
];

// ===================================================================
// HEROES — 20 位英雄，技能名与描述取自逆向报告第 5.3 节真实原文
// ===================================================================
var HEROES = [
  { id: 'veznan', nameZh: '维兹南', nameEn: "Vez'nan", cls: '黑暗巫师', cost: 300, color: '#7b3fa0', desc: '强大的黑暗巫师，奥术新星与暗影契约的主人。', skills: [
    { nameZh: '奥术新星', nameEn: 'Arcane Nova', desc: '制造一场巨大的魔法爆炸，造成28-52点范围伤害，并使敌人减速，持续2秒。' },
    { nameZh: '黑暗契约', nameEn: 'Dark Pact', desc: '与暗影签订契约，召唤恶魔为你作战。' },
    { nameZh: '灵魂灼烧', nameEn: 'Soul Burn', desc: '持续灼烧敌人的灵魂，造成魔法伤害。' }
  ] },
  { id: 'denas', nameZh: '迪纳斯王子', nameEn: 'Prince Denas', cls: '高贵骑士', cost: 260, color: '#d4af37', desc: '优雅而强大的高贵骑士，誓死守护精灵王国。', skills: [
    { nameZh: '宣誓卫士', nameEn: 'Sworn Defenders', desc: '召唤忠诚的卫士阻截来袭敌人。' },
    { nameZh: '万众瞩目', nameEn: 'Celebrity', desc: '王子的迷人外表能震慑最多6个敌人的心神，持续4秒。' },
    { nameZh: '王者之威', nameEn: 'Mighty', desc: '对敌人造成171~320点真实伤害。' }
  ] },
  { id: 'alleria', nameZh: '艾莉瑞雅·迅风', nameEn: 'Alleria Swiftwind', cls: '游侠', cost: 280, color: '#7ec850', desc: '艾纳妮血脉最后的传人，剧情核心英雄。', skills: [
    { nameZh: '精灵训练', nameEn: 'Elven Training', desc: '经过严苛训练的精准射击，提高攻击伤害。' },
    { nameZh: '箭矢风暴', nameEn: 'Arrow Storm', desc: '召唤漫天箭雨覆盖战场。' },
    { nameZh: '迅风之影', nameEn: 'Swiftfoot', desc: '身形如风，闪避敌人的攻击。' }
  ] },
  { id: 'eridan', nameZh: '艾莉丹', nameEn: 'Eridan', cls: '游侠', cost: 240, color: '#68b84a', desc: '迅捷的精灵游侠，擅长箭矢风暴与闪避反击。', skills: [
    { nameZh: '箭矢风暴', nameEn: 'Arrow Storm', desc: '召唤箭矢风暴打击大范围敌人。' },
    { nameZh: '敏捷', nameEn: 'Nimble', desc: '拥有30%闪避几率，并闪避后反击。' }
  ] },
  { id: 'catha', nameZh: '卡莎', nameEn: 'Catha', cls: '精灵仙子', cost: 230, color: '#ff9fd8', desc: '小小的妖精仙子，以仙尘愚弄敌人。', skills: [
    { nameZh: '仙尘', nameEn: 'Faery Dust', desc: '派出3个小仙子打击附近敌人，每个造成12-40点魔法伤害。' },
    { nameZh: '妖精战士', nameEn: 'Pixie Warrior', desc: '召唤妖精战士助战。' }
  ] },
  { id: 'lilith', nameZh: '莉莉丝', nameEn: 'Lilith', cls: '堕落天使', cost: 320, color: '#c04060', desc: '堕入凡间的天使，掌控天堂的混沌之力。', skills: [
    { nameZh: '天堂混沌', nameEn: 'Heavenly Chaos', desc: '有50%概率降下火雨，造成800点伤害。' },
    { nameZh: '死神收割', nameEn: "Reaper's Harvest", desc: '造成110点真实伤害，并有10%几率即死。' }
  ] },
  { id: 'faustus', nameZh: '浮士德', nameEn: 'Faustus', cls: '龙族法师', cost: 300, color: '#c07030', desc: '驾驭巨龙之力的法师，能扭曲空间。', skills: [
    { nameZh: '巨龙之怒', nameEn: 'Dragon Rage', desc: '召唤3条幼龙，每条造成90点范围伤害，持续6秒。' },
    { nameZh: '传送符文', nameEn: 'Teleport Rune', desc: '传送2个敌人，使其退回路径。' }
  ] },
  { id: 'phoenix', nameZh: '火凤凰', nameEn: 'Phoenix', cls: '长生鸟', cost: 310, color: '#ff7a2a', desc: '浴火重生的不朽神鸟，以烈焰净化敌人。', skills: [
    { nameZh: '自焚', nameEn: 'Immolate', desc: '俯冲造成100点范围伤害后牺牲，随后涅槃重生。' },
    { nameZh: '炽焰后代', nameEn: 'Blazing Offspring', desc: '孵化炽焰幼鸟助战。' }
  ] },
  { id: 'bruce', nameZh: '布鲁斯', nameEn: 'Bruce', cls: '狮人', cost: 270, color: '#d69a3a', desc: '威严的狮人国王，守护狮群与森林。', skills: [
    { nameZh: '守护狮', nameEn: 'Guardian Lions', desc: '召唤4头守护狮，造成840点伤害。' },
    { nameZh: '狮王咆哮', nameEn: "King's Roar", desc: '震耳欲聋的咆哮，使敌人眩晕1秒。' },
    { nameZh: '重咬', nameEn: 'Grievous Bites', desc: '撕咬目标敌人，造成60点真实伤害。' }
  ] },
  { id: 'durax', nameZh: '杜拉斯', nameEn: 'Durax', cls: '元素', cost: 290, color: '#5ac8e0', desc: '掌控水晶与宝石之力的元素生物。', skills: [
    { nameZh: '晶种', nameEn: 'Shardseed', desc: '发射水晶碎片，造成45点真实伤害。' },
    { nameZh: '水晶囚笼', nameEn: 'Crystal Prison', desc: '800点伤害由被囚禁的敌人分摊。' },
    { nameZh: '蓝宝石獠牙', nameEn: 'Sapphire Fangs', desc: '强化攻击，附带护甲穿透。' }
  ] },
  { id: 'regson', nameZh: '雷格森', nameEn: "Reg'son", cls: '异能魔刃', cost: 330, color: '#7a2fa0', desc: '手持异能魔刃的神秘刺客，能一击必杀。', skills: [
    { nameZh: '制裁者', nameEn: 'Vindicator', desc: '单体秒杀，冷却50~70秒。' },
    { nameZh: '异能之刃', nameEn: 'Eldritch Blade', desc: '造成30点伤害，并有几率即死。' }
  ] },
  { id: 'arivan', nameZh: '艾里凡', nameEn: 'Arivan', cls: '元素使', cost: 280, color: '#4aa0d0', desc: '掌控冰火土风四系元素的法师。', skills: [
    { nameZh: '元素风暴', nameEn: 'Elemental Storm', desc: '召唤毁灭性的元素风暴席卷战场。' },
    { nameZh: '冰封牢笼', nameEn: 'Icy Prison', desc: '冻结敌人2秒，并造成35点霜冻伤害。' },
    { nameZh: '火焰印记', nameEn: 'Seal of Fire', desc: '释放4个火球，每个造成20-40点伤害。' }
  ] },
  { id: 'bolverk', nameZh: '波尔维克', nameEn: 'Bolverk', cls: '战士', cost: 250, color: '#a05a3a', desc: '勇猛无畏的战士，以巨斧横扫千军。', skills: [
    { nameZh: '投斧', nameEn: 'Axe Throw', desc: '掷出巨斧，对敌人造成范围伤害。' },
    { nameZh: '狂暴', nameEn: 'Berserk', desc: '进入狂暴状态，大幅提升攻击速度。' }
  ] },
  { id: 'lynn', nameZh: '莉恩', nameEn: 'Lynn', cls: '妖咒之刃', cost: 300, color: '#a050c0', desc: '以厄运符咒与妖术折磨敌人的咒刃战士。', skills: [
    { nameZh: '咒怒', nameEn: 'Hexfury', desc: '最多攻击6次，每次造成360点真实伤害。' },
    { nameZh: '厄运符咒', nameEn: 'Charm of Unluck', desc: '拥有45%几率闪避敌人的攻击。' },
    { nameZh: '弱化', nameEn: 'Weakening', desc: '降低目标的魔法抗性与护甲，持续8秒。' }
  ] },
  { id: 'bravebark', nameZh: '勇敢树皮', nameEn: 'Bravebark', cls: '森林元素', cost: 290, color: '#4f9e4a', desc: '古老森林的化身，以藤蔓与树人作战。', skills: [
    { nameZh: '自然之怒', nameEn: "Nature's Wrath", desc: '生长出15根尖刺藤蔓，每根造成60点伤害。' },
    { nameZh: '橡树之种', nameEn: 'Oakseeds', desc: '召唤2只小树人，阻截并攻击敌人。' }
  ] },
  { id: 'rag', nameZh: '瑞兹与大瑞格', nameEn: 'Razz & Rags', cls: '变形者', cost: 260, color: '#d08040', desc: '一对调皮的变形者，擅长以诡计和爆炸物制敌。', skills: [
    { nameZh: '变形', nameEn: 'Changeling', desc: '变形迷惑敌人，制造混乱。' },
    { nameZh: '锤击时刻', nameEn: 'Hammer Time', desc: '造成72点伤害，并眩晕敌人3秒。' },
    { nameZh: '爆炸兔', nameEn: 'Kamihare', desc: '放出12只爆炸兔，接触敌人时爆炸，每只造成30点范围伤害。' }
  ] },
  { id: 'malik', nameZh: '马利克', nameEn: 'Malik', cls: '战士', cost: 240, color: '#c05a3a', desc: '被释放的勇士，以不屈意志冲破束缚。', skills: [
    { nameZh: '失控的马利克', nameEn: 'Malik Unchained', desc: '挣脱束缚，进入无人可挡的狂战状态。' },
    { nameZh: '重击', nameEn: 'Heavy Blow', desc: '对单个敌人造成高额物理伤害。' }
  ] },
  { id: 'wilbur', nameZh: '威尔伯', nameEn: 'Wilbur', cls: '发明家', cost: 280, color: '#c0a040', desc: '天才发明家，以无人机与炸弹作战。', skills: [
    { nameZh: '激光无人机', nameEn: 'PewPew Drones', desc: '派出4架无人机，造成128点伤害，持续8秒。' },
    { nameZh: '盒式炸弹', nameEn: 'Box Bomb', desc: '投掷炸弹，造成65点伤害。' }
  ] },
  { id: 'xin', nameZh: '鑫', nameEn: 'Xin', cls: '熊猫武僧', cost: 310, color: '#3a3a3a', desc: '来自遥远东方的熊猫武僧，以武入道。', skills: [
    { nameZh: '熊猫大乱斗', nameEn: 'Pandamonium', desc: '召唤6个熊猫武士，每个造成180点伤害。' },
    { nameZh: '心胜于体', nameEn: 'Mind over Body', desc: '6秒内恢复130点生命。' },
    { nameZh: '勇猛突击', nameEn: 'Daring Strike', desc: '眨眼之间攻击最强大的敌人，造成160-250点伤害。' }
  ] },
  { id: 'bard', nameZh: '吟游诗人', nameEn: 'Bard', cls: '法师', cost: 220, color: '#d0a060', desc: '以歌声鼓舞士气、以诗篇魅惑敌人的吟游诗人。', skills: [
    { nameZh: '勇气之歌', nameEn: 'Song of Courage', desc: '鼓舞友军，提升攻击力。' },
    { nameZh: '魅惑诗篇', nameEn: 'Enchantment', desc: '以歌声魅惑敌人，使其短暂停顿。' }
  ] }
];

// ===================================================================
// ENEMIES — 普通 / 精英敌人，覆盖豺狼 / 蜘蛛 / 飞行 / 森林魔物 / 蘑菇 / 暮光各族系
// 名称取自 strings/zh_kv.json 真实译文；数值为可玩平衡值。
// ===================================================================
var ENEMIES = [
  // 豺狼系
  { id: 'gnoll_reaver', nameZh: '豺狼人盗匪', nameEn: 'Gnoll Reaver', hp: 60, speed: 28, armor: 0, magicResist: 0, bounty: 8, flying: false, color: '#a06a3a', size: 11, ability: '' },
  { id: 'gnoll_burner', nameZh: '豺狼人纵火者', nameEn: 'Gnoll Burner', hp: 75, speed: 26, armor: 0, magicResist: 10, bounty: 10, flying: false, color: '#d0602a', size: 11, ability: '攻击附带灼烧' },
  { id: 'gnoll_blighter', nameZh: '豺狼人摧残者', nameEn: 'Gnoll Blighter', hp: 110, speed: 24, armor: 5, magicResist: 60, bounty: 16, flying: false, color: '#6a4a8a', size: 12, ability: '高魔法抗性，掌控死亡与衰弱之力' },
  { id: 'gnoll_gnawer', nameZh: '豺狼人咬噬者', nameEn: 'Gnoll Gnawer', hp: 130, speed: 26, armor: 20, magicResist: 0, bounty: 14, flying: false, color: '#8a6a3a', size: 13, ability: '中等护甲' },
  { id: 'gnoll_catapult', nameZh: '豺狼人投石车', nameEn: 'Gnoll Catapult', hp: 180, speed: 16, armor: 10, magicResist: 0, bounty: 22, flying: false, color: '#7a5a3a', size: 16, ability: '远程投石攻击' },
  // 蜘蛛系
  { id: 'sword_spider', nameZh: '刃脚蜘蛛', nameEn: 'Sword Spider', hp: 85, speed: 32, armor: 5, magicResist: 55, bounty: 12, flying: false, color: '#4a3a5a', size: 11, ability: '高魔法抗性' },
  { id: 'drider', nameZh: '蛛化精灵', nameEn: 'Drider', hp: 100, speed: 40, armor: 0, magicResist: 20, bounty: 15, flying: false, color: '#7a3a6a', size: 12, ability: '毒攻，由士兵转化，移动快速' },
  { id: 'arachnomancer', nameZh: '控蛛师', nameEn: 'Arachnomancer', hp: 120, speed: 24, armor: 0, magicResist: 40, bounty: 20, flying: false, color: '#5a2a7a', size: 13, ability: '召唤蜘蛛' },
  { id: 'son_of_mactans', nameZh: '黑寡妇之子', nameEn: 'Son of Mactans', hp: 150, speed: 30, armor: 10, magicResist: 30, bounty: 24, flying: false, color: '#3a1a4a', size: 14, ability: '剧毒攻击' },
  // 飞行系
  { id: 'cloud_stalker', nameZh: '云鹰', nameEn: 'Cloud Stalker', hp: 70, speed: 38, armor: 0, magicResist: 0, bounty: 12, flying: true, color: '#a0c0e0', size: 11, ability: '飞行，由士兵转化' },
  { id: 'perython', nameZh: '佩利顿鹰', nameEn: 'Perython', hp: 130, speed: 30, armor: 10, magicResist: 10, bounty: 18, flying: true, color: '#c0a060', size: 14, ability: '飞行，背载豺狼人' },
  { id: 'screecher_bat', nameZh: '尖啸蝙蝠', nameEn: 'Screecher Bat', hp: 45, speed: 44, armor: 0, magicResist: 0, bounty: 7, flying: true, color: '#6a4a7a', size: 9, ability: '高速飞行' },
  { id: 'gloomy', nameZh: '幽暗蝇', nameEn: 'Gloomy', hp: 55, speed: 34, armor: 0, magicResist: 0, bounty: 9, flying: true, color: '#5a5a8a', size: 9, ability: '自我复制成群' },
  // 森林魔物
  { id: 'redcap', nameZh: '小红帽', nameEn: 'Redcap', hp: 90, speed: 26, armor: 5, magicResist: 0, bounty: 12, flying: false, color: '#c03030', size: 11, ability: '' },
  { id: 'hyena', nameZh: '鬣狗', nameEn: 'Hyena', hp: 55, speed: 46, armor: 0, magicResist: 0, bounty: 9, flying: false, color: '#a08050', size: 10, ability: '移动极快' },
  { id: 'razorboar', nameZh: '剃刀野猪', nameEn: 'Razorboar', hp: 140, speed: 30, armor: 20, magicResist: 0, bounty: 16, flying: false, color: '#7a5a4a', size: 14, ability: '中等护甲' },
  { id: 'ettin', nameZh: '双头食人魔', nameEn: 'Ettin', hp: 260, speed: 28, armor: 15, magicResist: 0, bounty: 28, flying: false, color: '#8a9a6a', size: 17, ability: '快速自愈' },
  { id: 'bandersnatch', nameZh: '大毛怪', nameEn: 'Bandersnatch', hp: 320, speed: 20, armor: 25, magicResist: 20, bounty: 35, flying: false, color: '#6a7a4a', size: 18, ability: '无法被减速，范围伤害' },
  { id: 'ogre_magi', nameZh: '食人魔魔法师', nameEn: 'Ogre Magi', hp: 200, speed: 22, armor: 10, magicResist: 65, bounty: 26, flying: false, color: '#7a4a8a', size: 16, ability: '高魔法抗性' },
  { id: 'twilight_evoker', nameZh: '暮光召唤师', nameEn: 'Twilight Evoker', hp: 150, speed: 24, armor: 5, magicResist: 45, bounty: 24, flying: false, color: '#9a3a7a', size: 13, ability: '治疗友军，沉默防御塔' },
  { id: 'satyr_hoplite', nameZh: '萨梯重装步兵', nameEn: 'Satyr Hoplite', hp: 170, speed: 24, armor: 25, magicResist: 10, bounty: 20, flying: false, color: '#9a6a3a', size: 13, ability: '重甲防护' },
  { id: 'satyr_cutthroat', nameZh: '萨梯割喉者', nameEn: 'Satyr Cutthroat', hp: 110, speed: 36, armor: 5, magicResist: 10, bounty: 16, flying: false, color: '#b06a4a', size: 12, ability: '高速突袭' },
  { id: 'shadow_champion', nameZh: '暗影勇士', nameEn: 'Shadow Champion', hp: 220, speed: 28, armor: 20, magicResist: 40, bounty: 30, flying: false, color: '#4a2a5a', size: 15, ability: '暗影形态' },
  { id: 'blood_servant', nameZh: '血祭仆从', nameEn: 'Blood Servant', hp: 130, speed: 30, armor: 5, magicResist: 30, bounty: 18, flying: false, color: '#8a2030', size: 12, ability: '献祭强化' },
  { id: 'shadowspawn', nameZh: '暗影兵卒', nameEn: 'Shadowspawn', hp: 80, speed: 32, armor: 0, magicResist: 25, bounty: 11, flying: false, color: '#3a2a4a', size: 10, ability: '暗影系普通单位' },
  { id: 'mounted_avenger', nameZh: '复仇骑兵', nameEn: 'Mounted Avenger', hp: 200, speed: 40, armor: 15, magicResist: 0, bounty: 24, flying: false, color: '#9a4a3a', size: 15, ability: '高速冲锋' },
  { id: 'bunny', nameZh: '兔子', nameEn: 'Bunny', hp: 30, speed: 50, armor: 0, magicResist: 0, bounty: 3, flying: false, color: '#e0d0c0', size: 8, ability: '速度极快的小动物' },
  // 蘑菇系
  { id: 'munchshroom', nameZh: '咀嚼魔菇', nameEn: 'Munchshroom', hp: 95, speed: 24, armor: 5, magicResist: 10, bounty: 12, flying: false, color: '#d07050', size: 12, ability: '' },
  { id: 'boomshroom', nameZh: '炸弹魔菇', nameEn: 'Boomshroom', hp: 70, speed: 38, armor: 0, magicResist: 0, bounty: 12, flying: false, color: '#e0a030', size: 11, ability: '移动快速，死亡爆炸' },
  { id: 'shroom_breeder', nameZh: '菌菇饲养者', nameEn: 'Fungus Breeder', hp: 140, speed: 20, armor: 10, magicResist: 20, bounty: 20, flying: false, color: '#a06080', size: 14, ability: '培育魔菇' },
  // 暮光系
  { id: 'twilight_golem', nameZh: '暮光傀儡', nameEn: 'Twilight Golem', hp: 500, speed: 16, armor: 45, magicResist: 30, bounty: 45, flying: false, color: '#4a4a5a', size: 19, ability: '极其坚硬' },
  { id: 'dark_spitter', nameZh: '黑暗喷吐者', nameEn: 'Dark Spitter', hp: 120, speed: 26, armor: 5, magicResist: 40, bounty: 18, flying: false, color: '#5a3a6a', size: 12, ability: '远程喷吐腐蚀液' },
  { id: 'devourer', nameZh: '吞噬者', nameEn: 'Devourer', hp: 180, speed: 42, armor: 15, magicResist: 20, bounty: 26, flying: false, color: '#6a2a4a', size: 15, ability: '吞噬士兵，移动快速' }
];

// ===================================================================
// BOSSES — 7 个主线 / 无尽 Boss，结构同 ENEMIES，血量与体型更高
// ===================================================================
var BOSSES = [
  { id: 'bram', nameZh: '歼灭者布拉姆', nameEn: 'Bram, the Beheader', hp: 4200, speed: 14, armor: 40, magicResist: 20, bounty: 300, flying: false, color: '#8a3a2a', size: 30, ability: '食人魔国王，喜欢砍头，造成巨额伤害' },
  { id: 'godieth', nameZh: '戈迪斯', nameEn: 'Godieth', hp: 5600, speed: 16, armor: 35, magicResist: 60, bounty: 400, flying: false, color: '#c04020', size: 32, ability: '炎魔（Pit Lord），剧情最终反派' },
  { id: 'spider_goddess', nameZh: '蜘蛛女神', nameEn: 'Spider Goddess', hp: 3600, speed: 18, armor: 25, magicResist: 45, bounty: 280, flying: false, color: '#4a1a5a', size: 28, ability: '古代蜘蛛女王 Mactans，召唤蛛群' },
  { id: 'malicia', nameZh: '玛丽西娅', nameEn: 'Malicia', hp: 4000, speed: 20, armor: 20, magicResist: 70, bounty: 320, flying: false, color: '#8a2a6a', size: 27, ability: '暮光精灵女王，自封 Unseelie Queen，强大的黑暗魔法' },
  { id: 'bajninmen', nameZh: '憎恶者巴杰尼蒙', nameEn: "Baj'Nimen the Hateful", hp: 5000, speed: 18, armor: 30, magicResist: 50, bounty: 350, flying: false, color: '#5a2a4a', size: 30, ability: '终极 Boss，释放毁灭性法术' },
  { id: 'hihi_enha', nameZh: '嗨嗨恩哈', nameEn: 'Hi-Hi Enha', hp: 3200, speed: 22, armor: 25, magicResist: 10, bounty: 250, flying: false, color: '#9a6a3a', size: 26, ability: '豺狼部落首领' },
  { id: 'twilight_brute', nameZh: '暮光蛮兵', nameEn: 'Twilight Brute', hp: 2800, speed: 20, armor: 35, magicResist: 35, bounty: 220, flying: false, color: '#6a3a6a', size: 26, ability: '无尽模式 Mini-Boss，暮光精英' }
];

// ===================================================================
// POWERS — 全局法术，名称与效果取自逆向报告第 5.5 节
// ===================================================================
var POWERS = [
  { id: 'reinforce', nameZh: '召唤援军', nameEn: 'Call Reinforcements', cooldown: 18, desc: '召唤部队助战。升级可缩短冷却、装备更精良的“绿衣守卫”，并有几率免疫死亡。' },
  { id: 'thunder', nameZh: '闪电箭打击', nameEn: 'Strike of Thunderbolt', cooldown: 14, damage: 80, desc: '天雷轰击敌人。升级可提升伤害、缩短冷却，并额外增加3道附带减速的闪电箭。' },
  { id: 'hero', nameZh: '英雄技能', nameEn: 'Hero spell', desc: '每位英雄都会赋予你独一无二的法术！可在英雄室升级。' }
];

// ===================================================================
// COMICS — 9 幕漫画分镜对白，取自 strings/zh_kv.json 中文原文（COMIC_* 键）
// 简中本地化部分缺失处沿用英文原意；speaker 为根据剧情推断的角色标识。
// ===================================================================
var COMICS = [
  { id: 1, title: '很久以前', lines: [
    { speaker: '旁白', text: '很久以前，和平似乎会永远延续……' },
    { speaker: '旁白', text: '但正如故事所说……' }
  ] },
  { id: 2, title: '神龛与暮光精灵', lines: [
    { speaker: '公主', text: '我们找个安全的地方吧！' },
    { speaker: '公主', text: '看！有个神龛！' },
    { speaker: '公主', text: '等一下…' },
    { speaker: '旁白', text: '暮光精灵！' }
  ] },
  { id: 3, title: '逃亡与陷阱', lines: [
    { speaker: '玛丽西娅', text: '我一定要报仇！' },
    { speaker: '公主', text: '嘘…亲爱的！' },
    { speaker: '公主', text: '这是….' },
    { speaker: '旁白', text: '…一个陷阱！' },
    { speaker: '精灵', text: '伙伴们…我们有客人了！' },
    { speaker: '玛丽西娅', text: '确实如此！' }
  ] },
  { id: 4, title: '神殿仪式', lines: [
    { speaker: '公主', text: '不过…' },
    { speaker: '旁白', text: '…代价可能太高！' }
  ] },
  { id: 5, title: '惨胜', lines: [
    { speaker: '精灵', text: '胜利！！' },
    { speaker: '公主', text: '我们赢了！终于结束了！' },
    { speaker: '公主', text: '真不容易…' },
    { speaker: '旁白', text: '可是代价太高了。' }
  ] },
  { id: 6, title: '灰烬裂隙', lines: [
    { speaker: '精灵', text: '这个必须摧毁！' },
    { speaker: '玛丽西娅', text: '我的！' }
  ] },
  { id: 7, title: '豺狼再起', lines: [
    { speaker: '精灵', text: '嘘…那儿有东西' },
    { speaker: '公主', text: '只是一群豺狼人。' },
    { speaker: '旁白', text: '没有' }
  ] },
  { id: 8, title: '完美计划', lines: [
    { speaker: '玛丽西娅', text: '我们很接近了…' },
    { speaker: '玛丽西娅', text: '计划很完美。' },
    { speaker: '旁白', text: '但是这一次…' }
  ] },
  { id: 9, title: '向女王求援', lines: [
    { speaker: '旁白', text: '致女王陛下…' },
    { speaker: '旁白', text: '请派遣炼狱之火的上古恶魔助战。' }
  ] }
];

// ===================================================================
// ACHIEVEMENTS — 约 60 个成就中文名，取自 ELVES_ACHIEVEMENT_*_NAME
// ===================================================================
var ACHIEVEMENTS = [
  '龙与地下城', '权力的游戏', '干嘛这么严肃？', '兰博风格', '精灵森林罗宾汉',
  '别跟我谈胜算', '我自愿献身', '勇敢小裁缝', '凛冬将至', '战争艺术',
  '凌波微步', '害虫防治', '坚持不懈！', '伟大守护者', '格格巫',
  '豺狼人克星', '天命之选', '这是一个陷阱！', '躲猫猫', '摇滚明星',
  '我是说剪红线', '糖果拉什', '战争从未改变', '绿箭侠', '重量级课程',
  '白兔子', '怀尔·E', '来抓他们！', '要么戎马凯旋，要么战死沙场', '王箔草',
  '观星师', '空战王牌', '魔菇说', '模拟城市', '豺狼人杀手',
  '真心话大冒险', '人头落地！', '还不够...还不够...', '红色中队', '死期未到！',
  '壮丽之城', '塔瑞尔学徒', '无敌的守护者', '幽暗蝇灭杀剂', '矮人瀑布',
  '幻影地带', '坚守阵地！', '花园之歌', '叮！叮！叮！', '野火大丰收',
  '旗帜的传说', '比翁人', '番茄杀手！', '吉瓦！', '侏罗纪湖',
  '杀无赦！', '黑桃A', '就喜欢动来动去！', '收集魔力', '星尘'
];

// ===================================================================
// IAP — 6 件消耗型战场法术道具，名称与效果取自逆向报告第 9 章
// ===================================================================
var IAP = [
  { id: 'wrath_of_elynia', nameZh: '艾纳妮之怒', nameEn: 'Wrath of Elynie', desc: '神圣符号释放女神的愤怒，对范围内敌人造成伤害。', price: 80 },
  { id: 'rod_dragon_fire', nameZh: '龙焰之杖', nameEn: 'Rod of Dragon Fire', desc: '我们军械库中的一块瑰宝，里面保存着一千头龙的吐息！只要将它放在路上，就能将整个世界化作一片火海！', price: 120 },
  { id: 'horn_heroism', nameZh: '英勇号角', nameEn: 'Horn of Heroism', desc: '吹响号角，使防御塔与士兵无敌并获得双倍伤害。', price: 100 },
  { id: 'teleport_scroll', nameZh: '传送卷轴', nameEn: 'Teleport Scroll', desc: '卷轴中的法术会将敌人沿原路送回。适用于紧急情况……或者只是为了好玩。', price: 60 },
  { id: 'hand_midas', nameZh: '迈达斯之手', nameEn: 'Hand of Midas', desc: '一段时间内收入翻倍。', price: 90 },
  { id: 'gem_timewarp', nameZh: '时空宝石', nameEn: 'Gem of Timewarp', desc: '使全体敌人回退并减速。', price: 110 }
];

// ===================================================================
// DIFFICULTIES — 5 档难度，以系数矩阵修正敌人属性
// ===================================================================
var DIFFICULTIES = [
  { id: 'casual', nameZh: '休闲', nameEn: 'Casual', hpFactor: 0.8, speedFactor: 0.9 },
  { id: 'normal', nameZh: '普通', nameEn: 'Normal', hpFactor: 1.0, speedFactor: 1.0 },
  { id: 'veteran', nameZh: '老兵', nameEn: 'Veteran', hpFactor: 1.3, speedFactor: 1.1 },
  { id: 'heroic', nameZh: '英雄', nameEn: 'Heroic', hpFactor: 1.7, speedFactor: 1.2 },
  { id: 'iron', nameZh: '铁人', nameEn: 'Iron', hpFactor: 2.1, speedFactor: 1.3 }
];

// ===================================================================
// 查询函数
// ===================================================================
function getLevel(id) {
  for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
  return null;
}

function getTower(id) {
  for (var i = 0; i < TOWERS.length; i++) if (TOWERS[i].id === id) return TOWERS[i];
  return null;
}

function getEnemy(id) {
  for (var i = 0; i < ENEMIES.length; i++) if (ENEMIES[i].id === id) return ENEMIES[i];
  for (var j = 0; j < BOSSES.length; j++) if (BOSSES[j].id === id) return BOSSES[j];
  return null;
}

module.exports = {
  LEVELS: LEVELS,
  THEMES: THEMES,
  TOWERS: TOWERS,
  HEROES: HEROES,
  ENEMIES: ENEMIES,
  BOSSES: BOSSES,
  POWERS: POWERS,
  COMICS: COMICS,
  ACHIEVEMENTS: ACHIEVEMENTS,
  IAP: IAP,
  DIFFICULTIES: DIFFICULTIES,
  getLevel: getLevel,
  getTower: getTower,
  getEnemy: getEnemy
};
