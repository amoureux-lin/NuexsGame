import { _decorator, Button, Component, Label } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import type { CountdownHandle } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';
import { PLAYER_STATE } from 'db://assets/script/base/BaseGameModel';
import { TongitsEvents } from '../../config/TongitsEvents';
import type { TongitsPlayerInfo } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/**
 * WaitingPanel — 游戏开始前的操作面板
 *
 * readyBtn 倒计时：
 *   坐下后服务端返回 waitReadyExpiredTime（Unix 时间戳秒），
 *   按钮上显示剩余秒数，时间到未准备服务端会踢下座位。
 */
@ccclass('WaitingPanel')
export class WaitingPanel extends Component {

    @property({ type: Button, tooltip: '开始游戏按钮（仅房主可见）' })
    startGameBtn: Button = null!;

    @property({ type: Button, tooltip: '费用/底注按钮（仅房主可见）' })
    costBtn: Button = null!;

    @property({ type: Button, tooltip: '准备按钮（非房主 + 已入座 + 未准备时显示）' })
    readyBtn: Button = null!;

    @property({ type: Label, tooltip: '准备按钮上的倒计时文字' })
    readyCountdownLabel: Label = null!;

    @property({ type: Button, tooltip: '取消准备按钮（非房主 + 已入座 + 已准备时显示）' })
    cancelReadyBtn: Button = null!;

    private _countdown: CountdownHandle | null = null;

    // ── 公开方法（由 TongitsView 驱动） ──────────────────

    refresh(self: TongitsPlayerInfo | null, isOwner: boolean): void {
        const isSeated = (self?.playerInfo?.seat ?? 0) > 0;
        const isReady  = (self?.playerInfo?.state ?? 0) === PLAYER_STATE.READY;
        const expiredTime = self?.playerInfo?.waitReadyExpiredTime ?? 0;

        if (isOwner) {
            this._setActive(this.startGameBtn,   true);
            this._setActive(this.costBtn,        true);
            this._setActive(this.readyBtn,       false);
            this._setActive(this.cancelReadyBtn, false);
            this._stopCountdown();
        } else {
            this._setActive(this.startGameBtn,   false);
            this._setActive(this.costBtn,        false);
            this._setActive(this.readyBtn,       isSeated && !isReady);
            this._setActive(this.cancelReadyBtn, isSeated && isReady);

            if (isSeated && !isReady && expiredTime > 0) {
                this._startCountdown(expiredTime);
            } else {
                this._stopCountdown();
            }
        }
    }

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.startGameBtn?.node.on(Button.EventType.CLICK,   this._onStartGame,    this);
        this.costBtn?.node.on(Button.EventType.CLICK,        this._onCost,         this);
        this.readyBtn?.node.on(Button.EventType.CLICK,       this._onReady,        this);
        this.cancelReadyBtn?.node.on(Button.EventType.CLICK, this._onCancelReady,  this);
    }

    protected onDestroy(): void {
        this._stopCountdown();
        this.startGameBtn?.node.off(Button.EventType.CLICK,   this._onStartGame,   this);
        this.costBtn?.node.off(Button.EventType.CLICK,        this._onCost,        this);
        this.readyBtn?.node.off(Button.EventType.CLICK,       this._onReady,       this);
        this.cancelReadyBtn?.node.off(Button.EventType.CLICK, this._onCancelReady, this);
    }

    // ── 倒计时 ──────────────────────────────────────────

    private _startCountdown(expiredTime: number): void {
        // 避免重复创建
        if (this._countdown?.running) return;

        this._countdown = Nexus.time.createCountdown(expiredTime, {
            onTick: (remaining) => {
                if (this.readyCountdownLabel) {
                    this.readyCountdownLabel.string = `${remaining}`;
                }
            },
            onComplete: () => {
                if (this.readyCountdownLabel) {
                    this.readyCountdownLabel.string = '';
                }
                this._countdown = null;
            },
        });
    }

    private _stopCountdown(): void {
        if (this._countdown) {
            this._countdown.stop();
            this._countdown = null;
        }
        if (this.readyCountdownLabel) {
            this.readyCountdownLabel.string = '';
        }
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _setActive(btn: Button | null, active: boolean): void {
        if (btn) btn.node.active = active;
    }

    // ── 按钮回调 ─────────────────────────────────────────

    private _onStartGame(): void {
        Nexus.emit(TongitsEvents.CMD_START_GAME);
    }

    private _onCost(): void {
        // 预留：打开底注/费用设置面板
    }

    private _onReady(): void {
        Nexus.emit(GameEvents.CMD_READY, { ready: true });
    }

    private _onCancelReady(): void {
        Nexus.emit(GameEvents.CMD_READY, { ready: false });
    }
}
