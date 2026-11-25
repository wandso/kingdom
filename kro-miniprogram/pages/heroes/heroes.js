const DATA = require('../../game/data');

Page({
    data: {
        heroes: [],
        current: null,
        unlocked: [],
    },
    onLoad() {
        const progress = getApp().globalData.progress || {};
        const unlocked = progress.unlockedHeroes || ['veznan'];
        const heroes = (DATA.HEROES || []).map(h => {
            const unlockedFlag = unlocked.indexOf(h.id) >= 0;
            return {
                id: h.id, nameZh: h.nameZh, nameEn: h.nameEn, cls: h.cls,
                color: h.color, cost: h.cost, desc: h.desc,
                skills: h.skills || [], unlocked: unlockedFlag,
                initial: unlockedFlag ? (h.nameZh || '?').charAt(0) : '?',
            };
        });
        this.setData({ heroes: heroes, unlocked: unlocked, current: heroes[0] || null });
    },
    onHeroTap(e) {
        const id = e.currentTarget.dataset.id;
        const h = this.data.heroes.find(x => x.id === id);
        if (h) this.setData({ current: h });
    },
});
