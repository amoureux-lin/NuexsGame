import { NexusEvents } from 'db://nexus-framework/index';

/** 游戏业务事件名定义（与框架 NexusEvents 合并为统一配置） */
const GameEventDefines = {
    HTTP_GENERATE_TOKEN: "/debug/enter_game", // test get token
    HTTP_GAME_CONFIG: "/api/v1/get_game_config", //获取

    /** 进房成功（正常进入与断线重连共用） */
    GAME_JOIN_SUCCESS: 'GAME.JOIN.SUCCESS',
    /** 进房失败 */
    GAME_JOIN_FAIL: 'GAME.JOIN.FAIL',
    /** 重连后由 ReconnectManager 发出，当前 bundle 收到后发送 joinGame */
    RECONNECT_NEED_JOIN: 'RECONNECT.NEED_JOIN',
} as const;

/**
 * 统一事件名配置：框架事件 + 游戏业务事件。
 * 通过展开 NexusEvents 实现“继承”，一处引用即可使用全部事件 key。
 */
export const GameEvents = {
    ...NexusEvents,
    ...GameEventDefines,
} as const;

export type GameEventKey = keyof typeof GameEvents;
