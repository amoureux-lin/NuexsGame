/**
 * 游戏框架基础层事件定义。
 *
 * 层级：NexusEvents（框架底层）→ BaseGameEvents（游戏基础层，本文件）→ GameEvents（应用业务层）。
 * 由 GameEvents 通过 `...BaseGameEvents` 合并，应用代码一般通过 GameEvents 访问即可；
 * 框架基类内部（BaseGameEntry / BaseGameModel / BaseGameView）直接从本文件导入以避免循环依赖。
 */
export const BaseGameEvents = {
    /** Entry 在场景加载完成后 emit，携带 model 实例，供 View 保存只读引用 */
    MODEL_READY: 'base:model:ready',
    /** Loading 隐藏、游戏画面首次呈现给玩家时 emit（仅首次进入派发，重连不触发），payload: GameEnteredPayload */
    GAME_ENTERED: 'base:game:entered',
    /** 进房数据就绪 */
    ROOM_JOINED: 'base:room:joined',
    /** 玩家列表变化 */
    PLAYERS_UPDATED: 'base:players:updated',
    /** 游戏状态变化 */
    GAME_INFO_UPDATED: 'base:gameInfo:updated',
    /** 自己的数据变化 */
    SELF_UPDATED: 'base:self:updated',
    /** 观战者列表变化 */
    WATCHERS_UPDATED: 'base:watchers:updated',
    /** 上麦列表变化 */
    SPEAKERS_UPDATED: 'base:speakers:updated',
} as const;

/** GAME_ENTERED 事件载荷 */
export interface GameEnteredPayload {
    /** 进入游戏时的启动参数（与 Entry.onEnter 的 params 一致） */
    params?: Record<string, unknown>;
}
