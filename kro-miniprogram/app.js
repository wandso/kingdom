// 王国保卫战：起源 —— 应用入口
// 云服务会话缓存：登录/退出后重置，各页面 onShow 统一恢复
App({
    globalData: {
        appName: '王国保卫战：起源',
        save: null,          // 当前云存档对象 { id, save_data }
        progress: null,      // 解析后的游戏进度
        user: null,          // 当前用户
    },

    onLaunch() {
        // 会话在页面 onShow 时按需恢复，避免阻塞首屏
    },

    ensureSession() {
        const { cloud } = require('./utils/cloud');
        if (!this.sessionPromise) {
            this.sessionPromise = cloud.auth.getSession();
        }
        return this.sessionPromise;
    },

    resetSession() {
        this.sessionPromise = null;
    },
});
