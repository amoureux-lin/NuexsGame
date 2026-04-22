import { _decorator } from 'cc';
import { BaseLoadingView } from 'db://assets/script/base/BaseLoadingView';
import { LoadingStage } from 'db://assets/script/base/LoadingEvents';
import {logger} from "db://nexus-framework/utils";

const { ccclass, property } = _decorator;

/**
 * Tongits 专属 Loading UI。
 *
 * Tongits 有三个子包目录（audios / font / image），BUNDLE 阶段耗时较长，
 * stageRanges 据此拉宽至 25-65%。
 *
 * 挂载位置：tongitsEntry.prefab 的 Loading UI 节点。
 * 编辑器绑定：progressBar / tipLabel / percentLabel（继承自 BaseLoadingView）。
 */
@ccclass('TongitsLoadingView')
export class TongitsLoadingView extends BaseLoadingView {

    // ── 可选：挂载游戏特有的动画节点 ──────────────────────────
    // @property(Node) cardDealAnim: Node = null!;
    // @property(Node) tableAnim: Node = null!;

    onLoad() {
        super.onLoad();
        logger.debug('TongitsLoadingView::onLoad');
    }

    /**
     * Tongits 各阶段进度区间。
     * 子包资源（音频 + 字体 + 图片）较重，BUNDLE 段分配 40% 空间。
     */
    protected override stageRanges: Record<LoadingStage, [number, number]> = {
        [LoadingStage.COMMON_RESOURCES]: [0,  25],
        [LoadingStage.BUNDLE_RESOURCES]: [25, 65],   // audios + font + image
        [LoadingStage.CONNECTING]:       [65, 80],
        [LoadingStage.JOINING]:          [80, 100],
        [LoadingStage.DONE]:             [100, 100],
    };

    /**
     * 阶段切换时调用。
     * 在此播放对应阶段的入场动画、切换背景元素等。
     */
    protected  onStageChange(stage: LoadingStage, tip?: string): void {
        console.log(`[TongitsLoadingView] ${stage}`,tip);
        // TODO: 根据 stage 播放动画
        // switch (stage) {
        //     case LoadingStage.BUNDLE_RESOURCES:
        //         this.cardDealAnim?.active = true;
        //         break;
        //     case LoadingStage.JOINING:
        //         this.tableAnim?.active = true;
        //         break;
        // }
    }

    /**
     * 每帧随插值进度更新时调用（clamped: 0-1）。
     * 在此驱动牌桌入场动效、粒子等逐帧动画。
     */
    protected override onDisplayUpdate(_clamped: number): void {
        // TODO: 例如牌桌元素随进度淡入
    }
}
