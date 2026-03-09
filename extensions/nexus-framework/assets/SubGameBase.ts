import { Component, _decorator } from 'cc';
import { Nexus } from './core/Nexus';

const { ccclass } = _decorator;

/**
 * 子游戏入口基类，每个子游戏的入口场景根节点挂载继承此类的脚本。
 *
 * @example
 * \@ccclass('SlotGameEntry')
 * export class SlotGameEntry extends SubGameBase {
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
@ccclass('SubGameBase')
export abstract class SubGameBase extends Component {

    /**
     * Bundle 切换进入时由 BundleService 调用。
     */
    async onEnter(_params?: Record<string, unknown>): Promise<void> {}

    /**
     * Bundle 切换离开时由 BundleService 调用。
     */
    async onExit(): Promise<void> {
        Nexus.offTarget(this);
    }

    /** 节点销毁时兜底移除当前对象绑定的全部事件监听。 */
    protected onDestroy(): void {
        Nexus.offTarget(this);
    }
}
