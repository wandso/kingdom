// 从反编译的 levelNN_data.lua 提取原作真实塔位（tower_holder）
// 每个塔位含 pos（塔基）与 tower.default_rally_pos（兵营集结点）
// 用对象括号配对状态机解析，稳健提取每个 holder 块
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/xyh/game/kingdom';
const DIR = ROOT + '/reverse_analysis/decompiled/levels';
const OUT = ROOT + '/kro-minigame/js/real_slots.json';
const SX = 1000 / 1280, SY = 600 / 698;

function splitBlocks(lua) {
  // 找所有含 holder_id 的顶层对象 { ... }，用大括号配对
  const blocks = [];
  const lines = lua.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (/holder_id/.test(lines[i])) {
      // 向上找到最近的 '{'
      let start = i;
      while (start >= 0 && !/\{\s*$/.test(lines[start])) start--;
      if (start < 0) { i++; continue; }
      let depth = 0, end = -1;
      for (let j = start; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth <= 0) { end = j; break; }
      }
      if (end > i) blocks.push(lines.slice(start, end + 1).join('\n'));
      i = end + 1;
    } else i++;
  }
  return blocks;
}

function parseXY(block, key) {
  // key 可能带前缀，如 ["tower.default_rally_pos"]；直接找 key 字样后紧跟 = { x,y }
  const idx = block.indexOf(key);
  if (idx < 0) return null;
  const sub = block.slice(idx + key.length);
  const m = sub.match(/["\]]?\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*,\s*y\s*=\s*(-?[\d.]+)\s*\}/);
  return m ? { x: +m[1], y: +m[2] } : null;
}

const files = fs.readdirSync(DIR).filter(f => /^level\d+_data\.lua$/.test(f));
const all = {};
let total = 0, withRally = 0;
for (const f of files.sort()) {
  const lid = f.match(/level(\d+)_data/)[1];
  const blocks = splitBlocks(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const slots = [];
  for (const b of blocks) {
    const pos = parseXY(b, 'pos');
    if (!pos) continue;
    const rally = parseXY(b, 'default_rally_pos');
    if (rally) withRally++;
    slots.push({
      x: Math.round(pos.x * SX),
      y: Math.round(pos.y * SY),
      rally: rally ? { x: Math.round(rally.x * SX), y: Math.round(rally.y * SY) } : null,
    });
  }
  if (!slots.length) { console.log(lid + ': 0'); continue; }
  all[lid] = slots;
  total += slots.length;
  console.log(lid + ': ' + slots.length + ' holders, rally=' + slots.filter(s => s.rally).length);
}
fs.writeFileSync(OUT, JSON.stringify(all));
console.log('\n总塔位 ' + total + ', 关卡 ' + Object.keys(all).length + ', 含rally ' + withRally);
