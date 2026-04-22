import { _decorator, Component, Label, ProgressBar } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { LoadingEvents, LoadingProgress, LoadingStage } from './LoadingEvents';

const { ccclass, property } = _decorator;

/**
 * Loading UI 基类，与 BaseGameEntry 通过事件解耦。
 *
 * 职责：
 *   - 订阅 LoadingEvents.PROGRESS，将"阶段内进度（0-100）"映射为全局进度条位置
 *   - update 中插值平滑进度条
 *   - 动画跑满后 emit LoadingEvents.VIEW_DONE，通知 Entry 可以收尾；同时隐藏自身
 *
 * 使用方式：
 *   将此组件（或其子类）挂到 {game}Entry.prefab 的 Loading UI 节点上，
 *   在编辑器中绑定 progressBar / tipLabel / percentLabel。
 *   子类可覆写 stageRanges 调整各阶段在全局进度条中的权重，
 *   或覆写 onStageChange / onDisplayUpdate 添加自定义动画。
 */
@ccclass('BaseLoadingView')
export class BaseLoadingView extends Component {

    @property({ type: ProgressBar, tooltip: '进度条' })
    progressBar: ProgressBar | null = null;

    @property({ type: Label, tooltip: '阶段提示文字' })
    tipLabel: Label | null = null;

    @property({ type: Label, tooltip: '百分比数字' })
    percentLabel: Label | null = null;

    @property({ tooltip: '进度条追赶速度，越大越快（建议 2-4）' })
    progressSpeed = 3;

    /**
     * 各阶段在全局进度条中的区间 [start, end]（0-100）。
     * 子类覆写以调整权重，例如资源包很大时可以把 BUNDLE_RESOURCES 区间拉宽。
     */
    protected stageRanges: Record<LoadingStage, [number, number]> = {
        [LoadingStage.COMMON_RESOURCES]: [0,   30],
        [LoadingStage.BUNDLE_RESOURCES]: [30,  70],
        [LoadingStage.CONNECTING]:       [70,  85],
        [LoadingStage.JOINING]:          [85, 100],
        [LoadingStage.DONE]:             [100, 100],
    };

    private _targetPercent = 0;
    private _displayPercent = 0;
    private _waitingDone = false;

    onLoad(): void {
        console.log("BaseLoadingView")
        if (this.progressBar) this.progressBar.progress = 0;
        if (this.tipLabel) this.tipLabel.string = '';
        if (this.percentLabel) this.percentLabel.string = '0%';
    }

    protected update(dt: number): void {
        const target = this._targetPercent / 100;
        this._displayPercent += (target - this._displayPercent) * Math.min(1, this.progressSpeed * dt);
        const clamped = Math.min(1, Math.max(0, this._displayPercent));

        if (this.progressBar?.isValid) this.progressBar.progress = clamped;
        if (this.percentLabel?.isValid) this.percentLabel.string = `${Math.round(clamped * 100)}%`;

        this.onDisplayUpdate(clamped);

        if (this._waitingDone && clamped >= 0.999) {
            this._waitingDone = false;
            // 先发事件，再隐藏；保证 Entry 能在 update 仍活跃时收到通知
            Nexus.event.emit(LoadingEvents.VIEW_DONE);
            this.node.active = false;
        }
    }

    // ── 子类钩子 ────────────────────────────────────────────

    /**
     * 阶段变化时调用（每次 PROGRESS 事件触发）。
     * 子类覆写以播放阶段切换动画、更换背景图等。
     */
    protected onStageChange(_stage: LoadingStage, _tip?: string): void {}

    /**
     * 每帧随插值进度更新时调用（clamped 为 0-1）。
     * 子类覆写以驱动粒子、光效等额外动画。
     */
    protected onDisplayUpdate(_clamped: number): void {}

    // ── 公开接口（供 BaseGameEntry 直接调用）────────────────────

    /**
     * BaseGameEntry 调用此方法推送进度，避免经过事件系统导致 @ccclass
     * 原型链无法找到子类覆写的 onStageChange。
     */
    public handleProgress({ stage, percent, tip }: LoadingProgress): void {
        const [start, end] = this.stageRanges[stage] ?? [0, 100];
        this._targetPercent = start + (percent / 100) * (end - start);

        if (stage === LoadingStage.DONE) this._waitingDone = true;
        if (tip && this.tipLabel?.isValid) this.tipLabel.string = tip;
        this.onStageChange(stage, tip);
    }
}
