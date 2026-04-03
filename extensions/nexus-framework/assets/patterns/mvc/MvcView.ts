import { Component } from 'cc';
import { Nexus } from '../../core/Nexus';
import { NexusEvents } from '../../NexusEvents';

/**
 * MVC — View 基类（Component 子类）
 * 只负责 UI 展示：监听事件更新界面，用户操作通过 dispatch 转发给 Controller。
 *
 * 后台拦截机制（方案 C）：
 *   - 切后台后，listen 注册的回调被自动拦截，不触发 UI handler
 *   - Model 数据照常更新（Model 的 notify → Controller 的 handle 不受影响）
 *   - 回前台后，自动调用 onForeground()，子类在此做一次全量 UI 刷新
 */
export abstract class MvcView extends Component {

    /** 是否处于后台状态 */
    private _isBackground = false;
    /** 后台期间是否有被拦截的事件（有才需要回前台刷新） */
    private _hasPendingRefresh = false;

    /** 组件加载后注册事件。 */
    protected onLoad(): void {
        this.registerEvents();
        Nexus.on(NexusEvents.APP_HIDE, this._onAppHide, this);
        Nexus.on(NexusEvents.APP_SHOW, this._onAppShow, this);
    }

    /** 组件销毁时移除全部事件。 */
    protected onDestroy(): void {
        Nexus.offTarget(this);
    }

    /**
     * 子类在此注册所有事件监听。
     */
    protected abstract registerEvents(): void;

    /**
     * 监听全局事件，自动绑定当前 View 作为 target。
     * 后台期间自动拦截，不触发回调。
     */
    protected listen<T>(event: string, fn: (data: T) => void): void {
        const wrapped = (data: T) => {
            if (this._isBackground) {
                this._hasPendingRefresh = true;
                return;
            }
            fn.call(this, data);
        };
        Nexus.on(event, wrapped, this);
    }

    /**
     * 向事件总线发布命令，由 Controller 侧消费处理。
     */
    protected dispatch<T>(event: string, data?: T): void {
        Nexus.emit(event, data);
    }

    /**
     * 回前台时由框架自动调用。
     * 子类覆写此方法，根据 Model 当前数据做一次全量 UI 刷新。
     * 默认空实现（无需刷新的 View 不用覆写）。
     */
    protected onForeground(): void {}

    /** 是否处于后台 */
    protected get isBackground(): boolean {
        return this._isBackground;
    }

    // ── 私有 ──────────────────────────────────────────────

    private _onAppHide(): void {
        this._isBackground = true;
        this._hasPendingRefresh = false;
    }

    private _onAppShow(): void {
        this._isBackground = false;
        if (this._hasPendingRefresh) {
            this._hasPendingRefresh = false;
            this.onForeground();
        }
    }
}
