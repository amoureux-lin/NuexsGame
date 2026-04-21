import type { Asset, Node, Prefab } from 'cc';
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
    /** 失败后重试次数（默认 0，不重试） */
    retry?: number;
    /** 重试间隔毫秒（默认 1000，每次翻倍） */
    retryDelay?: number;
}

/** WebSocket 增强配置（initWs 时传入） */
export interface WsConfig {
    /** -1 永久重连，0 不自动重连，>0 重试次数 */
    autoReconnect?: number;
    /** 重连间隔毫秒 */
    reconnectDelayMs?: number;
    /** 单次请求超时毫秒 */
    requestTimeoutMs?: number;
    /** 心跳间隔毫秒 */
    heartbeatIntervalMs?: number;
    /** 多久未收包主动断开毫秒 */
    receiveTimeoutMs?: number;
    /** wsRequest 失败后重试次数（默认 0，不重试） */
    requestRetry?: number;
    /** wsRequest 重试间隔毫秒（默认 1000，每次翻倍） */
    requestRetryDelay?: number;
}

/**
 * WS 收包上下文：随每条消息一起传给 handler，携带消息到达时的元信息。
 * handler 不关心时可直接忽略第二参数。
 */
export interface WsMsgCtx {
    /** JS 处理该消息时 app 是否仍在后台（_backgroundAt > 0 表示仍在后台） */
    isBackground: boolean;
    /** JS 实际处理该消息的时间戳（ms） */
    processedAt: number;
    /** 消息类型 */
    msgType: string | number;
}

/** 发包上下文：贯穿整条发送链，willSend 可修改 body / extra */
export interface WsSendContext {
    readonly msgType: number;
    /** 0 = 单向通知（不需要响应），>0 = 请求（需要响应） */
    readonly requestId: number;
    /** willSend 可修改 body（例如加密、包装） */
    body: unknown;
    /** 追加公共字段（token、version、traceId 等），encode 时读取写入 header */
    extra: Record<string, unknown>;
}

/** 包头结构（16 字节：length, msgType, requestId, errorCode） */
export interface PacketHeader {
    length: number;
    msgType: number;
    requestId: number;
    errorCode: number;
}

/** 解码后的 WS 包（由各游戏的协议决定如何解析） */
export interface DecodedPacket {
    msgType: number;
    requestId: number;
    /** 可选：服务端错误码；没有错误码概念则不填 */
    errorCode?: number;
    body: unknown;
}

/**
 * WS 委托接口：协议编解码 + 收发拦截 + 连接状态感知，统一由业务实现。
 * 框架通过此接口与业务协议完全解耦。
 */
export interface IWsDelegate {
    // ── Codec ─────────────────────────────────────────────────────────────

    /**
     * 编码：将发包上下文序列化为可发送的字节。
     * ctx.requestId === 0 为单向通知，> 0 为需要响应的请求。
     * 可读取 ctx.extra 中由 willSend 追加的公共字段写入自定义 header。
     */
    encode(ctx: WsSendContext): Uint8Array;

    /**
     * 解码：将收到的原始数据（二进制或文本）解析为结构化包。
     * 业务自行定义 header 格式，框架不感知。
     * 无法解析时返回 null，框架丢弃该包。
     */
    decode(data: Uint8Array | string): DecodedPacket | null;

    /**
     * 心跳包：返回已编码好的字节，框架直接 ws.send()。
     * 返回 null 表示不启用心跳。
     */
    heartbeat(): Uint8Array | null;

    // ── 发包拦截 ───────────────────────────────────────────────────────────

    /**
     * 发包前回调：可修改 ctx.body 或往 ctx.extra 追加公共字段（token、version 等）。
     * 在 encode 之前调用。
     */
    willSend?(ctx: WsSendContext): void;

    // ── 收包拦截 ───────────────────────────────────────────────────────────

    /**
     * 收到任意包后、分发前调用，由业务决定如何处理。
     * 返回 true  = 静默拦截，不 dispatch 也不 reject pending（适合心跳、系统通知）。
     * 返回 Error = 拦截并 reject 对应的 wsRequest Promise（适合服务端错误码）。
     * 返回 void  = 继续正常流程（resolvePending + dispatch）。
     */
    willReceive?(pkt: DecodedPacket): true | Error | void;

    // ── 连接状态回调 ────────────────────────────────────────────────────────

