import { _decorator, Button, Component } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';
import { PLAYER_STATE } from 'db://assets/script/base/BaseGameModel';
import { TongitsEvents } from '../../config/TongitsEvents';
import type { TongitsPlayerInfo } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/**
 * WaitingPanel — 游戏开始前的操作面板
 *
 * 按钮显示规则：
 *   房主
 *     ├── startGameBtn  显示
 *     └── costBtn       显示
 *   非房主 + 未入座      → 全部隐藏
 *   非房主 + 已入座 + 未准备 → readyBtn 显示
 *   非房主 + 已入座 + 已准备 → cancelReadyBtn 显示
 *
 * 节点结构建议：
 *   WaitingPanel
 *   ├── startGameBtn    (Button) 开始游戏
 *   ├── costBtn         (Button) 费用/底注设置
 *   ├── readyBtn        (Button) 准备
 *   └── cancelReadyBtn  (Button) 取消准备
 */
@ccclass('WaitingPanel')
export class WaitingPanel extends Component {

    @property({ type: Button, tooltip: '开始游戏按钮（仅房主可见）' })
    startGameBtn: Button = null!;

    @property({ type: Button, tooltip: '费用/底注按钮（仅房主可见）' })
    costBtn: Button = null!;

    @property({ type: Button, tooltip: '准备按钮（非房主 + 已入座 + 未准备时显示）' })
    readyBtn: Button = null!;

    @property({ type: Button, tooltip: '取消准备按钮（非房主 + 已入座 + 已准备时显示）' })
    cancelReadyBtn: Button = null!;

    // ── 公开方法（由 TongitsView 驱动） ──────────────────

    /**
     * 刷新面板按钮可见性。
     * @param self    本地玩家数据（null 表示纯旁观者）
     * @param isOwner 本地玩家是否为房主
     */
    refresh(self: TongitsPlayerInfo | null, isOwner: boolean): void {
        const isSeated = (self?.playerInfo?.seat ?? 0) > 0;
        const isReady  = (self?.playerInfo?.state ?? 0) === PLAYER_STATE.READY;

        if (isOwner) {
            // 房主：显示开始游戏 + 费用按钮，隐藏准备相关
            this._setActive(this.startGameBtn,   true);
            this._setActive(this.costBtn,        true);
            this._setActive(this.readyBtn,       false);
            this._setActive(this.cancelReadyBtn, false);
        } else {
            // 非房主：隐藏房主按钮
            this._setActive(this.startGameBtn,   false);
            this._setActive(this.costBtn,        false);
            // 未入座：全隐藏；入座后根据准备状态切换
            this._setActive(this.readyBtn,       isSeated && !isReady);
            this._setActive(this.cancelReadyBtn, isSeated && isReady);
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
        this.startGameBtn?.node.off(Button.EventType.CLICK,   this._onStartGame,   this);
        this.costBtn?.node.off(Button.EventType.CLICK,        this._onCost,        this);
        this.readyBtn?.node.off(Button.EventType.CLICK,       this._onReady,       this);
        this.cancelReadyBtn?.node.off(Button.EventType.CLICK, this._onCancelReady, this);
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _setActive(btn: Button | null, active: boolean): void {
        if (btn) btn.node.active = active;
    }

    // ── 私有：按钮回调 ────────────────────────────────────

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
