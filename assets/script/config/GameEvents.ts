import { NexusEvents } from 'db://nexus-framework/index';
import { BaseGameEvents } from 'db://assets/script/base/BaseGameEvents';

/** 游戏业务事件名定义（与框架 NexusEvents、BaseGameEvents 合并为统一配置） */
const GameEventDefines = {
    HTTP_GENERATE_TOKEN: "/auth/v1/game/get-token-dev", // test get token
    HTTP_GAME_CONFIG: "/api/v1/get_game_config", //获取

    /** 进房成功（正常进入与断线重连共用） */
    GAME_JOIN_SUCCESS: 'GAME.JOIN.SUCCESS',
    /** 进房失败 */
    GAME_JOIN_FAIL: 'GAME.JOIN.FAIL',
    /** 重连后由 ReconnectManager 发出，当前 bundle 收到后发送 joinGame */
    RECONNECT_NEED_JOIN: 'RECONNECT.NEED_JOIN',

    // ---------- 公共 View → Controller 命令（所有子游戏共用） ----------
    /** 坐下，data: { seat: number } */
    CMD_SIT_DOWN: 'game:cmd:sitDown',
    /** 站起（自己主动离座） */
    CMD_STAND_UP: 'game:cmd:standUp',
    /** 准备/取消准备，data: { ready: boolean } */
    CMD_READY: 'game:cmd:ready',
    /** 房主踢人下座，data: { userId: number } */
    CMD_KICK_OFF_SEAT: 'game:cmd:kickOffSeat',
    /** 查看玩家信息，data: { userId: number } */
    CMD_VIEW_PLAYER_INFO: 'game:cmd:viewPlayerInfo',
    /** 打开设置面板 */
    CMD_OPEN_SETTINGS: 'game:cmd:openSettings',
    /** 返回大厅 */
    CMD_BACK_LOBBY: 'game:cmd:backLobby',
    /** 切换牌面主题，data: { index: number }（0=默认，1=备用） */
    CMD_SWITCH_CARD_THEME: 'game:cmd:switchCardTheme',
} as const;

/**
 * 统一事件名配置：NexusEvents（框架底层）+ BaseGameEvents（游戏基础层）+ GameEventDefines（应用业务层）。
 * 通过展开实现"继承"，一处引用即可使用全部事件 key。
 */
export const GameEvents = {
    ...NexusEvents,
    ...BaseGameEvents,
    ...GameEventDefines,
} as const;

export type GameEventKey = keyof typeof GameEvents;
