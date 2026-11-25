/**
 * KRO 小游戏 —— 全量一致性校验（Node 环境，可重复运行）
 * 用法：cd kro-minigame && node ../reverse_analysis/tools/verify.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../kro-minigame');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
function sec(t) { console.log('\n## ' + t); }

sec('语法');
const jsFiles = ['game.js'].concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));
const { execSync } = require('child_process');
let synOk = true;
for (const f of jsFiles) {
  try { execSync('node --check "' + path.join(ROOT, f) + '"', { stdio: 'ignore' }); }
  catch (e) { synOk = false; console.log('  语法错误: ' + f); }
}
ok('全部 ' + jsFiles.length + ' 个 JS 文件语法正确', synOk);

sec('资源一致性');
const sm = require(path.join(ROOT, 'js/sprite_manifest.js'));
const RP = require(path.join(ROOT, 'js/real_paths_full.json'));
const RW = require(path.join(ROOT, 'js/real_waves.json'));
const D = require(path.join(ROOT, 'js/data.js'));
let missFile = 0;
for (const k in sm) if (!fs.existsSync(path.join(ROOT, sm[k].file))) missFile++;
ok('精灵清单 ' + Object.keys(sm).length + ' 项文件齐全', missFile === 0, '缺失=' + missFile);
ok('旧塔帧序列齐全', ['archer', 'mage', 'artillery', 'barracks'].every(f => sm['tower_' + f] && sm['tower_' + f].frames === 8));
const FAMILIES = ['archer', 'mage', 'artillery', 'barracks'];
ok('4塔基齐全（分层结构）', FAMILIES.every(f => sm['base_' + f] && fs.existsSync(path.join(ROOT, sm['base_' + f].file))));
ok('4塔顶单位+动画帧齐全', FAMILIES.every(f => sm['top_' + f] && sm['top_' + f].frames >= 4 && sm['top_' + f + '_f0']));
ok('路径数据覆盖 24 关', Object.keys(RP).length === 24);
const allEnemies = (D.ENEMIES || []).concat(D.BOSSES || []);
ok('DATA 敌人/Boss ' + allEnemies.length + ' 个全部有精灵', allEnemies.every(e => !!sm['enemy_' + e.id]));
const waveIds = new Set();
(function walk(o) { if (!o || typeof o !== 'object') return; for (const k in o) { if (/creep|enemy/i.test(k) && typeof o[k] === 'string') waveIds.add(o[k]); walk(o[k]); } })(RW);
ok('波次敌人 ' + waveIds.size + ' 种全部有精灵', [...waveIds].every(id => !!sm['enemy_' + id.replace(/^enemy_/, '')]));

sec('路径贴合性（关卡1土路中心线）');
const c1 = RP['01'];
ok('关卡1有2条真实路径（右侧上下2岔路口）', c1 && c1.curves.length === 2);
const p0 = c1.curves[0].mapped, p1 = c1.curves[1].mapped;
ok('刷怪口1在右侧屏外(x>900)', p0[0].x > 900, '首点=' + JSON.stringify(p0[0]));
ok('刷怪口2在右侧屏外(x>900)', p1[0].x > 900, '首点=' + JSON.stringify(p1[0]));
ok('两岔路口上下分离(y差>200)', Math.abs(p0[0].y - p1[0].y) > 200, 'y差=' + Math.abs(p0[0].y - p1[0].y).toFixed(0));
ok('刷怪口均从右往左前进', p0[0].x > p0[p0.length - 1].x && p1[0].x > p1[p1.length - 1].x);
ok('终点在左侧屏外(x<0)', p0[p0.length - 1].x < 0, '末点=' + JSON.stringify(p0[p0.length - 1]));
ok('路径为密集采样点(>20)', p0.length > 20, '点数=' + p0.length);

sec('刷怪口两层路径语义（path_index=刷怪口，path=子路径车道）');
const rw1 = RW['level01_waves_campaign'];
const waveEntries = rw1.groups.map(g => [...new Set((g.waves || []).map(w => w.path_index || 1))]);
ok('波次使用path_index字段(1/2)', waveEntries.some(e => e.includes(2)), '各波刷怪口=' + JSON.stringify(waveEntries));
ok('波1仅从岔路口1出怪', waveEntries[0].length === 1 && waveEntries[0][0] === 1);
ok('波3仅从岔路口2出怪', waveEntries[2].length === 1 && waveEntries[2][0] === 2);
const engSrc = fs.readFileSync(path.join(ROOT, 'js/engine.js'), 'utf8');
ok('引擎用path_index决定刷怪口', /wv\.path_index/.test(engSrc) && /const entry = wv\.path_index/.test(engSrc));
ok('引擎将sp.path降级为车道偏移', /cfg\.lane = lane/.test(engSrc) && /sp\.path \|\| 1\) - 2/.test(engSrc));

sec('塔分层渲染（塔基+塔顶人物+兵营3士兵）');
ok('引擎分层绘制base_与top_', /sprites\['base_' \+ fam\]/.test(engSrc) && /sprites\['top_' \+ fam\]/.test(engSrc));
ok('引擎绘制兵营3士兵', /for \(let s = 0; s < 3; s\+\+\)/.test(engSrc) && /fam === 'barracks'/.test(engSrc));
ok('塔顶攻击动画帧播放', /t\.attackAnim > 0/.test(engSrc) && /fr\[idx\]/.test(engSrc));

console.log('\n========== PASS=' + pass + '  FAIL=' + fail + ' ==========');
process.exit(fail ? 1 : 0);
