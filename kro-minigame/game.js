/**
 * 王国保卫战：起源 —— 微信小游戏入口
 * ------------------------------------------------------------------
 * 忠实还原逆向分析报告的玩法 / 内容 / 叙事，采用纯 Canvas 渲染。
 * 逻辑坐标系 1000x600，按屏幕等比缩放居中；触摸坐标反算回逻辑坐标。
 */

var CanvasCtx = require('./js/canvas-ctx');
var Scenes = require('./js/scenes');
var Storage = require('./js/storage');
var Resources = require('./js/resources');
var DATA = require('./js/data');

var LW = Scenes.LW, LH = Scenes.LH;

// 应用全局状态（场景间共享）
var app = {
  progress: null,
  difficulty: null,
  _battleState: null,
  saveProgress: function () {
    Storage.save(this.progress);
  },
};

// 初始化存档与难度
(function init() {
  var loaded = Storage.load();
  app.progress = loaded.progress;
  var diffs = DATA.DIFFICULTIES || [];
  app.difficulty = diffs.filter(function (d) { return d.id === 'normal'; })[0] || diffs[0] || { id: 'normal', hpFactor: 1, speedFactor: 1 };
})();

// 主屏 canvas
var canvas = wx.createCanvas();
var ctx = CanvasCtx.adapt(canvas.getContext('2d'));

// 屏幕适配
var screen = { w: 0, h: 0, dpr: 1, scale: 1, ox: 0, oy: 0 };
function resize() {
  try {
    var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    screen.w = info.windowWidth;
    screen.h = info.windowHeight;
    screen.dpr = info.pixelRatio || 1;
  } catch (e) {
    screen.w = 375; screen.h = 667; screen.dpr = 1;
  }
  canvas.width = Math.round(screen.w * screen.dpr);
  canvas.height = Math.round(screen.h * screen.dpr);
  screen.scale = Math.min(screen.w / LW, screen.h / LH);
  screen.ox = (screen.w - LW * screen.scale) / 2;
  screen.oy = (screen.h - LH * screen.scale) / 2;
}

// 场景管理
var sm = Scenes.createSceneManager(app);
sm.go('menu');

// 主循环：逻辑 tick(dt) + 统一 render（清屏 -> 变换 -> 场景绘制）
var last = 0;
function frame(ts) {
  if (!last) last = ts;
  var dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  try { sm.onTick(dt); } catch (e) { console.error('[kro] tick error', e); }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(screen.dpr, screen.dpr);
  // 黑边背景
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, screen.w, screen.h);
  ctx.translate(screen.ox, screen.oy);
  ctx.scale(screen.scale, screen.scale);
  // 裁剪到逻辑区域
  ctx.beginPath(); ctx.rect(0, 0, LW, LH); ctx.clip();
  try { sm.render(ctx); } catch (e) { console.error('[kro] render error', e); }
  ctx.restore();

  raf(frame);
}

// 触摸：屏幕坐标 -> 逻辑坐标
function toLogic(touch) {
  var px = touch.clientX, py = touch.clientY;
  return { x: (px - screen.ox) / screen.scale, y: (py - screen.oy) / screen.scale };
}
wx.onTouchStart(function (e) {
  var t = e.touches && e.touches[0];
  if (!t) return;
  var p = toLogic(t);
  try { sm.onTap(p.x, p.y); } catch (err) { console.error('[kro] tap error', err); }
});

// 启动
resize();
wx.onResize && wx.onResize(function () { resize(); });
// 小游戏中 requestAnimationFrame 是全局函数（非 canvas 方法）；setTimeout 兜底
var raf = (typeof requestAnimationFrame === 'function')
  ? requestAnimationFrame
  : function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
raf(frame);

// 预加载素材分包（漫画/图集/非首关背景）。分包未就绪时主包首屏素材可正常显示。
Resources.loadSubpackage('pkg_assets').then(function (r) {
  if (r.ok) {
    console.log('[kro] 素材分包加载完成');
  } else {
    console.warn('[kro] 素材分包加载失败，将使用主包素材与程序化绘制', r.reason || r.error || '');
  }
});

// 便于调试
if (typeof GameGlobal !== 'undefined') {
  GameGlobal.__kro = { app: app, sm: sm, screen: screen };
}
