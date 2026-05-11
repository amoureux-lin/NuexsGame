/** 服务器环境枚举 */
export enum NetHost {
    dev   = 'dev',
    test  = 'test',
    prod  = 'prod',
    trial = 'trial',
}

/** 各环境 HTTP 地址映射 */
const HOST_MAP: Record<NetHost, string> = {
    [NetHost.dev]:   'https://gwm.herondev.xin',
    [NetHost.test]:  'https://gwm.herontest.xin',
    [NetHost.prod]:  'https://gwm.heronpro.xin',
    [NetHost.trial]: 'https://gwm.herontrial.xin',
};

/** 各环境上报地址映射 */
const REPORT_MAP: Record<NetHost, string> = {
    [NetHost.dev]:   'https://gwbi.herondev.xin/report-client-trace',
    [NetHost.test]:  'https://gwbi.herontest.xin/report-client-trace',
    [NetHost.prod]:  'https://gwbi.heronpro.xin/report-client-trace',
    [NetHost.trial]: 'https://gwbi.herontrial.xin/report-client-trace',
};

/** 各环境 BI 上报域名映射（不含 path，具体 path 由 GameEvents 配置） */
const BI_HOST_MAP: Record<NetHost, string> = {
    [NetHost.dev]:   'https://gwbi.herondev.xin',
    [NetHost.test]:  'https://gwbi.herontest.xin',
    [NetHost.prod]:  'https://gwbi.heronpro.xin',
    [NetHost.trial]: 'https://gwbi.herontrial.xin',
};

let _resolvedKind: NetHost | null = null;

/**
 * 在 GameLauncher.gameInit() 中调用一次。
 * 解析规则：
 *  1. URL 参数 ?env=dev|test|prod|trial（优先）
 *  2. defaultKind（GameLauncher 里配置的默认值）
 */
export function initHost(defaultKind: NetHost): void {
    if (typeof location !== 'undefined') {
        const param = new URLSearchParams(location.search).get('env');
        if (param && param in NetHost) {
            _resolvedKind = param as NetHost;
            console.log(`[NetworkConfig] env from URL param: ${_resolvedKind}`);
            return;
        }
    }
    _resolvedKind = defaultKind;
    console.log(`[NetworkConfig] env from default: ${_resolvedKind}`);
}

/** 获取当前环境的 HTTP baseUrl，供 ConnectManager 使用 */
export function getResolvedHostUrl(): string {
    return HOST_MAP[_resolvedKind ?? NetHost.dev];
}

/** 获取当前环境的上报地址 */
export function getResolvedReportUrl(): string {
    return REPORT_MAP[_resolvedKind ?? NetHost.dev];
}

/** 获取当前环境的 BI 上报域名（不含 path） */
export function getResolvedBiHostUrl(): string {
    return BI_HOST_MAP[_resolvedKind ?? NetHost.dev];
}

/** 当前是否为本地 dev 调试环境（dev 环境 + 本地访问） */
export function isDebugEnv(): boolean {
    if ((_resolvedKind ?? NetHost.dev) !== NetHost.dev) return false;
    if (typeof location === 'undefined') return false;
    const host = location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
}
