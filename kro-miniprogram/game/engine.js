/* eslint-disable */
// 塔防核心引擎 —— 逻辑坐标系 1000x600，渲染时按画布实际尺寸缩放。
// 使用 wx.createCanvasContext（旧版接口，模拟器与真机兼容性最佳）。
const DATA = require('./data');

const LW = 1000;
const LH = 600;

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
    const page = opts.page || null;
    const canvasId = opts.canvasId || 'battleCanvas';
    const diff = opts.difficulty || { hpFactor: 1, speedFactor: 1 };
    const hero = opts.hero || null;
    const ctx = wx.createCanvasContext(canvasId, page);

    // 渲染画布尺寸（由页面 onReady 通过 setViewport 注入）
    let vp = { w: LW, h: LH, scale: 1, ox: 0, oy: 0 };

    const path = level.path || [{ x: 0, y: 300 }, { x: 1000, y: 300 }];
    const slots = level.slots || [];
    const totalLen = pathLength(path);

    const state = {
        gold: 220,
        lives: 20,
        wave: 0,
        totalWaves: level.waves || 10,
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
        if (DATA.getEnemy) { const e = safeGet(() => DATA.getEnemy(id), null); if (e) return e; }
        const list = (DATA.ENEMIES || []).concat(DATA.BOSSES || []);
        return list.find(e => e.id === id) || list[0] || { id: id, nameZh: '敌人', hp: 60, speed: 40, bounty: 8, color: '#a55', size: 10 };
    }

    // 根据波次生成敌人队列
    function buildWave(n) {
        const pool = (DATA.ENEMIES || []).slice();
        if (!pool.length) pool.push({ id: 'gnoll', hp: 60, speed: 40, bounty: 8, color: '#a55', size: 10 });
        const count = Math.min(8 + n * 2, 34);
        const q = [];
        const hpScale = (diff.hpFactor || 1) * (1 + (n - 1) * 0.22);
        const spdScale = (diff.speedFactor || 1);
        for (let i = 0; i < count; i++) {
            const base = pick(pool);
            q.push({
                defId: base.id,
                hp: Math.round((base.hp || 60) * hpScale),
                speed: (base.speed || 40) * spdScale,
                bounty: Math.round((base.bounty || 8) * (1 + n * 0.05)),
                armor: base.armor || 0,
                magicResist: base.magicResist || 0,
                flying: !!base.flying,
                color: base.color || '#a55',
                size: base.size || 10,
                nameZh: base.nameZh || '敌人',
            });
        }
        // Boss 关最后一波加入 Boss
        if (level.bossId && n === state.totalWaves) {
            const boss = getEnemyDef(level.bossId);
            q.push({
                defId: boss.id, hp: Math.round((boss.hp || 1200) * (diff.hpFactor || 1)),
                speed: (boss.speed || 28) * (diff.speedFactor || 1), bounty: boss.bounty || 120,
                armor: boss.armor || 0, magicResist: boss.magicResist || 0, flying: !!boss.flying,
                color: boss.color || '#c33', size: boss.size || 20, nameZh: boss.nameZh || '首领', boss: true,
            });
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
        const start = pointAt(path, 0);
        enemies.push({
            x: start.x, y: start.y, d: 0,
            hp: cfg.hp, maxHp: cfg.hp, speed: cfg.speed, bounty: cfg.bounty,
            armor: cfg.armor, magicResist: cfg.magicResist, flying: cfg.flying,
            color: cfg.color, size: cfg.size, nameZh: cfg.nameZh, boss: !!cfg.boss,
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
            const dmgType = def.dmgType || 'physical';
            let dmg = def.damage || 10;
            bullets.push({
                x: t.x, y: t.y, tx: target.x, ty: target.y, target: target,
                speed: 520, dmg: dmg, type: dmgType, color: def.color || '#ffd36a',
                splash: def.splash || 0,
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
            if (e.d >= totalLen) {
                enemies.splice(i, 1);
                state.lives -= e.boss ? 5 : 1;
                pushFloat('-1', path[path.length - 1].x, path[path.length - 1].y - 10, '#ff6b6b', 24);
                emit();
                if (state.lives <= 0) { state.lives = 0; finish(false); return; }
                continue;
            }
            const p = pointAt(path, e.d);
            e.x = p.x; e.y = p.y;
        }
    }

    function update(dt) {
        // 冷却
        for (const k in state.powerCd) if (state.powerCd[k] > 0) state.powerCd[k] = Math.max(0, state.powerCd[k] - dt);
        // 出怪
        if (spawnQueue.length > 0) {
            spawnTimer -= dt;
            if (spawnTimer <= 0) { spawnEnemy(spawnQueue.shift()); spawnTimer = 0.55; }
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

        // 天空渐变（分段矩形模拟）
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
        // 地形装饰：随机草丛（固定种子感）
        ctx.setFillStyle(hex(th.accent || '#8fbc5a', 0.35));
        for (let i = 0; i < 40; i++) {
            const gx = (i * 137.5) % LW, gy = 40 + (i * 83.3) % (LH - 80);
            ctx.beginPath();
            ctx.moveTo(gx, gy); ctx.lineTo(gx - 6, gy + 12); ctx.lineTo(gx + 6, gy + 12);
            ctx.closePath(); ctx.fill();
        }
        // 路径（手绘土路：粗描边 + 内芯）
        ctx.setLineCap('round'); ctx.setLineJoin('round');
        ctx.setStrokeStyle(hex('#4a3418', 0.55)); ctx.setLineWidth(46);
        drawPolyline(path);
        ctx.setStrokeStyle(th.path || '#c8a86a'); ctx.setLineWidth(34);
        drawPolyline(path);
        ctx.setStrokeStyle(hex('#ffffff', 0.12)); ctx.setLineWidth(6);
        drawPolyline(path);

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

        // 子弹
        for (let i = 0; i < bullets.length; i++) {
            const b = bullets[i];
            ctx.setFillStyle(b.color);
            ctx.beginPath(); ctx.arc(b.x, b.y, b.type === 'magic' ? 5 : 4, 0, Math.PI * 2); ctx.fill();
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
        // 塔身（梯形）
        ctx.setFillStyle(hex(c, 1));
        ctx.beginPath();
        ctx.moveTo(t.x - 13, t.y + 12); ctx.lineTo(t.x - 9, t.y - 10);
        ctx.lineTo(t.x + 9, t.y - 10); ctx.lineTo(t.x + 13, t.y + 12);
        ctx.closePath(); ctx.fill();
        ctx.setStrokeStyle(hex('#2b1d0e', 0.7)); ctx.setLineWidth(2); ctx.stroke();
        // 顶部装饰（按 family 造型）
        const fam = def.family || '';
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
        if (e.flying) { // 翅膀
            ctx.setFillStyle('rgba(255,255,255,0.5)');
            ctx.beginPath(); ctx.ellipse(e.x - s * 0.8, e.y - s, s * 0.7, s * 0.3, -0.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(e.x + s * 0.8, e.y - s, s * 0.7, s * 0.3, 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.setFillStyle(e.hitFlash > 0 ? '#ffffff' : e.color);
        ctx.beginPath(); ctx.arc(e.x, e.y, s, 0, Math.PI * 2); ctx.fill();
        ctx.setStrokeStyle(hex('#2b1d0e', 0.8)); ctx.setLineWidth(e.boss ? 3 : 1.5); ctx.stroke();
        // 血条
        const bw = s * 2.2, bh = 4;
        const ratio = clamp(e.hp / e.maxHp, 0, 1);
        ctx.setFillStyle('rgba(0,0,0,0.6)'); ctx.fillRect(e.x - bw / 2, e.y - s - 10, bw, bh);
        ctx.setFillStyle(ratio > 0.5 ? '#6fd36f' : ratio > 0.25 ? '#e8c14a' : '#e85a4a');
        ctx.fillRect(e.x - bw / 2, e.y - s - 10, bw * ratio, bh);
    }

    // ============ 主循环 ============
    function tick() {
        if (state.status !== 'running') return;
        const now = Date.now();
        let dt = lastTs ? (now - lastTs) / 1000 : 0.033;
        lastTs = now;
        dt = clamp(dt, 0, 0.1) * state.speed;
        // 分步模拟提高稳定性
        const steps = Math.max(1, Math.ceil(dt / 0.033));
        for (let i = 0; i < steps; i++) update(dt / steps);
        render();
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
            towers.push({ slot: slotIndex, x: s.x, y: s.y, def: def, id: towerId, level: def.tier || 1, cool: 0 });
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
