const DATA = require('../../game/data');

Page({
    data: {
        comics: [],
        index: 0,
        current: null,
        achievements: [],
        showAchievements: false,
    },
    onLoad() {
        const comics = (DATA.COMICS || []).map(c => ({
            id: c.id, title: c.title, lines: c.lines || [],
        }));
        this.setData({ comics: comics, current: comics[0] || null, achievements: DATA.ACHIEVEMENTS || [] });
    },
    onPrev() {
        let i = this.data.index - 1;
        if (i < 0) i = this.data.comics.length - 1;
        this.setData({ index: i, current: this.data.comics[i] });
    },
    onNext() {
        let i = this.data.index + 1;
        if (i >= this.data.comics.length) i = 0;
        this.setData({ index: i, current: this.data.comics[i] });
    },
    onSelect(e) {
        const i = Number(e.currentTarget.dataset.index);
        this.setData({ index: i, current: this.data.comics[i] });
    },
    toggleAchievements() { this.setData({ showAchievements: !this.data.showAchievements }); },
});
