const DATA = require('../../game/data');
const Engine = require('../../game/engine');
const SaveService = require('../../utils/save-service');

Page({
    data: {
        level: null,
        difficulty: null,
        status: 'ready',
        gold: 0, lives: 0, wave: 0, totalWaves: 0, score: 0, speed: 1,
        powerCd: { reinforce: 0, thunder: 0, hero: 0 },
        powers: [],
        // 建塔面板
        panelOpen: false,
        panelSlot: -1,
        towerOptions: [],
        // 已选塔操作
        towerPanelOpen: false,
        selectedTower: null,
        upgradeCost: 0,
        // 剧情弹层
        showStory: false,
        // 结算
        result: null,
        // 提示
        toast: '',
        canvasW: 0, canvasH: 0,
        starArr: [0, 1, 2],
    },

    async onLoad(query) {
        const levelId = Number(query.level || 1);
        const diffId = query.diff || 'normal';
        const mode = query.mode || 'campaign';
        const level = DATA.getLevel(levelId) || DATA.LEVELS[0];
        const difficulties = DATA.DIFFICULTIES || [];
        const difficulty = difficulties.find(d => d.id === diffId) || difficulties[1] || { hpFactor: 1, speedFactor: 1 };
        const progress = getApp().globalData.progress || SaveService.DEFAULT_PROGRESS;
        const unlockedHeroes = progress.unlockedHeroes || ['veznan'];
        const hero = DATA.HEROES.find(h => unlockedHeroes.indexOf(h.id) >= 0) || DATA.HEROES[0] || null;

        const powers = (DATA.POWERS || []).slice(0, 3);
        this.setData({
            level: level, difficulty: difficulty, mode: mode,
            totalWaves: level.waves || 10,
            powers: powers,
            hero: hero,
            showStory: !!level.history && mode === 'campaign',
        });

        this.engine = Engine.createEngine({
            canvasId: 'battleCanvas',
            page: this,
            level: level,
            difficulty: difficulty,
            hero: hero,
            onState: (s) => this.onEngineState(s),
            onEnd: (r) => this.onEngineEnd(r),
        });
    },

    onReady() {
        const query = wx.createSelectorQuery().in(this);
        query.select('#battleCanvas').boundingClientRect((rect) => {
            if (!rect) return;
            this.setData({ canvasW: rect.width, canvasH: rect.height });
            if (this.engine) this.engine.setViewport(rect.width, rect.height);
        }).exec();
    },

    onUnload() { if (this.engine) this.engine.destroy(); },

    onEngineState(s) {
        this.setData({
            status: s.status, gold: s.gold, lives: s.lives,
            wave: s.wave, totalWaves: s.totalWaves, score: s.score,
            speed: s.speed, powerCd: s.powerCd,
        });
    },

    onEngineEnd(r) {
        this.setData({ result: r, status: r.win ? 'won' : 'lost' });
        // 更新云存档
        if (r.win) {
            const p = getApp().globalData.progress || SaveService.DEFAULT_PROGRESS;
            const lid = this.data.level.id;
            p.levelStars = p.levelStars || {};
            p.levelStars[lid] = Math.max(p.levelStars[lid] || 0, r.stars);
            p.unlockedLevel = Math.max(p.unlockedLevel || 1, Math.min(lid + 1, 22));
            p.totalScore = (p.totalScore || 0) + r.score;
            SaveService.save(p).then(() => {
                getApp().globalData.progress = p;
            });
        }
    },

    closeStory() { this.setData({ showStory: false }); },

    startBattle() {
        this.setData({ showStory: false });
        if (this.engine) this.engine.start();
    },

    // 画布点击 → 槽位
    onCanvasTap(e) {
        if (!this.engine || (this.data.status !== 'running' && this.data.status !== 'ready')) return;
        const x = e.detail.x, y = e.detail.y;
        const slot = this.engine.getCanvasTap(x, y);
        if (slot < 0) { this.closeAllPanels(); return; }
        const info = this.engine.getSlotInfo(slot);
        if (info.built) {
            this.setData({ selectedTower: info.tower, towerPanelOpen: true, panelOpen: false, panelSlot: slot });
        } else {
            const options = (DATA.TOWERS || []).filter(t => (t.tier || 1) === 1).map(t => {
                let icon = '🪨';
                const id = t.id || '';
                if (id.indexOf('archer') >= 0 || id.indexOf('silver') >= 0) icon = '🏹';
                else if (id.indexOf('mage') >= 0) icon = '✦';
                else if (id.indexOf('barrack') >= 0 || id.indexOf('blade') >= 0) icon = '🛡';
                return {
                    id: id, nameZh: t.nameZh, nameEn: t.nameEn, cost: t.cost || 70,
                    damage: t.damage || 10, range: t.range || 120, rate: t.rate || 1,
                    dmgType: t.dmgType || 'physical', color: t.color || '#8fbc5a', desc: t.desc || '', icon: icon,
                };
            });
            this.setData({ towerOptions: options, panelOpen: true, panelSlot: slot, towerPanelOpen: false, selectedTower: null });
        }
        this.engine.selectSlot(slot);
    },

    closeAllPanels() {
        this.setData({ panelOpen: false, towerPanelOpen: false });
        if (this.engine) this.engine.selectSlot(-1);
    },

    onBuildTap(e) {
        const id = e.currentTarget.dataset.id;
        const r = this.engine.buildTower(this.data.panelSlot, id);
        if (r.ok) this.closeAllPanels();
        else this.showToast(r.msg);
    },

    onUpgrade() {
        const r = this.engine.upgradeTower(this.data.panelSlot);
        if (r.ok) {
            const info = this.engine.getSlotInfo(this.data.panelSlot);
            this.setData({ selectedTower: info.tower });
        } else this.showToast(r.msg);
    },

    onSell() {
        const r = this.engine.sellTower(this.data.panelSlot);
        if (r.ok) this.closeAllPanels();
        else this.showToast(r.msg);
    },

    onPowerTap(e) {
        const id = e.currentTarget.dataset.id;
        const r = this.engine.castPower(id);
        if (!r.ok && r.msg) this.showToast(r.msg);
    },

    onCallWave() {
        const r = this.engine.callWave();
        if (r.ok) this.showToast(r.msg);
        else if (r.msg) this.showToast(r.msg);
    },

    onTogglePause() {
        if (this.data.status === 'running') this.engine.pause();
        else if (this.data.status === 'paused') this.engine.resume();
    },

    onSpeed() {
        const next = this.data.speed >= 3 ? 1 : this.data.speed + 1;
        this.engine.setSpeed(next);
    },

    showToast(msg) {
        this.setData({ toast: msg });
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.setData({ toast: '' }), 1400);
    },

    onResultRestart() {
        this.setData({ result: null });
        wx.redirectTo({ url: '/pages/battle/battle?level=' + this.data.level.id + '&diff=' + (this.data.difficulty.id || 'normal') + '&mode=' + (this.data.mode || 'campaign') });
    },

    onResultNext() {
        const next = Math.min(this.data.level.id + 1, 22);
        wx.redirectTo({ url: '/pages/battle/battle?level=' + next + '&diff=' + (this.data.difficulty.id || 'normal') });
    },

    onResultBack() { wx.navigateBack(); },
});
