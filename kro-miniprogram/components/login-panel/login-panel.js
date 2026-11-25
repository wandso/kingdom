// 微信一键登录组件：wx.login 获取 code，signInWithWechat 换取会话。
// 依赖 utils/cloud.js 导出的 { cloud }。成功后触发 signedin 事件。
const { cloud } = require('../../utils/cloud');

Component({
    data: {
        loggingIn: false,
        error: '',
    },
    lifetimes: {
        attached() { this.alive = true; },
        detached() { this.alive = false; },
    },
    methods: {
        async login() {
            if (this.data.loggingIn) return;
            this.setData({ loggingIn: true, error: '' });
            const doLogin = (code) => {
                let appid = '';
                try { appid = wx.getAccountInfoSync().miniProgram.appId; } catch (e) { appid = ''; }
                return cloud.auth.signInWithWechat(code, appid);
            };
            wx.login({
                success: async (res) => {
                    if (!res.code) {
                        if (this.alive) this.setData({ loggingIn: false, error: '微信登录失败，请重试' });
                        return;
                    }
                    let result;
                    try { result = await doLogin(res.code); }
                    catch (e) { result = { data: null, error: { message: '微信登录失败，请重试' } }; }
                    if (!this.alive) return;
                    this.setData({ loggingIn: false });
                    if (result.error) {
                        this.setData({ error: result.error.message || '微信登录失败，请重试' });
                        return;
                    }
                    this.triggerEvent('signedin', { user: result.data && result.data.user ? result.data.user : null });
                },
                fail: (err) => {
                    if (this.alive) this.setData({ loggingIn: false, error: (err && err.errMsg) || '微信登录失败' });
                },
            });
        },
    },
});
