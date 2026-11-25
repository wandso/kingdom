/**
 * 场景管理器（微信小游戏）—— 把原小程序的 5 个 WXML 页面改造成 Canvas 场景
 * ------------------------------------------------------------------
 * 逻辑坐标系固定 1000x600（塔防引擎同坐标系），主循环按屏幕尺寸等比缩放居中。
 * 每个场景实现：enter(params) / render(ctx) / onTap(lx,ly) / 可选 onTick(dt)
 *
 * 场景列表：menu（主菜单）/ levels（关卡选择）/ battle（战斗）/ heroes（英雄）/ story（剧情）
 */
var DATA = require('./data');
var UI = require('./ui');
var Storage = require('./storage');
var Resources = require('./resources');
var REAL_PATHS_FULL = null;   // 反编译自原作 levelNN_paths.lua
var REAL_WAVES = null;        // 反编译自原作 levelNN_waves_*.lua
var SPRITE_MANIFEST = null;   // 反编译 f_quad 切出的精灵
var REAL_SLOTS = null;        // 原作塔位种子(levelNN_data.lua) + 背景图空地像素吸附修正(refine_slots.js)，rally=原作真实集结点
// 微信小游戏不保证支持 require('*.json')，统一改用 CommonJS 数据模块（由同名 JSON 生成）
try { REAL_PATHS_FULL = require('./real_paths_data'); } catch (e) { REAL_PATHS_FULL = {}; console.error('[KRO] 路径数据加载失败', e); }
try { REAL_WAVES = require('./real_waves_data'); } catch (e) { REAL_WAVES = {}; console.error('[KRO] 波次数据加载失败', e); }
try { REAL_SLOTS = require('./real_slots_data'); } catch (e) { REAL_SLOTS = {}; console.error('[KRO] 塔位数据加载失败', e); }
try { SPRITE_MANIFEST = require('./sprite_manifest'); } catch (e) { SPRITE_MANIFEST = {}; }
// 数据自检：确认关键关卡路径已加载（便于开发者工具控制台排查）
try {
  var __pk = Object.keys(REAL_PATHS_FULL || {});
  console.log('[KRO] 路径关卡=' + __pk.length + ', 塔位关卡=' + Object.keys(REAL_SLOTS || {}).length + ', L01塔位=' + ((REAL_SLOTS && REAL_SLOTS['01'] || []).length) + ', L01曲线=' + ((REAL_PATHS_FULL['01'] && REAL_PATHS_FULL['01'].curves || []).length) + ', 波次组=' + ((REAL_WAVES['level01_waves_campaign'] || {}).groups || []).length);
} catch (e) { console.error('[KRO] 数据自检失败', e); }
var C = UI.C;

// 难度 → 原作波次文件后缀
function waveSuffix(diff) {
  var name = (diff && (diff.id || diff.key || diff.name || '')) + '';
  var idx = (diff && diff.index) || 0;
  if (/iron|铁人/i.test(name) || idx === 4) return 'iron';
  if (/heroic|英雄/i.test(name) || idx === 3) return 'heroic';
  if (/veteran|老兵/i.test(name) || idx === 2) return 'heroic';
  return 'campaign';
}

// 异步加载精灵 manifest 中所有图片 → { key: {image, w, h} }
var _spritesCache = null;
var _spritesPromise = null;
function loadAllSprites() {
  if (_spritesCache) return Promise.resolve(_spritesCache);
  if (_spritesPromise) return _spritesPromise;
  // 精灵在主包 assets 内，直接加载（避免分包时序问题）
  var out = {};
  var keys = Object.keys(SPRITE_MANIFEST || {});
  var jobs = keys.map(function (k) {
    var s = SPRITE_MANIFEST[k];
    return Resources.loadImage(s.file).then(function (img) {
      if (img) out[k] = { image: img, w: s.w, h: s.h, pw: s.pw, ph: s.ph, trim: s.trim || null, frames: null, frameIdx: 0 };
    });
  });
  _spritesPromise = Promise.all(jobs).then(function () {
    // 聚合塔顶单位的动画帧 top_<fam>_fN → out.top_<fam>.frames（远程攻击动作）
    ['archer', 'mage', 'artillery', 'barracks'].forEach(function (fam) {
      var base = out['top_' + fam];
      if (!base) return;
      var fr = [];
      for (var i = 0; i < 12; i++) {
        var f = out['top_' + fam + '_f' + i];
        if (f && f.image) fr.push(f.image);
      }
      if (fr.length) base.frames = fr;
    });
    // 兼容旧 tower_* 帧序列
    ['archer', 'mage', 'artillery', 'barracks'].forEach(function (fam) {
      var base = out['tower_' + fam];
      if (!base) return;
      var fr = [];
      for (var i = 0; i < 8; i++) {
        var f = out['tower_' + fam + '_f' + i];
        if (f && f.image) fr.push(f.image);
      }
      if (fr.length) base.frames = fr;
    });
    _spritesCache = out;
    return out;
  });
  return _spritesPromise;
}

