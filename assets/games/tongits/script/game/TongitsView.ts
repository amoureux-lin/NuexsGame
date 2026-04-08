import { _decorator,Node } from 'cc';
import { BaseGameView } from 'db://assets/script/base/BaseGameView';
import { Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import { PlayerSeatManager } from '../views/player/PlayerSeatManager';
import { WaitingPanel } from '../views/panel/WaitingPanel';
import { ActionPanel } from '../views/panel/ActionPanel';
import { HandCardPanel } from '../views/handcard/HandCardPanel';
import type { ButtonStates } from '../utils/HandCardState';
import type {
    TongitsPlayerInfo,
    GameInfo,
    GameStartBroadcast,
    ActionChangeBroadcast,
    DrawCardBroadcast,
    MeldCardBroadcast,
    LayOffCardBroadcast,
    DiscardCardBroadcast,
    TakeCardBroadcast,
    ChallengeBroadcast,
    PKBroadcast,
    BeforeResultBroadcast,
    GameResultBroadcast,
    RoomResetBroadcast,
    JoinRoomRes,
    GameResultDetailsRes,
} from '../proto/tongits';
import {GameEvents} from "db://assets/script/config/GameEvents";
import {GameStartEffect} from "db://assets/games/tongits/script/views/effect/GameStartEffect";

const { ccclass, property } = _decorator;

/**
 * TongitsView — Tongits 主场景视图
 *
 * 职责：
 *   - 继承 BaseGameView，registerGameEvents() 注册 Tongits 特有事件
 *   - 实现所有 on* 回调刷新 UI，协调 PlayerSeatManager 更新座位
 *   - 提供 dispatch 快捷方法供子节点 UI 调用
 *   - 挂到 tongitsMain.scene 根节点，Inspector 中拖入各子组件
 */
@ccclass('TongitsView')
export class TongitsView extends BaseGameView<TongitsPlayerInfo, GameInfo> {

    // ── 子组件引用（Inspector 中拖入） ──────────────────────

    /** 座位管理器 */
    @property({ type: PlayerSeatManager, tooltip: '座位管理器组件' })
    seatManager: PlayerSeatManager = null!;

    /** 游戏前操作面板（准备/开始游戏） */
    @property({ type: WaitingPanel, tooltip: '游戏开始前面板' })
    waitingPanel: WaitingPanel = null!;

    /** 游戏中操作面板（抽牌/出牌等） */
    @property({ type: ActionPanel, tooltip: '游戏进行中面板' })
    actionPanel: ActionPanel = null!;

    /** 本地玩家手牌区（底部），仅自己可见发牌动画 */
    @property({ type: HandCardPanel, tooltip: '本地玩家手牌区组件' })
    handCardPanel: HandCardPanel = null!;

    @property({ type: GameStartEffect, tooltip: '游戏开始动画控制器' })
    gameStartEffect: GameStartEffect = null!;

    @property({ type: Node,tooltip:"牌桌上摸牌与弃牌区域"})
    tableArea:Node = null!;

    // ── 缓存本地状态 ─────────────────────────────────────

    private _selfUserId: number = 0;
    private _players: TongitsPlayerInfo[] = [];
    private _gameInfo: GameInfo | null = null;
    private _isLocalOwner: boolean = false;
    private _isGameStarted: boolean = false;
    /** 发牌动画进行中，此期间拦截操作按钮刷新 */
    private _isDealing: boolean = false;
    /** 手牌状态机最新的按钮可用状态 */
    private _handButtons: ButtonStates | null = null;

    protected onLoad() {
        super.onLoad();
        this.tableArea.active = false;
    }

    // ── 事件注册 ─────────────────────────────────────────

    protected override registerGameEvents(): void {
        if (this.handCardPanel) {
            // 合并完成、展开前 → 显示所有按钮（禁用状态）
            this.handCardPanel.onDealMergeComplete = () => {
                this._isDealing = false;
                this.actionPanel?.showAll();
                this._refreshActionPanel();
            };
            // 手牌选中状态变化 → 实时更新按钮可交互状态
            this.handCardPanel.onSelectionChange = (info) => {
                this._handButtons = info.buttons;
                if (!this._isDealing) this._refreshActionPanel();
            };
        }
        // 本地手牌操作命令（不经过服务器）
        Nexus.on(TongitsEvents.CMD_GROUP,   this._onCmdGroup,   this);
        Nexus.on(TongitsEvents.CMD_UNGROUP, this._onCmdUngroup, this);

        this.listen<GameStartBroadcast>(TongitsEvents.GAME_START,       (d) => this.onGameStart(d));
        this.listen<ActionChangeBroadcast>(TongitsEvents.ACTION_CHANGE, (d) => this.onActionChange(d));
        this.listen<DrawCardBroadcast>(TongitsEvents.DRAW,              (d) => this.onDraw(d));
        this.listen<MeldCardBroadcast>(TongitsEvents.MELD,              (d) => this.onMeld(d));
        this.listen<LayOffCardBroadcast>(TongitsEvents.LAY_OFF,         (d) => this.onLayOff(d));
        this.listen<DiscardCardBroadcast>(TongitsEvents.DISCARD,        (d) => this.onDiscard(d));
        this.listen<TakeCardBroadcast>(TongitsEvents.TAKE,              (d) => this.onTake(d));
        this.listen<ChallengeBroadcast>(TongitsEvents.CHALLENGE,        (d) => this.onChallenge(d));
        this.listen<PKBroadcast>(TongitsEvents.PK,                      (d) => this.onPK(d));
        this.listen<BeforeResultBroadcast>(TongitsEvents.BEFORE_RESULT, (d) => this.onBeforeResult(d));
        this.listen<GameResultBroadcast>(TongitsEvents.GAME_RESULT,     (d) => this.onGameResult(d));
        this.listen<RoomResetBroadcast>(TongitsEvents.ROOM_RESET,       (d) => this.onRoomReset(d));
        this.listen<GameResultDetailsRes>(TongitsEvents.RESULT_DETAILS, (d) => this.onResultDetails(d));
    }


    protected openMock(){
        this.dispatch(TongitsEvents.CMD_OPEN_MOCK);
    }

    // ── Model → View 事件回调 ─────────────────────────────

    protected onRoomJoined(data: JoinRoomRes): void {
        this._selfUserId = data.self?.playerInfo?.userId ?? 0;
        this._players = data.players ?? [];
        this._gameInfo = (data.gameInfo as GameInfo) ?? null;
        this._isLocalOwner = (data.self?.playerInfo?.post ?? 0) === 1;
        this._isGameStarted = false;
        this.seatManager?.setContext(this._isLocalOwner, false);
        this._refreshAllSeats();
        // 面板：游戏前显示，游戏中隐藏
        if (this.waitingPanel) this.waitingPanel.node.active = true;
        if (this.actionPanel) this.actionPanel.node.active = false;
        this.waitingPanel?.refresh(data.self ?? null, this._isLocalOwner);
        // 重连/中途加入：若游戏已在进行则立即显示自己手牌（无动画）
        if (this._gameInfo) {
            const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._selfUserId);
            this.handCardPanel?.showCards(selfPlayer?.handCards ?? []);
        }
    }

    protected onPlayersUpdated(players: TongitsPlayerInfo[]): void {
        this._players = players;
        this._refreshAllSeats();
    }

    protected onGameInfoUpdated(gameInfo: GameInfo): void {
        this._gameInfo = gameInfo;
    }

    protected onSelfUpdated(self: TongitsPlayerInfo): void {
        const newIsOwner = (self.playerInfo?.post ?? 0) === 1;
        if (newIsOwner !== this._isLocalOwner) {
            this._isLocalOwner = newIsOwner;
            this.seatManager?.setContext(this._isLocalOwner, this._isGameStarted);
        }
        const idx = this._players.findIndex(p => p.playerInfo?.userId === self.playerInfo?.userId);
        if (idx >= 0) {
            this._players = [
                ...this._players.slice(0, idx),
                self,
                ...this._players.slice(idx + 1),
            ];
        }
        this._refreshAllSeats();
        // 准备状态变化时刷新 WaitingPanel
        if (!this._isGameStarted) {
            this.waitingPanel?.refresh(self, this._isLocalOwner);
        }
    }

    protected onGameStart(data: GameStartBroadcast): void {
        console.log('onGameStart', data);
        this._isGameStarted = true;
        this.seatManager?.setContext(this._isLocalOwner, true);
        if (data.players) {
            this._players = data.players;
            this._refreshAllSeats();
        }
        if (this.waitingPanel) this.waitingPanel.node.active = false;
        if (this.actionPanel) this.actionPanel.node.active = true;
        this.actionPanel?.hideAll();

        // GameStart 带的 gameInfo 包含初始 actionPlayerId，缓存备用
        if (data.gameInfo) this._gameInfo = data.gameInfo as GameInfo;

        // 标记发牌中，拦截期间的 ActionChange 按钮刷新
        this._isDealing = true;

        const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._selfUserId);
        const potAmount = (data.gameInfo?.betAmount ?? 0)
            * (data.gameInfo?.pot?.base ?? 1);
        const avatarPositions = this.seatManager?.getAvatarWorldPositions() ?? [];

        // 开场动画 → 发牌 → 发牌完成后刷新操作按钮
        this.gameStartEffect?.playSequence(
            avatarPositions,
            potAmount,
            () => {
                this.tableArea.active = true;
                this.handCardPanel?.dealCards(
                    selfPlayer?.handCards ?? [],
                    data.gameInfo?.deckCardCount ?? 0,
                );
            },
        );
    }

    protected onActionChange(data: ActionChangeBroadcast): void {
        this.seatManager?.updateActionPlayer(data.actionPlayerId);
        this.seatManager?.updateCountdown(data.actionPlayerId, data.countdown);
        if (!this._isDealing) this._refreshActionPanel();
    }

    protected onDraw(data: DrawCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        // 自己抽牌：drawnCard 有值时追加到手牌区
        if (data.userId === this._selfUserId && data.drawnCard) {
            this.handCardPanel?.addCard(data.drawnCard);
        }
    }

    protected onMeld(data: MeldCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
    }

    protected onLayOff(data: LayOffCardBroadcast): void {
        this._syncPlayerField(data.actionPlayerId, { handCardCount: data.handCardCount });
    }

    protected onDiscard(data: DiscardCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        // 自己出牌：从手牌区移除对应节点
        if (data.userId === this._selfUserId && data.discardedCard) {
            this.handCardPanel?.removeCard(data.discardedCard);
        }
    }

    protected onTake(data: TakeCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
    }

    protected onChallenge(_data: ChallengeBroadcast): void {
        this._refreshAllSeats();
    }

    protected onPK(_data: PKBroadcast): void {
        this._refreshAllSeats();
    }

    protected onBeforeResult(data: BeforeResultBroadcast): void {
        if (data.players) {
            this._players = data.players;
            this._refreshAllSeats();
        }
    }

    protected onGameResult(_data: GameResultBroadcast): void {
        this.seatManager?.updateActionPlayer(0);
        this.actionPanel?.hideAll();
    }

    protected onRoomReset(data: RoomResetBroadcast): void {
        this._isDealing = false;
        this._isGameStarted = false;
        this.seatManager?.setContext(this._isLocalOwner, false);
        if (data.players) this._players = data.players;
        this.seatManager?.updateActionPlayer(0);
        this._refreshAllSeats();
        // 回到等待状态
        if (this.waitingPanel) this.waitingPanel.node.active = true;
        if (this.actionPanel) this.actionPanel.node.active = false;
        const self = this._players.find(p => p.playerInfo?.userId === this._selfUserId) ?? null;
        this.waitingPanel?.refresh(self, this._isLocalOwner);
        this.handCardPanel?.clear();
    }

    protected onResultDetails(_data: GameResultDetailsRes): void {
        // 留给结算详情面板处理
    }

    // ── View → Controller 命令（由 UI 事件调用） ─────────

    protected draw(): void { this.dispatch(TongitsEvents.CMD_DRAW); }
    protected meld(cards: number[]): void { this.dispatch(TongitsEvents.CMD_MELD, { cards }); }
    protected layOff(card: number, targetPlayerId: number, targetMeldId: number): void {
        this.dispatch(TongitsEvents.CMD_LAY_OFF, { card, targetPlayerId, targetMeldId });
    }
    protected discard(card: number): void { this.dispatch(TongitsEvents.CMD_DISCARD, { card }); }
    protected take(cardsFromHand: number[]): void { this.dispatch(TongitsEvents.CMD_TAKE, { cardsFromHand }); }
    protected challenge(changeStatus: number): void { this.dispatch(TongitsEvents.CMD_CHALLENGE, { changeStatus }); }
    protected startGame(): void { this.dispatch(TongitsEvents.CMD_START_GAME); }
    protected tongitsClick(): void { this.dispatch(TongitsEvents.CMD_TONGITS_CLICK); }
    protected resultDetails(): void { this.dispatch(TongitsEvents.CMD_RESULT_DETAILS); }
    // openSettings() / backLobby() 继承自 BaseGameView

    // ── 生命周期 ─────────────────────────────────────────

    protected onDestroy(): void {
        Nexus.off(TongitsEvents.CMD_GROUP,   this._onCmdGroup,   this);
        Nexus.off(TongitsEvents.CMD_UNGROUP, this._onCmdUngroup, this);
    }

    // ── 私有：本地手牌命令 ────────────────────────────────

    private _onCmdGroup(): void {
        this.handCardPanel?.onGroupBtn();
    }

    private _onCmdUngroup(): void {
        this.handCardPanel?.onUngroupBtn();
    }

    /** 用当前缓存状态刷新 ActionPanel 的可交互状态 */
    private _refreshActionPanel(): void {
        const self = this._players.find(p => p.playerInfo?.userId === this._selfUserId) ?? null;
        this.actionPanel?.refresh(self, this._gameInfo, this._handButtons ?? undefined);
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _refreshAllSeats(): void {
        this.seatManager?.refreshFromPlayers(this._players, this._selfUserId);
    }

    private _syncPlayerField(playerId: number, patch: Partial<TongitsPlayerInfo>): void {
        const idx = this._players.findIndex(p => p.playerInfo?.userId === playerId);
        if (idx < 0) return;
        this._players = [
            ...this._players.slice(0, idx),
            { ...this._players[idx], ...patch },
            ...this._players.slice(idx + 1),
        ];
        this.seatManager?.getSeatByUserId(playerId)?.setData(
            this._players[idx],
            this._players[idx].playerInfo?.userId === this._selfUserId,
        );
    }
}
