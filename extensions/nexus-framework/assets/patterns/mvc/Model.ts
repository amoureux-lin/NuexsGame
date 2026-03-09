import { Nexus } from '../../core/Nexus';

/**
 * MVC — Model 基类
 * 负责数据存储与业务规则，通过事件总线通知 View 更新。
 */
export abstract class Model {

    /**
     * 向事件总线发布数据变更通知。
     */
    protected notify<T>(event: string, data?: T): void {
        Nexus.emit(event, data);
    }

    /**
     * 子类可覆盖以清理资源或解除外部引用。
     */
    destroy(): void {}
}