var LW = 1000, LH = 600;

function createSceneManager(app) {
  var current = null;
  var currentName = '';
  var params = {};

  function go(name, p) {
    params = p || {};
    currentName = name;
    current = SCENES[name](app, go, params);
    if (current && typeof current.enter === 'function') current.enter(params);
  }

  return {
    go: go,
    getName: function () { return currentName; },
    render: function (ctx) { if (current && current.render) current.render(ctx); },
    onTap: function (lx, ly) { if (current && current.onTap) current.onTap(lx, ly); },
    onTick: function (dt) { if (current && current.onTick) current.onTick(dt); },
    destroy: function () { if (current && current.destroy) current.destroy(); },
  };
}

// ============ 通用：顶部标题条 ============
// titleX: 标题起始 x；带「返回」按钮的场景传 136，避免与按钮重叠
function header(ctx, title, sub, titleX) {
  ctx.fillStyle = 'rgba(20,14,6,0.85)';
  ctx.fillRect(0, 0, LW, 62);
  UI.text(ctx, title, titleX || 24, 40, { size: 30, bold: true, color: C.gold, shadow: '#000', stroke: '#2b1d0e' });
  if (sub) UI.text(ctx, sub, LW - 24, 40, { size: 18, color: '#c8b78e', align: 'right' });
}

