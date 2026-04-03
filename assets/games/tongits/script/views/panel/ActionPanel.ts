import { _decorator, Button, Component } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../../config/TongitsEvents';
import type { TongitsPlayerInfo, GameInfo } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/** 玩家游戏内操作状态（与服务端一致） */
const enum PLAYER_STATUS {
    INIT   = 1,  // 等待抽牌
    SELECT = 2,  // 已弃牌，等待他人操作
    ACTION = 3,  // 已抽牌，可出牌/弃牌/吃牌/补牌
}

/**
 * ActionPanel — 游戏进行中的操作面板
 *
 * 显示条件：roomStatus === GAME（游戏中）
 *
 * 按钮可见规则（轮到自己时才可操作）：
 *   INIT   状态：drawBtn 可见（可抽牌）
 *   ACTION 状态：meldBtn / discardBtn / layOffBtn / takeBtn / tongitsBtn 可见
 *   changeStatus 触发挑战：challengeBtn 可见
 *
 * 节点结构建议：
 *   ActionPanel
 *   ├── drawBtn       抽牌
 *   ├── meldBtn       出牌（成组）
 *   ├── discardBtn    弃牌
 *   ├── layOffBtn     补牌 / 压牌
 *   ├── takeBtn       吃牌
 *   ├── challengeBtn  挑战
 *   └── tongitsBtn    Tongits 胜利确认
 */
@ccclass('ActionPanel')
export class ActionPanel extends Component {

    @property({ type: Button, tooltip: '抽牌按钮' })
    drawBtn: Button = null!;

    @property({ type: Button, tooltip: '出牌（组合）按钮' })
    meldBtn: Button = null!;

    @property({ type: Button, tooltip: '弃牌按钮' })
    discardBtn: Button = null!;

    @property({ type: Button, tooltip: '补牌 / 压牌按钮' })
    layOffBtn: Button = null!;

    @property({ type: Button, tooltip: '吃牌按钮' })
    takeBtn: Button = null!;

    @property({ type: Button, tooltip: '挑战按钮' })
    challengeBtn: Button = null!;

    @property({ type: Button, tooltip: 'Tongits 胜利确认按钮' })
    tongitsBtn: Button = null!;

    // ── 公开方法（由 TongitsView 驱动） ──────────────────

    /**
     * 刷新操作按钮可见性。
     * @param self           本地玩家数据（含 status / isFight / changeStatus）
     * @param actionPlayerId 当前操作玩家 userId
     * @param selfUserId     本地玩家 userId
     * @param gameInfo       游戏状态（含弃牌堆，用于判断是否可吃牌）
     */
    refresh(
        self: TongitsPlayerInfo | null,
        actionPlayerId: number,
        selfUserId: number,
        gameInfo: GameInfo | null,
    ): void {
        const isMyTurn      = actionPlayerId === selfUserId;
        const status        = self?.status ?? PLAYER_STATUS.INIT;
        const isFight       = self?.isFight ?? false;
        const changeStatus  = self?.changeStatus ?? 0;
        const hasDiscard    = (gameInfo?.discardPile?.length ?? 0) > 0;

        // 抽牌：轮到自己且处于等待抽牌状态
        this._setActive(this.drawBtn,      isMyTurn && status === PLAYER_STATUS.INIT);

        // 出牌 / 弃牌 / 补牌 / 吃牌 / Tongits：轮到自己且已抽牌
        this._setActive(this.meldBtn,      isMyTurn && status === PLAYER_STATUS.ACTION);
        this._setActive(this.discardBtn,   isMyTurn && status === PLAYER_STATUS.ACTION);
        this._setActive(this.layOffBtn,    isMyTurn && status === PLAYER_STATUS.ACTION);
        this._setActive(this.takeBtn,      isMyTurn && status === PLAYER_STATUS.ACTION && hasDiscard);
        this._setActive(this.tongitsBtn,   isMyTurn && status === PLAYER_STATUS.ACTION && isFight);

        // 挑战：changeStatus 为 2(发起) / 3(接受) / 4(拒绝) 时才需要操作
        this._setActive(this.challengeBtn, changeStatus >= 2 && changeStatus <= 4);
    }

    /** 隐藏所有操作按钮（游戏结束 / 重置时调用） */
    hideAll(): void {
        [
            this.drawBtn, this.meldBtn, this.discardBtn,
            this.layOffBtn, this.takeBtn, this.challengeBtn, this.tongitsBtn,
        ].forEach(btn => this._setActive(btn, false));
    }

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.drawBtn?.node.on(Button.EventType.CLICK,      this._onDraw,      this);
        this.meldBtn?.node.on(Button.EventType.CLICK,      this._onMeld,      this);
        this.discardBtn?.node.on(Button.EventType.CLICK,   this._onDiscard,   this);
        this.layOffBtn?.node.on(Button.EventType.CLICK,    this._onLayOff,    this);
        this.takeBtn?.node.on(Button.EventType.CLICK,      this._onTake,      this);
        this.challengeBtn?.node.on(Button.EventType.CLICK, this._onChallenge, this);
        this.tongitsBtn?.node.on(Button.EventType.CLICK,   this._onTongits,   this);
    }

    protected onDestroy(): void {
        this.drawBtn?.node.off(Button.EventType.CLICK,      this._onDraw,      this);
        this.meldBtn?.node.off(Button.EventType.CLICK,      this._onMeld,      this);
        this.discardBtn?.node.off(Button.EventType.CLICK,   this._onDiscard,   this);
        this.layOffBtn?.node.off(Button.EventType.CLICK,    this._onLayOff,    this);
        this.takeBtn?.node.off(Button.EventType.CLICK,      this._onTake,      this);
        this.challengeBtn?.node.off(Button.EventType.CLICK, this._onChallenge, this);
        this.tongitsBtn?.node.off(Button.EventType.CLICK,   this._onTongits,   this);
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _setActive(btn: Button | null, active: boolean): void {
        if (btn) btn.node.active = active;
    }

    // ── 私有：按钮回调 ────────────────────────────────────
    // 复杂操作（meld/layOff/take/challenge）需要额外数据，
    // 由手牌面板或其他交互流程选完牌后再 emit，这里仅作触发入口。

    private _onDraw(): void {
        Nexus.emit(TongitsEvents.CMD_DRAW);
    }

    private _onMeld(): void {
        // 具体 cards 由 HandCardPanel 选牌后传入，此处仅触发选牌流程
        Nexus.emit(TongitsEvents.CMD_MELD, { cards: [] });
    }

    private _onDiscard(): void {
        // 具体 card 由 HandCardPanel 选牌后传入
        Nexus.emit(TongitsEvents.CMD_DISCARD, { card: 0 });
    }

    private _onLayOff(): void {
        Nexus.emit(TongitsEvents.CMD_LAY_OFF, { card: 0, targetPlayerId: 0, targetMeldId: 0 });
    }

    private _onTake(): void {
        Nexus.emit(TongitsEvents.CMD_TAKE, { cardsFromHand: [] });
    }

    private _onChallenge(): void {
        // changeStatus 2:发起挑战
        Nexus.emit(TongitsEvents.CMD_CHALLENGE, { changeStatus: 2 });
    }

    private _onTongits(): void {
        Nexus.emit(TongitsEvents.CMD_TONGITS_CLICK);
    }
}
