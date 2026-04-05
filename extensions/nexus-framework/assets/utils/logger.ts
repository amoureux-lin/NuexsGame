/**
 * Nexus 日志系统：支持全局级别过滤 + 按模块禁用。
 *
 * 级别优先级：DEBUG < INFO < WARN < ERROR < NONE
 *
 * 用法示例：
 * ```ts
 * // 初始化（GameLauncher 中）
 * setLogLevel(debug ? LogLevel.DEBUG : LogLevel.WARN);
 *
 * // 禁用某个噪音模块
 * disableLogModule('WS');
 *
 * // 框架内部使用 scope 子日志器
 * const wsLog = logger.scope('WS');
 * wsLog.debug('sending heartbeat');  // level < 当前级别时静默
 * wsLog.error('connection failed');  // ERROR 始终输出（除非 NONE）
 *
 * // 业务层直接用 logger
 * logger.info('game started');
 * ```
 */

export enum LogLevel {
    DEBUG = 0,
    INFO  = 1,
    WARN  = 2,
    ERROR = 3,
    NONE  = 4,
}

export interface ScopedLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

const ROOT_TAG = '[Nexus]';

let _level   = LogLevel.DEBUG;
let _rootTag = ROOT_TAG;
const _disabledModules = new Set<string>();

/** 设置全局日志级别。低于此级别的日志全部静默。 */
export function setLogLevel(level: LogLevel): void {
    _level = level;
}

/** 获取当前全局日志级别。 */
export function getLogLevel(): LogLevel {
    return _level;
}

/** 设置根日志前缀（默认 `[Nexus]`）。 */
export function setLogTag(tag: string): void {
    _rootTag = tag;
}

/** 禁用指定模块的日志输出（所有级别）。 */
export function disableLogModule(module: string): void {
    _disabledModules.add(module);
}

/** 重新启用指定模块的日志输出。 */
export function enableLogModule(module: string): void {
    _disabledModules.delete(module);
}

function _shouldLog(level: LogLevel, module?: string): boolean {
    if (level < _level) return false;
    if (module && _disabledModules.has(module)) return false;
    return true;
}

function _output(level: LogLevel, tag: string, args: unknown[]): void {
    switch (level) {
        case LogLevel.DEBUG: console.debug(tag, ...args); break;
        case LogLevel.INFO:  console.info(tag,  ...args); break;
        case LogLevel.WARN:  console.warn(tag,  ...args); break;
        case LogLevel.ERROR: console.error(tag, ...args); break;
    }
}

/** 全局根日志器。 */
export const logger = {
    debug(...args: unknown[]): void {
        if (_shouldLog(LogLevel.DEBUG)) _output(LogLevel.DEBUG, _rootTag, args);
    },
    info(...args: unknown[]): void {
        if (_shouldLog(LogLevel.INFO))  _output(LogLevel.INFO,  _rootTag, args);
    },
    warn(...args: unknown[]): void {
        if (_shouldLog(LogLevel.WARN))  _output(LogLevel.WARN,  _rootTag, args);
    },
    error(...args: unknown[]): void {
        if (_shouldLog(LogLevel.ERROR)) _output(LogLevel.ERROR, _rootTag, args);
    },

    /**
     * 创建带模块标签的子日志器。
     *
     * @param module 模块名，如 `'WS'`、`'UI'`、`'Audio'`
     *
     * 示例：
     * ```ts
     * const log = logger.scope('WS');
     * log.debug('connected');  // 输出：[Nexus][WS] connected
     * ```
     */
    scope(module: string): ScopedLogger {
        const tag = `${_rootTag}[${module}]`;
        return {
            debug(...args: unknown[]): void {
                if (_shouldLog(LogLevel.DEBUG, module)) _output(LogLevel.DEBUG, tag, args);
            },
            info(...args: unknown[]): void {
                if (_shouldLog(LogLevel.INFO, module))  _output(LogLevel.INFO,  tag, args);
            },
            warn(...args: unknown[]): void {
                if (_shouldLog(LogLevel.WARN, module))  _output(LogLevel.WARN,  tag, args);
            },
            error(...args: unknown[]): void {
                if (_shouldLog(LogLevel.ERROR, module)) _output(LogLevel.ERROR, tag, args);
            },
        };
    },
};

// ── 兼容旧 API ───────────────────────────────────────────────────────────────

export interface LoggerOptions {
    enabled?: boolean;
    tag?: string;
}

/** @deprecated 请改用 setLogLevel / setLogTag */
export function setLoggerOptions(options: LoggerOptions): void {
    if (options.enabled === false) setLogLevel(LogLevel.NONE);
    else if (options.enabled === true) setLogLevel(LogLevel.DEBUG);
    if (options.tag !== undefined) setLogTag(options.tag);
}
