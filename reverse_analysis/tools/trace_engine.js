// 实证测试：驱动真实引擎若干帧，捕获敌人实际渲染坐标，叠加到背景图
// 目的：确认"引擎 + 新路径数据"确实让敌人沿土路走（排除引擎逻辑问题）
const path = require('path');
const fs = require('fs');
const ROOT = 'D:/xyh/game/kingdom/kro-minigame';
const RP = require(path.join(ROOT, 'js/real_paths_full.json'));
const { readPNG, writePNG } = require(path.join(ROOT, '../reverse_analysis/tools/pnglib'));

const LID = process.argv[2] || '01';
const lv = RP[LID];
const realPaths = lv.curves.map(c => c.mapped);

// 捕获敌人渲染坐标：传入 sprites=null，敌人走 arc(e.x, e.y, s)；记录所有 arc 调用
const enemyPts = [];
function mockCtx() {
  const noop = () => {};
  const t = {
    canvas: { width: 1000, height: 600 },
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    globalAlpha: 1,
    arc(x, y, r) { enemyPts.push({ x, y, r }); },
  };
  return new Proxy(t, { get(o, k) { if (k in o) return o[k]; return noop; }, set(o, k, v) { o[k] = v; return true; } });
}

// mock setInterval 捕获 tick；mock Date.now 手动推进
let tickFn = null;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const realNow = Date.now;
let simNow = 1000;
global.setInterval = (fn) => { tickFn = fn; return 1; };
global.clearInterval = () => { tickFn = null; };
Date.now = () => simNow;

const Engine = require(path.join(ROOT, 'js/engine.js'));
const eng = Engine.createEngine({
  ctx: mockCtx(),
  level: { id: parseInt(LID), path: realPaths[0], slots: [], gold: 300, waves: 20 },
  difficulty: { hpFactor: 1, speedFactor: 1 },
  realPaths: realPaths, realWaves: null, sprites: null,
  onState: () => {}, onEnd: () => {},
});
eng.setViewport(1000, 470);
eng.start();

// 手动推进 1200 帧（约 40 秒），每帧 +33ms；tick 只 update，需手动 render 触发绘制捕获
for (let i = 0; i < 1200; i++) { simNow += 33; if (tickFn) tickFn(); if (eng.render) eng.render(); }

// 还原
global.setInterval = realSetInterval; global.clearInterval = realClearInterval; Date.now = realNow;
eng.destroy();

// 过滤敌人点：半径接近敌人 size(通常 8~22)，且在逻辑地图范围内
const pts = enemyPts.filter(p => p.r >= 7 && p.r <= 24 && p.x > -100 && p.x < 1100 && p.y > -50 && p.y < 650);
console.log(`捕获 arc 绘制总数=${enemyPts.length}, 判定敌人数=${pts.length}`);
if (pts.length) {
  console.log('前5点', pts.slice(0, 5).map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
  console.log('后5点', pts.slice(-5).map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
}

// 叠加到背景图
let bgp = `ROOT/assets/stages/bg_${LID}.png`.replace('ROOT', ROOT);
if (!fs.existsSync(bgp)) bgp = `${ROOT}/pkg_assets/stages/bg_${LID}.png`;
const im = readPNG(bgp);
const SX = 1000 / im.w, SY = 600 / im.h;
function mark(px, py, col) {
  const x = Math.round(px / SX), y = Math.round(py / SY);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= im.w || yy >= im.h) continue;
    const i = (yy * im.w + xx) * 4;
    im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2];
  }
}
for (const p of pts) mark(p.x, p.y, [255, 40, 40]);
const out = `D:/xyh/game/kingdom/_shots/engine_trace_${LID}.png`;
writePNG(out, im.data, im.w, im.h);
console.log('轨迹图已写出:', out);
