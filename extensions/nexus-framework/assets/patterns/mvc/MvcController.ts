import { Nexus } from '../../core/Nexus';

/**
 * MVC — Controller 基类
 * 协调 Model 和 View：处理来自 View 的命令，调用 Model，触发结果事件。
 */
export abstract class MvcController {

    /** 创建时立即注册该 Controller 负责处理的命令。 */
    constructor() {
        this.registerCommands();
    }

    /**
     * 子类在此调用 handle() 注册所有命令处理器。
     */
    protected abstract registerCommands(): void;

    /**
     * 注册命令处理器，并将当前 Controller 绑定为 target。
     */
    protected handle<T>(event: string, handler: (data: T) => void): void {
        Nexus.on(event, handler, this);
    }

    /**
     * 启动入口，可由子类覆盖以执行初始化流程。
     */
    async start(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * 销毁并移除当前 Controller 绑定的全部事件监听。
     */
    destroy(): void {
        Nexus.offTarget(this);
    }
}
