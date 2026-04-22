import { _decorator, Node } from 'cc';
import { BaseLoadingView } from 'db://assets/script/base/BaseLoadingView';
import { LoadingStage } from 'db://assets/script/base/LoadingEvents';

const { ccclass, property } = _decorator;

/**
 * SlotGame 专属 Loading UI。
 *
 * SlotGame 当前无子包资源（loadBundleResources 为空），
 * 主要耗时在公共资源加载和网络连接，stageRanges 据此拉宽 CONNECTING/JOINING 区间。
 *
 * 挂载位置：slotGameEntry.prefab 的 Loading UI 节点。
 * 编辑器绑定：progressBar / tipLabel / percentLabel（继承自 BaseLoadingView）。
 */
@ccclass('SlotGameLoadingView')
export class SlotGameLoadingView extends BaseLoadingView {

    // ── 可选：挂载游戏特有的动画节点 ──────────────────────────
    // @property(Node) slotReelAnim: Node = null!;

    /**
     * SlotGame 各阶段进度区间。
     * 无子包资源，BUNDLE 段极短；网络阶段较重，分配更多进度空间。
     */
    protected override stageRanges: Record<LoadingStage, [number, number]> = {
        [LoadingStage.COMMON_RESOURCES]: [0,  35],
        [LoadingStage.BUNDLE_RESOURCES]: [35, 40],   // 当前无资源，几乎瞬过
        [LoadingStage.CONNECTING]:       [40, 70],
        [LoadingStage.JOINING]:          [70, 100],
        [LoadingStage.DONE]:             [100, 100],
    };

    /**
     * 阶段切换时调用。
     * 在此播放对应阶段的入场动画、切换背景元素等。
     */
    protected override onStageChange(stage: LoadingStage, tip?: string): void {
        // TODO: 根据 stage 播放动画
        // switch (stage) {
        //     case LoadingStage.CONNECTING:
        //         this.slotReelAnim?.active = true;
        //         break;
        // }
    }

    /**
     * 每帧随插值进度更新时调用（clamped: 0-1）。
     * 在此驱动粒子、光晕等逐帧动画。
     */
    protected override onDisplayUpdate(_clamped: number): void {
        // TODO: 例如进度条辉光强度随 clamped 变化
    }
}
