/**
 * ChallengeResponsePanel — 挑战响应面板（本地玩家专用）
 *
 * 固定在 bottom 区域，覆盖在手牌区上方显示。
 * 展示内容：
 *   - 自己当前手牌点数
 *   - 独立倒计时（endTimestamp 驱动，与 PlayerSeat 倒计时无关）
 *   - Challenge 按钮（接受挑战）
 *   - Fold 按钮（折牌）
 *
 * 节点结构（编辑器中搭建）：
 *   ChallengeResponsePanel
 *   ├── challengeBtn   ← Button，点击接受挑战
 *   ├── foldBtn        ← Button，点击折牌
 *   ├── pointsLabel    ← Label，显示自己手牌点数
 *   └── countdownLabel ← Label，倒计时剩余秒数
 */

import { _decorator, Button, Component, Label, Sprite } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('ChallengeResponsePanel')
export class ChallengeResponsePanel extends Component {

    // ── Inspector 绑定 ────────────────────────────────────

    @property({ type: Button, tooltip: '接受挑战按钮' })
    challengeBtn: Button | null = null;

    @property({ type: Button, tooltip: '折牌按钮' })
    foldBtn: Button | null = null;

    @property({ type: Label, tooltip: '自己当前手牌点数文本' })
    pointsLabel: Label | null = null;

    @property({ type: Sprite, tooltip: '倒计时filled图'})
    countdownSprite: Sprite | null = null;

    @property({ type: Label, tooltip: '倒计时剩余秒数文本' })
    countdownLabel: Label | null = null;

    // ── 对外回调（由 FightPanel 赋值） ──────────────────────

    /** 点击 Challenge 按钮后触发 */
    onChallenge: (() => void) | null = null;
    /** 点击 Fold 按钮后触发 */
    onFold: (() => void) | null = null;

    // ── 私有状态 ──────────────────────────────────────────

    /** 倒计时结束的 Unix 时间戳（ms） */
    private _endTimestamp: number = 0;
    /** 倒计时总时长（秒），用于计算 fillRange 比例 */
    private _totalDuration: number = 1;
    /** 倒计时是否运行中 */
    private _countdownRunning: boolean = false;

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        this.challengeBtn?.node.on(Button.EventType.CLICK, this._onChallengeClick, this);
        this.foldBtn?.node.on(Button.EventType.CLICK,      this._onFoldClick,      this);
        // 面板默认隐藏
        this.node.active = false;
    }

    protected onDestroy(): void {
        this.challengeBtn?.node.off(Button.EventType.CLICK, this._onChallengeClick, this);
        this.foldBtn?.node.off(Button.EventType.CLICK,      this._onFoldClick,      this);
    }

    protected update(_dt: number): void {
        if (!this._countdownRunning) return;
        const remaining = Math.max(0, (this._endTimestamp - Date.now()) / 1000);
        if (this.countdownLabel) {
            this.countdownLabel.string = String(Math.ceil(remaining));
        }
        if (this.countdownSprite) {
            this.countdownSprite.fillRange = remaining / this._totalDuration;
        }
        if (remaining <= 0) {
            this._countdownRunning = false;
        }
    }

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 显示响应面板并启动倒计时。
     * @param points       自己当前手牌点数
     * @param endTimestamp 倒计时结束的 Unix 时间戳（ms）
     */
    show(points: number, endTimestamp: number): void {
        this.node.active = true;
        if (this.pointsLabel) this.pointsLabel.string = String(points);

        this._endTimestamp     = endTimestamp;
        this._totalDuration    = Math.max(1, (endTimestamp - Date.now()) / 1000);
        this._countdownRunning = endTimestamp > Date.now();

        // 立即刷新一次，防止首帧显示上一次残留值
        const remaining = Math.max(0, (endTimestamp - Date.now()) / 1000);
        if (this.countdownLabel) {
            this.countdownLabel.string = String(Math.ceil(remaining));
        }
        if (this.countdownSprite) {
            this.countdownSprite.fillRange = 1;
        }
    }

    /** 隐藏面板并停止倒计时 */
    hide(): void {
        this.node.active       = false;
        this._countdownRunning = false;
        if (this.countdownSprite) {
            this.countdownSprite.fillRange = 1;
        }
    }

    // ── 私有 ──────────────────────────────────────────────

    private _onChallengeClick(): void {
        this.onChallenge?.();
    }

    private _onFoldClick(): void {
        this.onFold?.();
    }
}
