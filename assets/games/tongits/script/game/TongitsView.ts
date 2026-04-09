import { _decorator } from 'cc';
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
    DrawCardRes,
    MeldCardRes,
    DiscardCardRes,
    TakeCardRes,
    LayOffCardRes,
    ChallengeRes,
} from '../proto/tongits';
import {GameStartEffect} from "db://assets/games/tongits/script/views/effect/GameStartEffect";
import { TableAreaView } from '../views/panel/TableAreaView';

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

    @property({ type: TableAreaView, tooltip: '牌桌中央区（牌堆数量 + 弃牌展示 + 历史按钮），挂在 tableArea 节点上' })
    tableAreaView: TableAreaView = null!;

    // ── 缓存本地状态 ─────────────────────────────────────

    private _selfUserId: number = 0;
    /**
     * 视角玩家 userId：
     *   - 普通玩家：与 _selfUserId 相同
     *   - 观战者：gameInfo.perspectiveId（被观战玩家的 id）
     * 所有座位排列、手牌显示、操作按钮等 view 逻辑均以此为基准。
     */
    private _perspectiveId: number = 0;
    private _players: TongitsPlayerInfo[] = [];
    private _gameInfo: GameInfo | null = null;
    private _isLocalOwner: boolean = false;
    private _isGameStarted: boolean = false;
    /** 发牌动画进行中，此期间拦截操作按钮刷新 */
    private _isDealing: boolean = false;
    /** 手牌状态机最新的按钮可用状态 */
    private _handButtons: ButtonStates | null = null;
    /** 当前可操作玩家（来自 ActionChangeBroadcast） */
    private _actionPlayerId: number = 0;

    protected onLoad() {
        super.onLoad();
        this.init();
    }

    init(){
        if (this.tableAreaView) this.tableAreaView.node.active = false;
        if (this.actionPanel) this.actionPanel.node.active = false;
        this.actionPanel?.hideAll();
    }

    // ── 事件注册 ─────────────────────────────────────────

    protected override registerGameEvents(): void {
        if (this.handCardPanel) {
            // 合并完成、展开前 → 显示所有按钮（禁用状态）
            this.handCardPanel.onDealMergeComplete = () => {
                this._isDealing = false;
                this.actionPanel?.showAll();
                this._refreshActionPanel();
                // cardCountNode 与 actionPanel 同时显示
                this.seatManager?.setContext(this._isLocalOwner, true);
                if (this.actionPanel) {this.actionPanel.node.active = true;}
            };
            // 手牌选中状态变化 → 实时更新按钮可交互状态
            this.handCardPanel.onSelectionChange = (info) => {
                this._handButtons = info.buttons;
                if (this._isDealing) return;
                // group/ungroup 是本地操作，不受回合限制，始终随选牌状态更新
                this.actionPanel?.refreshGroupButtons(info.buttons);
                // drop/drump/spaw/fight 只在轮到自己时开启
                if (this._actionPlayerId === this._perspectiveId) {
                    this._refreshActionPanel();
                }
            };
        }
        // 牌堆点击抽牌（TableAreaView 内部做 enabled gate）
        if (this.tableAreaView) {
            this.tableAreaView.onDeckDrawClick = () => this._onDeckDrawClick();
        }
        // 本地手牌操作命令（不经过服务器）
        Nexus.on(TongitsEvents.CMD_GROUP,   this._onCmdGroup,   this);
        Nexus.on(TongitsEvents.CMD_UNGROUP, this._onCmdUngroup, this);

        this.listen<GameStartBroadcast>(TongitsEvents.GAME_START,       (d) => this.onGameStart(d));
        this.listen<ActionChangeBroadcast>(TongitsEvents.ACTION_CHANGE, (d) => this.onActionChange(d));
        // 他人操作广播
        this.listen<DrawCardBroadcast>(TongitsEvents.DRAW,              (d) => this.onDraw(d));
        this.listen<MeldCardBroadcast>(TongitsEvents.MELD,              (d) => this.onMeld(d));
        this.listen<LayOffCardBroadcast>(TongitsEvents.LAY_OFF,         (d) => this.onLayOff(d));
        this.listen<DiscardCardBroadcast>(TongitsEvents.DISCARD,        (d) => this.onDiscard(d));
        this.listen<TakeCardBroadcast>(TongitsEvents.TAKE,              (d) => this.onTake(d));
        this.listen<ChallengeBroadcast>(TongitsEvents.CHALLENGE,        (d) => this.onChallenge(d));
        this.listen<PKBroadcast>(TongitsEvents.PK,                      (d) => this.onPK(d));
        // 自己操作的 RES 响应
        this.listen<DrawCardRes>(TongitsEvents.DRAW_RES,                (d) => this.onDrawRes(d));
        this.listen<MeldCardRes>(TongitsEvents.MELD_RES,                (d) => this.onMeldRes(d));
        this.listen<DiscardCardRes>(TongitsEvents.DISCARD_RES,          (d) => this.onDiscardRes(d));
        this.listen<TakeCardRes>(TongitsEvents.TAKE_RES,                (d) => this.onTakeRes(d));
        this.listen<LayOffCardRes>(TongitsEvents.LAY_OFF_RES,           (d) => this.onLayOffRes(d));
        this.listen<ChallengeRes>(TongitsEvents.CHALLENGE_RES,          (d) => this.onChallengeRes(d));
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
        // 观战时用 perspectiveId 作为视角基准，普通玩家两者相同
        this._perspectiveId = this._gameInfo?.perspectiveId || this._selfUserId;
        this._isLocalOwner = (data.self?.playerInfo?.post ?? 0) === 1;
        this._isGameStarted = false;
        this.seatManager?.setContext(this._isLocalOwner, false);
        this._refreshAllSeats();
        this._refreshPanelVisibility();
        this.waitingPanel?.refresh(data.self ?? null, this._isLocalOwner);
        // 重连/中途加入：若游戏已在进行则立即显示视角玩家手牌（无动画）
        if (this._gameInfo) {
            const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._perspectiveId);
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
        this._resetToPreGame();
        this._isGameStarted = true;
        // waitingPanel 立即隐藏，actionPanel 等动画回调时与 cardCountNode 同步显示
        this._refreshPanelVisibility();

        if (data.players) {
            this._players = data.players;
            this._refreshAllSeats();
        }

        // GameStart 带的 gameInfo 包含初始 actionPlayerId，缓存备用
        if (data.gameInfo) this._gameInfo = data.gameInfo as GameInfo;

        // 标记发牌中，拦截期间的 ActionChange 按钮刷新
        this._isDealing = true;

        const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._perspectiveId);
        const potAmount = (data.gameInfo?.betAmount ?? 0)
            * (data.gameInfo?.pot?.base ?? 1);
        const avatarPositions = this.seatManager?.getAvatarWorldPositions() ?? [];

        // 开场动画 → 发牌 → 发牌完成后刷新操作按钮
        this.gameStartEffect?.playSequence(
            avatarPositions,
            potAmount,
            () => {
                if (this.tableAreaView) this.tableAreaView.node.active = true;
                this.handCardPanel?.dealCards(
                    selfPlayer?.handCards ?? [],
                    data.gameInfo?.deckCardCount ?? 0,
                    async ()=>{
                        await Nexus.audio.playSfx("res/audios/send_card");
                    }
                );
            },
        );
    }

    protected onActionChange(data: ActionChangeBroadcast): void {
        this.seatManager?.updateActionPlayer(data.actionPlayerId);
        this.seatManager?.updateCountdown(data.actionPlayerId, data.countdown);

        this._actionPlayerId = data.actionPlayerId;
        // 同步自身/对手的操作阶段字段，保证按钮启用条件使用的是最新状态
        this._syncPlayerField(data.actionPlayerId, {
            status: data.status,
            countdown: data.countdown,
            isFight: data.isFight,
        } as Partial<TongitsPlayerInfo>);

        // 每回合切换先做统一按钮重置（不依赖是否轮到自己）
        if (!this._isDealing) {
            this.actionPanel?.resetForTurn();
            const isSelfTurn = this._actionPlayerId === this._perspectiveId;
            // status===1：可抽牌 → 开启牌堆点击与指引；其他阶段关闭
            this.handCardPanel?.setDeckDrawEnabled(isSelfTurn && data.status === 1);
            // status===2：可 drop/drump（以及后续 sapaw）→ 按选牌驱动开启按钮
            if (isSelfTurn) this._refreshActionPanel();
        }
    }

    // ── 他人操作广播（playerId !== self） ────────────────────

    protected onDraw(data: DrawCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        // 他人摸牌：牌堆视觉减一
        const pileTop = this.tableAreaView?.popDeckCard();
        if (pileTop?.isValid) pileTop.destroy();
    }

    protected onMeld(data: MeldCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
    }

    protected onLayOff(data: LayOffCardBroadcast): void {
        this._syncPlayerField(data.actionPlayerId, { handCardCount: data.handCardCount });
    }

    protected onDiscard(data: DiscardCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        // 他人弃牌也更新弃牌堆展示
        if (data.discardPile?.length) {
            this.tableAreaView?.syncDiscard(data.discardPile);
        }
    }

    protected onTake(data: TakeCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
    }

    protected onChallenge(data: ChallengeBroadcast): void {
        if (data.basePlayers) {
            for (const bp of data.basePlayers) {
                this._syncPlayerField(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: bp.countdown,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        if (!this._isDealing && this._actionPlayerId === this._perspectiveId) {
            this._refreshActionPanel();
        }
        this._refreshAllSeats();
    }

    // ── 自己操作的 RES 响应 ────────────────────────────────

    protected onDrawRes(data: DrawCardRes): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        this.tableAreaView?.setDeckDrawEnabled(false);
        // popDeckCard + 飞行动画 由 HandCardPanel.addCard 统一处理
        if (data.drawnCard) this.handCardPanel?.addCard(data.drawnCard);
        this._refreshActionPanel();
    }

    protected onMeldRes(data: MeldCardRes): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        this._refreshActionPanel();
    }

    protected onDiscardRes(data: DiscardCardRes): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        // 从手牌区移除弃出的牌
        if (data.discardedCard) this.handCardPanel?.removeCard(data.discardedCard);
        // 更新弃牌堆
        if (data.discardPile?.length) this.tableAreaView?.syncDiscard(data.discardPile);
    }

    protected onTakeRes(data: TakeCardRes): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        this._refreshActionPanel();
    }

    protected onLayOffRes(data: LayOffCardRes): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        this._refreshActionPanel();
    }

    protected onChallengeRes(data: ChallengeRes): void {
        if (data.basePlayers) {
            for (const bp of data.basePlayers) {
                this._syncPlayerField(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: bp.countdown,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        if (!this._isDealing && this._actionPlayerId === this._perspectiveId) {
            this._refreshActionPanel();
        }
        this._refreshAllSeats();
    }

    protected onPK(_data: PKBroadcast): void {
        const data = _data as PKBroadcast;
        // PK 会改变 challenge 的状态字段（用于 fight 按钮交互）
        this._syncPlayerField(data.playerId, {
            changeStatus: data.changeStatus,
        } as Partial<TongitsPlayerInfo>);
        if (!this._isDealing && this._actionPlayerId === this._perspectiveId) {
            this._refreshActionPanel();
        }
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
        if (data.players) this._players = data.players;
        this._resetToPreGame();
        const self = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        this.waitingPanel?.refresh(self, this._isLocalOwner);
    }

    /** 重置到进房间初始状态 */
    private _resetToPreGame(): void {
        this._isDealing = false;
        this._isGameStarted = false;
        this._actionPlayerId = 0;
        this._handButtons = null;
        this.seatManager?.setContext(this._isLocalOwner, false);
        this.seatManager?.updateActionPlayer(0);
        this._refreshAllSeats();
        if (this.tableAreaView) this.tableAreaView.node.active = false;
        this.handCardPanel?.clear();
        this.tableAreaView?.clear();
        this.handCardPanel?.setDeckDrawEnabled(false);
        this._refreshPanelVisibility();
        // actionPanel 重置时始终隐藏，等动画回调时再显示
        if (this.actionPanel) this.actionPanel.node.active = false;
    }

    /**
     * 根据 _isGameStarted 控制 waitingPanel 显隐。
     * actionPanel 由动画回调（与 cardCountNode 同步）单独控制。
     */
    private _refreshPanelVisibility(): void {
        if (this.waitingPanel) this.waitingPanel.node.active = !this._isGameStarted;
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
        if (this.tableAreaView) this.tableAreaView.onDeckDrawClick = null;
    }

    // ── 私有：本地手牌命令 ────────────────────────────────

    private _onCmdGroup(): void {
        this.handCardPanel?.onGroupBtn();
    }

    private _onCmdUngroup(): void {
        this.handCardPanel?.onUngroupBtn();
    }

    private _onDeckDrawClick(): void {
        // 额外保护：只在轮到自己且 status===1 时允许抽牌
        if (this._actionPlayerId !== this._perspectiveId) return;
        const self = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        if ((self?.status ?? 0) !== 1) return;
        this.draw();
    }

    /** 用当前缓存状态刷新 ActionPanel 的可交互状态 */
    private _refreshActionPanel(): void {
        // 只允许“轮到自己”时由选牌状态驱动按钮开启
        if (this._actionPlayerId !== this._perspectiveId) return;
        const self = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        this.actionPanel?.refresh(self, this._gameInfo, this._handButtons ?? undefined);
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _refreshAllSeats(): void {
        this.seatManager?.refreshFromPlayers(this._players, this._perspectiveId);
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
            this._players[idx].playerInfo?.userId === this._perspectiveId,
        );
    }
}
