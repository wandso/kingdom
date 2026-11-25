/**
 * Canvas UI 绘制工具库（微信小游戏）
 * ------------------------------------------------------------------
 * 提供手绘奇幻风格的按钮、羊皮纸面板、文本、进度条，以及触摸命中检测。
 * 逻辑坐标系由调用方决定（主循环统一按 1000x600 逻辑坐标绘制）。
 */

var C = {
  parchment: '#f0e2bd',
  parchmentDark: '#d9c08a',
  ink: '#3a2a12',
  gold: '#f5d67a',
  goldDeep: '#8a6a34',
  wood: '#6b4a24',
  woodDark: '#3e2a12',
  green: '#5fa83f',
  red: '#b8392e',
  purple: '#7a4fa8',
};

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r || 8, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 羊皮纸面板（带木质描边与投影）
function panel(ctx, x, y, w, h, opt) {
  opt = opt || {};
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  var grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, C.parchment);
  grad.addColorStop(1, C.parchmentDark);
  rr(ctx, x, y, w, h, opt.radius || 14);
  ctx.fillStyle = opt.fill || grad;
  ctx.fill();
  ctx.restore();
  rr(ctx, x, y, w, h, opt.radius || 14);
  ctx.strokeStyle = opt.stroke || C.goldDeep;
  ctx.lineWidth = opt.lineWidth || 3;
  ctx.stroke();
}

// 木质按钮。返回按钮矩形供命中检测
function button(ctx, x, y, w, h, label, opt) {
  opt = opt || {};
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 6;
  var g = ctx.createLinearGradient(x, y, x, y + h);
  var disabled = !!opt.disabled;
  g.addColorStop(0, disabled ? '#5a5348' : (opt.color || '#7a5228'));
  g.addColorStop(1, disabled ? '#3a3630' : (opt.color2 || '#4e3317'));
  rr(ctx, x, y, w, h, opt.radius || 10);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  rr(ctx, x, y, w, h, opt.radius || 10);
  ctx.strokeStyle = opt.border || '#a9793f';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = disabled ? '#9a9184' : '#f5e4bf';
  ctx.font = 'bold ' + (opt.fontSize || 22) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  return { x: x, y: y, w: w, h: h };
}

function text(ctx, str, x, y, opt) {
  opt = opt || {};
  ctx.save();
  ctx.fillStyle = opt.color || C.ink;
  ctx.font = (opt.bold ? 'bold ' : '') + (opt.size || 20) + 'px sans-serif';
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = opt.baseline || 'alphabetic';
  if (opt.shadow) {
    ctx.shadowColor = opt.shadow;
    ctx.shadowBlur = opt.shadowBlur || 6;
  }
  // 简易描边
  if (opt.stroke) {
    ctx.strokeStyle = opt.stroke;
    ctx.lineWidth = opt.strokeWidth || 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillText(str, x, y);
  ctx.restore();
}

// 进度条
function bar(ctx, x, y, w, h, ratio, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  rr(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color || C.green;
  rr(ctx, x, y, Math.max(h, w * Math.max(0, Math.min(1, ratio))), h, h / 2); ctx.fill();
}

// 命中检测：点 (px,py) 是否落在矩形内
function hit(rect, px, py) {
  return !!rect && px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// 绘制星空/森林背景（程序化，无外部图片）
function background(ctx, w, h, theme) {
  var sky = (theme && theme.sky) || '#1c2b3a';
  var ground = (theme && theme.ground) || '#2f4a2a';
  var g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, sky);
  g.addColorStop(1, ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

module.exports = { C: C, panel: panel, button: button, text: text, bar: bar, hit: hit, rr: rr, background: background };
