/** Game → Platform 消息类型 */
export enum SendGameMessageType {
    /** 显示加载界面 */
    C2W_SHOW_LOADING = 'C2W_SHOW_LOADING',
    /** 关闭加载界面 */
    C2W_CLOSE_LOADING = 'C2W_CLOSE_LOADING',
    /** 开始游戏 */
    C2W_START_GAME = 'C2W_START_GAME',
    /** 退出游戏 */
    C2W_EXIT_GAME = 'C2W_EXIT_GAME',
    /** 加入游戏 */
    C2W_JOIN_GAME = 'C2W_JOIN_GAME',
    /** 充值游戏 */
    C2W_RECHARGE_GAME = 'C2W_RECHARGE_GAME',
    /** 改变金币 */
    C2W_CHANGE_COIN = 'C2W_CHANGE_COIN',
    /** 本局游戏结束 */
    C2W_GAME_OVER = 'C2W_GAME_OVER',
    /** 打开用户面板 */
    C2W_OPEN_USER_DATA = 'C2W_OPEN_USER_DATA',
    /** 打开改变底分面板 */
    C2W_CHANGE_SCORE = 'C2W_CHANGE_SCORE',
    /** 打开结果表情 */
    C2W_OPEN_RESULT_EMOJI = 'C2W_OPEN_RESULT_EMOJI',
    /** 关闭结果表情 */
    C2W_CLOSE_RESULT_EMOJI = 'C2W_CLOSE_RESULT_EMOJI',
    /** 破产 */
    C2W_BANKRUPT = 'C2W_BANKRUPT',
    /** 语音开关 */
    C2W_VOICE_SWITCH = 'C2W_VOICE_SWITCH',
    /** 成员更新 */
    C2W_MEMBER_UPDATE = 'C2W_MEMBER_UPDATE',
    /** 游戏状态 */
    C2W_GAME_STATUS = 'C2W_GAME_STATUS',
    /** 刷新按钮状态 */
    C2W_REFRESH_BUTTON_STATUS = 'C2W_REFRESH_BUTTON_STATUS',
    /** 游戏动作 */
    C2W_GAME_ACTION = 'C2W_GAME_ACTION',
}

/** Platform → Game 消息类型 */
export enum HandleMessageType {
    /** 退出游戏 */
    W2C_EXIT_GAME = 'W2C_EXIT_GAME',
    /** 改变底分 */
    W2C_CHANGE_SCORE = 'W2C_CHANGE_SCORE',
    /** 播放表情 */
    W2C_PLAY_EMOJI = 'W2C_PLAY_EMOJI',
    /** 语音开关 */
    W2C_VOICE_SWITCH = 'W2C_VOICE_SWITCH',
    /** 切换房间 */
    W2C_PLAYER_SWITCH_ROOM = 'W2C_PLAYER_SWITCH_ROOM',
    /** 玩家预约离开 */
    W2C_PLAYER_PENDING_LEAVE = 'W2C_PLAYER_PENDING_LEAVE',
}

export enum ResultType {
    /** 输 */
    LOSE = 0,
    /** 赢 */
    WIN = 1,
    /** 平 */
    DOGFALL = 2,
}

export const enum WebSdkGameStatus {
    /** 初始化 */
    INIT = 'INIT',
    /** 加入房间 */
    JOIN_ROOM = 'JOIN_ROOM',
    /** 游戏进行中 */
    GAME_ING = 'GAME_ING',
    /** 游戏结束 */
    GAME_OVER = 'GAME_OVER',
    /** 游戏重置 */
    GAME_RESET = 'GAME_RESET',
}

/** Game → Platform 消息结构 */
export interface SendGameMessage {
    type: SendGameMessageType;
    data?: unknown;
}

/** Platform → Game 消息结构 */
export interface HandleGameMessage {
    type: HandleMessageType;
    data?: any;
}
