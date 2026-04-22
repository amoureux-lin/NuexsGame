import { _decorator } from 'cc';
import {BaseLoadingView} from "db://assets/script/base/BaseLoadingView";
import {LoadingStage} from "db://assets/script/base/LoadingEvents";
const { ccclass } = _decorator;

@ccclass('TongitsLoadingView')
export class TongitsLoadingView extends BaseLoadingView {

    onLoad() {
        console.log('TongitsLoadingView.onLoad');
        super.onLoad();
    }

    /**
     * Tongits 各阶段进度区间。
     * 子包资源较重（prefabs / sekleton / fonts / audios / images），BUNDLE 段分配 50%。
     */
    protected override stageRanges: Record<LoadingStage, [number, number]> = {
        [LoadingStage.COMMON_RESOURCES]: [0,  25],
        [LoadingStage.BUNDLE_RESOURCES]: [25, 80],   // prefabs + sekleton + fonts + audios + images
        [LoadingStage.CONNECTING]:       [80, 90],
        [LoadingStage.JOINING]:          [90, 100],
        [LoadingStage.DONE]:             [100, 100],
    };

    /**
     * 阶段切换时调用。
     * 在此播放对应阶段的入场动画、切换背景元素等。
     */
    protected onStageChange(stage: LoadingStage, tip?: string): void {
        // TODO: 根据 stage 播放动画
        // switch (stage) {
        //     case LoadingStage.CONNECTING:
        //         this.slotReelAnim?.active = true;
        //         break;
        // }
        super.onStageChange(stage, tip);
    }

    /**
     * 每帧随插值进度更新时调用（clamped: 0-1）。
     * 在此驱动粒子、光晕等逐帧动画。
     */
    protected override onDisplayUpdate(_clamped: number): void {
        // TODO: 例如进度条辉光强度随 clamped 变化
    }
}

