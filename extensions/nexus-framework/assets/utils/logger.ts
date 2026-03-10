/**
 * 简单日志工具，可配合 Nexus.config.debug 控制输出。
 */

const TAG = '[Nexus]';

export interface LoggerOptions {
    /** 是否启用，默认 true；可绑定 Nexus.config.debug */
    enabled?: boolean;
    /** 前缀，默认 [Nexus] */
    tag?: string;
}

let _enabled = true;
let _tag = TAG;

/** 配置全局 Logger。 */
export function setLoggerOptions(options: LoggerOptions): void {
    if (options.enabled !== undefined) _enabled = options.enabled;
    if (options.tag !== undefined) _tag = options.tag;
}

function prefix(): string {
    return _tag;
}

export const logger = {
    debug(...args: unknown[]): void {
        if (_enabled) console.debug(prefix(), ...args);
    },
    log(...args: unknown[]): void {
        if (_enabled) console.log(prefix(), ...args);
    },
    info(...args: unknown[]): void {
        if (_enabled) console.info(prefix(), ...args);
    },
    warn(...args: unknown[]): void {
        if (_enabled) console.warn(prefix(), ...args);
    },
    error(...args: unknown[]): void {
        console.error(prefix(), ...args);
    },
};
