import { _decorator, AudioClip, Font, Node, Prefab, ProgressBar, Label, sp, SpriteFrame } from 'cc';
import { Nexus, NexusBaseEntry, NexusEvents } from 'db://nexus-framework/index';

const { ccclass, property } = _decorator;

/** 进度分段常量 */
export const PROGRESS_COMMON_END = 30;
export const PROGRESS_BUNDLE_END = 60;
export const PROGRESS_CONNECT_END = 80;
export const PROGRESS_JOIN_END = 100;
/** 显示进度追赶到该比例（0~1）后再切场景，避免进度条还没满就跳转 */
const DISPLAY_PROGRESS_COMPLETE = 0.998;

/** common 资源按目录加载的配置 */
export interface CommonLoadDirItem {
    dir: string;
    type?: any;
}

/**
 * 子游戏 Entry 基类（模板方法模式）。
 *
 * 通用流程：
 *   onEnter → onGameInit（子类注册 proto/面板、创建 MVC）
 *           → loadResources（公共资源 → bundle 资源 → 等 WS 连接 → joinRoom）
 *           → 进度条跑满 → runScene → 隐藏 Loading UI
 *
 * 子类只需覆写差异部分：onGameInit / loadBundleResources / joinRoom / onGameExit。
 */
@ccclass('BaseGameEntry')
export abstract class BaseGameEntry extends NexusBaseEntry {

    @property({ type: Node, tooltip: 'Loading 根节点，跳转场景后销毁' })
    loadingRoot: Node | null = null;

    @property({ type: ProgressBar, tooltip: '进度条' })
    progressBar: ProgressBar | null = null;

    @property({ type: Label, tooltip: '进度文字' })
    progressLabel: Label | null = null;

    @property({ type: Label, tooltip: '进度数字' })
    progressNumber: Label | null = null;

    @property({ tooltip: '进度条动画速度，越大越快' })
    progressSpeed = 3;

    private _targetPercent = 0;
    private _displayProgress = 0;
    private _waitDisplayResolve: (() => void) | null = null;
    /** 首次进房是否已完成（区分首次进房和重连） */
    private _enteredRoom = false;
    /** 是否正在 resync 中（防止并发） */
    private _resyncing = false;

