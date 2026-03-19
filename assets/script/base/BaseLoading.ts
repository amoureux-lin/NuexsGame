import { _decorator, AudioClip, Font, Label, Prefab, ProgressBar, sp, SpriteFrame } from 'cc';
import { Nexus, NexusBaseLoading, NexusEvents } from 'db://nexus-framework/index';

const { ccclass, property } = _decorator;

/** common 内按目录加载的配置：dir 为相对 common 根目录的目录路径，type 为资源类型（如 Prefab）。 */
export interface CommonLoadDirItem {
    dir: string;
    type?: any;
}

/** 进度分段：公共 0-20%，自定义资源 20-80%，播音乐 80-85%,/连接 80-90%，进房 90-100% */
const PROGRESS_COMMON_END = 20;
const PROGRESS_CUSTOM_END = 80;
const PROGRESS_MUSIC_END = 85;
const PROGRESS_CONNECT_END = 90;
const PROGRESS_JOIN_END = 100;
/** 进度阶段索引：0 公共资源、1 子包资源、2 播音乐、3 连接、4 进房。 */
const STAGE_COMMON = 0;
const STAGE_CUSTOM = 1;
const STAGE_MUSIC = 2;
const STAGE_CONNECT = 3;
const STAGE_JOIN = 4;

/**
 * 游戏侧 Loading 基类，模板方法 + 进度分段。
 * 流程由 onShow 启动，子类只需按需覆写：loadRes、playMusic、joinRoom。
 */
@ccclass('BaseLoading')
export abstract class BaseLoading extends NexusBaseLoading {

    @property({ type: ProgressBar, tooltip: '进度条' })
    progressBar: ProgressBar | null = null;

    @property({type: Label, tooltip: '进度文字'})
    progressLabel: Label | null = null;

    @property({type: Label, tooltip: '进度数字'})
    progressNumber: Label | null = null;

    /** 进度条向目标值追赶的速度，越大动得越快（建议 2～4）。 */
    @property({ tooltip: '进度条动画速度，越大越快' })
    progressSpeed = 3;

    /** 显示进度 0～1，每帧向 _targetPercent 插值；仅 update 中写入 progressBar。 */
    protected _displayProgress = 0;
    /** 目标进度 0～100，由 setProgress 设置。 */
    protected _targetPercent = 0;
    /** 是否已触发“进度到 100%”后的场景切换，保证只执行一次。 */
    protected _finishedTriggered = false;
    /**
     * 阶段文案数组：
     * 0：公共资源 0-20%，1：自定义资源 20-80%，2：音乐 80-85%，3：连接 85-90%，4：进房 90-100%。
     * setProgress(percent, tip) 时，根据 percent 所属分段写入对应下标的文案；
     * update 中根据当前可视进度所属分段读取对应字符串显示。
     */
    protected _stageTips: [string, string, string, string, string] = ['', '', '', '', ''];

    protected _cancelled = false;
    /** Socket 是否已连接成功（收到 NexusEvents.NET_CONNECTED 后置为 true）。 */
    protected _netConnected = false;
    /** joinRoom 是否已成功完成（由子类返回值或抛错决定）。 */
    protected _joinRoomSucceeded = false;

    private _netConnectedPromise: Promise<void> | null = null;
    private _resolveNetConnected: (() => void) | null = null;

    override onShow(params?: unknown): void {
        super.onShow(params);
        this._cancelled = false;
        // onopen 可能发生在本面板显示之前；因此首次以 isConnected() 作为兜底。
        this._netConnected = Nexus.net.isConnected();
        this._joinRoomSucceeded = false;
        this._netConnectedPromise = new Promise<void>((r) => { this._resolveNetConnected = r; });
        if (this._netConnected) this._resolveNetConnected?.();
        this._displayProgress = 0;
        this._targetPercent = 0;
        this._finishedTriggered = false;
        this._stageTips = ['', '', '', '', ''];
        // 提前监听 Socket 连接成功事件，避免事件在等待阶段之前就触发而“丢失”。
        Nexus.on(NexusEvents.NET_CONNECTED, this.onNetConnected, this);
        if (this.progressBar !== null) this.progressBar.progress = 0;
        if (this.progressLabel !== null) this.progressLabel.string = '';
        if (this.progressNumber !== null) this.progressNumber.string = '0%';
        this.setProgress(0, '');
        this.runLoading(params as Record<string, unknown> | undefined);
    }