// ============ 主菜单 ============
function menuScene(app, go) {
  var btns = [];
  var stars = [];
  var menuBg = null;
  for (var i = 0; i < 40; i++) stars.push({ x: (i * 137.5) % LW, y: (i * 71.3) % 300, r: (i % 3) * 0.6 + 0.8 });
  // 异步加载真实主菜单背景（精灵森林加载画面）
  Resources.loadImage('assets/loading/loading_elven_woods.png').then(function (img) { menuBg = img; });
  return {
    enter: function () { btns = []; },
    render: function (ctx) {
      if (menuBg) {
        // 真实手绘背景 + 暗化遮罩（保证文字可读）
        ctx.drawImage(menuBg, 0, 0, LW, LH);
        ctx.fillStyle = 'rgba(12,18,12,0.42)';
        ctx.fillRect(0, 0, LW, LH);
      } else {
        // 程序化夜空兜底
        var g = ctx.createLinearGradient(0, 0, 0, LH);
        g.addColorStop(0, '#141d2e'); g.addColorStop(0.6, '#263c46'); g.addColorStop(1, '#2f4a2a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
        ctx.fillStyle = 'rgba(255,244,200,0.75)';
        for (var i = 0; i < stars.length; i++) { ctx.beginPath(); ctx.arc(stars[i].x, stars[i].y, stars[i].r, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#f5e6a8'; ctx.beginPath(); ctx.arc(830, 110, 54, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a2634'; ctx.beginPath(); ctx.arc(852, 96, 48, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1c2b22';
        ctx.beginPath(); ctx.moveTo(0, 420); ctx.lineTo(180, 300); ctx.lineTo(340, 430); ctx.lineTo(560, 280); ctx.lineTo(760, 440); ctx.lineTo(1000, 310); ctx.lineTo(1000, 600); ctx.lineTo(0, 600); ctx.closePath(); ctx.fill();
      }
      // 标题
      UI.text(ctx, '王国保卫战', LW / 2, 132, { size: 66, bold: true, color: C.gold, align: 'center', stroke: '#2b1d0e', strokeWidth: 8, shadow: '#000', shadowBlur: 12 });
      UI.text(ctx, '起  源', LW / 2, 196, { size: 40, bold: true, color: '#f0e2bd', align: 'center', stroke: '#2b1d0e', strokeWidth: 6 });
      // 按钮（在 render 中生成以便拿到 ctx）
      btns = [];
      var y0 = 280;
      btns.push({ id: 'start', rect: UI.button(ctx, 350, y0, 300, 62, '开始征战', { fontSize: 28 }) });
      btns.push({ id: 'heroes', rect: UI.button(ctx, 350, y0 + 80, 300, 56, '英雄图鉴', { color: '#4a3a6e', color2: '#2e2348', border: '#8f6fc0' }) });
      btns.push({ id: 'story', rect: UI.button(ctx, 350, y0 + 146, 300, 56, '起源史诗', { color: '#3a5a3a', color2: '#233b23', border: '#6fa86f' }) });
      // 版本/存档信息
      var prog = app.progress;
      UI.text(ctx, '已解锁 ' + prog.unlockedLevel + ' 关  ·  总分 ' + prog.totalScore, LW / 2, 560, { size: 16, color: '#c8b78e', align: 'center' });
      UI.text(ctx, 'Kingdom Rush Origins · 逆向复刻版', LW / 2, 584, { size: 13, color: '#8f8f7a', align: 'center' });
    },
    onTap: function (x, y) {
      for (var i = 0; i < btns.length; i++) {
        if (UI.hit(btns[i].rect, x, y)) {
          if (btns[i].id === 'start') go('levels');
          else if (btns[i].id === 'heroes') go('heroes');
          else if (btns[i].id === 'story') go('story');
          return;
        }
      }
    },
  };
}

// ============ 关卡选择 ============
function levelsScene(app, go) {
  var cards = [], backBtn, diffBtns = [], scrollY = 0;
  var LEVELS = DATA.LEVELS;
  var cols = 5, cw = 168, ch = 96, gapX = 14, gapY = 14;
  var gridX = 40, gridY = 128;
  function visibleCount() { return 2; } // 每屏两行
  return {
    enter: function () { scrollY = 0; },
    render: function (ctx) {
      UI.background(ctx, LW, LH, { sky: '#22303a', ground: '#1a2415' });
      header(ctx, '选择关卡', '共 ' + LEVELS.length + ' 关', 136);
      backBtn = UI.button(ctx, 24, 16, 96, 34, '‹ 返回', { fontSize: 16 });
      // 难度选择
      var diffs = DATA.DIFFICULTIES || [];
      diffBtns = [];
      var dx = 720;
      for (var d = 0; d < diffs.length; d++) {
        var active = app.difficulty && app.difficulty.id === diffs[d].id;
        var r = UI.button(ctx, dx + d * 56, 16, 52, 34, diffs[d].nameZh, {
          fontSize: 14,
          color: active ? '#8a6a1f' : '#4a3a24',
          color2: active ? '#6b4e12' : '#2e2414',
          border: active ? '#f5d67a' : '#7a6238',
        });
        diffBtns.push({ id: diffs[d].id, rect: r });
      }
      // 关卡网格（显示已解锁关，滚动）
      cards = [];
      var perPage = cols * 2;
      var page = Math.floor(scrollY / perPage);
      var start = page * perPage;
      var maxPage = Math.max(0, Math.ceil(LEVELS.length / perPage) - 1);
      if (page > maxPage) page = maxPage;
      start = page * perPage;
      for (var i = 0; i < perPage && (start + i) < LEVELS.length; i++) {
        var lv = LEVELS[start + i];
        var col = i % cols, row = Math.floor(i / cols);
        var x = gridX + col * (cw + gapX), y = gridY + row * (ch + gapY);
        var unlocked = lv.id <= app.progress.unlockedLevel;
        var starsN = app.progress.levelStars[lv.id] || 0;
        var th = (DATA.THEMES || {})[lv.theme] || {};
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
        UI.rr(ctx, x, y, cw, ch, 10);
        ctx.fillStyle = unlocked ? (th.ground || '#4f7f3a') : '#3a3a34'; ctx.fill();
        ctx.restore();
        UI.rr(ctx, x, y, cw, ch, 10); ctx.strokeStyle = unlocked ? '#f5d67a' : '#5a5a50'; ctx.lineWidth = 2; ctx.stroke();
        if (lv.bossId) { UI.text(ctx, 'BOSS', x + cw - 8, y + 18, { size: 12, bold: true, color: '#ff8b7a', align: 'right' }); }
        if (lv.endless) { UI.text(ctx, '无尽', x + 8, y + 18, { size: 12, bold: true, color: '#ffe27a' }); }
        UI.text(ctx, lv.id + '. ' + lv.nameZh, x + cw / 2, y + 46, { size: 17, bold: true, color: unlocked ? '#fff5d8' : '#9a9a8e', align: 'center', stroke: '#2b1d0e', strokeWidth: 3 });
        UI.text(ctx, lv.nameEn || '', x + cw / 2, y + 66, { size: 11, color: unlocked ? '#e0d4a8' : '#7a7a70', align: 'center' });
        if (unlocked) {
          var st = '';
          for (var k = 0; k < 3; k++) st += (k < starsN ? '★' : '☆');
          UI.text(ctx, st, x + cw / 2, y + 86, { size: 18, color: C.gold, align: 'center' });
        } else {
          UI.text(ctx, '🔒 未解锁', x + cw / 2, y + 86, { size: 13, color: '#aaa', align: 'center' });
        }
        cards.push({ lv: lv, rect: { x: x, y: y, w: cw, h: ch }, unlocked: unlocked });
      }
      // 翻页
      UI.text(ctx, '第 ' + (page + 1) + ' / ' + (maxPage + 1) + ' 页', LW / 2, 470, { size: 16, color: '#e0d4a8', align: 'center' });
      var prevR = UI.button(ctx, 380, 490, 110, 44, '‹ 上一页', { fontSize: 16, disabled: page === 0 });
      var nextR = UI.button(ctx, 510, 490, 110, 44, '下一页 ›', { fontSize: 16, disabled: page >= maxPage });
      cards.push({ id: '__prev', rect: prevR, unlocked: page > 0 });
      cards.push({ id: '__next', rect: nextR, unlocked: page < maxPage });
    },
    onTap: function (x, y) {
      if (UI.hit(backBtn, x, y)) { go('menu'); return; }
      for (var i = 0; i < diffBtns.length; i++) {
        if (UI.hit(diffBtns[i].rect, x, y)) {
          var d = (DATA.DIFFICULTIES || []).find(function (q) { return q.id === diffBtns[i].id; });
          if (d) app.difficulty = d;
          return;
        }
      }
      for (var j = 0; j < cards.length; j++) {
        if (!UI.hit(cards[j].rect, x, y)) continue;
        if (cards[j].id === '__prev') { scrollY -= 10; return; }
        if (cards[j].id === '__next') { scrollY += 10; return; }
        if (cards[j].unlocked) { go('battle', { level: cards[j].lv }); }
        return;
      }
    },
  };
}

// ============ 战斗 ============
function battleScene(app, go, p) {
  var Engine = require('./engine');
  var level = p.level || DATA.LEVELS[0];
  var engine = null;
  var hud = {}, ctrlBtns = [], towerBtns = [], overlayBtns = [];
  var showIntro = true;
  var result = null;
  var toast = { text: '', life: 0 };
  var fieldRect = { x: 0, y: 62, w: LW, h: 470 }; // 战场逻辑区域

  function say(t) { toast.text = t; toast.life = 1.6; }

  var __battleCtx = null;
  var bgLoaded = false;

  function initEngine() {
    var sid = String(level.id).padStart(2, '0');
    var engLevel = Object.assign({}, level);

    // 真实塔位（反编译原作 levelNN_data.lua 的 tower_holder）：覆盖程序随机生成的 slots
    var rslots = REAL_SLOTS && REAL_SLOTS[sid];
    if (rslots && rslots.length) {
      engLevel.slots = rslots.map(function (s) { return { x: s.x, y: s.y, rally: s.rally || null }; });
    }

    // 真实路径（反编译原作 levelNN_paths.lua）：多条曲线 + active 标记
    var rp = REAL_PATHS_FULL && REAL_PATHS_FULL[sid];
    var realPaths = null;
    if (rp && rp.curves && rp.curves.length) {
      realPaths = rp.curves.map(function (c) { return c.mapped || c.raw; });
    }

    // 真实波次（反编译原作 levelNN_waves_*.lua），按难度选文件
    var diff = app.difficulty || DATA.DIFFICULTIES[1];
    var suffix = waveSuffix(diff);
    var waveKey = 'level' + sid + '_waves_' + suffix;
    var realWaves = (REAL_WAVES && REAL_WAVES[waveKey]) || null;

    engine = Engine.createEngine({
      ctx: __battleCtx,
      level: engLevel,
      difficulty: diff,
      hero: null,
      realPaths: realPaths,
      realWaves: realWaves,
      sprites: _spritesCache,
      onState: function (s) { app._battleState = s; },
      onEnd: function (r) { result = r; onEnd(r); },
    });
    engine.setViewport(LW, 470);
    engine.start();

    // 异步加载真实关卡背景图（主包首关为本地，其他关在分包）
    var mainBg = 'assets/stages/bg_' + sid + '.png';
    var pkgBg = 'pkg_assets/stages/bg_' + sid + '.png';
    Resources.loadImage(mainBg).then(function (img) {
      if (img) { engine.setBackground(img); bgLoaded = true; return; }
      return Resources.loadImage(pkgBg).then(function (img2) {
        if (img2) { engine.setBackground(img2); bgLoaded = true; }
      });
    });
    // 异步加载精灵，加载完后注入引擎（引擎绘制时优先用精灵）
    if (!_spritesCache) {
      loadAllSprites().then(function (sprites) {
        app._spriteDebug = Object.keys(sprites).length + '/' + Object.keys(SPRITE_MANIFEST).length;
        if (engine && engine.setSprites) engine.setSprites(sprites);
      });
    } else {
      app._spriteDebug = Object.keys(_spritesCache).length + '/' + Object.keys(SPRITE_MANIFEST).length;
    }
  }

  function onEnd(r) {
    if (r.win) {
      var id = level.id;
      var old = app.progress.levelStars[id] || 0;
      if (r.stars > old) app.progress.levelStars[id] = r.stars;
      if (app.progress.unlockedLevel < id + 1 && id < DATA.LEVELS.length) app.progress.unlockedLevel = id + 1;
      app.progress.totalScore += r.score;
      app.saveProgress();
    }
  }

  return {
    enter: function () { showIntro = true; result = null; engine = null; },
    render: function (ctx) {
      __battleCtx = ctx;
      if (!engine) initEngine();
      // 战场：引擎按 1000x470 视口绘制（初始化时已 setViewport），需平移到 (0,62)
      ctx.save();
      ctx.translate(0, 62);
      engine.render();
      ctx.restore();

      // 战斗顶部 HUD（覆盖在引擎信息条之下的第二行控制区）
      header(ctx, level.id + '. ' + level.nameZh, '按原作路径行进');
      ctrlBtns = [];
      var by = 540;
      ctrlBtns.push({ id: 'pause', rect: UI.button(ctx, 24, by, 92, 46, engine.getState().status === 'paused' ? '继续' : '暂停', { fontSize: 18 }) });
      ctrlBtns.push({ id: 'speed', rect: UI.button(ctx, 126, by, 92, 46, '×' + engine.getState().speed, { fontSize: 18, color: '#3a5a3a', color2: '#223b22', border: '#6fa86f' }) });
      ctrlBtns.push({ id: 'wave', rect: UI.button(ctx, 228, by, 116, 46, '召唤波次', { fontSize: 17, color: '#7a5228', color2: '#4e3317' }) });
      var powers = DATA.POWERS || [];
      for (var i = 0; i < powers.length; i++) {
        var cd = (engine.getState().powerCd || {})[powers[i].id] || 0;
        var label = powers[i].nameZh + (cd > 0 ? ' ' + Math.ceil(cd) + 's' : '');
        ctrlBtns.push({ id: 'power_' + powers[i].id, rect: UI.button(ctx, 356 + i * 150, by, 144, 46, label, { fontSize: 15, disabled: cd > 0, color: '#4a3a6e', color2: '#2e2348', border: '#8f6fc0' }) });
      }
      ctrlBtns.push({ id: 'back', rect: UI.button(ctx, 864, by, 112, 46, '撤退', { fontSize: 18, color: '#7a2f2f', color2: '#4e1c1c', border: '#b85a5a' }) });

      // 建塔 / 操作面板（选中槽位时）
      var sel = engine.getSelectedSlot();
      if (sel >= 0) {
        var info = engine.getSlotInfo(sel);
        UI.panel(ctx, 640, 80, 344, 420, { radius: 12 });
        if (!info.built) {
          UI.text(ctx, '建造防御塔', 812, 112, { size: 22, bold: true, color: C.ink, align: 'center' });
          UI.text(ctx, '金币 ' + engine.getState().gold, 812, 138, { size: 15, color: '#8a6a34', align: 'center' });
          towerBtns = [];
          var bases = (DATA.TOWERS || []).filter(function (t) { return !t.branch && (t.tier === 1 || t.tier === undefined); });
          if (bases.length > 8) bases = bases.slice(0, 8);
          for (var k = 0; k < bases.length; k++) {
            var bx = 656 + (k % 2) * 164, byy = 154 + Math.floor(k / 2) * 74;
            var canAfford = engine.getState().gold >= (bases[k].cost || 70);
            var r = UI.button(ctx, bx, byy, 156, 66, bases[k].nameZh, { fontSize: 14, disabled: !canAfford });
            UI.text(ctx, '💰' + (bases[k].cost || 70), bx + 78, byy + 60, { size: 12, color: canAfford ? '#7a5a1a' : '#a33', align: 'center' });
            towerBtns.push({ id: bases[k].id, rect: r });
          }
        } else {
          var t = info.tower;
          UI.text(ctx, t.def.nameZh || '防御塔', 812, 116, { size: 22, bold: true, color: C.ink, align: 'center' });
          UI.text(ctx, '等级 ' + (t.level || 1), 812, 144, { size: 15, color: '#8a6a34', align: 'center' });
          if (t.def.desc) wrapText(ctx, t.def.desc, 660, 172, 304, 20, 15, C.ink);
          towerBtns = [];
          var upR = UI.button(ctx, 664, 420, 156, 56, '升级', { fontSize: 20, color: '#3a6a3a', color2: '#224422', border: '#6fa86f' });
          var sellR = UI.button(ctx, 832, 420, 140, 56, '出售', { fontSize: 20, color: '#7a2f2f', color2: '#4e1c1c', border: '#b85a5a' });
          var closeR = UI.button(ctx, 664, 484, 308, 0, '', { fontSize: 1 }); // 占位
          towerBtns.push({ id: '__upgrade', rect: upR });
          towerBtns.push({ id: '__sell', rect: sellR });
          UI.button(ctx, 664, 486, 308, 40, '取消选择', { fontSize: 16, color: '#6a5a44', color2: '#453a2c' });
          towerBtns.push({ id: '__close', rect: { x: 664, y: 486, w: 308, h: 40 } });
        }
      }

      // 开场剧情
      if (showIntro) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, LW, LH);
        UI.panel(ctx, 180, 170, 640, 260, { radius: 16 });
        UI.text(ctx, level.nameZh, 500, 220, { size: 32, bold: true, color: C.ink, align: 'center' });
        UI.text(ctx, level.nameEn || '', 500, 250, { size: 16, color: '#8a6a34', align: 'center' });
        wrapText(ctx, level.history || '准备迎战！', 230, 296, 540, 26, 19, C.ink);
        overlayBtns = [{ id: 'intro_ok', rect: UI.button(ctx, 380, 372, 240, 46, '开始战斗', { fontSize: 20, color: '#3a6a3a', color2: '#224422', border: '#6fa86f' }) }];
      } else if (result) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, LW, LH);
        UI.panel(ctx, 250, 150, 500, 300, { radius: 16 });
        UI.text(ctx, result.win ? '胜利！' : '战败', 500, 210, { size: 44, bold: true, color: result.win ? C.green : C.red, align: 'center' });
        if (result.win) {
          var st = ''; for (var s = 0; s < 3; s++) st += (s < result.stars ? '★' : '☆');
          UI.text(ctx, st, 500, 262, { size: 40, color: C.gold, align: 'center' });
        }
        UI.text(ctx, '得分 ' + result.score + '  ·  剩余生命 ' + result.lives, 500, 316, { size: 18, color: C.ink, align: 'center' });
        overlayBtns = [
          { id: 'retry', rect: UI.button(ctx, 292, 366, 190, 52, '再战一次', { fontSize: 19 }) },
          { id: 'tolevels', rect: UI.button(ctx, 518, 366, 190, 52, '返回关卡', { fontSize: 19, color: '#3a5a3a', color2: '#223b22', border: '#6fa86f' }) },
        ];
      } else {
        overlayBtns = [];
      }

      // toast
      if (toast.life > 0) {
        UI.panel(ctx, 350, 96, 300, 44, { radius: 10, fill: 'rgba(20,14,6,0.9)', stroke: '#8a6a34' });
        UI.text(ctx, toast.text, 500, 124, { size: 17, color: C.gold, align: 'center' });
      }
    },
    onTick: function (dt) {
      if (toast.life > 0) toast.life -= dt;
      if (!showIntro && !result && engine) engine.getState();
    },
    onTap: function (x, y) {
      // 弹层优先
      for (var o = 0; o < overlayBtns.length; o++) {
        if (!UI.hit(overlayBtns[o].rect, x, y)) continue;
        if (overlayBtns[o].id === 'intro_ok') { showIntro = false; }
        else if (overlayBtns[o].id === 'retry') { engine.destroy(); engine = null; result = null; showIntro = false; }
        else if (overlayBtns[o].id === 'tolevels') { if (engine) engine.destroy(); go('levels'); }
        return;
      }
      if (showIntro || result) return;
      // 右侧建塔面板
      for (var k = 0; k < towerBtns.length; k++) {
        if (!UI.hit(towerBtns[k].rect, x, y)) continue;
        var id = towerBtns[k].id;
        var sel = engine.getSelectedSlot();
        if (id === '__upgrade') { var r = engine.upgradeTower(sel); say(r.msg); }
        else if (id === '__sell') { var r2 = engine.sellTower(sel); say(r2.msg); }
        else if (id === '__close') { engine.selectSlot(-1); }
        else { var r3 = engine.buildTower(sel, id); say(r3.msg); if (r3.ok) engine.selectSlot(-1); }
        return;
      }
      // 底部控制栏
      for (var c = 0; c < ctrlBtns.length; c++) {
        if (!UI.hit(ctrlBtns[c].rect, x, y)) continue;
        var cid = ctrlBtns[c].id;
        if (cid === 'pause') { var st = engine.getState().status; if (st === 'paused') engine.resume(); else engine.pause(); }
        else if (cid === 'speed') { var sp = engine.getState().speed === 2 ? 1 : 2; engine.setSpeed(sp); }
        else if (cid === 'wave') { var rw = engine.callWave(); if (rw.msg) say(rw.msg); }
        else if (cid.indexOf('power_') === 0) { var rp = engine.castPower(cid.slice(6)); if (rp.msg) say(rp.msg); }
        else if (cid === 'back') { engine.destroy(); go('levels'); }
        return;
      }
      // 战场点击 -> 选槽位（把逻辑坐标换算到战场视口：y 需要减去 62）
      if (y >= fieldRect.y && y <= fieldRect.y + fieldRect.h) {
        var slot = engine.getCanvasTap(x, y - fieldRect.y);
        engine.selectSlot(slot);
      }
    },
    destroy: function () { if (engine) engine.destroy(); },
  };
}