    // ── 模板流程 ─────────────────────────────────────────────

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        await this.onGameInit(params);
        await this.loadResources(params);
        // 首次进房完成，开始监听重连
        this._enteredRoom = true;
        Nexus.on(NexusEvents.NET_CONNECTED, this._onReconnected, this);
    }

    /**
     * 加载资源完整流程：
     * 1. 加载公共资源 (0-30%)
     * 2. 加载游戏 bundle 资源 (30-60%)  ← 子类覆写
     * 3. 等待 WS 连接 (60-80%)
     * 4. 进房请求 (80-100%)             ← 子类覆写
     * 5. 进度条跑满 → runScene → 清理 Loading UI
     */
    protected async loadResources(params?: Record<string, unknown>): Promise<void> {
        // 1. 公共资源 0-30%
        this.setProgress(0, '加载公共资源...');
        await this.loadCommonResources();

        // 2. Bundle 资源 30-60%
        this.setProgress(PROGRESS_COMMON_END, '加载游戏资源...');
        await this.loadBundleResources(params);
        this.setProgress(PROGRESS_BUNDLE_END, '连接服务器...');

        // 3. 提前打开场景（Loading UI 仍覆盖在上层）
        //    此时 View 完成 onLoad → registerEvents，后续事件可正常接收
        await Nexus.bundle.runScene();
        // runScene 完成后框架会隐藏 Entry 节点（含 loadingRoot），重新激活保持进度条可见
        this.node.active = true;
        // 场景已就绪，通知子类向 View 注入 model 只读引用
        this.onSceneReady();

        const isMock = Nexus.data.get<boolean>('mock_mode') ?? false;

        // 4. 等待 WS 连接 60-80%（mock 模式跳过）
        if (!isMock) {
            await this.waitWsConnected();
        }
        this.setProgress(PROGRESS_CONNECT_END, '加入房间...');

        // 5. 进房 80-100%（mock 模式使用本地数据）
        if (isMock) {
            await this.mockJoinRoom(params);
        } else {
            await this.joinRoom(params);
        }
        this.setProgress(PROGRESS_JOIN_END, '进入游戏...');

        // 6. 等进度条动画跑满 → 隐藏 Entry 节点 → 清理
        await this.waitUntilDisplayComplete();
        this.node.active = false;
        this.loadingRoot?.destroy();
        this.enabled = false;
    }

    async onExit(): Promise<void> {
        await this.onGameExit();
        await super.onExit();
    }

    protected onDestroy(): void {
        this._waitDisplayResolve = null;
        this._enteredRoom = false;
        Nexus.off(NexusEvents.NET_CONNECTED, this._onReconnected, this);
        super.onDestroy();
    }

    // ── 子类覆写 ─────────────────────────────────────────────

    /**
     * 游戏初始化：注册 proto、注册 UI 面板、创建 MVC 等。
     * 在 loadResources 之前调用。
     */
    protected abstract onGameInit(params?: Record<string, unknown>): Promise<void>;

    /**
     * 加载本游戏 bundle 资源（进度 30-60%）。
     * 子类可在此 loadDir / preload，通过 setProgress 更新进度。
     * 默认空实现，无额外资源时可不覆写。
     */
    protected async loadBundleResources(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * 发送进房请求并等待响应（进度 80-100%）。
     * 子类在此发 wsRequest、处理返回数据。
     * 默认空实现，无进房需求时可不覆写。
     */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * mock 模式下的进房（?mock=true）。
     * 子类覆写以注入本地 mock 数据，跳过所有网络请求。
     * 默认空实现。
     */
    protected async mockJoinRoom(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * 游戏退出清理：销毁 MVC、反注册面板等。
     * 由 onExit 调用。
     */
    protected abstract onGameExit(): Promise<void>;

    // ── 重连同步 ───────────────────────────────────────────────

    /**
     * WS 重连成功回调。首次进房完成后才生效。
     * 自动调用 resyncRoom() 拉全量状态。
     */
    private async _onReconnected(): Promise<void> {
        if (!this._enteredRoom || this._resyncing) return;
        this._resyncing = true;
        try {
            console.log('[BaseGameEntry] reconnected, resyncing room...');
            await this.resyncRoom();
        } catch (err) {
            console.error('[BaseGameEntry] resync failed:', err);
        } finally {
            this._resyncing = false;
        }
    }

    /**
     * 子类覆写：发同步请求拉全量房间状态，用返回数据重置 Model 并通知 View。
     * 默认复用 joinRoom()，子类可覆写为更轻量的同步接口。
     */
    protected async resyncRoom(): Promise<void> {
        await this.joinRoom();
    }

    // ── 公共资源加载 ─────────────────────────────────────────

    /**
     * 返回 common bundle 需要按目录加载的资源列表。
     * 子类可覆写以增减目录。
     */
    protected getCommonPreloadDirs(): CommonLoadDirItem[] {
        return [
            { dir: 'prefabs', type: Prefab },
            { dir: 'emojis', type: sp.SkeletonData },
            { dir: 'fonts', type: Font },
            { dir: 'audios', type: AudioClip },
            { dir: 'images', type: SpriteFrame },
        ];
    }

    private async loadCommonResources(): Promise<void> {
        const dirs = this.getCommonPreloadDirs();
        if (dirs.length === 0) {
            this.setProgress(PROGRESS_COMMON_END);
            return;
        }
        for (let i = 0; i < dirs.length; i++) {
            const item = dirs[i];
            const start = (i / dirs.length) * PROGRESS_COMMON_END;
            const end = ((i + 1) / dirs.length) * PROGRESS_COMMON_END;
            await Nexus.asset.loadDir('common', item.dir, item.type as any, (finished, total) => {
                const ratio = total > 0 ? finished / total : 1;
                this.setProgress(start + ratio * (end - start), '加载公共资源...');
            });
        }
        this.setProgress(PROGRESS_COMMON_END);
    }

    // ── 等待 WS 连接 ────────────────────────────────────────

    private async waitWsConnected(): Promise<void> {
        if (Nexus.net.isConnected()) return;
        return new Promise<void>((resolve) => {
            const onConnected = () => {
                Nexus.off(NexusEvents.NET_CONNECTED, onConnected, this);
                resolve();
            };
            Nexus.on(NexusEvents.NET_CONNECTED, onConnected, this);
        });
    }

    // ── 进度条 ───────────────────────────────────────────────

    /** 设置目标进度（0-100）和提示文字。子类可在 loadBundleResources / joinRoom 中调用。 */
    protected setProgress(percent: number, tip?: string): void {
        this._targetPercent = Math.min(100, Math.max(0, percent));
        if (tip !== undefined && this.progressLabel?.isValid) {
            this.progressLabel.string = tip;
        }
    }

    protected update(dt: number): void {
        const target = this._targetPercent / 100;
        this._displayProgress += (target - this._displayProgress) * Math.min(1, this.progressSpeed * dt);
        const clamped = Math.min(1, Math.max(0, this._displayProgress));
        if (this.progressBar?.isValid) this.progressBar.progress = clamped;
        if (this.progressNumber?.isValid) this.progressNumber.string = Math.round(clamped * 100) + '%';

        if (this._waitDisplayResolve && this._targetPercent >= PROGRESS_JOIN_END && clamped >= DISPLAY_PROGRESS_COMPLETE) {
            const resolve = this._waitDisplayResolve;
            this._waitDisplayResolve = null;
            this.onComplete();
            resolve();
        }
    }

    private waitUntilDisplayComplete(): Promise<void> {
        if (this._targetPercent >= PROGRESS_JOIN_END && this._displayProgress >= DISPLAY_PROGRESS_COMPLETE) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this._waitDisplayResolve = resolve;
        });
    }

    /**
     * 场景加载完成后的钩子（runScene 返回后立即调用，View 的 onLoad/registerEvents 已执行）。
     * 子类覆写此方法向 View 注入 model 只读引用（emit MODEL_READY 事件）。
     */
    protected onSceneReady(): void {}

    /**
     * loading 100事件
     * @protected
     */
    protected onComplete(){
        console.log('[BaseGameEntry] complete');
    }
}
