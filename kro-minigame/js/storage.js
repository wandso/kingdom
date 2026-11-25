/**
 * 本地存档模块（微信小游戏）
 * ------------------------------------------------------------------
 * 说明：当前绑定的是小游戏「测试号」，微信测试号不支持云开发
 * （cloud_env_list 返回 ret:-601059 测试号不能使用云服务），
 * 且 WorkBuddy 云 SDK 属于小程序类目，不适用于小游戏类目。
 * 因此小游戏版采用 wx.setStorageSync 做本地持久化。
 * 进度结构与小程序版 SaveService.DEFAULT_PROGRESS 保持一致，
 * 后续若换用支持云开发的小游戏 AppID，可平滑迁移到 wx.cloud。
 */

var KEY = 'kro_origins_save_v1';

var DEFAULT_PROGRESS = {
    unlockedLevel: 1,
    levelStars: {},            // { levelId: 0-3 }
    totalScore: 0,
    unlockedHeroes: ['veznan'],
    achievements: [],
    settings: { speed: 1, sound: true },
};

function normalize(p) {
    var d = JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
    if (!p || typeof p !== 'object') return d;
    if (typeof p.unlockedLevel === 'number') d.unlockedLevel = p.unlockedLevel;
    if (p.levelStars && typeof p.levelStars === 'object') d.levelStars = p.levelStars;
    if (typeof p.totalScore === 'number') d.totalScore = p.totalScore;
    if (Array.isArray(p.unlockedHeroes)) d.unlockedHeroes = p.unlockedHeroes;
    if (Array.isArray(p.achievements)) d.achievements = p.achievements;
    if (p.settings && typeof p.settings === 'object') d.settings = Object.assign(d.settings, p.settings);
    return d;
}

var Storage = {
    DEFAULT_PROGRESS: DEFAULT_PROGRESS,

    load: function () {
        try {
            var raw = wx.getStorageSync(KEY);
            if (!raw) return { found: false, progress: normalize(null) };
            var parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            return { found: true, progress: normalize(parsed) };
        } catch (e) {
            return { found: false, progress: normalize(null) };
        }
    },

    save: function (progress) {
        try {
            wx.setStorageSync(KEY, normalize(progress));
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    },

    clear: function () {
        try { wx.removeStorageSync(KEY); } catch (e) {}
    },
};

module.exports = Storage;
