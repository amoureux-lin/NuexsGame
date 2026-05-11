/**
 * 游戏统一错误体系。
 *
 * 设计原则：
 *   - 每个错误自带 `retryable` 标志，retry 层据此决定是否重试。
 *   - 每个错误自带 `category`，便于上报与监控分桶。
 *   - 网络层错误（NetworkError）才会被重试；协议错误（ProtocolError）和状态错误
 *     （StateApplyError）属于"业务/代码 bug"，立刻外抛，不重试。
 *   - View 层订阅者抛出（ViewError）由 View 边界自己 catch + 上报，不污染主流程。
 *
 * 重要约束：retry 是网络层的职责。任何对状态层 / View 层 throw 的重试都是错误的。
 */

/** 所有可分类错误的根 */
export abstract class GameError extends Error {
    abstract readonly retryable: boolean;
    abstract readonly category: 'network' | 'protocol' | 'state' | 'view';

    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = this.constructor.name;
    }
}

/** 网络层：超时、断连、wsRequest 抛错。可重试。 */
export class NetworkError extends GameError {
    readonly retryable = true as const;
    readonly category = 'network' as const;
}

/** 协议层：服务端返回业务错误码 / 房间不存在 / 被踢。不可重试。 */
export class ProtocolError extends GameError {
    readonly retryable = false as const;
    readonly category = 'protocol' as const;

    constructor(message: string, public readonly code?: number, cause?: unknown) {
        super(message, cause);
    }
}

/** 状态应用层：reducer / model.apply 同步抛（=客户端 bug）。不可重试。 */
export class StateApplyError extends GameError {
    readonly retryable = false as const;
    readonly category = 'state' as const;
}

/** View 层：订阅者 / 渲染层抛（=客户端 bug，但不影响主流程）。不可重试。 */
export class ViewError extends GameError {
    readonly retryable = false as const;
    readonly category = 'view' as const;
}

/**
 * 把任意 throw 归一化成 GameError。
 *
 * 兜底策略：当无法分类时归为 StateApplyError（不可重试），
 * 避免把客户端代码 bug 当网络错无限重试。
 */
export function classifyError(raw: unknown): GameError {
    if (raw instanceof GameError) return raw;

    const message = raw instanceof Error
        ? raw.message
        : typeof raw === 'string' ? raw : String(raw);

    return new StateApplyError(message, raw);
}

/**
 * 把 wsRequest 抛出的错误归一化成 NetworkError / ProtocolError。
 *
 * 当前 nexus 网络层抛出形态（见 WsServiceImpl）：
 *   - 字符串 '[Nexus] WS request timeout'           → NetworkError
 *   - 字符串 '[Nexus] WebSocket not connected'      → NetworkError
 *   - 字符串 'WS disconnected'                      → NetworkError
 *   - Error  'server:${code}'（来自 WsDelegate.willReceive）→ ProtocolError(code)
 *
 * 兜底当 NetworkError（可重试）—— 因为 wsRequest 调用边界本就是网络操作，
 * 未识别的错误保守地允许重试，由 retry 预算/退避兜底，不会无限循环。
 */
export function classifyWsError(raw: unknown): GameError {
    if (raw instanceof GameError) return raw;

    // 服务端业务错误码：Error('server:123')
    if (raw instanceof Error) {
        const m = /^server:(\d+)$/.exec(raw.message);
        if (m) {
            const code = Number(m[1]);
            return new ProtocolError(raw.message, code, raw);
        }
        // 其他 Error：当网络错（保守）
        return new NetworkError(raw.message, raw);
    }

    // 字符串错误（timeout / disconnected / not connected）
    if (typeof raw === 'string') {
        return new NetworkError(raw, raw);
    }

    return new NetworkError('unknown ws error', raw);
}
