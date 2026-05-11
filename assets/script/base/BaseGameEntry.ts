import { _decorator, AudioClip, Font, Prefab, sp, SpriteFrame, sys } from 'cc';
import { Nexus, NexusBaseEntry, NexusEvents } from 'db://nexus-framework/index';
import { ConnectManager } from 'db://assets/script/net/ConnectManager';
import { CommonUI, ServicePrefabs } from 'db://assets/script/config/UIConfig';
import { WebSDKBridge } from 'db://assets/script/lib/websdk/WebSDKBridge';
import { LoadingEvents, LoadingStage } from './LoadingEvents';
import { BaseGameEvents, type GameEnteredPayload } from './BaseGameEvents';
import { PLAYER_STATE, type JoinRoomData } from './BaseGameModel';
import { BaseLoadingView } from 'db://assets/script/base/BaseLoadingView';
import { ClientTraceReporter, ClientTracePhase } from 'db://assets/script/lib/report/ClientTraceReporter';
import { postClientTraceReport } from 'db://assets/script/lib/report/clientTraceReportTransport';
import { ErrorReporter } from 'db://assets/script/lib/report/ErrorReporter';
import { GameError, StateApplyError } from 'db://assets/script/base/errors';

const { ccclass } = _decorator;

/** common bundle 按目录加载的配置项 */
export interface CommonLoadDirItem {
    dir: string;
    type?: any;
    /** 进度权重，数值越大占用进度条比例越大（默认 1） */
    weight?: number;
}

/** VIEW_DONE 超时兜底时长（ms）：LoadingView 缺失或动画异常时防止 Entry 永久挂起 */
const VIEW_DONE_TIMEOUT_MS = 5000;


/**
 * 子游戏 Entry 基类（模板方法模式）。
 *
 * 与 Loading UI 完全解耦：进度通过 LoadingEvents.PROGRESS 事件广播，
 * BaseLoadingView（挂在同一 Prefab 的 UI 子节点上）负责订阅并渲染进度条。
 *
 * 加载流程：
 *   onEnter
 *     → onGameInit()            子类：注册 proto/面板、创建 MVC
 *     → loadCommonResources()   公共资源 + toast + 配置（COMMON 阶段 0-30%）
 *     → loadI18nResources()     当前语言业务翻译（I18N 阶段）
 *     → loadBundleResources()   子包资源（BUNDLE 阶段 30-70%）
 *     → Nexus.bundle.runScene(this) 场景切换
 *     → onSceneReady()          子类：向 View 注入 model 引用
 *     → waitWsConnected()       等待 WS（CONNECTING 阶段 70-85%）
 *     → joinRoomFlow()          进房（JOINING 阶段 85-100%）：fetch（带重试）+ apply
 *     → onLoadingComplete()     子类：播放音乐等收尾
 *     → waitViewDone()          等 LoadingView 动画跑满（5s 超时兜底）
 *     → 隐藏 Entry 节点
 *   首次进房完成后监听 重连/前台恢复/网络熔断
 *
 * 子类只需覆写：onGameInit / loadBundleResources / fetchJoinRoom / applyJoinRoom / onGameExit。
 * 可选覆写：mockJoinRoom / onSceneReady / onLoadingComplete / resyncRoom / onNetUnstable。
 */
@ccclass('BaseGameEntry')
export abstract class BaseGameEntry extends NexusBaseEntry {

    // ── 内部状态 ──────────────────────────────────────────────

    /** 当前正在进行的加载阶段，供 setProgress 自动绑定 */
    private _currentStage: LoadingStage = LoadingStage.COMMON_RESOURCES;
    /** 首次进房是否已完成（区分首次进房和重连） */
    private _enteredRoom = false;
    /** 是否正在 resync 中（并发锁） */
    private _resyncing = false;
    /** Loading UI 组件直接引用，避免经事件系统造成 @ccclass 原型链断裂 */
    private _loadingView: BaseLoadingView | null = null;
    /** resync 触发去抖：合并短时间内的多次重连/前台事件，避免重复请求 */
    private _resyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    /** 回到前台触发 resync 的最小后台时长（ms） */
    protected static readonly BACKGROUND_REFRESH_THRESHOLD = 5000;
    /** resync 去抖窗口（ms）：APP_SHOW + NET_CONNECTED 经常成对触发 */
    protected static readonly RESYNC_DEBOUNCE_MS = 50;

