// 诊断：解析 level01 lua 的 paths 结构（每个path几条seg、各seg起止点），并采样背景图土路颜色
const fs = require('fs');
const { readPNG } = require('./pnglib');
const TXT = fs.readFileSync('D:/xyh/game/kingdom/reverse_analysis/decompiled/levels/level01_paths.lua', 'utf8');
const idx = TXT.indexOf('\tpaths = {');
const sub = TXT.slice(idx);
const paths = []; let curPath = null, curSeg = null, depth = 0;
for (let i = 0; i < sub.length; i++) {
  const ch = sub[i];
  if (ch === '{') {
    depth++;
    if (depth === 2) { curPath = []; paths.push(curPath); }
    else if (depth === 3) { curSeg = []; curPath.push(curSeg); }
    else if (depth === 4) {
      const m = /x\s*=\s*(-?[\d.]+)\s*,\s*\n\s*y\s*=\s*(-?[\d.]+)/.exec(sub.slice(i, i + 120));
      if (m && curSeg) curSeg.push({ x: +m[1], y: +m[2] });
    }
  } else if (ch === '}') { depth--; if (depth === 0) break; }
}
console.log('paths 条数 =', paths.length);
paths.forEach((segs, pi) => {
  console.log(`\n--- path${pi}: ${segs.length} 条 seg ---`);
  segs.forEach((s, si) => {
    console.log(`  seg${si}: ${s.length} 点, 首=${JSON.stringify(s[0])} 尾=${JSON.stringify(s[s.length-1])}`);
  });
  // 取中间 seg 打印全部点（gen_paths 的做法）
  const pick = segs[Math.floor(segs.length / 2)];
  console.log('  [gen_paths取的中间seg ' + Math.floor(segs.length/2) + '] 关键点:');
  [0, 5, 10, 15, 20, 25, 30, 35, 40].forEach(k => { if (pick[k]) process.stdout.write(`    [${k}]=(${pick[k].x},${pick[k].y})\n`); });
});

// 采样背景颜色
const img = readPNG('D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_01.png');
function px(x, y) { const i = ((y|0) * img.w + (x|0)) * 4; return [img.data[i], img.data[i+1], img.data[i+2]]; }
console.log('\n=== 背景采样 (土路应偏黄褐 R>190,G>160,B<180 且 R>B+35) ===');
[[1100,120],[700,120],[400,340],[1000,560],[1000,600],[780,500],[760,450],[700,300],[850,250],[640,262],[777,453],[1243,598],[1241,148]].forEach(p => {
  console.log(`  (${p[0]},${p[1]}) = RGB(${px(p[0],p[1]).join(',')})`);
});
