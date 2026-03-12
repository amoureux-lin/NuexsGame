export const NexusEvents = {
    APP_READY:        'APP_READY',        // 应用准备
    APP_HIDE:         'APP_HIDE',         // 应用隐藏
    APP_SHOW:         'APP_SHOW',         // 应用显示
    BUNDLE_ENTER:     'BUNDLE_ENTER',     // 进入 Bundle
    BUNDLE_EXIT:      'BUNDLE_EXIT',      // 退出 Bundle
    NET_CONNECTED:    'NET_CONNECTED',    // 网络连接成功
    NET_DISCONNECTED: 'NET_DISCONNECTED', // 网络断开
    LANGUAGE_CHANGED: 'LANGUAGE_CHANGED', // 语言切换
    LOGIN_SUCCESS:    'LOGIN_SUCCESS',    // 登录成功
    LOGOUT:           'LOGOUT',           // 登出
    UI_OPEN:          'UI_OPEN',          // 通过事件打开 UI 面板 { id, params?, layer? }
    UI_CLOSE:         'UI_CLOSE',         // 通过事件关闭 UI 面板 { id, destroy? }
} as const;

export type NexusEventKey = typeof NexusEvents[keyof typeof NexusEvents];
