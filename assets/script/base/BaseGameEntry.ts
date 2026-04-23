import { _decorator, AudioClip, Font, Prefab, sp, SpriteFrame } from 'cc';
import { Nexus, NexusBaseEntry, NexusEvents } from 'db://nexus-framework/index';
import { ConnectManager } from 'db://assets/script/net/ConnectManager';
import { ServicePrefabs } from 'db://assets/script/config/UIConfig';
import { LoadingEvents, LoadingStage } from './LoadingEvents';
import { BaseGameEvents, type GameEnteredPayload } from './BaseGameEvents';
import { BaseLoadingView } from 'db://assets/script/base/BaseLoadingView';

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

/** joinRoom 最大重试次数（首次 + N 次重试） */
const JOIN_ROOM_MAX_RETRY = 2;

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
 *     → loadBundleResources()   子包资源（BUNDLE 阶段 30-70%）
 *     → Nexus.bundle.runScene() 场景切换
 *     → onSceneReady()          子类：向 View 注入 model 引用
 *     → waitWsConnected()       等待 WS（CONNECTING 阶段 70-85%）
 *     → joinRoomWithRetry()     进房（JOINING 阶段 85-100%）
 *     → onLoadingComplete()     子类：播放音乐等收尾
 *     → waitViewDone()          等 LoadingView 动画跑满（5s 超时兜底）
 *     → 隐藏 Entry 节点
 *   首次进房完成后监听 重连/前台恢复/网络熔断
 *
 * 子类只需覆写：onGameInit / loadBundleResources / joinRoom / onGameExit。
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

    /** 回到前台触发 resync 的最小后台时长（ms） */
    protected static readonly BACKGROUND_REFRESH_THRESHOLD = 5000;

    // ── 主流程 ────────────────────────────────────────────────

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        this._loadingView = this.getComponentInChildren(BaseLoadingView);
        await this.onGameInit(params);
        await this.loadResources(params);
        this._enteredRoom = true;
        Nexus.on(NexusEvents.NET_CONNECTED, this._onReconnected, this);
        Nexus.on<number>(NexusEvents.APP_SHOW, this._onAppForeground, this);
        Nexus.on(NexusEvents.NET_UNSTABLE, this._onNetUnstable, this);
    }

    async onExit(): Promise<void> {
        await this.onGameExit();
        await super.onExit();
    }

    protected onDestroy(): void {
        this._enteredRoom = false;
        Nexus.off(NexusEvents.NET_CONNECTED, this._onReconnected, this);
        Nexus.off<number>(NexusEvents.APP_SHOW, this._onAppForeground, this);
        Nexus.off(NexusEvents.NET_UNSTABLE, this._onNetUnstable, this);
        super.onDestroy();
    }

    // ── 加载流程 ──────────────────────────────────────────────

    private async loadResources(params?: Record<string, unknown>): Promise<void> {
        const isMock = Nexus.data.get<boolean>('mock_mode') ?? false;

        // 1. 公共资源
        this._setStage(LoadingStage.COMMON_RESOURCES, 0, '加载公共资源...');
        await this.loadCommonResources();

        // 2. 子包资源
        this._setStage(LoadingStage.BUNDLE_RESOURCES, 0, '加载游戏资源...');
        await this.loadBundleResources(params);

        // 3. 提前切场景，让 View 完成 onLoad + registerEvents
        //    Entry 节点在 runScene 后被框架隐藏，重新激活以保持 LoadingView 可见
        await Nexus.bundle.runScene();
        this.node.active = true;
        this.onSceneReady();

        // 4. 等待 WS 连接
        this._setStage(LoadingStage.CONNECTING, 0, '连接服务器...');
        if (!isMock) {
            ConnectManager.init();
            await this.waitWsConnected();
        }

        // 5. 进房
        this._setStage(LoadingStage.JOINING, 0, '加入房间...');
        if (isMock) {
            await this.mockJoinRoom(params);
        } else {
            await this.joinRoomWithRetry(params);
        }

        // 6. 子类收尾（播音乐等）
        await this.onLoadingComplete();

        // 7. 通知 LoadingView 已到终点，等其动画跑满后再隐藏
        this._setStage(LoadingStage.DONE, 100, '进入游戏...');
        await this.waitViewDone();

        this.node.active = false;
        this.enabled = false;

        // 8. 游戏画面首次呈现：通知 View 做开场展示（重连不派发，由 resyncRoom 绕开）
        Nexus.emit<GameEnteredPayload>(BaseGameEvents.GAME_ENTERED, { params });
    }

    // ── 进度通知 ──────────────────────────────────────────────

    /**
     * 在 loadBundleResources / joinRoom 内调用，更新当前阶段内的进度（0-100）。
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

    // ── joinRoom 重试 ─────────────────────────────────────────

    private async joinRoomWithRetry(params?: Record<string, unknown>): Promise<void> {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= JOIN_ROOM_MAX_RETRY; attempt++) {
            try {
                await this.joinRoom(params);
                return;
            } catch (err) {
                lastErr = err;
                console.warn(`[BaseGameEntry] joinRoom failed (attempt ${attempt + 1}/${JOIN_ROOM_MAX_RETRY + 1})`, err);
                if (attempt < JOIN_ROOM_MAX_RETRY) {
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastErr;
    }

    // ── 公共资源加载 ──────────────────────────────────────────

    /**
     * 返回 common bundle 需要按目录加载的资源列表。
     * 子类可覆写以增减目录。
     */
    protected getCommonPreloadDirs(): CommonLoadDirItem[] {
        return [
            { dir: 'prefabs',  type: Prefab },
            { dir: 'emojis',   type: sp.SkeletonData },
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
                this.setProgress(segStart + ratio * (segEnd - segStart), '加载公共资源...');
            });
        }
        this.setProgress(90, '加载配置文件...');
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
                this.setProgress(segStart + ratio * (segEnd - segStart), '加载游戏资源...');
            });
            segStart = segEnd;
        }
        this.setProgress(100, '加载游戏资源...');
    }

    /**
     * 发送进房请求并等待响应（JOINING 阶段）。
     * 失败时抛异常，基类会自动重试 JOIN_ROOM_MAX_RETRY 次。
     * 默认空实现。
     */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<void> {}

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

    private async _onReconnected(): Promise<void> {
        console.log('[BaseGameEntry] reconnected, triggering resync...');
        await this._triggerResync();
    }

    private async _onAppForeground(backgroundDuration: number): Promise<void> {
        if (backgroundDuration < (this.constructor as typeof BaseGameEntry).BACKGROUND_REFRESH_THRESHOLD) return;
        console.log(`[BaseGameEntry] foreground after ${backgroundDuration}ms, triggering resync...`);
        await this._triggerResync();
    }

    private async _triggerResync(): Promise<void> {
        if (!this._enteredRoom || this._resyncing) return;
        this._resyncing = true;
        try {
            await this.resyncRoom();
        } catch (err) {
            console.error('[BaseGameEntry] resync failed:', err);
        } finally {
            this._resyncing = false;
        }
    }

    /**
     * 发同步请求拉全量房间状态，重置 Model 并通知 View。
     * 子类应在此执行 model.freeze() → joinRoom() → model.unfreeze()。
     * 默认直接调用 joinRoom()。
     */
    protected async resyncRoom(): Promise<void> {
        await this.joinRoom();
    }
}