// 文本自动换行
function wrapText(ctx, str, x, y, maxW, lineH, size, color) {
  ctx.font = (size || 16) + 'px sans-serif';
  ctx.fillStyle = color || C.ink;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  var chars = String(str || '').split(''), line = '', yy = y;
  for (var i = 0; i < chars.length; i++) {
    var test = line + chars[i];
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = chars[i]; yy += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}

// ============ 英雄图鉴 ============
function heroesScene(app, go) {
  var HEROES = DATA.HEROES || [];
  var backBtn, cards = [], detailHero = null, closeBtn;
  var heroPage = 0, pageBtns = [];
  var PER_PAGE = 15; // 5列×3行，确保全部可见
  var totalPages = Math.max(1, Math.ceil(HEROES.length / PER_PAGE));
  return {
    enter: function () { detailHero = null; heroPage = 0; },
    render: function (ctx) {
      UI.background(ctx, LW, LH, { sky: '#2a2340', ground: '#1a1626' });
      header(ctx, '英雄图鉴', HEROES.length + ' 位英雄 · 第' + (heroPage + 1) + '/' + totalPages + '页', 136);
      backBtn = UI.button(ctx, 24, 16, 96, 34, '‹ 返回', { fontSize: 16 });
      cards = [];
      var start = heroPage * PER_PAGE;
      for (var i = start; i < Math.min(start + PER_PAGE, HEROES.length); i++) {
        var h = HEROES[i];
        var k = i - start;
        var col = k % 5, row = Math.floor(k / 5);
        var x = 40 + col * 190, y = 88 + row * 132;
        var unlocked = (app.progress.unlockedHeroes || []).indexOf(h.id) >= 0;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8;
        UI.rr(ctx, x, y, 176, 122, 10);
        ctx.fillStyle = unlocked ? (h.color || '#5a4a7a') : '#3a3a38'; ctx.fill(); ctx.restore();
        UI.rr(ctx, x, y, 176, 122, 10); ctx.strokeStyle = unlocked ? '#f5d67a' : '#5a5a52'; ctx.lineWidth = 2; ctx.stroke();
        // 头像圆
        ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.arc(x + 88, y + 45, 28, 0, Math.PI * 2); ctx.fill();
        UI.text(ctx, unlocked ? (h.nameZh || '?').slice(0, 1) : '锁', x + 88, y + 53, { size: 30, bold: true, color: unlocked ? '#fff' : '#888', align: 'center' });
        UI.text(ctx, h.nameZh || h.id, x + 88, y + 92, { size: 15, bold: true, color: unlocked ? '#fff5d8' : '#9a9a92', align: 'center' });
        UI.text(ctx, h.cls || '', x + 88, y + 111, { size: 11, color: unlocked ? '#e0d4a8' : '#7a7a72', align: 'center' });
        cards.push({ h: h, rect: { x: x, y: y, w: 176, h: 122 }, unlocked: unlocked });
      }
      // 翻页按钮
      pageBtns = [];
      pageBtns.push({ id: 'prev', rect: UI.button(ctx, 340, 496, 140, 46, '‹ 上一页', { fontSize: 17, disabled: heroPage === 0 }) });
      pageBtns.push({ id: 'next', rect: UI.button(ctx, 520, 496, 140, 46, '下一页 ›', { fontSize: 17, disabled: heroPage >= totalPages - 1 }) });
      if (detailHero) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, LW, LH);
        UI.panel(ctx, 200, 110, 600, 380, { radius: 16 });
        var d = detailHero;
        UI.text(ctx, d.nameZh, 500, 158, { size: 34, bold: true, color: d.color || C.purple, align: 'center' });
        UI.text(ctx, d.nameEn + ' · ' + (d.cls || ''), 500, 188, { size: 15, color: '#8a6a34', align: 'center' });
        wrapText(ctx, d.desc || '', 236, 224, 528, 26, 17, C.ink);
        UI.text(ctx, '技能', 236, 300, { size: 20, bold: true, color: C.ink });
        var sks = d.skills || [];
        var yy = 330;
        for (var s = 0; s < sks.length && s < 3; s++) {
          UI.text(ctx, '• ' + (sks[s].nameZh || ''), 240, yy, { size: 16, bold: true, color: C.purple });
          wrapText(ctx, sks[s].desc || '', 260, yy + 22, 500, 20, 13, '#5a4a34');
          yy += 62;
        }
        closeBtn = UI.button(ctx, 400, 452, 200, 44, '关闭', { fontSize: 18 });
      }
    },
    onTap: function (x, y) {
      if (detailHero) { if (UI.hit(closeBtn, x, y)) detailHero = null; return; }
      if (UI.hit(backBtn, x, y)) { go('menu'); return; }
      for (var p = 0; p < pageBtns.length; p++) {
        if (!UI.hit(pageBtns[p].rect, x, y)) continue;
        if (pageBtns[p].id === 'prev' && heroPage > 0) heroPage--;
        else if (pageBtns[p].id === 'next' && heroPage < totalPages - 1) heroPage++;
        return;
      }
      for (var i = 0; i < cards.length; i++) {
        if (UI.hit(cards[i].rect, x, y)) { detailHero = cards[i].h; return; }
      }
    },
  };
}

