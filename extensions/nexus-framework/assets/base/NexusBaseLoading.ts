import { Component, _decorator } from 'cc';

const { ccclass } = _decorator;

/**
 * Bundle Loading 面板基类，每个 Bundle 的 Loading 预制体根节点挂载继承此类的脚本。
 *
 * 框架在显示 Loading 面板后调用 onShow(params)，由组件在此处完成初始化并自行启动加载流程；
 * 何时完成由业务决定（如游戏侧 BaseLoading 将主进度推到 100% 后，进度条动画到 100% 时自动调用 loadFinish）。
 * 框架不依赖 execute，只等待 loadFinish() 被调用后再切场景并销毁本面板。
 *
 * 框架调用时序：
 *   onShow(params) → 面板显示时调用，可在此初始化并启动加载流程
 *   onCancel()     → 被新的 enter() 抢占时，在销毁前调用（用于取消挂起的请求/监听）
 */
@ccclass('NexusBaseLoading')
export abstract class NexusBaseLoading extends Component {

    /**
     * 面板显示时由框架调用，可获取 enter() 传入的参数。
     * 子类在此做初始化并启动加载流程（如游戏侧 BaseLoading 在此调用 runLoading）。
     * 默认空实现，子类按需覆写。
     */
    onShow(_params?: unknown): void {}

    /**
     * 进度更新通知，由子类在更新进度时调用以驱动进度条/提示文字（如 BaseLoading.setProgress 内会调此方法）。
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