    protected update(dt: number): void {
        const target = this._targetPercent / 100;
        const speed = this.progressSpeed * dt;
        this._displayProgress += (target - this._displayProgress) * Math.min(1, speed);
        const clamped = Math.min(1, Math.max(0, this._displayProgress));
        if (this.progressBar !== null) {
            this.progressBar.progress = clamped;
        }
        if (this.progressNumber !== null) {
            this.progressNumber.string = Math.round(clamped * 100) + '%';
        }
        // 根据当前“可视进度”所属分段显示对应阶段文案。
        if (this.progressLabel !== null) {
            const currentPercent = clamped * 100;
            let idx = STAGE_JOIN; // 默认进房段
            if (currentPercent < PROGRESS_COMMON_END) {
                idx = STAGE_COMMON;
            } else if (currentPercent < PROGRESS_CUSTOM_END) {
                idx = STAGE_CUSTOM;
            } else if (currentPercent < PROGRESS_MUSIC_END) {
                idx = STAGE_MUSIC;
            } else if (currentPercent < PROGRESS_CONNECT_END) {
                idx = STAGE_CONNECT;
            } else {
                idx = STAGE_JOIN;
            }
            this.progressLabel.string = this._stageTips[idx] ?? '';
        }
        // 主进度到 100% 时，平滑动画结束后触发场景切换与关闭 Loading（只触发一次）。
        if (!this._finishedTriggered && clamped >= 0.999) {
            // 只有“WS 已连接 + joinRoom 成功”两者同时成立，才允许 loadFinish()
            if (this._netConnected && this._joinRoomSucceeded) {
                this._finishedTriggered = true;
                Nexus.bundle.loadFinish();
            }
        }
    }

    /**
     * 进度更新通知，由子类在更新进度时调用以驱动进度条/提示文字（如 BaseLoading.setProgress 内会调此方法）。
     * 默认空实现。
     */
    protected onProgress(_percent: number, _tip?: string): void {
        // console.log('onProgress', _percent, _tip);
    }

    /**
     * 被新的 enter() 抢占时，框架在销毁本面板前调用。
     * 子类覆写以取消挂起的网络请求、移除事件监听等，防止资源泄漏。
     * 默认空实现。
     */
    onCancel(): void {
        this._cancelled = true;
        this._finishedTriggered = true;
        this._joinRoomSucceeded = false;
        // 取消时移除与本 Loading 相关的事件监听。
        Nexus.off(NexusEvents.NET_CONNECTED, this.onNetConnected, this);
        this._resolveNetConnected?.();
        this._netConnectedPromise = null;
        this._resolveNetConnected = null;
    }

    protected isCancelled(): boolean {
        return this._cancelled;
    }

    /**
     * 设置目标进度；进度条/进度数字由 update 插值更新。
     * 若传入 tip，则根据 percent 所属分段写入 _stageTips 对应下标，update 按当前进度段显示。
     */
    protected setProgress(percent: number, tip?: string): void {
        this._targetPercent = Math.min(100, Math.max(0, percent));
        if (tip !== undefined) {
            const p = this._targetPercent;
            let idx = STAGE_JOIN;
            if (p <= PROGRESS_COMMON_END) {
                idx = STAGE_COMMON;
            } else if (p <= PROGRESS_CUSTOM_END) {
                idx = STAGE_CUSTOM;
            } else if (p <= PROGRESS_MUSIC_END) {
                idx = STAGE_MUSIC;
            } else if (p <= PROGRESS_CONNECT_END) {
                idx = STAGE_CONNECT;
            } else {
                idx = STAGE_JOIN;
            }
            this._stageTips[idx] = tip;
        }
        this.onProgress(percent, tip);
    }

    /**
     * 内部流程：公共资源 → 子类资源 → 播音乐 → 进房；由 onShow 启动，不对外暴露。
     * 业务在合适时机将主进度推到 100%，进度条平滑到 100% 后由 update 自动调用 loadFinish。
     */
    private async runLoading(params?: Record<string, unknown>): Promise<void> {
        await this.loadCommonResources();
        if (this.isCancelled()) return;
        await this.loadBundlePhase(params);
        if (this.isCancelled()) return;
    }

