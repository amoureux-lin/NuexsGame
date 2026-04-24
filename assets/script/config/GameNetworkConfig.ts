/** 服务器环境枚举 */
export enum GameNetworkHostKind {
    dev   = 'dev',
    test  = 'test',
    prod  = 'prod',
    trial = 'trial',
}

/** 各环境 HTTP 地址映射 */
const HOST_MAP: Record<GameNetworkHostKind, string> = {
    [GameNetworkHostKind.dev]:   'https://gwm.herondev.xin',
    [GameNetworkHostKind.test]:  'https://gwm.herontest.xin',
    [GameNetworkHostKind.prod]:  'https://gwm.heronpro.xin',
    [GameNetworkHostKind.trial]: 'https://gwm.herontrial.xin',
};

/** 各环境上报地址映射 */
const REPORT_MAP: Record<GameNetworkHostKind, string> = {
    [GameNetworkHostKind.dev]:   'https://gwbi.herondev.xin/report-client-trace',
    [GameNetworkHostKind.test]:  'https://gwbi.herontest.xin/report-client-trace',
    [GameNetworkHostKind.prod]:  'https://gwbi.heronpro.xin/report-client-trace',
    [GameNetworkHostKind.trial]: 'https://gwbi.herontrial.xin/report-client-trace',
};

let _resolvedKind: GameNetworkHostKind | null = null;

/**
 * 在 GameLauncher.gameInit() 中调用一次。
 * 解析规则：
 *  1. URL 参数 ?env=dev|test|prod|trial（优先）
 *  2. defaultKind（GameLauncher 里配置的默认值）
 */
export function initHostKind(defaultKind: GameNetworkHostKind): void {
    if (typeof location !== 'undefined') {
        const param = new URLSearchParams(location.search).get('env');
        if (param && param in GameNetworkHostKind) {
            _resolvedKind = param as GameNetworkHostKind;
            console.log(`[GameNetworkConfig] env from URL param: ${_resolvedKind}`);
            return;
        }
    }
    _resolvedKind = defaultKind;
    console.log(`[GameNetworkConfig] env from default: ${_resolvedKind}`);
}

/** 获取当前环境的 HTTP baseUrl，供 ConnectManager 使用 */
export function getResolvedHostUrl(): string {
    return HOST_MAP[_resolvedKind ?? GameNetworkHostKind.dev];
}

/** 获取当前环境的上报地址 */
export function getResolvedReportUrl(): string {
    return REPORT_MAP[_resolvedKind ?? GameNetworkHostKind.dev];
}

/** 当前是否为非生产环境（需要 generateToken） */
export function isDebugEnv(): boolean {
    return (_resolvedKind ?? GameNetworkHostKind.dev) !== GameNetworkHostKind.prod;
}
