/**
 * 时间服务：维护服务端与本地的时间差，提供校准后的服务端时间和倒计时工具。
 *
 * 校准时机：
 *   - WS 连接成功时，由业务层在心跳响应中调用 calibrate(serverTimestamp)
 *   - 多次校准自动取平均值，越来越精确
 *
 * 使用：
 *   Nexus.time.now()                         // 校准后的服务端当前时间（秒）
 *   Nexus.time.nowMs()                       // 校准后的服务端当前时间（毫秒）
 *   Nexus.time.remainingSeconds(expiredTime) // 距离过期还剩多少秒
 *   Nexus.time.isExpired(expiredTime)        // 是否已过期
 *
 * 倒计时：
 *   const cd = Nexus.time.createCountdown(expiredTime, {
 *       onTick(remaining) { label.string = `${remaining}`; },
 *       onComplete()      { label.string = ''; },
 *   });
 *   cd.stop();  // 手动停止
 */

/** 倒计时回调配置 */
export interface CountdownOptions {
    /** 每秒回调，参数为剩余秒数（整数，>=0） */
    onTick?: (remaining: number) => void;
    /** 倒计时归零时回调（仅触发一次） */
    onComplete?: () => void;
    /** tick 间隔毫秒（默认 1000） */
    intervalMs?: number;
}

/** 倒计时句柄，用于停止 */
export interface CountdownHandle {
    /** 停止倒计时 */
    stop(): void;
    /** 是否正在运行 */
    readonly running: boolean;
}

export class TimeService {

    /** 服务端时间 - 本地时间 的差值（毫秒），正值表示服务端时间超前 */
    private static _offsetMs = 0;
    /** 校准次数，用于计算移动平均 */
    private static _calibrateCount = 0;
    /** 所有活跃的倒计时，destroy 时统一清理 */
    private static readonly _countdowns = new Set<CountdownHandle>();

    // ── 校准 ──────────────────────────────────────────────

    /**
     * 用服务端时间戳校准。
     * 多次调用会取加权移动平均，逐步收敛到准确值。
     *
     * @param serverTimeSec 服务端当前时间（秒级时间戳）
     * @param rttMs 可选的往返延迟（毫秒），用于补偿网络延迟。
     *             传入时，估算单程延迟为 rttMs/2，校准更精确。
     */
    static calibrate(serverTimeSec: number, rttMs = 0): void {
        const localMs = Date.now();
        const serverMs = serverTimeSec * 1000;
        const adjustedServerMs = serverMs + rttMs / 2;
        const newOffset = adjustedServerMs - localMs;

        if (TimeService._calibrateCount === 0) {
            TimeService._offsetMs = newOffset;
        } else {
            TimeService._offsetMs = TimeService._offsetMs * 0.7 + newOffset * 0.3;
        }
        TimeService._calibrateCount++;
    }

    /** 用毫秒级服务端时间戳校准。 */
    static calibrateMs(serverTimeMs: number, rttMs = 0): void {
        TimeService.calibrate(serverTimeMs / 1000, rttMs);
    }

    // ── 时间查询 ──────────────────────────────────────────

    /** 校准后的服务端当前时间（秒级时间戳） */
    static now(): number {
        return Math.floor((Date.now() + TimeService._offsetMs) / 1000);
    }

    /** 校准后的服务端当前时间（毫秒级时间戳） */
    static nowMs(): number {
        return Date.now() + TimeService._offsetMs;
    }

    /**
     * 距离过期时间还剩多少秒（向上取整，最小 0）。
     * @param expiredTimeSec 过期时间戳（秒）
     */
    static remainingSeconds(expiredTimeSec: number): number {
        const diff = expiredTimeSec - TimeService.now();
        return Math.max(0, Math.ceil(diff));
    }

    /**
     * 距离过期时间还剩多少毫秒（最小 0）。
     * @param expiredTimeSec 过期时间戳（秒）
     */
    static remainingMs(expiredTimeSec: number): number {
        const diff = expiredTimeSec * 1000 - TimeService.nowMs();
        return Math.max(0, diff);
    }

    /**
     * 指定时间是否已过期。
     * @param expiredTimeSec 过期时间戳（秒）
     */
    static isExpired(expiredTimeSec: number): boolean {
        return TimeService.now() >= expiredTimeSec;
    }

    // ── 倒计时 ────────────────────────────────────────────

    /**
     * 创建一个基于服务端时间的倒计时。
     *
     * @param expiredTimeSec 过期时间戳（秒）
     * @param options 回调配置
     * @returns 倒计时句柄，调用 stop() 可提前终止
     *
     * @example
     * const cd = Nexus.time.createCountdown(expiredTime, {
     *     onTick(remaining) { this.label.string = `${remaining}s`; },
     *     onComplete()      { this.label.string = ''; },
     * });
     * // 不需要时：cd.stop();
     */
    static createCountdown(expiredTimeSec: number, options: CountdownOptions): CountdownHandle {
        const interval = options.intervalMs ?? 1000;
        let running = true;
        let lastRemaining = -1;

        // 立即 tick 一次
        const tick = () => {
            if (!running) return;
            const remaining = TimeService.remainingSeconds(expiredTimeSec);

            // 避免同一秒重复回调
            if (remaining !== lastRemaining) {
                lastRemaining = remaining;
                options.onTick?.(remaining);
            }

            if (remaining <= 0) {
                running = false;
                options.onComplete?.();
                TimeService._countdowns.delete(handle);
                return;
            }
        };

        tick();
        const timerId = setInterval(tick, interval);

        const handle: CountdownHandle = {
            stop() {
                if (!running) return;
                running = false;
                clearInterval(timerId);
                TimeService._countdowns.delete(handle);
            },
            get running() {
                return running;
            },
        };

        TimeService._countdowns.add(handle);
        return handle;
    }

    /**
     * 停止所有活跃的倒计时。
     */
    static stopAllCountdowns(): void {
        for (const cd of TimeService._countdowns) {
            cd.stop();
        }
        TimeService._countdowns.clear();
    }

    // ── 状态 ──────────────────────────────────────────────

    /** 当前校准偏移量（毫秒），调试用 */
    static get offsetMs(): number {
        return TimeService._offsetMs;
    }

    /** 是否已经校准过 */
    static get calibrated(): boolean {
        return TimeService._calibrateCount > 0;
    }

    /** 重置校准状态并停止所有倒计时 */
    static reset(): void {
        TimeService._offsetMs = 0;
        TimeService._calibrateCount = 0;
        TimeService.stopAllCountdowns();
    }
}