    protected getCommonPreloadDirs(): CommonLoadDirItem[] {
        return [
            { dir: 'prefabs', type: Prefab },
            { dir: 'emojis', type: sp.SkeletonData },
            { dir: 'fonts', type: Font },
            { dir: 'audios', type: AudioClip },
            { dir: 'images', type: SpriteFrame },
        ];
    }

    /** 0-20%：按目录加载 common，进度按比例落在 0~20。 */
    protected async loadCommonResources(): Promise<void> {
        const dirs = this.getCommonPreloadDirs();
        if (dirs.length === 0) {
            this.setProgress(PROGRESS_COMMON_END);
            return;
        }
        const total = dirs.length;
        for (let i = 0; i < dirs.length; i++) {
            if (this.isCancelled()) return;
            const item = dirs[i];
            // 当前目录在“公共资源 0-20%”段中的起止区间
            const start = (i / total) * PROGRESS_COMMON_END;
            const end = ((i + 1) / total) * PROGRESS_COMMON_END;
            await Nexus.asset.loadDir('common', item.dir, item.type as any, (finished, dirTotal) => {
                const ratio = dirTotal > 0 ? finished / dirTotal : 1;
                const percent = start + ratio * (end - start);
                this.setProgress(percent, '加载公共资源...');
            });
        }
        this.setProgress(PROGRESS_COMMON_END, '加载公共资源...');
    }

    /** 20-80% loadRes → 80-85% playMusic → 85-90% 连接 → 90-100% joinRoom。 */
    private async loadBundlePhase(params?: Record<string, unknown>): Promise<void> {
        this.setProgress(PROGRESS_COMMON_END, '加载本包资源...');
        await this.loadRes(params);
        if (this.isCancelled()) return;
        this.setProgress(PROGRESS_CUSTOM_END, '资源加载完成');
        await this.playMusic();
        // 85%：音乐阶段完成后，进入“连接服务器”阶段；连接成功事件会触发进度从 85 涨到 90。
        this.setProgress(PROGRESS_MUSIC_END, '连接服务器...');
        let joinOk = false;
        try {
            joinOk = await this.joinRoom(params);
        } catch {
            joinOk = false;
        }
        this._joinRoomSucceeded = !!joinOk;
        if (this.isCancelled()) return;

        // joinRoom 未成功：不允许推进到 100%（避免“进度到 100 但未真正进房”）
        if (!this._joinRoomSucceeded) {
            this.setProgress(PROGRESS_CONNECT_END, '进房失败');
            return;
        }

        // joinRoom 成功但 WS 尚未连接：等待 WS 连接完成后再推进到 100%
        await this.waitNetConnected();
        // 两者同时成立时允许进入 100%
        this.setProgress(PROGRESS_JOIN_END, '进入游戏...');
    }

    /** 收到一次 Socket 连接成功事件：将内部状态标记为已连接，并解锁 80→85 的进度段。 */
    protected onNetConnected(): void {
        console.log('onNetConnected');
        if (this._netConnected) return;
        this._netConnected = true;
        this._resolveNetConnected?.();
        // 若当前主进度已到达“连接阶段”（85% 左右），则把目标进度提升到 90%，展示“准备进房...”。
        if (this._targetPercent >= PROGRESS_MUSIC_END && this._targetPercent < PROGRESS_CONNECT_END) {
            this.setProgress(PROGRESS_CONNECT_END, '准备进房...');
        }
    }

    /** 子类覆写：加载本 Bundle 自定义资源，进度在 20-80% 间可自行 setProgress。 */
    protected async loadRes(_params?: Record<string, unknown>): Promise<void> {
        await Promise.resolve();
    }

    /** 子类覆写：播放背景音乐等，在 80-85% 段调用。 */
    protected async playMusic(): Promise<void> {
        await Promise.resolve();
    }

    /** 子类覆写：建连、进房等，完成即 resolve，进度 85-100%。 */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<boolean> {
        await Promise.resolve();
        // 默认实现：视为“成功”（子类可覆写为真实进房成功后 resolve(true)）
        return true;
    }

    private waitNetConnected(): Promise<void> {
        if (this._netConnected) return Promise.resolve();
        if (this._netConnectedPromise) return this._netConnectedPromise;
        // 兜底：理论上 onShow 会初始化该 Promise；但为了安全，这里也提供降级逻辑
        return new Promise<void>((r) => {
            this._resolveNetConnected = r;
            this._netConnectedPromise = r ? undefined : null as any; // 仅占位，实际由上面 Promise 解析
        });
    }
}