    /** 连接建立成功 */
    onConnected?(): void;
    /** 连接断开 */
    onDisconnected?(): void;
    /**
     * 正在重连；attemptsLeft 为剩余次数，0 表示不再重连。
     * -1 永久重连时传入 -1。
     */
    onReconnecting?(attemptsLeft: number): void;
    /** 连接发生错误 */
    onConnectError?(error: unknown): void;
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
    /** 是否需要遮罩（默认 false）。为 true 时框架自动在面板前创建全屏半透明遮罩。 */
    mask?: boolean;
    /** 遮罩颜色，十六进制 RRGGBBAA（默认 '000000AA'）。 */
    maskColor?: string;
    /** 点击遮罩是否关闭面板（默认 false，仅拦截穿透）。 */
    maskClose?: boolean;
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
    /** 由 Entry 在加载完成后主动调用，加载并切换到当前 Bundle 的主场景。 */
    abstract runScene(): Promise<void>;
    /** @deprecated 已废弃，无需调用。 */
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
    /**
     * 将面板加载到指定父节点下（而非全局 Layer）。
     * 适用于需要挂载在场景内特定节点的面板（如游戏内局部弹层）。
     * hide / destroy 仍通过 name 调用，生命周期与 show() 完全一致。
     */
    abstract showInNode(name: string, parentNode: Node, params?: unknown): Promise<Node>;
    /** 隐藏一个已显示的 UI 面板。 */
    abstract hide(name: string): Promise<void>;
    /** 销毁一个已创建的 UI 面板。 */
    abstract destroy(name: string): Promise<void>;
    /** 显示全局 Loading，透传 text 参数给面板组件的 onShow。 */
    abstract showLoading(text?: string): void;
    /** 隐藏全局 Loading。 */
    abstract hideLoading(): Promise<void>;
    /** 设置 UI 根节点。 */
    abstract setRoot(root: object): void;
    /** 获取指定层级的容器节点。 */
    abstract getLayerNode(layer: UILayer): Node;
    /**
     * 指定用于 showLoading/hideLoading 的面板 key（需已通过 registerPanels 注册）。
     * 未设置时 showLoading/hideLoading 无效并打印警告。
     */
    abstract setLoadingPanel(name: string): void;
    /**
     * 指定用于遮罩的面板 key（需已通过 registerPanels 注册）。
     * mask: true 的面板 show 时会加载此 prefab 作为遮罩。
     */
    abstract setMaskPanel(name: string): void;

    /**
     * 显示面板并将其名称推入导航栈。
     * 适用于多层嵌套的面板流程（如：主界面 → 背包 → 物品详情）。
     */
    abstract showWithStack(name: string, params?: unknown, layer?: UILayer): Promise<Node>;
    /**
     * 关闭栈顶面板，并将上一个面板重新显示。
     * 若栈为空则无操作。
     */
    abstract back(): Promise<void>;
    /** 清空导航栈并关闭所有栈内面板。 */
    abstract clearStack(): Promise<void>;
}

export abstract class INetService extends ServiceBase {
    /** 发起 GET 请求，成功时 resolve 仅返回响应体 data。 */
    abstract get<T>(path: string, options?: HttpOptions): Promise<T>;
    /** 发起 POST 请求，成功时 resolve 仅返回响应体 data。 */
    abstract post<T>(path: string, body?: unknown, options?: HttpOptions): Promise<T>;
    /** 设置 HTTP 基础地址。 */
    abstract setBaseUrl(url: string): void;
    /** 设置认证 token。 */
    abstract setToken(token: string): void;
    /** 建立 WebSocket 连接。 */
    abstract connectWs(url: string): Promise<void>;
    /** 发送 WebSocket 消息（单向，不关心响应）。 */
    abstract sendWs(cmd: string | number, data: unknown): void;
    /** 监听指定命令的 WebSocket 消息；传 target 时可用 offWsMsgByTarget(target) 统一解绑。 */
    abstract onWsMsg(cmd: string | number, fn: (msg: unknown, ctx: WsMsgCtx) => void, target?: object): void;
    /** 移除指定命令的 WebSocket 消息监听。 */
    abstract offWsMsg(cmd: string | number, fn: (msg: unknown, ctx: WsMsgCtx) => void): void;
    /** 移除该 target 下所有 WebSocket 消息监听（与事件 offTarget 一致）。 */
    abstract offWsMsgByTarget(target: object): void;

