/**
 * 大厅 MVC 事件名：Model 通知 View 用 DATA_*，View 发给 Controller 用 CMD_*。
 * 便于扩展：新增数据或操作时在此追加常量并在 Model/View/Controller 中对接。
 */
export const LobbyEvents = {
    // ---------- Model -> View（数据更新） ----------
    /** 游戏列表已更新，data: { list: GameItem[] } */
    DATA_GAME_LIST_UPDATED: 'lobby:data:gameListUpdated',
    /** 用户信息已更新，data: { user: UserInfo } */
    DATA_USER_INFO_UPDATED: 'lobby:data:userInfoUpdated',

    // ---------- View -> Controller（用户命令） ----------
    /** 打开游戏列表面板，data 可选 */
    CMD_OPEN_GAME_LIST: 'lobby:cmd:openGameList',
    /** 进入子游戏，data: { bundleName: string; params?: Record<string, unknown> } */
    CMD_ENTER_GAME: 'lobby:cmd:enterGame',
    /** 打开设置等扩展用，data 可选 */
    CMD_OPEN_SETTINGS: 'lobby:cmd:openSettings',
} as const;

/** 大厅 WebSocket 消息 cmd，与后端约定一致，按需扩展 */
export const LobbyWsCmd = {
    /** 游戏列表推送 */
    GAME_LIST: 1,
    /** 用户信息推送 */
    USER_INFO: 2,
} as const;

export type LobbyEventKey = (typeof LobbyEvents)[keyof typeof LobbyEvents];
