import { classifyError, GameError } from 'db://assets/script/base/errors';

/**
 * 单点错误上报。
 *
 * 用法：
 *   ErrorReporter.report(err, { phase: 'join_room' });
 *
 * 注册 sink 把错误投递到外部系统（Sentry / 自研埋点）：
 *   ErrorReporter.addSink((err, ctx) => myTelemetry.report(err, ctx));
 *
 * Sink 内部抛出不会影响其他 sink 调用（每个 sink 独立 try-catch）。
 */
type Sink = (err: GameError, context?: Record<string, unknown>) => void;

class ErrorReporterImpl {
    private _sinks: Sink[] = [];

    /** 注册 sink，可叠加多个（控制台/Sentry/toast 等） */
    addSink(sink: Sink): void {
        this._sinks.push(sink);
    }

    /** 移除指定 sink */
    removeSink(sink: Sink): void {
        const idx = this._sinks.indexOf(sink);
        if (idx >= 0) this._sinks.splice(idx, 1);
    }

    /**
     * 上报一个错误。raw 不必是 GameError，会自动归类。
     * 控制台始终会打印，确保开发期可见。
     */
    report(raw: unknown, context?: Record<string, unknown>): void {
        const err = classifyError(raw);

        // 1. 控制台：开发期必见
        console.error(
            `[${err.category}] ${err.name}: ${err.message}`,
            err.cause ?? '',
            context ?? '',
        );

        // 2. 投递到所有 sink
        for (const sink of this._sinks) {
            try {
                sink(err, context);
            } catch (e) {
                // sink 抛错不能再走 ErrorReporter 否则可能死循环
                console.error('[ErrorReporter] sink threw:', e);
            }
        }
    }
}

export const ErrorReporter = new ErrorReporterImpl();
