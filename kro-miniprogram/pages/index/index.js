const SaveService = require('../../utils/save-service');

Page({
    data: {
        viewState: 'checking', // checking|signed-out|ready
        user: null,
        progress: null,
        menu: [
            { key: 'campaign', icon: '⚔', title: '战役模式', desc: '22 个关卡，保卫艾纳妮' },
            { key: 'heroes', icon: '🛡', title: '英雄图鉴', desc: '查看英雄与技能' },
            { key: 'story', icon: '📜', title: '起源史诗', desc: '9 幕漫画剧情' },
            { key: 'endless', icon: '♾', title: '无尽模式', desc: '挑战最高分数' },
        ],
    },

    onShow() { this.restore(); },

    async restore() {
        this.setData({ viewState: 'checking' });
        const s = await SaveService.restoreSession();
        if (!s.signedIn) {
            getApp().resetSession();
            this.setData({ viewState: 'signed-out', user: null });
            return;
        }
        const loaded = await SaveService.load();
        const progress = loaded.progress;
        getApp().globalData.progress = progress;
        getApp().globalData.user = s.user;
        getApp().globalData.save = loaded.save;
        this.setData({ viewState: 'ready', user: s.user, progress: progress });
    },

    async onSignedIn() {
        getApp().resetSession();
        await this.restore();
    },

    onMenuTap(e) {
        const key = e.currentTarget.dataset.key;
        if (key === 'campaign') {
            wx.navigateTo({ url: '/pages/levels/levels' });
        } else if (key === 'endless') {
            const p = this.data.progress || {};
            const target = Math.max(1, Math.min(p.unlockedLevel || 1, 22));
            wx.navigateTo({ url: '/pages/battle/battle?level=' + target + '&mode=endless' });
        } else if (key === 'heroes') {
            wx.navigateTo({ url: '/pages/heroes/heroes' });
        } else if (key === 'story') {
            wx.navigateTo({ url: '/pages/story/story' });
        }
    },

    async onLogout() {
        const { cloud } = require('../../utils/cloud');
        await cloud.auth.signOut();
        getApp().resetSession();
        getApp().globalData.progress = null;
        this.setData({ viewState: 'signed-out', user: null });
    },
});
