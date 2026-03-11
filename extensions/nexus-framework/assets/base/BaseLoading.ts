import { Component, _decorator } from 'cc';

const { ccclass } = _decorator;

/**
 * Bundle Loading 面板基类，每个 Bundle 的 Loading 预制体根节点挂载继承此类的脚本。
 * 框架在显示 Loading 面板后调用 execute()，等其 resolve 后再执行场景切换。
 * Loading 组件只需专注业务逻辑，无需调用任何框架 API。
 *
 * @example
 * \@ccclass('SlotGameLoading')
 * export class SlotGameLoading extends BaseLoading {
 *     // start() 由 Cocos 驱动：播放进场动画、初始化进度条等视觉逻辑
 *     protected start(): void {
 *         this.playEnterAnimation();
 *     }
 *
 *     // execute() 由框架驱动：建连、预加载、发 join 等业务逻辑
 *     async execute(params?: Record<string, unknown>): Promise<void> {
 *         await this.connectServer();
 *         await this.joinGame(params);
 *         await this.preloadAssets();
 *         // resolve 即通知框架"准备完毕，可以切场景了"
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
}
