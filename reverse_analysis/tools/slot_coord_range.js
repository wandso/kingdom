// 精确解析 levelNN_data.lua 的 tower holder pos，统计坐标范围
// 用与 extract_real_slots.js 相同的括号配对块解析
const fs = require('fs');
const path = require('path');
const DECOMP = 'D:/xyh/game/kingdom/reverse_analysis/decompiled/levels/';

function extractSlots(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const slots = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/holder_id/.test(lines[i])) continue;
    // 从 holder 行向前找到对象起始 {，向后括号配对找块尾
    let start = i;
    while (start > 0 && !/\{\s*$/.test(lines[start])) start--;
    let depth = 0, end = start;
    for (; end < lines.length; end++) {
      for (const ch of lines[end]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth <= 0 && end > start) break;
    }
    const block = lines.slice(start, end + 1).join('\n');
    // 在块内找 pos = { x, y }（排除 rally_pos / default_rally_pos：取第一个裸 pos）
    const posRe = /(?:^|[^\w.])pos\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*,\s*y\s*=\s*(-?[\d.]+)\s*\}/m;
    const m = block.match(posRe);
    if (m) slots.push({ x: +m[1], y: +m[2] });
  }
  return slots;
}

for (const lid of ['01','02','05','09','12','19']) {
  const f = path.join(DECOMP, 'level' + lid + '_data.lua');
  if (!fs.existsSync(f)) { console.log(lid + ': 无文件'); continue; }
  const slots = extractSlots(f);
  const xs = slots.map(s => s.x), ys = slots.map(s => s.y);
  console.log(lid + ': n=' + slots.length +
    ' x[' + Math.min(...xs) + ',' + Math.max(...xs) + ']' +
    ' y[' + Math.min(...ys) + ',' + Math.max(...ys) + ']');
}
