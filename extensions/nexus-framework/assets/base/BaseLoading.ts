import { Component, _decorator } from 'cc';

const { ccclass } = _decorator;

/**
 * Bundle Loading 面板基类，每个 Bundle 的 Loading 预制体根节点挂载继承此类的脚本。
 * 框架在显示 Loading 面板后调用 execute()，等其 resolve 后再执行场景切换。
 * Loading 组件只需专注业务逻辑，无需调用任何框架 API。
 *
 * 框架调用时序：
 *   onShow(params)  → 面板显示时（可获取 enter 参数）
 *   execute(params) → 执行业务加载逻辑，resolve 后切场景
 *   onCancel()      → 被新的 enter() 抢占时，在销毁前调用（用于取消挂起的请求/监听）
 *
 * @example
 * \@ccclass('SlotGameLoading')
 * export class SlotGameLoading extends BaseLoading {
 *     protected start(): void { this.playEnterAnimation(); }
 *
 *     async execute(params?: Record<string, unknown>): Promise<void> {
 *         await this.connectServer();
 *         await this.joinGame(params);
 *     }
 *
 *     onProgress(percent: number, tip?: string): void {
 *         this.progressBar.progress = percent / 100;
 *     }
 *
 *     onCancel(): void {
 *         NetService.cancelPending();
 *     }
 * }
 */
@ccclass('BaseLoading')
export abstract class BaseLoading extends Component {

    /**
     * 执行本 Bundle 的加载业务逻辑（建连、预加载、发 join 等）。
     * 由 BundleService 在显示 Loading 面板后调用；完成时 resolve，失败时 reject。
     * 框架在 execute() resolve 后负责切换场景并销毁本面板。
     */
    abstract execute(params?: Record<string, unknown>): Promise<void>;

    /**
     * 面板显示时由框架调用，可获取 enter() 传入的参数（如 gameId）。
     * 默认空实现，子类按需覆写。
     */
    onShow(_params?: unknown): void {}

    /**
     * 进度更新通知，由子类自身在 execute() 中调用以驱动进度条/提示文字。
     * 框架不主动调用此方法；子类覆写后统一管理进度 UI。
     * 默认空实现。
     */
    onProgress(_percent: number, _tip?: string): void {}

    /**
     * 被新的 enter() 抢占时，框架在销毁本面板前调用。
     * 子类覆写以取消挂起的网络请求、移除事件监听等，防止资源泄漏。
     * 默认空实现。
     */
    onCancel(): void {}
}
