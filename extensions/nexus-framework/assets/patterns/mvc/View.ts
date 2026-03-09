import { Component } from 'cc';
import { Nexus } from '../../core/Nexus';

/**
 * MVC — View 基类（Component 子类）
 * 只负责 UI 展示：监听事件更新界面，用户操作通过 dispatch 转发给 Controller。
 */
export abstract class View extends Component {

    /** 组件加载后注册当前 View 关心的事件。 */
    protected onLoad(): void {
        this.registerEvents();
    }

    /** 组件销毁时移除当前 View 绑定的全部全局事件。 */
    protected onDestroy(): void {
        Nexus.offTarget(this);
    }

    /**
     * 子类在此注册所有事件监听。
     */
    protected abstract registerEvents(): void;

    /**
     * 监听全局事件，并自动绑定当前 View 作为 target。
     */
    protected listen<T>(event: string, fn: (data: T) => void): void {
        Nexus.on(event, fn, this);
    }

    /**
     * 向事件总线发布命令，由 Controller 侧消费处理。
     */
    protected dispatch<T>(event: string, data?: T): void {
        Nexus.emit(event, data);
    }
}
