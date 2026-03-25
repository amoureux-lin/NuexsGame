import { Component, _decorator } from 'cc';
import { Nexus } from '../core/Nexus';

const { ccclass } = _decorator;

/**
 * Bundle 入口基类，每个 Bundle 的主场景根节点挂载继承此类的脚本。
 * 适用于大厅、子游戏等所有有独立主场景的 Bundle。
 *
 * @example
 * \@ccclass('SlotGameEntry')
 * export class SlotGameEntry extends NexusBaseEntry {
 *     async onEnter(params?: Record<string, unknown>): Promise<void> {
 *         await super.onEnter(params);
 *         // 子游戏初始化逻辑
 *     }
 *
 *     async onExit(): Promise<void> {
 *         // 清理逻辑
 *         await super.onExit();
 *     }
 * }
 */
@ccclass('NexusBaseEntry')
export abstract class NexusBaseEntry extends Component {

    /**
     * Bundle 进入时由 BundleService 调用，params 来自 Nexus.bundle.enter()。
     * 子类在此做初始化：注册面板、创建 MVC、显示 Loading 等。
     */
    async onEnter(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * Bundle 切换离开时由 BundleService 调用。
     * 子类在此做清理：销毁 MVC、反注册面板等。
     */
    async onExit(): Promise<void> {
        Nexus.offTarget(this);
    }

    /** 节点销毁时兜底移除当前对象绑定的全部事件监听。 */
    protected onDestroy(): void {
        Nexus.offTarget(this);
    }
}
