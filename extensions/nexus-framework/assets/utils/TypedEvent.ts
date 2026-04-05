import { Nexus } from '../core/Nexus';

/**
 * 类型安全的事件总线包装器。
 *
 * 通过泛型 EventMap 约束事件名与数据类型的对应关系，
 * emit 错误类型时 TypeScript 编译期报错，而非运行时静默失败。
 *
 * 用法示例：
 * ```ts
 * // 1. 定义事件映射表
 * interface TongitsEventMap {
 *     [TongitsEvents.GAME_START]:   GameStartBroadcast;
 *     [TongitsEvents.ACTION_CHANGE]: ActionChangeBroadcast;
 *     [TongitsEvents.GAME_RESULT]:  GameResultBroadcast;
 * }
 *
 * // 2. 创建类型安全总线（通常每个游戏模块一个）
 * const bus = new TypedEvent<TongitsEventMap>();
 *
 * // 3. 监听 —— data 自动推断为 GameStartBroadcast
 * bus.on(TongitsEvents.GAME_START, (data) => {
 *     console.log(data.players);
 * }, this);
 *
 * // 4. 发送 —— 类型不匹配时编译报错
 * bus.emit(TongitsEvents.GAME_START, broadcastData);
 *
 * // 5. 销毁时统一解绑
 * bus.offTarget(this);
 * ```
 */
export class TypedEvent<M extends Record<string, unknown>> {

    /** 注册事件监听。 */
    on<K extends keyof M & string>(event: K, fn: (data: M[K]) => void, target?: object): void {
        Nexus.on(event, fn as (data: unknown) => void, target);
    }

    /** 注册一次性事件监听（触发一次后自动移除）。 */
    once<K extends keyof M & string>(event: K, fn: (data: M[K]) => void, target?: object): void {
        Nexus.once(event, fn as (data: unknown) => void, target);
    }

    /** 移除指定事件监听。 */
    off<K extends keyof M & string>(event: K, fn: (data: M[K]) => void, target?: object): void {
        Nexus.off(event, fn as (data: unknown) => void, target);
    }

    /** 发送事件（类型不匹配时编译期报错）。 */
    emit<K extends keyof M & string>(event: K, data: M[K]): void {
        Nexus.emit(event, data);
    }

    /** 移除 target 绑定的全部监听（销毁时调用）。 */
    offTarget(target: object): void {
        Nexus.offTarget(target);
    }
}