// ============ 剧情 / 漫画 ============
function storyScene(app, go) {
  var COMICS = DATA.COMICS || [];
  var idx = 0, backBtn, navBtns = [];
  var comicImgs = {}; // idx -> image
  // 预加载全部 9 幕漫画（主包内）
  for (var ci = 1; ci <= 9; ci++) {
    (function (num) {
      Resources.loadImage('pkg_assets/comics/comic_' + num + '.png').then(function (img) { comicImgs[num] = img; });
    })(ci);
  }
  return {
    enter: function () { idx = 0; },
    render: function (ctx) {
      UI.background(ctx, LW, LH, { sky: '#3a2c1e', ground: '#241a10' });
      header(ctx, '起源史诗', '9 幕漫画', 136);
      backBtn = UI.button(ctx, 24, 16, 96, 34, '‹ 返回', { fontSize: 16 });
      if (!COMICS.length) { UI.text(ctx, '暂无剧情数据', LW / 2, 300, { size: 24, color: '#ddd', align: 'center' }); return; }
      var c = COMICS[idx];
      UI.panel(ctx, 120, 96, 760, 400, { radius: 16 });
      // 真实漫画插画区（内容集中在原图左上，取整图按比例缩放展示在画框内）
      ctx.save();
      UI.rr(ctx, 150, 110, 700, 180, 10); ctx.clip();
      ctx.fillStyle = '#1a2a1e'; ctx.fillRect(150, 110, 700, 180);
      var cimg = comicImgs[idx + 1];
      if (cimg) {
        // 漫画图内容仅占左上约 640x680 区域，裁切后铺满画框
        var sw = Math.min(cimg.width, 700), sh = Math.min(cimg.height, 660);
        var scale = Math.max(700 / sw, 180 / sh);
        ctx.drawImage(cimg, 0, 0, sw, sh, 150, 110, sw * scale, sh * scale);
      } else {
        UI.text(ctx, '漫画载入中…', 500, 200, { size: 18, color: '#c8b78e', align: 'center' });
      }
      ctx.restore();
      UI.text(ctx, '第 ' + (idx + 1) + ' 幕 · ' + (c.title || ''), 500, 306, { size: 24, bold: true, color: C.ink, align: 'center' });
      var lines = c.lines || [];
      var yy = 348;
      for (var i = 0; i < lines.length && i < 3; i++) {
        var ln = lines[i];
        UI.text(ctx, (ln.speaker ? ln.speaker + '：' : ''), 156, yy, { size: 14, bold: true, color: C.goldDeep });
        var used = wrapText(ctx, ln.text || '', 156, yy + 22, 688, 24, 16, '#4a3a24');
        yy = used + 14;
        if (yy > 460) break;
      }
      navBtns = [];
      navBtns.push({ id: 'prev', rect: UI.button(ctx, 300, 520, 150, 48, '‹ 上一幕', { fontSize: 17, disabled: idx === 0 }) });
      navBtns.push({ id: 'next', rect: UI.button(ctx, 550, 520, 150, 48, '下一幕 ›', { fontSize: 17, disabled: idx >= COMICS.length - 1 }) });
    },
    onTap: function (x, y) {
      if (UI.hit(backBtn, x, y)) { go('menu'); return; }
      for (var i = 0; i < navBtns.length; i++) {
        if (!UI.hit(navBtns[i].rect, x, y)) continue;
        if (navBtns[i].id === 'prev' && idx > 0) idx--;
        else if (navBtns[i].id === 'next' && idx < COMICS.length - 1) idx++;
        return;
      }
    },
  };
}

var SCENES = {
  menu: menuScene,
  levels: levelsScene,
  battle: battleScene,
  heroes: heroesScene,
  story: storyScene,
};

module.exports = { createSceneManager: createSceneManager, SCENES: SCENES, LW: LW, LH: LH, header: header };