    // ── 主流程 ────────────────────────────────────────────────

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        this._loadingView = this.getComponentInChildren(BaseLoadingView);
        await this.onGameInit(params);
        // ROOM_JOINED 监听必须在 loadResources 之前注册：
        // 首次进房的 notify(ROOM_JOINED) 在 applyJoinRoom 内同步触发，晚注册就接不到。
        Nexus.on(BaseGameEvents.ROOM_JOINED, this._onRoomJoinedForReport, this);
        await this.loadResources(params);
        this._enteredRoom = true;
        // 进房成功后切换为无限重连，游戏中断线会一直尝试
        Nexus.net.setReconnectLimit(-1);
        Nexus.on(NexusEvents.APP_HIDE, this._onAppHide, this);
        Nexus.on(NexusEvents.NET_CONNECTED, this._onReconnected, this);
        Nexus.on<number>(NexusEvents.APP_SHOW, this._onAppForeground, this);
        Nexus.on(NexusEvents.NET_UNSTABLE, this._onNetUnstable, this);
        Nexus.on(BaseGameEvents.SELF_LEFT_ROOM, this._onSelfLeftRoom, this);
        Nexus.on(BaseGameEvents.SWITCH_ROOM, this._onSwitchRoom, this);
        Nexus.on(BaseGameEvents.SERVER_CLOSED, this._onServerClosed, this);
    }

    async onExit(): Promise<void> {
        // 退出游戏恢复有限重连
        Nexus.net.setReconnectLimit(3);
        await this.onGameExit();
        await super.onExit();
    }

    protected onDestroy(): void {
        this._enteredRoom = false;
        if (this._resyncDebounceTimer) {
            clearTimeout(this._resyncDebounceTimer);
            this._resyncDebounceTimer = null;
        }
        Nexus.data.set('_isBackground', false);
        Nexus.off(NexusEvents.APP_HIDE, this._onAppHide, this);
        Nexus.off(NexusEvents.NET_CONNECTED, this._onReconnected, this);
        Nexus.off<number>(NexusEvents.APP_SHOW, this._onAppForeground, this);
        Nexus.off(NexusEvents.NET_UNSTABLE, this._onNetUnstable, this);
        Nexus.off(BaseGameEvents.SELF_LEFT_ROOM, this._onSelfLeftRoom, this);
        Nexus.off(BaseGameEvents.SWITCH_ROOM, this._onSwitchRoom, this);
        Nexus.off(BaseGameEvents.SERVER_CLOSED, this._onServerClosed, this);
        Nexus.off(BaseGameEvents.ROOM_JOINED, this._onRoomJoinedForReport, this);
        super.onDestroy();
    }

    // ── 加载流程 ──────────────────────────────────────────────

    private async loadResources(params?: Record<string, unknown>): Promise<void> {
        const isMock = Nexus.data.get<boolean>('mock_mode') ?? false;
        const trace = ClientTraceReporter.getInstance();

        // ── 进房阶段标记：WsDelegate 据此决定用 loadingView 文字还是 netLoading ──
        Nexus.data.set('_entering', true);
        Nexus.data.set('_loadingView', this._loadingView);

        // ── WebSDK 状态上报：初始化 ──
        WebSDKBridge.getInstance().notifyLoadingInit();

        // ── 轨迹上报初始化 ──
        trace.setReportHandler(postClientTraceReport);
        trace.setDeviceInfoForNextReport(this._collectDeviceInfo());
        trace.startSession();

        try {
            // 1. 公共资源
            this._setStage(LoadingStage.COMMON_RESOURCES, 0, Nexus.i18n.t('loading.common'));
            await this.loadCommonResources();
            trace.step(ClientTracePhase.LOAD_RESOURCE, { ok: true, detail: 'common' });

            // 2. 当前游戏多语言
            this._setStage(LoadingStage.I18N, 0, Nexus.i18n.t('loading.i18n'));
            await this.loadI18nResources();
            this._setStage(LoadingStage.I18N, 100, Nexus.i18n.t('loading.i18n'));
            trace.step(ClientTracePhase.LOAD_RESOURCE, { ok: true, detail: 'i18n' });

            // 3. 子包资源
            this._setStage(LoadingStage.BUNDLE_RESOURCES, 0, Nexus.i18n.t('loading.bundle'));
            await this.loadBundleResources(params);
            trace.step(ClientTracePhase.LOAD_RESOURCE, { ok: true, detail: 'bundle' });

            // 4. 提前切场景，让 View 完成 onLoad + registerEvents
            //    Entry 节点在 runScene 后被框架隐藏，重新激活以保持 LoadingView 可见
            await Nexus.bundle.runScene(this);
            this.node.active = true;
            this.onSceneReady();
            trace.step(ClientTracePhase.ENTER_SCENE, { ok: true });

            // 5. 等待 WS 连接
            this._setStage(LoadingStage.CONNECTING, 0, Nexus.i18n.t('loading.connect'));
            if (!isMock) {
                ConnectManager.init();
                await this.waitWsConnected();
            }

            // 6. 进房
            this._setStage(LoadingStage.JOINING, 0, Nexus.i18n.t('loading.join'));
            if (isMock) {
                await this.mockJoinRoom(params);
            } else {
                await this.joinRoomFlow(params);
            }
            trace.step(ClientTracePhase.JOIN_ROOM, { ok: true });

            // 7. 子类收尾（播音乐等）
            await this.onLoadingComplete();

            // 8. 通知 LoadingView 已到终点，等其动画跑满后再隐藏
            this._setStage(LoadingStage.DONE, 100, Nexus.i18n.t('loading.enter'));
            await this.waitViewDone();

            this.node.active = false;
            this.enabled = false;

            // ── 轨迹上报：成功 ──
            trace.succeed();

            // ── 清除进房阶段标记 ──
            Nexus.data.set('_entering', false);
            Nexus.data.set('_loadingView', null);

            // 9. 游戏画面首次呈现：通知 View 做开场展示（重连不派发，由 resyncRoom 绕开）
            Nexus.emit<GameEnteredPayload>(BaseGameEvents.GAME_ENTERED, { params });
        } catch (err) {
            // ── 清除进房阶段标记 ──
            Nexus.data.set('_entering', false);
            Nexus.data.set('_loadingView', null);

            // ── 轨迹上报：失败 ──
            const msg = err instanceof Error ? err.message : String(err);
            trace.fail({
                category: 'load_error',
                message: msg,
            });
            throw err;
        }
    }

    // ── 进度通知 ──────────────────────────────────────────────

    /**
     * 在 loadBundleResources / fetchJoinRoom 内调用，更新当前阶段内的进度（0-100）。
     * 不需要知道全局进度区间，全局映射由 BaseLoadingView.stageRanges 决定。
     */
    protected setProgress(stagePercent: number, tip?: string): void {
        this._loadingView?.handleProgress({
            stage: this._currentStage,
            percent: Math.min(100, Math.max(0, stagePercent)),
            tip,
        });
    }

    private _setStage(stage: LoadingStage, percent: number, tip?: string): void {
        this._currentStage = stage;
        this.setProgress(percent, tip);
    }

    // ── 等待 ViewDone ─────────────────────────────────────────

    private waitViewDone(): Promise<void> {
        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                Nexus.off(LoadingEvents.VIEW_DONE, onDone, this);
                console.warn('[BaseGameEntry] waitViewDone timeout, proceeding without animation');
                resolve();
            }, VIEW_DONE_TIMEOUT_MS);

            const onDone = () => {
                clearTimeout(timer);
                Nexus.off(LoadingEvents.VIEW_DONE, onDone, this);
                resolve();
            };
            Nexus.on(LoadingEvents.VIEW_DONE, onDone, this);
        });
    }

    // ── 等待 WS 连接 ──────────────────────────────────────────

    private waitWsConnected(): Promise<void> {
        if (Nexus.net.isConnected()) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const onConnected = () => {
                Nexus.off(NexusEvents.NET_CONNECTED, onConnected, this);
                resolve();
            };
            Nexus.on(NexusEvents.NET_CONNECTED, onConnected, this);
        });
    }

    // ── joinRoom 流程 ────────────────────────────────────────
    //
    // 设计原则：
    //   1. 网络拉数据（fetchJoinRoom）和应用到 Model（applyJoinRoom）严格分离。
    //   2. 只有 fetchJoinRoom 才允许重试 —— 它是唯一可能因网络抖动而暂时失败的环节。
    //   3. applyJoinRoom 是同步纯状态变更，抛错=客户端 bug，立刻外抛，不重试。
    //   4. retry 严格按错误类型区分：
    //        - NetworkError → 限次 + 退避后重试
    //        - ProtocolError / StateApplyError → 立刻外抛，零重试
    //   5. 所有失败都会经 ErrorReporter，可观测。

    /** fetchJoinRoom 重试预算（限次，避免无限循环） */
    protected static readonly JOIN_ROOM_MAX_ATTEMPTS = 5;
    /** 退避基础时长（ms），实际等待时间为 base * 2^(attempt-1)，截断到 max */
    protected static readonly JOIN_ROOM_BASE_BACKOFF_MS = 500;
    /** 退避上限（ms），避免指数爆炸 */
    protected static readonly JOIN_ROOM_MAX_BACKOFF_MS = 8000;

    /**
     * 进房完整流程：fetch（带重试）→ apply（无重试）。
     * 由 loadResources 与默认 resyncRoom 共用。子类一般无需覆写。
     */
    protected async joinRoomFlow(params?: Record<string, unknown>): Promise<void> {
        const res = await this.fetchJoinRoomWithRetry(params);
        try {
            this.applyJoinRoom(res);
        } catch (rawErr) {
            const err = rawErr instanceof StateApplyError
                ? rawErr
                : new StateApplyError(
                    rawErr instanceof Error ? rawErr.message : 'applyJoinRoom failed',
                    rawErr,
                );
            ErrorReporter.report(err, { phase: 'apply_join_room' });
            throw err;
        }
    }

    /** 仅对网络错误重试（限次 + 指数退避）。其他类型错误立即外抛。 */
    private async fetchJoinRoomWithRetry(params?: Record<string, unknown>): Promise<unknown> {
        let attempt = 0;
        const maxAttempts = (this.constructor as typeof BaseGameEntry).JOIN_ROOM_MAX_ATTEMPTS;
        const baseBackoff = (this.constructor as typeof BaseGameEntry).JOIN_ROOM_BASE_BACKOFF_MS;
        const maxBackoff = (this.constructor as typeof BaseGameEntry).JOIN_ROOM_MAX_BACKOFF_MS;

        while (true) {
            try {
                return await this.fetchJoinRoom(params);
            } catch (rawErr) {
                attempt++;

                // 子类的 fetchJoinRoom 应当抛 GameError；万一抛了原始 throw，按状态错处理（保守不重试）
                const err: GameError = rawErr instanceof GameError
                    ? rawErr
                    : new StateApplyError(
                        rawErr instanceof Error ? rawErr.message : String(rawErr),
                        rawErr,
                    );

                // 非网络错（协议错 / 状态错）立刻外抛，零重试
                if (!err.retryable) {
                    ErrorReporter.report(err, { phase: 'fetch_join_room', attempt });
                    throw err;
                }

                // 网络错预算耗尽
                if (attempt >= maxAttempts) {
                    ErrorReporter.report(err, { phase: 'fetch_join_room', attempt, exhausted: true });
                    throw err;
                }

                console.warn(`[BaseGameEntry] fetchJoinRoom failed (attempt ${attempt}/${maxAttempts}):`, err.message);

                // 等 WS 真的恢复（已连接时立刻返回；WS 重连耗尽时此处会抛）
                await this.waitWsReconnectedOrGiveUp();

                // 指数退避，避免雪崩
                const backoff = Math.min(baseBackoff * Math.pow(2, attempt - 1), maxBackoff);
                await new Promise<void>((r) => setTimeout(r, backoff));
            }
        }
    }

    /**
     * 等待 WS 重连成功，或重连耗尽时 reject。
     * - NET_CONNECTED → resolve（WS 重连上了，可以重试 joinRoom）
     * - NET_DISCONNECTED / NET_UNSTABLE → reject（WS 彻底放弃）
     */
    /**
     * 等待 WS 重连成功，或重连耗尽时 reject。
     */
    private waitWsReconnectedOrGiveUp(): Promise<void> {
        if (Nexus.net.isConnected()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                Nexus.off(NexusEvents.NET_CONNECTED, onConnected, this);
                Nexus.off(NexusEvents.NET_DISCONNECTED, onGiveUp, this);
                Nexus.off(NexusEvents.NET_UNSTABLE, onGiveUp, this);
            };
            const onConnected = () => { cleanup(); resolve(); };
            const onGiveUp = () => { cleanup(); reject(new Error('WS reconnect exhausted')); };

            Nexus.on(NexusEvents.NET_CONNECTED, onConnected, this);
            Nexus.on(NexusEvents.NET_DISCONNECTED, onGiveUp, this);
            Nexus.on(NexusEvents.NET_UNSTABLE, onGiveUp, this);
        });
    }

    // ── 公共资源加载 ──────────────────────────────────────────

    /**
     * 返回 common bundle 需要按目录加载的资源列表。
     * 子类可覆写以增减目录。
     */
    protected getCommonPreloadDirs(): CommonLoadDirItem[] {
        return [
            { dir: 'prefabs',  type: Prefab },
            // { dir: 'emojis',   type: sp.SkeletonData },
            { dir: 'fonts',    type: Font },
            { dir: 'audios',   type: AudioClip },
            { dir: 'images',   type: SpriteFrame },
        ];
    }

    private async loadCommonResources(): Promise<void> {
        const dirs = this.getCommonPreloadDirs();
        // 预留 10% 给配置文件加载；目录均分前 90%
        const dirRatio = 0.9;
        for (let i = 0; i < dirs.length; i++) {
            const segStart = (i / dirs.length) * 100 * dirRatio;
            const segEnd   = ((i + 1) / dirs.length) * 100 * dirRatio;
            await Nexus.asset.loadDir('common', dirs[i].dir, dirs[i].type as any, (finished, total) => {
                const ratio = total > 0 ? finished / total : 1;
                this.setProgress(segStart + ratio * (segEnd - segStart), Nexus.i18n.t('loading.common'));
            });
        }
        this.setProgress(90, Nexus.i18n.t('loading.config'));
        await this.loadCommonConfigs();
        this.setProgress(100);
    }

    /**
     * 加载公共配置（toast prefab、错误码 CSV 等）。
     * 子类可覆写以追加游戏内公共配置，调用 super 保留基类行为。
     */
    protected async loadCommonConfigs(): Promise<void> {
        const notifyPrefab = await Nexus.asset.load('common', ServicePrefabs.NOTIFY, Prefab);
        Nexus.toast.setPrefab(notifyPrefab);
        try {
            await Nexus.configs.loadCSV('errorCodes', 'common', 'configs/error_codes');
        } catch (e) {
            console.warn('[BaseGameEntry] 加载 error_codes.csv 失败：', e);
        }
    }

    /** 加载当前游戏 bundle 的多语言文本。 */
    protected async loadI18nResources(): Promise<void> {
        this.setProgress(0, Nexus.i18n.t('loading.i18n'));
        await Nexus.i18n.loadCommonTranslations();
        this.setProgress(50, Nexus.i18n.t('loading.i18n'));
        await Nexus.i18n.loadBundleTranslations(this.getBundleName());
        this.setProgress(100, Nexus.i18n.t('loading.i18n'));
    }

    // ── 子类覆写（必须） ─────────────────────────────────────

    /**
     * 游戏初始化：注册 proto/面板、创建 MVC。
     * 在 loadResources 之前调用。
     */
    protected abstract onGameInit(params?: Record<string, unknown>): Promise<void>;

    /**
     * 游戏退出清理：销毁 MVC、反注册面板。
     * 由 onExit 调用。
     */
    protected abstract onGameExit(): Promise<void>;

    // ── 子类覆写（可选） ─────────────────────────────────────

    /**
     * 子游戏 bundle 名称，直接从框架读取当前激活的 bundle，无需子类覆写。
     */
    protected getBundleName(): string { return Nexus.bundle.current; }

    /**
     * 返回子游戏 bundle 需要按目录加载的资源列表。
     * 子类覆写以声明目录，加载进度由基类统一处理。
     */
    protected getBundlePreloadDirs(): CommonLoadDirItem[] { return []; }

    /**
     * 加载本游戏 bundle 资源（BUNDLE 阶段，0-100%）。
     * 各目录按 weight 分配进度区间（默认 1），资源多的目录可设更大权重使进度更平滑。
     * 子类一般不需要覆写此方法，只需覆写 getBundlePreloadDirs 即可。
     */
    protected async loadBundleResources(_params?: Record<string, unknown>): Promise<void> {
        const bundleName = this.getBundleName();
        const dirs = this.getBundlePreloadDirs();
        if (dirs.length === 0) return;

        const weights = dirs.map(d => d.weight ?? 1);
        const totalWeight = weights.reduce((a, b) => a + b, 0);

        let segStart = 0;
        for (let i = 0; i < dirs.length; i++) {
            const segEnd = segStart + (weights[i] / totalWeight) * 100;
            await Nexus.asset.loadDir(bundleName, dirs[i].dir, dirs[i].type as any, (finished, total) => {
                const ratio = total > 0 ? finished / total : 1;
                this.setProgress(segStart + ratio * (segEnd - segStart), Nexus.i18n.t('loading.bundle'));
            });
            segStart = segEnd;
        }
        this.setProgress(100, Nexus.i18n.t('loading.bundle'));
    }

    /**
     * 网络层：发送进房请求并返回响应。
     * 子类必须实现。失败时抛 NetworkError（可重试）或 ProtocolError（不重试）—
     * 推荐用 errors.ts 的 classifyWsError(rawErr) 把 wsRequest 抛出统一归类。
     *
     * 注意：此方法不应做任何"应用响应到 Model"的副作用（那部分放 applyJoinRoom）。
     */
    protected async fetchJoinRoom(_params?: Record<string, unknown>): Promise<unknown> {
        throw new Error('fetchJoinRoom() must be implemented by subclass');
    }

    /**
     * 状态层：把进房响应应用到 Model。
     * 子类必须实现。同步执行，抛错 = 客户端 bug，会被 retry 层视作 StateApplyError 立刻外抛。
     *
     * 注意：此方法不应有任何网络 IO。
     */
    protected applyJoinRoom(_res: unknown): void {
        throw new Error('applyJoinRoom() must be implemented by subclass');
    }

    /**
     * mock 模式下的进房（?mock=true），跳过所有网络请求。
     * 默认空实现。
     */
    protected async mockJoinRoom(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * 进房完成、进度到 100% 之前的收尾钩子。
     * 子类在此播放背景音乐等。
     * 默认空实现。
     */
    protected async onLoadingComplete(): Promise<void> {}

    /**
     * runScene 完成后调用，View 的 onLoad/registerEvents 已执行。
     * 子类在此向 View 注入 model 只读引用（emit MODEL_READY）。
     * 默认空实现。
     */
    protected onSceneReady(): void {}

    // ── 设备信息采集 ───────────────────────────────────────────

    private _collectDeviceInfo(): Record<string, unknown> {
        const info: Record<string, unknown> = {
            sys_os: sys.os,
            sys_osVersion: sys.osVersion,
            sys_osMainVersion: sys.osMainVersion,
            sys_browserType: sys.browserType,
            sys_browserVersion: sys.browserVersion,
            sys_language: sys.language,
            sys_platform: sys.platform,
            sys_isMobile: sys.isMobile,
            sys_isNative: sys.isNative,
            sys_isBrowser: sys.isBrowser,
        };
        if (typeof navigator !== 'undefined') {
            info.navigator_userAgent = navigator.userAgent;
            info.navigator_language = navigator.language;
        }
        if (typeof window !== 'undefined') {
            info.window_innerWidth = window.innerWidth;
            info.window_innerHeight = window.innerHeight;
            info.window_devicePixelRatio = window.devicePixelRatio;
        }
        return info;
    }

    // ── 房间事件 ──────────────────────────────────────────────

    /**
     * 自己被踢/离开房间广播。
     * reason: 1=主动退出 2=预约离开执行 3=被踢
     * 弹窗提示后通知平台退出游戏。
     */
    private _onSelfLeftRoom(data: { reason: number }): void {
        console.warn('[BaseGameEntry] SELF_LEFT_ROOM, reason:', data.reason);
        const isKicked = data.reason === 3;
        const msgKey = isKicked ? 'room.kicked' : 'room.left';
        Nexus.ui.show(CommonUI.ALERT, {
            content: Nexus.i18n.t(msgKey),
            onConfirm: () => { WebSDKBridge.getInstance().requestPlatformExit(); },
        });
    }

    /**
     * 换房广播：收到新 roomId，重新走 joinRoom 流程。
     */
    private async _onSwitchRoom(data: { roomId: number }): Promise<void> {
        console.log('[BaseGameEntry] SWITCH_ROOM, roomId:', data.roomId);
        Nexus.data.set('room_id', data.roomId);
        await this._triggerResync();
    }

    /**
     * 进房完成后给平台同步三件事（首次 + 每次 resync / 换房都会触发）：
     *   1. 当前 roomId（换房后让平台知道新房间）；
     *   2. 自己的预约动作按钮态（即使无预约也要发 0，让平台清掉旧高亮）；
     *   3. 自己当前是否在牌局中（state === GAME 时上报，带座位号供平台展示）。
     * 用 self.playerInfo.state 而不是 roomInfo.roomStatus，是为了区分观战者
     * （观战所在房间在 GAME 状态，但自己并未在牌局中）。
     */
    private _onRoomJoinedForReport(data: JoinRoomData<any, any>): void {
        const bridge = WebSDKBridge.getInstance();
        const roomId = data?.roomInfo?.roomId ?? '';
        bridge.notifyJoinRoom(roomId);
        const selfInfo = data?.self?.playerInfo;
        bridge.notifyPendingActionChanged(selfInfo?.activePendingAction ?? 0);
        if (selfInfo?.state === PLAYER_STATE.GAME) {
            bridge.notifyGameInProgress(selfInfo.seat);
        }
    }

    /**
     * 服务器关闭广播：弹窗提示后通知平台退出游戏。
     */
    private _onServerClosed(): void {
        console.warn('[BaseGameEntry] SERVER_CLOSED');
        Nexus.ui.show(CommonUI.ALERT, {
            content: Nexus.i18n.t('loading.server_closed'),
            onConfirm: () => { WebSDKBridge.getInstance().requestPlatformExit(); },
        });
    }

    // ── 网络事件 ──────────────────────────────────────────────

    private _onNetUnstable(): void {
        console.warn('[BaseGameEntry] NET_UNSTABLE triggered');
        this.onNetUnstable();
    }

    /**
     * 网络频繁断连熔断后的处理。
     * 默认空实现，子类可弹"网络不稳定"提示或强制退回大厅。
     */
    protected onNetUnstable(): void {}

    private _onAppHide(): void {
        Nexus.data.set('_isBackground', true);
    }

    private _onReconnected(): void {
        console.log('[BaseGameEntry] reconnected, scheduling resync...');
        this._scheduleResync();
    }

    private _onAppForeground(backgroundDuration: number): void {
        Nexus.data.set('_isBackground', false);
        if (backgroundDuration < (this.constructor as typeof BaseGameEntry).BACKGROUND_REFRESH_THRESHOLD) return;
        console.log(`[BaseGameEntry] foreground after ${backgroundDuration}ms, scheduling resync...`);
        this._scheduleResync();
    }

    /**
     * 去抖调度 resync：合并短窗口内的多次触发（APP_SHOW + NET_CONNECTED 经常成对触发）。
     * 不直接 await —— 事件回调本身不该阻塞。
     */
    private _scheduleResync(): void {
        if (!this._enteredRoom) return;
        const debounceMs = (this.constructor as typeof BaseGameEntry).RESYNC_DEBOUNCE_MS;
        if (this._resyncDebounceTimer) clearTimeout(this._resyncDebounceTimer);
        this._resyncDebounceTimer = setTimeout(() => {
            this._resyncDebounceTimer = null;
            void this._triggerResync();
        }, debounceMs);
    }

    private async _triggerResync(): Promise<void> {
        if (!this._enteredRoom || this._resyncing) return;
        this._resyncing = true;
        try {
            // 确保 WS 已连接再同步，切后台太久 WS 可能已断
            if (!Nexus.net.isConnected()) {
                console.log('[BaseGameEntry] WS not connected, waiting before resync...');
                await this.waitWsConnected();
            }
            await this.resyncRoom();
        } catch (err) {
            // 走 ErrorReporter 而不是裸 console.error，便于上线后追踪
            ErrorReporter.report(err, { phase: 'resync' });
        } finally {
            this._resyncing = false;
        }
    }

    /**
     * 发同步请求拉全量房间状态，重置 Model 并通知 View。
     * 子类应在此执行 model.freeze() → super.resyncRoom() → model.unfreeze()。
     * 默认直接走 joinRoomFlow（fetch + apply）。
     */
    protected async resyncRoom(): Promise<void> {
        await this.joinRoomFlow();
    }
}
