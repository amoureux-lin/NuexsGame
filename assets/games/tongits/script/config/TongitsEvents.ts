/**
 * Tongits 子游戏 MVC 事件名：Model 通知 View 用 DATA_*，View 发给 Controller 用 CMD_*。
 */
export const TongitsEvents = {
    // ---------- Model -> View（数据更新） ----------
    /** 余额已更新，data: { balance: number } */
    DATA_BALANCE_UPDATED: 'tongits:data:balanceUpdated',
    /** 旋转结果，data: { win: number; lines?: number[] } */
    DATA_SPIN_RESULT: 'tongits:data:spinResult',

    // ---------- View -> Controller（用户命令） ----------
    /** 下注旋转，data: { bet: number } */
    CMD_SPIN: 'tongits:cmd:spin',
    /** 打开设置 */
    CMD_OPEN_SETTINGS: 'tongits:cmd:openSettings',
    /** 返回大厅 */
    CMD_BACK_LOBBY: 'tongits:cmd:backLobby',
} as const;
