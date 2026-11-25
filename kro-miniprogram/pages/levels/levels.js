const DATA = require('../../game/data');
const SaveService = require('../../utils/save-service');

Page({
    data: {
        levels: [],
        progress: null,
        difficulty: 'normal',
        difficulties: DATA.DIFFICULTIES || [],
        diffIndex: 1,
        starArr: [0, 1, 2],
    },

    onShow() {
        const p = getApp().globalData.progress || SaveService.DEFAULT_PROGRESS;
        this.setData({ progress: p });
        this.buildLevels(p);
    },

    buildLevels(p) {
        const unlocked = p.unlockedLevel || 1;
        const stars = p.levelStars || {};
        const list = (DATA.LEVELS || []).filter(l => !l.endless && l.id >= 1 && l.id <= 22).map(l => ({
            id: l.id,
            nameZh: l.nameZh,
            nameEn: l.nameEn,
            theme: l.theme,
            unlocked: l.id <= unlocked,
            star: stars[l.id] || 0,
            boss: !!l.bossId,
        }));
        this.setData({ levels: list });
    },

    onDifficulty(e) {
        const i = Number(e.currentTarget.dataset.index);
        this.setData({ diffIndex: i, difficulty: (this.data.difficulties[i] || {}).id || 'normal' });
    },

    onLevelTap(e) {
        const id = e.currentTarget.dataset.id;
        const unlocked = e.currentTarget.dataset.unlocked === 'true';
        if (!unlocked) {
            wx.showToast({ title: '请先通关前一关', icon: 'none' });
            return;
        }
        const diff = (this.data.difficulties[this.data.diffIndex] || {}).id || 'normal';
        wx.navigateTo({ url: '/pages/battle/battle?level=' + id + '&diff=' + diff });
    },

    onBack() { wx.navigateBack(); },
});
