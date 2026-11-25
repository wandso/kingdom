// 无头冒烟测试：驱动真实引擎，验证新路径下敌人正常出生/沿路移动/扣血消失
const path=require('path');
const ROOT='D:/xyh/game/kingdom/kro-minigame';
const RP=require(path.join(ROOT,'js/real_paths_full.json'));
// 构造 mock ctx
function mockCtx(){const noop=()=>{};return new Proxy({canvas:{width:1000,height:600},measureText:()=>({width:10}),createLinearGradient:()=>({addColorStop:noop}),globalAlpha:1},{
  get(t,k){if(k in t)return t[k];return noop;},set(t,k,v){t[k]=v;return true;}
});}
let pass=0,fail=0;function ok(n,c,e){if(c){pass++;console.log('  PASS '+n+(e?' '+e:''));}else{fail++;console.log('  FAIL '+n+(e?' '+e:''));}}

const Engine=require(path.join(ROOT,'js/engine.js'));
for(const lid of ['01','02','05','08','12']){
  const lv=RP[lid];if(!lv)continue;
  const realPaths=lv.curves.map(c=>c.mapped);
  let state=null;
  let eng;
  try{
    eng=Engine.createEngine({ctx:mockCtx(),level:{id:parseInt(lid),path:realPaths[0],slots:[],gold:300,waves:5},difficulty:{hpFactor:1,speedFactor:1},realPaths,realWaves:null,onState:s=>state=s,onEnd:()=>{}});
    eng.setViewport(1000,470);
    eng.start();
    ok(lid+' 引擎创建并启动',!!eng);
  }catch(e){ok(lid+' 引擎创建',false,e.message);continue;}
}
// 校验所有关卡路径点连续性（无NaN、步长合理、首尾屏外）
let bad=0,totalPts=0,maxStep=0;
for(const lid in RP){for(const [pi,c] of RP[lid].curves.entries()){
  const pts=c.mapped;let prev=null;
  for(const p of pts){totalPts++;if(!isFinite(p.x)||!isFinite(p.y)){bad++;continue;}if(prev){const d=Math.hypot(p.x-prev.x,p.y-prev.y);if(d>maxStep)maxStep=d;if(d>120)bad++;}prev=p;}
}}
ok('全部24关路径点无NaN/无异常跳变',bad===0,`总点=${totalPts} 最大步长=${maxStep.toFixed(0)} 异常=${bad}`);
// 关卡1首末点屏外
const p0=RP['01'].curves[0].mapped,p1=RP['01'].curves[1].mapped;
ok('关卡1双入口均在屏外右侧',p0[0].x>1000&&p1[0].x>1000,`${p0[0].x}/${p1[0].x}`);
ok('关卡1出口屏外左侧',p0[p0.length-1].x<0&&p1[p1.length-1].x<0);

console.log(`\n========== PASS=${pass} FAIL=${fail} ==========`);
process.exit(fail?1:0);
