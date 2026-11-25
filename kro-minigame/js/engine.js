/* eslint-disable */
// 塔防核心引擎 —— 逻辑坐标系 1000x600，渲染时按画布实际尺寸缩放。
// 使用 wx.createCanvasContext（旧版接口，模拟器与真机兼容性最佳）。
const DATA = require('./data');

const LW = 1000;
const LH = 600;
const FPS = 60; // 原作时间单位：帧/秒（波次 delay/interval 以帧计）

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function dist(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return Math.sqrt(dx * dx + dy * dy); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 安全取数据（防御子代理数据尚未就绪或字段缺失）
function safeGet(fn, fallback) { try { const v = fn(); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; } }

function pathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += dist(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
    return len;
}
function pointAt(path, d) {
    if (!path || path.length === 0) return { x: 0, y: 0 };
    if (path.length === 1) return { x: path[0].x, y: path[0].y };
    let remain = d;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const seg = dist(a.x, a.y, b.x, b.y);
        if (remain <= seg) {
            const t = seg === 0 ? 0 : remain / seg;
            return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
        }
        remain -= seg;
    }
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
}

function hexToRgb(hex) {
    if (!hex) return [120, 160, 90];
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (isNaN(n)) return [120, 160, 90];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function createEngine(opts) {
    const level = opts.level || {};
    const diff = opts.difficulty || { hpFactor: 1, speedFactor: 1 };
    const hero = opts.hero || null;
    // 小游戏：由外部注入已适配的标准 Canvas2D 上下文（js/canvas-ctx.js 适配）
    const ctx = opts.ctx;
    if (!ctx) throw new Error('createEngine 需要传入 ctx（标准 Canvas2D 上下文）');

    // 渲染画布尺寸（由页面 onReady 通过 setViewport 注入）
    let vp = { w: LW, h: LH, scale: 1, ox: 0, oy: 0 };

    // 可选：真实背景图（已加载的 image 对象），以及图集精灵
    let bgImage = opts.bgImage || null;
    let sprites = opts.sprites || null; // { [key]: {image,w,h,pw,ph} }

    // 真实路径（反编译自原作 levelNN_paths.lua）：paths[i] = 映射后的路径点数组
    // 敌人从每条路径的[0]（屏幕外刷怪口）出发，沿路径行进到末点。
    const realPaths = opts.realPaths && opts.realPaths.length ? opts.realPaths : null;
    const paths = realPaths || [level.path || [{ x: 1000, y: 300 }, { x: 0, y: 300 }]];
    const pathLens = paths.map(p => pathLength(p));
    // 兼容：path 指向主路径（第一条）
    const path = paths[0];
    const slots = level.slots || [];
    const totalLen = pathLens[0];

    // 真实波次（反编译自原作 levelNN_waves_*.lua）
    const realWaves = opts.realWaves || null;

    // 真实波次：一个 group = 一波（组间 interval 为波间隔）
    const waveGroups = realWaves && realWaves.groups && realWaves.groups.length ? realWaves.groups : null;
    const state = {
        gold: realWaves && realWaves.cash ? realWaves.cash : (level.gold || 220),
        lives: 20,
        wave: 0,
        totalWaves: waveGroups ? waveGroups.length : (level.waves || 10),
        score: 0,
        status: 'ready', // ready|running|paused|won|lost
        speed: 1,
        selectedSlot: -1,
        powerCd: { reinforce: 0, thunder: 0, hero: 0 },
    };

    let enemies = [];
    let towers = [];
    let bullets = [];
    let effects = [];
    let floatTexts = [];
    let waveTimer = 0;
    let spawnQueue = [];
    let spawnTimer = 0;
    let loopHandle = null;
    let lastTs = 0;
    let heroUnit = null;

    function emit() {
        if (typeof opts.onState === 'function') {
            opts.onState({
                gold: state.gold, lives: state.lives, wave: state.wave,
                totalWaves: state.totalWaves, score: state.score,
                status: state.status, speed: state.speed,
                powerCd: Object.assign({}, state.powerCd),
            });
        }
    }

    function theme() {
        const themes = DATA.THEMES || {};
        const key = level.theme || 'elven_woods';
        return themes[key] || themes.elven_woods || {
            sky: '#3a5a3a', ground: '#6f8f4a', path: '#c8a86a', accent: '#8fbc5a',
        };
    }

    function getTowerDef(id) {
        if (DATA.getTower) { const t = safeGet(() => DATA.getTower(id), null); if (t) return t; }
        const list = DATA.TOWERS || [];
        return list.find(t => t.id === id) || list[0] || {
            id: id, nameZh: '防御塔', cost: 70, damage: 12, range: 120, rate: 1, dmgType: 'physical', color: '#8fbc5a',
        };
    }
    function getEnemyDef(id) {
        // 原作 creep id 带 enemy_ 前缀（如 enemy_gnoll_reaver），DATA 里不带，需兼容
        const bare = String(id || '').replace(/^enemy_/, '');
        let e = null;
        if (DATA.getEnemy) { e = safeGet(() => DATA.getEnemy(bare), null); }
        if (!e) {
            const list = (DATA.ENEMIES || []).concat(DATA.BOSSES || []);
            e = list.find(x => x.id === bare || x.id === id || x.nameEn === bare) || null;
        }
        if (!e) e = { id: bare, nameZh: '敌人', hp: 60, speed: 40, bounty: 8, color: '#a55', size: 10 };
        // 保留原作 creep 全名供精灵匹配
        e = Object.assign({}, e);
        e._creepId = id;
        e.spriteKey = 'enemy_' + bare;
        return e;
    }

    // 根据波次生成敌人队列（优先真实波次数据）
    function makeEnemyCfg(def, hpScale, spdScale, pathIndex, extra) {
        const isBoss = !!(extra && extra.boss);
        return {
            defId: def.id,
            hp: Math.round((def.hp || 60) * hpScale),
            speed: (def.speed || 40) * spdScale,
            bounty: Math.round((def.bounty || 8) * (1 + state.wave * 0.05)),
            armor: def.armor || 0, magicResist: def.magicResist || 0, flying: !!def.flying,
            color: def.color || '#a55', size: def.size || (isBoss ? 20 : 10),
            nameZh: def.nameZh || '敌人', boss: isBoss,
            pathIndex: Math.max(0, Math.min(paths.length - 1, (pathIndex || 1) - 1)),
            spriteKey: def.spriteKey || ('enemy_' + String(def.id || '').replace(/^enemy_/, '')),
        };
    }

    function buildWave(n) {
        const hpScale = (diff.hpFactor || 1) * (1 + (n - 1) * 0.22);
        const spdScale = (diff.speedFactor || 1);
        // —— 真实波次：展开 group → waves → spawns，每项带 interval 与 path ——
        if (waveGroups) {
            const group = waveGroups[n - 1];
            if (!group) return [];
            const q = [];
            const wlist = group.waves || [];
            for (const wv of wlist) {
                const wDelay = (wv.delay || 0) / FPS; // 原作以帧为单位
                // 原作双层路径：path_index = 主路径/刷怪口（1..N，对应右侧各岔路口）
                // sp.path = 子路径/车道偏移（1..3，仅在同一岔路口内分散站位），不是刷怪口
                const entry = wv.path_index || 1;
                for (const sp of (wv.spawns || [])) {
                    const def = getEnemyDef(sp.creep);
                    const cnt = Math.max(1, sp.max || 1);
                    // 主刷怪口由 path_index 决定；子路径 sp.path 只做轻微纵向错位（车道）
                    const cfgBase = makeEnemyCfg(def, hpScale, spdScale, entry, null);
                    const lane = (sp.path || 1) - 2; // -1 / 0 / +1
                    for (let k = 0; k < cnt; k++) {
                        const cfg = Object.assign({}, cfgBase);
                        cfg.lane = lane;
                        cfg.interval = (k === 0 ? (sp.interval || 0) : (sp.interval_next || 300)) / FPS;
                        cfg.waitBefore = k === 0 ? wDelay : 0;
                        q.push(cfg);
                    }
                }
            }
            // Boss 关最后一波追加 Boss
            if (level.bossId && n === state.totalWaves) {
                const boss = getEnemyDef(level.bossId);
                q.push(makeEnemyCfg(boss, diff.hpFactor || 1, spdScale, 1, { boss: true }));
            }
            return q;
        }
        // —— 兜底：程序化波次 ——
        const pool = (DATA.ENEMIES || []).slice();
        if (!pool.length) pool.push({ id: 'gnoll', hp: 60, speed: 40, bounty: 8, color: '#a55', size: 10 });
        const count = Math.min(8 + n * 2, 34);
        const q = [];
        for (let i = 0; i < count; i++) {
            q.push(makeEnemyCfg(pick(pool), hpScale, spdScale, 1 + (i % paths.length), null));
        }
        if (level.bossId && n === state.totalWaves) {
            q.push(makeEnemyCfg(getEnemyDef(level.bossId), diff.hpFactor || 1, spdScale, 1, { boss: true }));
        }
        return q;
    }

    function startNextWave() {
        if (state.status !== 'running') return;
        if (state.wave >= state.totalWaves) {
            // 所有波次结束，清场即胜利
            if (enemies.length === 0 && spawnQueue.length === 0) finish(true);
            return;
        }
        state.wave++;
        state.gold += 20 + state.wave * 2; // 提前/正常开波奖励
        spawnQueue = buildWave(state.wave);
        spawnTimer = 0;
        waveTimer = 0;
        pushFloat('第 ' + state.wave + ' 波', LW / 2, 90, '#f5d67a', 30);
        emit();
    }

    function finish(win) {
        state.status = win ? 'won' : 'lost';
        const stars = win ? (state.lives >= 15 ? 3 : state.lives >= 8 ? 2 : 1) : 0;
        if (typeof opts.onEnd === 'function') {
            opts.onEnd({ win: win, stars: stars, wave: state.wave, score: state.score, lives: state.lives });
        }
        emit();
    }

    function spawnEnemy(cfg) {
        const pi = clamp(cfg.pathIndex || 0, 0, paths.length - 1);
        const ep = paths[pi];
        const start = pointAt(ep, 0); // 屏幕外刷怪口（右侧岔路口）
        // 子路径车道：同一刷怪口的敌人在纵向轻微错开，避免完全重叠（原作 sub_path 语义）
        const lane = cfg.lane || 0;
        enemies.push({
            x: start.x, y: start.y + lane * 4, d: 0, lane: lane,
            pathIndex: pi, pathLen: pathLens[pi],
            hp: cfg.hp, maxHp: cfg.hp, speed: cfg.speed, bounty: cfg.bounty,
            armor: cfg.armor, magicResist: cfg.magicResist, flying: cfg.flying,
            color: cfg.color, size: cfg.size, nameZh: cfg.nameZh, boss: !!cfg.boss,
            defId: cfg.defId, spriteKey: cfg.spriteKey,
            animT: 0,
            slowUntil: 0, poison: 0, hitFlash: 0, dead: false,
        });
    }

    function pushFloat(text, x, y, color, size) {
        floatTexts.push({ text: text, x: x, y: y, color: color || '#fff', size: size || 20, life: 1 });
    }
    function pushEffect(x, y, color, r) {
        effects.push({ x: x, y: y, color: color, r0: 4, r: r || 30, life: 1 });
    }

    // 塔攻击
    function updateTowers(dt) {
        for (let i = 0; i < towers.length; i++) {
            const t = towers[i];
            const def = t.def;
            t.cool -= dt;
            if (t.cool > 0) continue;
            // 找射程内推进最远的敌人
            let target = null, bestD = -1;
            for (let j = 0; j < enemies.length; j++) {
                const e = enemies[j];
                if (e.dead) continue;
                const dd = dist(t.x, t.y, e.x, e.y);
                if (dd <= (def.range || 120) && e.d > bestD) { target = e; bestD = e.d; }
            }
            if (!target) continue;
            t.cool = 1 / (def.rate || 1);
            // 攻击动画：记录开火状态与朝向，drawTower 据此播放攻击帧
            t.attackAnim = 0.36;
            t.aimAngle = Math.atan2(target.y - t.y, target.x - t.x);
            const dmgType = def.dmgType || 'physical';
            let dmg = def.damage || 10;
            bullets.push({
                x: t.x, y: t.y, tx: target.x, ty: target.y, target: target,
                speed: 520, dmg: dmg, type: dmgType, color: def.color || '#ffd36a',
                splash: def.splash || 0,
                // 真实子弹精灵（箭矢/火球等）
                spriteKey: dmgType === 'magic' ? 'bullet_magic' : 'bullet_arrow',
            });
        }
    }

    function damageEnemy(e, dmg, type) {
        if (e.dead) return;
        let actual = dmg;
        if (type === 'physical') actual = Math.max(1, dmg - (e.armor || 0));
        else if (type === 'magic') actual = Math.max(1, Math.round(dmg * (1 - (e.magicResist || 0))));
        e.hp -= actual;
        e.hitFlash = 0.12;
        if (e.hp <= 0) {
            e.dead = true;
            state.gold += e.bounty;
            state.score += e.bounty * 10 + (e.boss ? 1000 : 0);
            pushFloat('+' + e.bounty, e.x, e.y - e.size - 6, '#ffd36a', 18);
            pushEffect(e.x, e.y, e.color, e.boss ? 70 : 26);
            emit();
        }
    }

    function updateBullets(dt) {
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            const tx = b.target && !b.target.dead ? b.target.x : b.tx;
            const ty = b.target && !b.target.dead ? b.target.y : b.ty;
            const dx = tx - b.x, dy = ty - b.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            const step = b.speed * dt;
            if (d <= step + 4) {
                if (b.target && !b.target.dead) damageEnemy(b.target, b.dmg, b.type);
                if (b.splash > 0) {
                    for (let k = 0; k < enemies.length; k++) {
                        const e = enemies[k];
                        if (e.dead) continue;
                        if (dist(tx, ty, e.x, e.y) <= b.splash) damageEnemy(e, Math.round(b.dmg * 0.5), b.type);
                    }
                    pushEffect(tx, ty, b.color, b.splash);
                } else {
                    pushEffect(tx, ty, b.color, 12);
                }
                bullets.splice(i, 1);
            } else {
                b.x += dx / d * step;
                b.y += dy / d * step;
            }
        }
    }

    function updateEnemies(dt) {
        const now = Date.now();
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            if (e.dead) { enemies.splice(i, 1); continue; }
            if (e.hitFlash > 0) e.hitFlash -= dt;
            let spd = e.speed;
            if (e.slowUntil > now) spd *= 0.55;
            if (e.poison > 0) { e.hp -= e.poison * dt; e.poison -= dt; if (e.hp <= 0) { e.dead = true; state.gold += e.bounty; state.score += e.bounty * 10; emit(); } }
            e.d += spd * dt;
            e.animT += dt;
            const ep = paths[e.pathIndex || 0];
            const eLen = e.pathLen || pathLens[e.pathIndex || 0] || totalLen;
            if (e.d >= eLen) {
                enemies.splice(i, 1);
                state.lives -= e.boss ? 5 : 1;
                const end = ep[ep.length - 1];
                pushFloat('-1', end.x, end.y - 10, '#ff6b6b', 24);
                emit();
                if (state.lives <= 0) { state.lives = 0; finish(false); return; }
                continue;
            }
            const p = pointAt(ep, e.d);
            e.x = p.x; e.y = p.y + (e.lane || 0) * 4;
        }
    }

    function update(dt) {
        // 冷却
        for (const k in state.powerCd) if (state.powerCd[k] > 0) state.powerCd[k] = Math.max(0, state.powerCd[k] - dt);
        // 出怪（真实波次带精确 interval；waitBefore 为整波延迟）
        if (spawnQueue.length > 0) {
            spawnTimer -= dt;
            if (spawnTimer <= 0) {
                const cfg = spawnQueue.shift();
                spawnEnemy(cfg);
                const nextCfg = spawnQueue[0];
                // 下一只的间隔：优先用下一项的 waitBefore，否则用本项 interval，兜底 0.55s
                spawnTimer = nextCfg && nextCfg.waitBefore ? nextCfg.waitBefore
                    : (cfg.interval || 0.55);
            }
        }
        // 波次节奏
        if (state.status === 'running') {
            if (spawnQueue.length === 0 && enemies.length === 0) {
                waveTimer += dt;
                if (waveTimer > 2.5) {
                    if (state.wave < state.totalWaves) startNextWave();
                    else finish(true);
                }
            } else waveTimer = 0;
        }
        // 塔攻击动画计时衰减
        for (const t of towers) if (t.attackAnim > 0) t.attackAnim = Math.max(0, t.attackAnim - dt);
        updateEnemies(dt);
        updateTowers(dt);
        updateBullets(dt);
        // 特效与浮字
        for (let i = effects.length - 1; i >= 0; i--) { effects[i].life -= dt * 2.2; if (effects[i].life <= 0) effects.splice(i, 1); }
        for (let i = floatTexts.length - 1; i >= 0; i--) { floatTexts[i].life -= dt * 0.9; floatTexts[i].y -= dt * 26; if (floatTexts[i].life <= 0) floatTexts.splice(i, 1); }
    }

    // ============ 渲染 ============
    function hex(c, alpha) {
        const rgb = hexToRgb(c);
        return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (alpha === undefined ? 1 : alpha) + ')';
    }

    function render() {
        const th = theme();
        ctx.save();
        ctx.scale(vp.scale, vp.scale);
        ctx.translate(vp.ox, vp.oy);

        if (bgImage) {
            // 真实关卡背景图（1:1 还原原作手绘地图）：覆盖整个逻辑战场
            ctx.drawImage(bgImage, 0, 0, LW, LH);
        } else {
            // 程序化背景兜底
            const top = hexToRgb(th.sky || '#3a5a3a'), bot = hexToRgb(th.ground || '#6f8f4a');
            const steps = 12;
            for (let i = 0; i < steps; i++) {
                const t = i / (steps - 1);
                const r = Math.round(lerp(top[0], bot[0], t));
                const g = Math.round(lerp(top[1], bot[1], t));
                const b = Math.round(lerp(top[2], bot[2], t));
                ctx.setFillStyle('rgb(' + r + ',' + g + ',' + b + ')');
                ctx.fillRect(0, i * (LH / steps), LW, LH / steps + 1);
            }
            ctx.setFillStyle(hex(th.accent || '#8fbc5a', 0.35));
            for (let i = 0; i < 40; i++) {
                const gx = (i * 137.5) % LW, gy = 40 + (i * 83.3) % (LH - 80);
                ctx.beginPath();
                ctx.moveTo(gx, gy); ctx.lineTo(gx - 6, gy + 12); ctx.lineTo(gx + 6, gy + 12);
                ctx.closePath(); ctx.fill();
            }
            // 路径（仅程序化模式下绘制；真实背景图里路径已存在）
            ctx.setLineCap('round'); ctx.setLineJoin('round');
            ctx.setStrokeStyle(hex('#4a3418', 0.55)); ctx.setLineWidth(46);
            drawPolyline(path);
            ctx.setStrokeStyle(th.path || '#c8a86a'); ctx.setLineWidth(34);
            drawPolyline(path);
            ctx.setStrokeStyle(hex('#ffffff', 0.12)); ctx.setLineWidth(6);
            drawPolyline(path);
        }

        // 建塔槽位
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            const built = towers.find(t => t.slot === i);
            const sel = state.selectedSlot === i && !built;
            ctx.setStrokeStyle(built ? hex('#000000', 0.25) : (sel ? '#f5d67a' : hex('#ffffff', 0.5)));
            ctx.setLineWidth(sel ? 4 : 2);
            ctx.setFillStyle(built ? hex('#000000', 0.18) : hex('#2b1d0e', 0.35));
            ctx.beginPath(); ctx.arc(s.x, s.y, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            if (!built) {
                ctx.setFillStyle(sel ? '#f5d67a' : hex('#ffffff', 0.75));
                ctx.setFontSize(22); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('+', s.x, s.y + 1);
            }
        }

        // 塔
        for (let i = 0; i < towers.length; i++) drawTower(towers[i]);

        // 敌人
        for (let i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);

        // 子弹（真实箭矢/魔法弹外观 + 拖尾）
        for (let i = 0; i < bullets.length; i++) {
            const b = bullets[i];
            const isMagic = b.type === 'magic' || b.type === 'true';
            const ang = Math.atan2((b.ty || b.y) - b.y, (b.tx || b.x) - b.x);
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(ang);
            if (isMagic) {
                // 魔法弹：发光球体 + 光晕
                ctx.setFillStyle(hex(b.color || '#a06fd0', 0.25));
                ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
                ctx.setFillStyle(b.color || '#a06fd0');
                ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
                ctx.setFillStyle('rgba(255,255,255,0.8)');
                ctx.beginPath(); ctx.arc(-1.5, -1.5, 2.2, 0, Math.PI * 2); ctx.fill();
            } else {
                // 箭矢：细长箭身 + 箭头 + 尾羽
                ctx.setFillStyle(b.color || '#d9c89a');
                ctx.fillRect(-9, -1.4, 14, 2.8);
                ctx.setFillStyle('#e8e0c8');
                ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -3.5); ctx.lineTo(3, 3.5); ctx.closePath(); ctx.fill();
                ctx.setFillStyle('#8f6a3a');
                ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-13, -3); ctx.lineTo(-11, 0); ctx.lineTo(-13, 3); ctx.closePath(); ctx.fill();
            }
            ctx.restore();
        }

        // 特效（爆炸环）
        for (let i = 0; i < effects.length; i++) {
            const e = effects[i];
            const r = lerp(e.r0, e.r, 1 - e.life);
            ctx.setStrokeStyle(hex(e.color, e.life * 0.8)); ctx.setLineWidth(3);
            ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
        }

        // 浮字
        for (let i = 0; i < floatTexts.length; i++) {
            const f = floatTexts[i];
            ctx.setFillStyle(hex(f.color, Math.min(1, f.life * 1.5)));
            ctx.setFontSize(f.size); ctx.textAlign = 'center';
            ctx.fillText(f.text, f.x, f.y);
        }

        // 顶部信息条
        ctx.setFillStyle('rgba(20,14,6,0.72)');
        ctx.fillRect(0, 0, LW, 54);
        ctx.setFillStyle('#f5d67a'); ctx.setFontSize(22); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('⛁ ' + state.gold, 16, 27);
        ctx.setFillStyle('#ff8b7a');
        ctx.fillText('♥ ' + state.lives, 150, 27);
        ctx.setFillStyle('#dce8ff');
        ctx.fillText('波次 ' + state.wave + '/' + state.totalWaves, 300, 27);
        ctx.textAlign = 'right'; ctx.setFillStyle('#c8b78e');
        ctx.fillText('分数 ' + state.score, LW - 16, 27);

        ctx.restore();
        ctx.draw(false);
    }

    function drawPolyline(pts) {
        if (!pts || pts.length < 2) return;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
    }

    function drawTower(t) {
        const def = t.def;
        const c = def.color || '#8fbc5a';
        // 底座阴影
        ctx.setFillStyle('rgba(0,0,0,0.28)');
        ctx.beginPath(); ctx.ellipse(t.x, t.y + 12, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
        // ===== 真实塔：分层渲染（REA复核确认的原作结构）=====
        // 塔基（建筑）在底部；塔顶单位（弓手/法师/德鲁伊）站在塔顶做远程攻击；
        // 兵营塔 = 塔基 + 3 名士兵从塔门走出、站在路中待敌触发近战。
        let fam = def.family || 'archer';
        const FAM_MAP = { rock: 'artillery', blade: 'archer' };
        fam = FAM_MAP[fam] || fam;
        const baseSpr = sprites && sprites['base_' + fam];
        const topSpr = sprites && sprites['top_' + fam];
        if (baseSpr && baseSpr.image) {
            // 塔基与塔顶人物素材本就是同一坐标系、画布中心对齐即可让人物站在平台。
            // 关键修正：显示高度用 58（原 84 使整塔过大接近道路宽度）。
            // 用画布比例缩放（非 trim），保持 base/top 天然对齐关系。
            function drawCanvas(spr, img, cx, bottomY, H) {
                const scale = H / spr.h;
                const dw = spr.w * scale;
                ctx.drawImage(img, cx - dw / 2, bottomY - H, dw, H);
            }
            const BASE_H = 58;
            const anchorBottom = t.y + 16; // 塔底贴地
            drawCanvas(baseSpr, baseSpr.image, t.x, anchorBottom, BASE_H);

            // 塔顶单位：与塔基同高、同地面锚点 → 画布中心对齐，人物正好站平台。
            // 攻击时播放原作帧序列（待机→拉弓→放箭），无多余位移（帧图已含动作）。
            if (topSpr && topSpr.image) {
                let topImg = topSpr.image;
                const fr = topSpr.frames;
                const n = fr && fr.length;
                const ATK_DUR = 0.36;
                if (n) {
                    if (t.attackAnim > 0) {
                        const prog = 1 - (t.attackAnim / ATK_DUR); // 0→1
                        const idx = Math.min(n - 1, Math.max(0, Math.floor(prog * n)));
                        topImg = fr[idx];
                    } else {
                        topImg = fr[0]; // 待机固定首帧
                    }
                }
                drawCanvas(topSpr, topImg, t.x, anchorBottom, BASE_H);

                // 兵营：3 名士兵站在 rally 集结点（原作 tower.default_rally_pos，位于道路上）
                if (fam === 'barracks' && n) {
                    const rally = t.rally || { x: t.x, y: t.y + 40 };
                    const soldierPositions = [
                        { x: rally.x - 18, y: rally.y + 4 },
                        { x: rally.x, y: rally.y + 10 },
                        { x: rally.x + 18, y: rally.y + 4 },
                    ];
                    const SH = 34; // 画布高；实际士兵内容约 18px
                    for (let s = 0; s < 3; s++) {
                        const p = soldierPositions[s];
                        const img = fr[(s * 2) % n];
                        drawCanvas(topSpr, img, p.x, p.y, SH);
                    }
                }
            }
            // 等级点
            ctx.setFillStyle('#fff3c4');
            for (let k = 0; k < (t.level || 1); k++) { ctx.beginPath(); ctx.arc(t.x - 8 + k * 8, t.y + 18, 2.5, 0, Math.PI * 2); ctx.fill(); }
            if (state.selectedSlot === t.slot) {
                ctx.setStrokeStyle(hex('#f5d67a', 0.5)); ctx.setLineWidth(2);
                ctx.beginPath(); ctx.arc(t.x, t.y, def.range || 120, 0, Math.PI * 2); ctx.stroke();
            }
            return;
        }
        // 程序化塔身（兜底，梯形）
        ctx.setFillStyle(hex(c, 1));
        ctx.beginPath();
        ctx.moveTo(t.x - 13, t.y + 12); ctx.lineTo(t.x - 9, t.y - 10);
        ctx.lineTo(t.x + 9, t.y - 10); ctx.lineTo(t.x + 13, t.y + 12);
        ctx.closePath(); ctx.fill();
        ctx.setStrokeStyle(hex('#2b1d0e', 0.7)); ctx.setLineWidth(2); ctx.stroke();
        // 顶部装饰（按 family 造型）
        ctx.setFillStyle(hex('#f5d67a', 0.95));
        if (fam === 'archer') { // 弓：尖顶
            ctx.beginPath(); ctx.moveTo(t.x, t.y - 26); ctx.lineTo(t.x - 10, t.y - 10); ctx.lineTo(t.x + 10, t.y - 10); ctx.closePath(); ctx.fill();
        } else if (fam === 'mage') { // 法：水晶球
            ctx.beginPath(); ctx.arc(t.x, t.y - 18, 8, 0, Math.PI * 2); ctx.fill();
        } else if (fam === 'barracks') { // 兵营：旗帜
            ctx.fillRect(t.x - 2, t.y - 30, 3, 20);
            ctx.beginPath(); ctx.moveTo(t.x + 1, t.y - 30); ctx.lineTo(t.x + 14, t.y - 25); ctx.lineTo(t.x + 1, t.y - 20); ctx.closePath(); ctx.fill();
        } else { // 德鲁伊：石环
            ctx.beginPath(); ctx.arc(t.x, t.y - 12, 9, 0, Math.PI * 2); ctx.stroke();
        }
        // 等级点
        ctx.setFillStyle('#fff3c4');
        for (let k = 0; k < (t.level || 1); k++) { ctx.beginPath(); ctx.arc(t.x - 8 + k * 8, t.y + 16, 2.5, 0, Math.PI * 2); ctx.fill(); }
        // 攻击范围（选中时）
        if (state.selectedSlot === t.slot) {
            ctx.setStrokeStyle(hex('#f5d67a', 0.5)); ctx.setLineWidth(2);
            ctx.beginPath(); ctx.arc(t.x, t.y, def.range || 120, 0, Math.PI * 2); ctx.stroke();
        }
    }

    function drawEnemy(e) {
        const s = e.size || 10;
        // 真实精灵：优先用反编译切出的原作精灵
        const key = e.spriteKey || ('enemy_' + (e.defId || '').replace(/^enemy_/, ''));
        const spr = sprites && (sprites[key]);
        if (spr && spr.image) {
            // 高清精灵：按原始设计尺寸缩放（pw/ph 为图集原生尺寸），脚下对齐路径点
            // 目标显示高度约 34~62，保持原图宽高比，确保角色清晰可辨
            let h;
            if (spr.hd && spr.ph) {
                h = clamp(spr.ph * 0.42, 34, 62);
            } else {
                h = clamp(s * 2.2, 26, 64);
            }
            const w = h * (spr.w / spr.h);
            // 行走动画：左右轻微摆动（模拟迈步），受击闪烁
            const bob = Math.sin((e.animT || 0) * 6) * 1.5;
            ctx.save();
            if (e.hitFlash > 0) { ctx.globalAlpha = 0.6; }
            ctx.drawImage(spr.image, e.x - w / 2, e.y - h + s * 0.35 + bob, w, h);
            ctx.restore();
        } else {
            if (e.flying) { // 翅膀
                ctx.setFillStyle('rgba(255,255,255,0.5)');
                ctx.beginPath(); ctx.ellipse(e.x - s * 0.8, e.y - s, s * 0.7, s * 0.3, -0.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.ellipse(e.x + s * 0.8, e.y - s, s * 0.7, s * 0.3, 0.5, 0, Math.PI * 2); ctx.fill();
            }
            ctx.setFillStyle(e.hitFlash > 0 ? '#ffffff' : e.color);
            ctx.beginPath(); ctx.arc(e.x, e.y, s, 0, Math.PI * 2); ctx.fill();
            ctx.setStrokeStyle(hex('#2b1d0e', 0.8)); ctx.setLineWidth(e.boss ? 3 : 1.5); ctx.stroke();
        }
        // 血条
        const bw = s * 2.2, bh = 4;
        const ratio = clamp(e.hp / e.maxHp, 0, 1);
        if (ratio < 1 || e.boss) {
            ctx.setFillStyle('rgba(0,0,0,0.6)'); ctx.fillRect(e.x - bw / 2, e.y - s - 10, bw, bh);
            ctx.setFillStyle(ratio > 0.5 ? '#6fd36f' : ratio > 0.25 ? '#e8c14a' : '#e85a4a');
            ctx.fillRect(e.x - bw / 2, e.y - s - 10, bw * ratio, bh);
        }
    }

    // ============ 主循环 ============
    // 逻辑循环只做 update；渲染由外部场景统一驱动（小游戏单 canvas + 坐标变换）。
    function tick() {
        if (state.status !== 'running') return;
        const now = Date.now();
        let dt = lastTs ? (now - lastTs) / 1000 : 0.033;
        lastTs = now;
        dt = clamp(dt, 0, 0.1) * state.speed;
        // 分步模拟提高稳定性
        const steps = Math.max(1, Math.ceil(dt / 0.033));
        for (let i = 0; i < steps; i++) update(dt / steps);
        emit();
    }

    function startLoop() {
        stopLoop();
        lastTs = 0;
        loopHandle = setInterval(tick, 33);
    }
    function stopLoop() { if (loopHandle) { clearInterval(loopHandle); loopHandle = null; } }

    const engine = {
        setViewport(w, h) {
            vp.w = w; vp.h = h;
            vp.scale = Math.min(w / LW, h / LH);
            vp.ox = (w - LW * vp.scale) / 2;
            vp.oy = (h - LH * vp.scale) / 2;
            render();
        },
        start() {
            if (state.status === 'won' || state.status === 'lost') return;
            state.status = 'running';
            startLoop();
            startNextWave();
            emit();
        },
        pause() { if (state.status === 'running') { state.status = 'paused'; stopLoop(); emit(); } },
        resume() { if (state.status === 'paused') { state.status = 'running'; startLoop(); emit(); } },
        setSpeed(n) { state.speed = n; emit(); },
        setBackground(img) { bgImage = img || null; render(); },
        setSprites(s) { sprites = s || null; },
        destroy() { stopLoop(); enemies = []; towers = []; bullets = []; effects = []; },

        selectSlot(i) { state.selectedSlot = i; render(); emit(); },
        getSelectedSlot() { return state.selectedSlot; },
        getSlotInfo(i) {
            const t = towers.find(t => t.slot === i);
            return { built: !!t, tower: t || null, slot: slots[i] || null };
        },
        buildTower(slotIndex, towerId) {
            if (slotIndex < 0 || slotIndex >= slots.length) return { ok: false, msg: '无效位置' };
            if (towers.find(t => t.slot === slotIndex)) return { ok: false, msg: '此处已有塔' };
            const def = getTowerDef(towerId);
            const cost = def.cost || 70;
            if (state.gold < cost) return { ok: false, msg: '金币不足' };
            state.gold -= cost;
            const s = slots[slotIndex];
            towers.push({ slot: slotIndex, x: s.x, y: s.y, rally: s.rally || null, def: def, id: towerId, level: def.tier || 1, cool: 0 });
            pushFloat('建造!', s.x, s.y - 24, '#f5d67a', 18);
            emit(); render();
            return { ok: true, msg: '建造成功' };
        },
        upgradeTower(slotIndex) {
            const t = towers.find(t => t.slot === slotIndex);
            if (!t) return { ok: false, msg: '没有可升级的塔' };
            const cost = Math.round((t.def.cost || 70) * 0.8 * t.level);
            if (state.gold < cost) return { ok: false, msg: '金币不足' };
            state.gold -= cost;
            t.level += 1;
            t.def = Object.assign({}, t.def, {
                damage: Math.round((t.def.damage || 10) * 1.4),
                range: (t.def.range || 120) + 12,
                rate: (t.def.rate || 1) * 1.12,
            });
            pushFloat('升级!', t.x, t.y - 24, '#8fe0ff', 18);
            emit(); render();
            return { ok: true, msg: '升级成功' };
        },
        sellTower(slotIndex) {
            const idx = towers.findIndex(t => t.slot === slotIndex);
            if (idx < 0) return { ok: false, msg: '没有塔' };
            const t = towers[idx];
            const refund = Math.round((t.def.cost || 70) * 0.6);
            state.gold += refund;
            towers.splice(idx, 1);
            pushFloat('+' + refund, t.x, t.y - 16, '#ffd36a', 18);
            emit(); render();
            return { ok: true, msg: '已出售' };
        },
        callWave() {
            if (state.status !== 'running') return { ok: false, msg: '' };
            if (state.wave >= state.totalWaves) return { ok: false, msg: '已是最后一波' };
            if (spawnQueue.length > 0 || enemies.length > 0) return { ok: false, msg: '当前波次尚未结束' };
            startNextWave();
            return { ok: true, msg: '提前召唤奖励金币' };
        },
        castPower(powerId) {
            const cd = state.powerCd[powerId] || 0;
            if (cd > 0) return { ok: false, msg: '冷却中 ' + Math.ceil(cd) + 's' };
            if (powerId === 'thunder') {
                // 对最前敌人及附近造成伤害
                let target = null, best = -1;
                for (const e of enemies) if (!e.dead && e.d > best) { target = e; best = e.d; }
                if (!target) return { ok: false, msg: '没有目标' };
                const dmg = 120;
                for (const e of enemies) {
                    if (!e.dead && dist(e.x, e.y, target.x, target.y) < 90) damageEnemy(e, dmg, 'magic');
                }
                pushEffect(target.x, target.y, '#ffe27a', 90);
                state.powerCd.thunder = 14;
            } else if (powerId === 'reinforce') {
                // 援军：路径中段造成范围伤害并召唤幻影（简化为范围伤害+减速）
                const mid = pointAt(path, totalLen * 0.5);
                for (const e of enemies) {
                    if (!e.dead && dist(e.x, e.y, mid.x, mid.y) < 130) { damageEnemy(e, 60, 'physical'); e.slowUntil = Date.now() + 3000; }
                }
                pushEffect(mid.x, mid.y, '#9fe08f', 130);
                state.powerCd.reinforce = 18;
            } else if (powerId === 'hero' && hero) {
                const mid = pointAt(path, totalLen * 0.4);
                for (const e of enemies) if (!e.dead && dist(e.x, e.y, mid.x, mid.y) < 120) damageEnemy(e, 150, 'true');
                pushEffect(mid.x, mid.y, '#c79bff', 120);
                state.powerCd.hero = 25;
            } else {
                return { ok: false, msg: '该法术暂不可用' };
            }
            pushFloat('法术!', LW / 2, 100, '#c79bff', 26);
            emit(); render();
            return { ok: true, msg: '法术释放' };
        },
        // 把画布点击像素坐标转换为槽位索引
        getCanvasTap(px, py) {
            const lx = (px - vp.ox) / vp.scale, ly = (py - vp.oy) / vp.scale;
            let best = -1, bd = 30;
            for (let i = 0; i < slots.length; i++) {
                const d = dist(lx, ly, slots[i].x, slots[i].y);
                if (d < bd) { bd = d; best = i; }
            }
            return best;
        },
        render: render,
        getState() { return Object.assign({}, state); },
    };

    render();
    return engine;
}

module.exports = { createEngine };
