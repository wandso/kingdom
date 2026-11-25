// WorkBuddy 云服务初始化：全应用共享这一个客户端实例。
// publicConfig 来自 workbuddy_cloud_service 激活结果，endpoint / publishableKey 必须从此来源注入。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

const publicConfig = {
    resourceId: 'wbcs_Vi6ToeavCvBd4DChO0KF2R',
    endpoint: 'https://mp-api.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_J0SEXBX2NkQ3e6MF1xsXR4_ZTBzXG5F5dN5aR1K8MtMIbyJV99IK65Q',
    workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_J0SEXBX2NkQ3e6MF1xsXR4',
};

const cloud = createMiniProgramWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
    workBuddyOAuthClientId: publicConfig.workBuddyOAuthClientId,
    wx: createDiagnosticWx(wx),
});

module.exports = { cloud, publicConfig };
