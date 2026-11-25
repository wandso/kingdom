// 存档服务：登录门 + 云存档读写 + 默认进度。
// 页面通过它恢复会话、加载/保存进度，不直接访问数据库。
const { cloud } = require('./cloud');
const { saves } = require('./save-store');

const DEFAULT_PROGRESS = {
    unlockedLevel: 1,          // 已解锁到第几关
    levelStars: {},            // { levelId: 0-3 }
    totalScore: 0,
    unlockedHeroes: ['veznan'],
    achievements: [],
    settings: { speed: 1, sound: true },
};

function normalize(p) {
    const d = JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
    if (!p || typeof p !== 'object') return d;
    if (typeof p.unlockedLevel === 'number') d.unlockedLevel = p.unlockedLevel;
    if (p.levelStars && typeof p.levelStars === 'object') d.levelStars = p.levelStars;
    if (typeof p.totalScore === 'number') d.totalScore = p.totalScore;
    if (Array.isArray(p.unlockedHeroes)) d.unlockedHeroes = p.unlockedHeroes;
    if (Array.isArray(p.achievements)) d.achievements = p.achievements;
    if (p.settings && typeof p.settings === 'object') d.settings = Object.assign(d.settings, p.settings);
    return d;
}

const SaveService = {
    DEFAULT_PROGRESS: DEFAULT_PROGRESS,

    // 恢复会话，返回 { signedIn, user }
    async restoreSession() {
        const { data: session, error } = await cloud.auth.getSession();
        if (error || !session) return { signedIn: false, user: null };
        return { signedIn: true, user: session.user || null };
    },

    // 加载当前用户存档，返回 { found, progress, save }
    async load() {
        const { data: rows, error } = await saves.list();
        if (error) return { found: false, progress: normalize(null), save: null, error: error };
        if (rows && rows.length > 0) {
            const row = rows[0];
            let parsed = null;
            try { parsed = JSON.parse(row.save_data); } catch (e) { parsed = null; }
            return { found: true, progress: normalize(parsed), save: row };
        }
        return { found: false, progress: normalize(null), save: null };
    },

    // 保存进度：有记录则 update，无则 create
    async save(progress) {
        const payload = JSON.stringify(normalize(progress));
        const existing = await saves.list();
        if (existing.error) return { ok: false, error: existing.error };
        if (existing.data && existing.data.length > 0) {
            const r = await saves.update(existing.data[0].id, { save_data: payload });
            return r.error ? { ok: false, error: r.error } : { ok: true };
        }
        const r = await saves.create({ save_data: payload });
        return r.error ? { ok: false, error: r.error } : { ok: true };
    },
};

module.exports = SaveService;