    /** 初始化 WS：传入配置与委托实现（编解码 + 拦截 + 状态感知）。 */
    abstract initWs(config: WsConfig, delegate: IWsDelegate): void;
    /** 一发一收的 WS 请求（带 requestId、超时、错误码处理）；需先 initWs。 */
    abstract wsRequest<T = unknown>(msgType: number, body: unknown, timeoutMs?: number): Promise<T>;
    /** 当前 WebSocket 是否已连接。 */
    abstract isConnected(): boolean;
    /** 取消所有进行中的 HTTP 请求（abort XHR）。 */
    abstract cancelAllHttpRequests(): void;
    /** 取消所有等待响应的 WS 请求（reject pending promises）。 */
    abstract cancelAllWsRequests(reason?: string): void;
    /**
     * 模拟收到一条 WS 服务端消息，直接走 dispatch 流程。
     * 仅供开发测试使用（MockView）。
     */
    simulateWsReceive?(msgType: string | number, data: unknown): void;
    /**
     * 注册 Mock 请求拦截器：wsRequest 发包前先检查此表，
     * 有对应 handler 则直接以其返回值 resolve Promise，完全不走真实 WS。
     * 仅供开发测试使用（MockView）。
     */
    registerMockHandler?(msgType: number, handler: (body: unknown) => unknown | Promise<unknown>): void;
    /** 移除 Mock 请求拦截器。仅供开发测试使用（MockView）。 */
    unregisterMockHandler?(msgType: number): void;
}

export abstract class IAudioService extends ServiceBase {
    /** 播放背景音乐，自动从当前 bundle 查找，失败 fallback 到 common。 */
    abstract playMusic(path: string, loop?: boolean): Promise<void>;
    /** 停止背景音乐。 */
    abstract stopMusic(): void;
    /** 播放音效，自动从当前 bundle 查找，失败 fallback 到 common。 */
    abstract playSfx(path: string): Promise<void>;
    /** 播放指定 bundle 的背景音乐。 */
    abstract playMusicByBundle(bundle: string, path: string, loop?: boolean): Promise<void>;
    /** 播放指定 bundle 的音效。 */
    abstract playSfxByBundle(bundle: string, path: string): Promise<void>;
    /** 设置背景音乐音量。 */
    abstract setMusicVolume(vol: number): void;
    /** 设置音效音量。 */
    abstract setSfxVolume(vol: number): void;
    /** 获取当前背景音乐音量。 */
    abstract getMusicVolume(): number;
    /** 获取当前音效音量。 */
    abstract getSfxVolume(): number;
    /** 开关背景音乐。 */
    abstract setMusicEnabled(on: boolean): void;
    /** 开关音效。 */
    abstract setSfxEnabled(on: boolean): void;
    /** 背景音乐是否开启。 */
    abstract isMusicEnabled(): boolean;
    /** 音效是否开启。 */
    abstract isSfxEnabled(): boolean;
    /** 背景音乐是否正在播放。 */
    abstract isMusicPlaying(): boolean;
    /**
     * 淡出当前 BGM 再淡入新 BGM（无缝切换）。
     * @param path 音频资源路径
     * @param fadeDuration 淡出+淡入各自的时长（秒），默认 0.5
     * @param loop 是否循环，默认 true
     */
    abstract playMusicFade(path: string, fadeDuration?: number, loop?: boolean): Promise<void>;
    /**
     * 淡出并停止当前背景音乐。
     * @param fadeDuration 淡出时长（秒），默认 0.5
     */
    abstract stopMusicFade(fadeDuration?: number): Promise<void>;
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

/**
 * 轻量数据存储：纯内存，不写入 Nexus.storage。
 * 用于运行时全局数据（如 user_id、serverTime、token），进程内共享。
 */
export abstract class IDataStoreService extends ServiceBase {
    abstract get<T>(key: string, defaultValue?: T): T | undefined;
    abstract set<T>(key: string, value: T): void;
    abstract remove(key: string): void;
    abstract has(key: string): boolean;
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
    /**
     * 加载远程 URL 资源（图片、音频等）。
     * 底层使用 assetManager.loadRemote，结果不归属任何 Bundle，需手动释放。
     * @param url 完整资源地址
     * @param options 可选参数，如 { ext: '.png' } 指定扩展名
     */
    abstract loadRemote<T extends Asset>(url: string, options?: Record<string, unknown>): Promise<T>;
}

// ── 对象池 ──────────────────────────────────────────────────────────────────

export abstract class IObjectPoolService extends ServiceBase {
    /**
     * 从池中取一个节点，池为空时若传入 prefab 则 instantiate 新节点，否则返回 null。
     * 取出的节点 active 已设为 true。
     */
    abstract get(key: string, prefab?: Prefab): Node | null;
    /**
     * 将节点归还到池。框架自动设置 active = false 并 removeFromParent。
     */
    abstract put(key: string, node: Node): void;
    /**
     * 预热：提前 instantiate 指定数量的节点存入池。
     */
    abstract preload(key: string, prefab: Prefab, count: number): Promise<void>;
    /** 返回指定 key 的当前池中节点数量。 */
    abstract size(key: string): number;
    /** 销毁指定 key 下所有池节点。 */
    abstract clear(key: string): void;
    /** 销毁全部池节点。 */
    abstract clearAll(): void;
}

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * 配置服务：运行时加载并缓存 CSV / JSON 配置文件。
 *
 * 典型用法：
 *   // 游戏启动时加载
 *   await Nexus.configs.loadCSV('errorCodes', 'common', 'configs/error_codes');
 *   // 业务使用
 *   const rows = Nexus.configs.getCSVRows('errorCodes');
 */
export abstract class IConfigService extends ServiceBase {
    /**
     * 加载 CSV 配置并以 key 缓存。
     * @param key    缓存标识
     * @param bundle Cocos Bundle 名称
     * @param path   Bundle 内的资源路径（不含扩展名）
     */
    abstract loadCSV(key: string, bundle: string, path: string): Promise<void>;

