import { _decorator, Node } from 'cc';
import { BaseLoadingView } from 'db://assets/script/base/BaseLoadingView';
import { LoadingStage } from 'db://assets/script/base/LoadingEvents';

const { ccclass, property } = _decorator;

/**
 * Lobby 专属 Loading UI。
 *
 * Lobby 当前无子包资源（loadBundleResources 为空），
 * 主要耗时在公共资源加载，stageRanges 拉宽 COMMON 区间。
 *
 * 挂载位置：lobbyEntry.prefab 的 Loading UI 节点。
 * 编辑器绑定：progressBar / tipLabel / percentLabel（继承自 BaseLoadingView）。
 */
@ccclass('LobbyLoadingView')
export class LobbyLoadingView extends BaseLoadingView {

    // ── 可选：挂载大厅特有的动画节点 ──────────────────────────
    // @property(Node) logoAnim: Node = null!;

    /**
     * Lobby 各阶段进度区间。
     * 无子包资源，BUNDLE 段极短；公共资源较重，分配更多前段空间。
     */
    protected override stageRanges: Record<LoadingStage, [number, number]> = {
        [LoadingStage.COMMON_RESOURCES]: [0,  45],
        [LoadingStage.BUNDLE_RESOURCES]: [45, 50],   // 当前无资源，几乎瞬过
        [LoadingStage.CONNECTING]:       [50, 75],
        [LoadingStage.JOINING]:          [75, 100],
        [LoadingStage.DONE]:             [100, 100],
    };

    /**
     * 阶段切换时调用。
     * 在此播放 Logo 动画、背景切换等。
     */
    protected override onStageChange(stage: LoadingStage, tip?: string): void {
        // TODO: 根据 stage 播放动画
        // switch (stage) {
        //     case LoadingStage.COMMON_RESOURCES:
        //         this.logoAnim?.active = true;
        //         break;
        // }
    }

    /**
     * 每帧随插值进度更新时调用（clamped: 0-1）。
     * 在此驱动 Logo 淡入、背景粒子等逐帧动画。
     */
    protected override onDisplayUpdate(_clamped: number): void {
        // TODO: 例如 Logo 随进度缩放入场
    }
}
