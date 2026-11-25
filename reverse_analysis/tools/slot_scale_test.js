// 决定性测试：塔位原始坐标用不同缩放，到"图像提取的真实路径"的距离对比
// 真塔位应紧邻路边（距路 20-90 背景像素），不该压在路上(<10)或远离(>150)
const fs = require('fs');
const { readPNG } = require('./pnglib');
const path = require('path');
const DECOMP = 'D:/xyh/game/kingdom/reverse_analysis/decompiled/levels/';
const ROOT = 'D:/xyh/game/kingdom/';
const RP = require('../../kro-minigame/js/real_paths_data');

function extractRawSlots(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const slots = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/holder_id/.test(lines[i])) continue;
    let start = i;
    while (start > 0 && !/\{\s*$/.test(lines[start])) start--;
    let depth = 0, end = start;
    for (; end < lines.length; end++) {
      for (const ch of lines[end]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth <= 0 && end > start) break;
    }
    const block = lines.slice(start, end + 1).join('\n');
    const m = block.match(/(?:^|[^\w.])pos\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*,\s*y\s*=\s*(-?[\d.]+)\s*\}/m);
    if (m) slots.push({ x: +m[1], y: +m[2] });
  }
  return slots;
}
function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return f;
}
function distToPath(px, py, pathsBg) {
  let best = 1e9;
  for (const pth of pathsBg) for (let i = 1; i < pth.length; i++) {
    const a = pth[i-1], b = pth[i];
    const dx = b.x-a.x, dy = b.y-a.y, L = dx*dx+dy*dy || 1;
    let t = ((px-a.x)*dx + (py-a.y)*dy)/L; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px-(a.x+t*dx), py-(a.y+t*dy)));
  }
  return best;
}
// 图像提取路径是逻辑坐标 1000×600，反算回背景像素 1280×698
function pathsToBg(lid) {
  const SX = 1000/1280, SY = 600/698;
  return (RP[lid].curves || []).map(c => c.mapped.map(p => ({ x: p.x/SX, y: p.y/SY })));
}

for (const lid of ['01','02','05','09','12']) {
  const raw = extractRawSlots(path.join(DECOMP, 'level'+lid+'_data.lua'));
  const im = readPNG(bgPath(lid));
  const W = im.w, H = im.h; // 1280x698
  const pathsBg = pathsToBg(lid);
  // 模式A: 原始坐标当背景像素（不缩放）
  // 模式B: 原始坐标 * (1000/1280,600/698) 当逻辑坐标，再反算回背景 = 原始（等价A！）
  // 真正需要对比的是：raw 是否已经是背景像素坐标
  const dA = raw.map(s => distToPath(s.x, s.y, pathsBg));
  // 模式C: 假设 raw 是 1000×600 逻辑坐标，画到背景图需放大到 1280×698
  const sxc = W/1000, syc = H/600;
  const dC = raw.map(s => distToPath(s.x*sxc, s.y*syc, pathsBg));
  const stat = arr => {
    const near = arr.filter(d => d>=15 && d<=90).length;
    const onroad = arr.filter(d => d<12).length;
    const far = arr.filter(d => d>160).length;
    return '路边15-90:'+near+' 压路<12:'+onroad+' 远离>160:'+far+' 中位:'+arr.sort((a,b)=>a-b)[Math.floor(arr.length/2)].toFixed(0);
  };
  console.log(lid + ' n=' + raw.length);
  console.log('  A(raw直接当背景px): ' + stat([...dA]));
  console.log('  C(raw当1000x600逻辑): ' + stat([...dC]));
}
