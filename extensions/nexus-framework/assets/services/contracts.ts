import type { Asset, Node } from 'cc';
import { ServiceBase } from '../core/ServiceBase';

export enum UILayer {
    SCENE = 0,
    LOADING = 100,
    PANEL = 200,
    POPUP = 300,
    TIPS = 400,
    TOP = 500,
}

export interface HttpOptions {
    headers?: Record<string, string>;
    timeout?: number;
}

export interface HttpResponse<T> {
    ok: boolean;
    status: number;
    data: T;
    raw: unknown;
}

export type AssetCtor<T extends Asset> = abstract new (...args: any[]) => T;

/** UI 面板注册配置项：用于通过 registerPanels 向 UI 服务注册可用面板。 */
export interface UIPanelOptions {
    /** 预制体路径，相对于 Bundle 根目录；不含则默认使用 prefabs/<id> 规则。 */
    prefab: string;
    /** 默认层级；show() 未显式传 layer 时使用。 */
    layer?: UILayer;
    /** 覆盖加载所用的 Bundle 名；不填则使用当前 Bundle，并在失败时回退到 common。 */
    bundle?: string;
    /** 是否需要遮罩等附加语义（由业务自定义解释）。 */
    mask?: boolean;
    /** 是否单实例 / 可复用等语义（由业务自定义解释）。 */
    vacancy?: boolean;
}

export type UIPanelConfigMap = Record<string, UIPanelOptions>;

export abstract class IEventService extends ServiceBase {
    /** 注册事件监听。 */
    abstract on<T>(event: string, fn: (data: T) => void, target?: object): void;
    /** 注册一次性事件监听。 */
    abstract once<T>(event: string, fn: (data: T) => void, target?: object): void;
    /** 移除指定事件监听。 */
    abstract off<T>(event: string, fn: (data: T) => void, target?: object): void;
    /** 移除 target 绑定的全部事件监听。 */
    abstract offTarget(target: object): void;
    /** 派发事件。 */
    abstract emit<T>(event: string, data?: T): void;
    /** 判断事件是否存在监听者。 */
    abstract has(event: string): boolean;
}

export abstract class IBundleService extends ServiceBase {
    /** 加载指定 Bundle，但不切换场景。 */
    abstract load(bundleName: string): Promise<void>;
    /** 进入指定 Bundle，并执行切换流程。 */
    abstract enter(bundleName: string, params?: Record<string, unknown>): Promise<void>;
    /** 由 Loading 在“加载完成、进度到 100%”后调用，触发场景切换并关闭 Loading；不依赖 execute() 的 resolve。 */
    abstract loadFinish(): void;
    /** 退出当前 Bundle。 */
    abstract exit(bundleName: string): Promise<void>;
    /** 卸载指定 Bundle 并释放资源。 */
    abstract unload(bundleName: string): void;
    /** 判断 Bundle 是否已加载。 */
    abstract isLoaded(bundleName: string): boolean;
    /** 当前激活的 Bundle 名称。 */
    abstract get current(): string;
}

export abstract class IUIService extends ServiceBase {
    /** 注册一批 UI 面板配置，后续 show(name) / hide(name) 可直接使用 id。 */
    abstract registerPanels(config: UIPanelConfigMap): void;
    /** 反注册一批 UI 面板配置（一般在 Bundle 退出时按需调用）。可传 id 数组或 key 对象（如 lobbyUI），内部会取 value 作为 id。 */
    abstract unregisterPanels(ids: string[] | Record<string, string>): void;
    /** 显示一个 UI 面板，返回面板根节点。 */
    abstract show(name: string, params?: unknown, layer?: UILayer): Promise<Node>;
    /** 隐藏一个已显示的 UI 面板。 */
    abstract hide(name: string): void;
    /** 销毁一个已创建的 UI 面板。 */
    abstract destroy(name: string): void;
    /** 显示全局 Loading。 */
    abstract showLoading(text?: string): void;
    /** 隐藏全局 Loading。 */
    abstract hideLoading(): void;
    /** 设置 UI 根节点。 */
    abstract setRoot(root: object): void;
}