    /**
     * 加载 JSON 配置并以 key 缓存。
     * @param key    缓存标识
     * @param bundle Cocos Bundle 名称
     * @param path   Bundle 内的资源路径（不含扩展名）
     */
    abstract loadJSON<T = unknown>(key: string, bundle: string, path: string): Promise<void>;

    /**
     * 获取已加载的 CSV 数据（每行为一个对象，key 为表头列名）。
     * 未加载时返回空数组。
     */
    abstract getCSVRows(key: string): Record<string, string>[];

    /**
     * 获取已加载的 JSON 数据。
     * 未加载时返回 undefined。
     */
    abstract getJSON<T = unknown>(key: string): T | undefined;

    /** 指定 key 的配置是否已加载。 */
    abstract isLoaded(key: string): boolean;

    /**
     * 清除缓存。
     * @param key 指定 key 则只清除该条；省略则清除全部。
     */
    abstract clear(key?: string): void;
}

// ── Toast ────────────────────────────────────────────────────────────────────

export type ToastType = 'info' | 'success' | 'error' | 'warn';

/** Toast 显示位置。 */
export type ToastPosition = 'top' | 'center' | 'bottom';

/** 单次 show 调用的可选参数。 */
export interface ToastShowOptions {
    /** 显示时长（ms）；省略时按类型使用默认值（info/success: 2000，warn: 2500，error: 3000）。 */
    duration?: number;
    /** 显示位置，默认 'top'（居中偏上）。 */
    position?: ToastPosition;
    /** 图标 SpriteFrame；省略或 null 时不显示图标。 */
    icon?: import('cc').SpriteFrame;
}

/** Toast 全局配置，通过 configure() 设置。 */
export interface ToastConfig {
    /** 最大并发显示数量；超出后立即加速淡出最旧的一条，默认 5。 */
    maxCount?: number;
    /**
     * 各位置的基准 Y 坐标（相对于 TOP 层容器中心，单位 px）。
     * 默认：{ top: 380, center: 0, bottom: -380 }。
     */
    positionY?: Partial<Record<ToastPosition, number>>;
}

export abstract class IToastService extends ServiceBase {
    /**
     * 设置 Toast 使用的 Prefab（首次 show 前调用）。
     * Prefab 根节点需挂载继承自 ToastItem 的组件。
     */
    abstract setPrefab(prefab: import('cc').Prefab): void;
    /** 全局配置（可随时调用，增量合并）。 */
    abstract configure(config: ToastConfig): void;
    /** 普通提示。 */
    abstract show(msg: string, options?: ToastShowOptions): void;
    /** 成功提示。 */
    abstract success(msg: string, options?: ToastShowOptions): void;
    /** 错误提示（默认 3s）。 */
    abstract error(msg: string, options?: ToastShowOptions): void;
    /** 警告提示。 */
    abstract warn(msg: string, options?: ToastShowOptions): void;
}