export abstract class INetService extends ServiceBase {
    /** 发起 GET 请求。 */
    abstract get<T>(path: string, options?: HttpOptions): Promise<HttpResponse<T>>;
    /** 发起 POST 请求。 */
    abstract post<T>(path: string, body?: unknown): Promise<HttpResponse<T>>;
    /** 设置 HTTP 基础地址。 */
    abstract setBaseUrl(url: string): void;
    /** 设置认证 token。 */
    abstract setToken(token: string): void;
    /** 建立 WebSocket 连接。 */
    abstract connectWs(url: string): Promise<void>;
    /** 发送 WebSocket 消息。 */
    abstract sendWs(cmd: string | number, data: unknown): void;
    /** 监听指定命令的 WebSocket 消息；传 target 时可用 offWsMsgByTarget(target) 统一解绑。 */
    abstract onWsMsg(cmd: string | number, fn: (msg: unknown) => void, target?: object): void;
    /** 移除指定命令的 WebSocket 消息监听。 */
    abstract offWsMsg(cmd: string | number, fn: (msg: unknown) => void): void;
    /** 移除该 target 下所有 WebSocket 消息监听（与事件 offTarget 一致）。 */
    abstract offWsMsgByTarget(target: object): void;
}

export abstract class IAudioService extends ServiceBase {
    /** 播放背景音乐。 */
    abstract playMusic(bundle: string, path: string, loop?: boolean): Promise<void>;
    /** 停止背景音乐。 */
    abstract stopMusic(): void;
    /** 播放音效。 */
    abstract playSfx(bundle: string, path: string): Promise<void>;
    /** 设置背景音乐音量。 */
    abstract setMusicVolume(vol: number): void;
    /** 设置音效音量。 */
    abstract setSfxVolume(vol: number): void;
    /** 开关背景音乐。 */
    abstract setMusicEnabled(on: boolean): void;
    /** 开关音效。 */
    abstract setSfxEnabled(on: boolean): void;
    /** 暂停所有音频。 */
    abstract pauseAll(): void;
    /** 恢复所有音频。 */
    abstract resumeAll(): void;
}

export abstract class IStorageService extends ServiceBase {
    /** 读取本地存储。 */
    abstract get<T>(key: string, defaultValue?: T): T | undefined;
    /** 写入本地存储。 */
    abstract set<T>(key: string, value: T): void;
    /** 删除指定 key。 */
    abstract remove(key: string): void;
    /** 判断 key 是否存在。 */
    abstract has(key: string): boolean;
    /** 清空当前命名空间下的数据。 */
    abstract clear(): void;
}

export abstract class II18nService extends ServiceBase {
    /** 翻译指定 key。 */
    abstract t(key: string, params?: Record<string, unknown>): string;
    /** 切换当前语言。 */
    abstract switchLanguage(lang: string): Promise<void>;
    /** 当前语言代码。 */
    abstract get language(): string;
}

export abstract class IAssetService extends ServiceBase {
    /** 加载单个资源。 */
    abstract load<T extends Asset>(bundle: string, path: string, type?: AssetCtor<T>): Promise<T>;
    /**
     * 加载目录下的同类资源。
     * 可选 onProgress 回调，签名与 Cocos loadDir 一致：(finished, total, item)。
     */
    abstract loadDir<T extends Asset>(
        bundle: string,
        dir: string,
        type?: AssetCtor<T>,
        onProgress?: (finished: number, total: number, item: unknown) => void,
    ): Promise<T[]>;
    /** 释放单个资源。 */
    abstract release(bundle: string, path: string): void;
    /** 释放整个 Bundle 的资源。 */
    abstract releaseBundle(bundle: string): void;
    /** 预加载一组资源路径。 */
    abstract preload(bundle: string, paths: string[]): Promise<void>;
}
