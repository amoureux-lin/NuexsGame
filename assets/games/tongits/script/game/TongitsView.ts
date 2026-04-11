import { _decorator, Vec3, tween } from 'cc';
import { BaseGameView } from 'db://assets/script/base/BaseGameView';
import type { LayoffHints, ActionChangePayload, DrawResPayload, MeldResPayload, TakeResPayload, LayOffResPayload } from './TongitsModel';
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
import { FlyUtil } from '../utils/FlyUtil';
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
    /** 当前是否处于可吃牌状态 */
    private _canTake: boolean = false;
    /** 已发出 CMD_TAKE 时使用的手牌（等待 TakeRes 后移除） */
    private _pendingTakeCards: number[] = [];
    /** Model 最近计算的补牌提示（供选牌后展示 meld 候选用） */
    private _lastLayoffHints: LayoffHints | null = null;

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
                // 发牌期间收到的 ActionChange 只更新了 model，UI 刷新被拦截。
                // 此时 model 已是最新，直接补刷发完牌后应有的状态。
                const isSelfTurn = this._actionPlayerId === this._perspectiveId;
                const actionPlayer = this._players.find(
                    p => p.playerInfo?.userId === this._actionPlayerId,
                );
                this.actionPanel?.resetForTurn();
                this.handCardPanel?.setDeckDrawEnabled(isSelfTurn && (actionPlayer?.status ?? 0) === 2);
                if (this.tableAreaView) this.tableAreaView.node.active = true;
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
                // drop/dump/sapaw/fight 只在轮到自己时开启
                if (this._actionPlayerId === this._perspectiveId) {
                    this._refreshActionPanel();
                    // 选中变化时更新 meld 块提示（只在有补牌候选时驱动）
                    this._updateMeldTipsForSelection();
                }
            };
        }
        // 牌堆点击抽牌 / 弃牌区点击吃牌
        if (this.tableAreaView) {
            this.tableAreaView.onDeckDrawClick    = () => this._onDeckDrawClick();
            this.tableAreaView.onDiscardAreaClick = () => this._onDiscardAreaClick();
        }
        // 本地手牌操作命令（不经过服务器）
        Nexus.on(TongitsEvents.CMD_GROUP,    this._onCmdGroup,   this);
        Nexus.on(TongitsEvents.CMD_UNGROUP,  this._onCmdUngroup, this);
        // UI 按钮信号 → View 填入真实数据后再 dispatch 给 Controller
        Nexus.on(TongitsEvents.CMD_DUMP_BTN,   this._onCmdDiscard, this);
        Nexus.on(TongitsEvents.CMD_DROP_BTN,   this._onCmdMeld,    this);
        Nexus.on(TongitsEvents.CMD_SAPAW_BTN,  this._onCmdSapaw,   this);

        this.listen<GameStartBroadcast>(TongitsEvents.GAME_START,       (d) => this.onGameStart(d));
        this.listen<ActionChangePayload>(TongitsEvents.ACTION_CHANGE, (d) => this.onActionChange(d));
        // 他人操作广播
        this.listen<DrawCardBroadcast>(TongitsEvents.DRAW,              (d) => this.onDraw(d));
        this.listen<MeldCardBroadcast>(TongitsEvents.MELD,              (d) => this.onMeld(d));
        this.listen<LayOffCardBroadcast>(TongitsEvents.LAY_OFF,         (d) => this.onLayOff(d));
        this.listen<DiscardCardBroadcast>(TongitsEvents.DISCARD,        (d) => this.onDiscard(d));
        this.listen<TakeCardBroadcast>(TongitsEvents.TAKE,              (d) => this.onTake(d));
        this.listen<ChallengeBroadcast>(TongitsEvents.CHALLENGE,        (d) => this.onChallenge(d));
        this.listen<PKBroadcast>(TongitsEvents.PK,                      (d) => this.onPK(d));
        // 自己操作的 RES 响应
        this.listen<DrawResPayload>(TongitsEvents.DRAW_RES,              (d) => this.onDrawRes(d));
        this.listen<MeldResPayload>(TongitsEvents.MELD_RES,              (d) => this.onMeldRes(d));
        this.listen<DiscardCardRes>(TongitsEvents.DISCARD_RES,          (d) => this.onDiscardRes(d));
        this.listen<TakeResPayload>(TongitsEvents.TAKE_RES,              (d) => this.onTakeRes(d));
        this.listen<LayOffResPayload>(TongitsEvents.LAY_OFF_RES,         (d) => this.onLayOffRes(d));
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

    protected onActionChange(data: ActionChangePayload): void {
        this.seatManager?.updateActionPlayer(data.actionPlayerId);
        this.seatManager?.updateCountdown(data.actionPlayerId, data.countdown);

        this._actionPlayerId = data.actionPlayerId;
        // 同步自身/对手的操作阶段字段，保证按钮启用条件使用的是最新状态
        this._syncPlayerField(data.actionPlayerId, {
            status: data.status,
            countdown: data.countdown,
            isFight: data.isFight,
        } as Partial<TongitsPlayerInfo>);

        // meldField 呼吸高亮：先全部停止，再点亮当前操作玩家
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }
        this.seatManager?.getSeatByUserId(data.actionPlayerId)?.meldField?.startTurnHighlight();

        // 每回合切换先做统一按钮重置（不依赖是否轮到自己）
        if (!this._isDealing) {
            this.actionPanel?.resetForTurn();
            const isSelfTurn = this._actionPlayerId === this._perspectiveId;
            // status===2(select)：可抽牌/吃牌/挑战 → 开启牌堆点击；其他阶段关闭
            this.handCardPanel?.setDeckDrawEnabled(isSelfTurn && data.status === 2);
            // status===2：可 drop/dump（以及后续 spaw）→ 按选牌驱动开启按钮
            if (isSelfTurn) this._refreshActionPanel();

            // 吃牌模式：Model 已计算好候选，View 直接应用
            if (isSelfTurn && data.status === 2) {
                if (data.takeCandidates.length > 0) {
                    this._canTake = true;
                    this.handCardPanel?.enterTakeMode(data.takeCandidates);
                    this.tableAreaView?.startDiscardTip();
                } else {
                    this._canTake = false;
                }
                this._applyLayoffTips(data.layoffHints);
            } else if (isSelfTurn && data.status === 3) {
                this._exitTakeMode();
                this._applyLayoffTips(data.layoffHints);
            } else {
                this._exitTakeMode();
                this._clearLayoffTips();
            }
        }
    }

    // ── 他人操作广播（playerId !== self） ────────────────────

    protected onDraw(data: DrawCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        // 他人摸牌：牌堆弹出顶部节点并飞向对应座位
        const pileTop = this.tableAreaView?.popDeckCard();
        if (!pileTop?.isValid) return;

        const seat          = this.seatManager?.getSeatByUserId(data.playerId);
        const avatarNode    = seat?.cardCountNode;
        if (!avatarNode) { pileTop.destroy(); return; }

        // re-parent 到 tableAreaView 父节点，获得稳定参考系
        const parent   = this.tableAreaView.node.parent!;
        const fromPos  = pileTop.getWorldPosition();
        parent.addChild(pileTop);

        const toPos = avatarNode.getWorldPosition();

        // 飞行前设置起始缩放
        pileTop.setScale(0.5, 0.5, 1);

        // 弧形飞行（旋转跟随切线）
        FlyUtil.fly(pileTop, fromPos, toPos, {
            duration:  0.3,
            arcHeight: 150,
            rotate:    1,
            easing:    'quadOut',
            onComplete: () => { if (pileTop.isValid) pileTop.destroy(); },
        });

        // 并行缩放：飞行过程中逐渐缩小至目标大小
        tween(pileTop)
            .to(0.3, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .start();
    }

    protected onMeld(data: MeldCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        if (data.newMeld) {
            const seat = this.seatManager?.getSeatByUserId(data.playerId);
            if (seat) {
                const fromWorldPos = seat.node.worldPosition.clone();
                seat.meldField?.addMeld(data.newMeld, fromWorldPos);
            }
        }
    }

    protected onLayOff(data: LayOffCardBroadcast): void {
        this._syncPlayerField(data.actionPlayerId, { handCardCount: data.handCardCount });
        // 找到目标玩家的 meldField，飞入补牌动画（追加到末尾）
        const actionSeat = this.seatManager?.getSeatByUserId(data.actionPlayerId);
        const targetSeat = this.seatManager?.getSeatByUserId(data.targetPlayerId);
        if (targetSeat) {
            const fromWorldPos = actionSeat?.node.worldPosition.clone();
            targetSeat.meldField?.layOffToMeld(
                data.targetMeldId,
                data.cardAdded,
                Number.MAX_SAFE_INTEGER, // 追加到末尾，由 layOffToMeld 内部 clamp
                fromWorldPos,
            );
        }
    }

    protected onDiscard(data: DiscardCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        if (!data.discardPile?.length) return;

        const isSelf = data.playerId === this._perspectiveId;
        if (isSelf) {
            // 自己弃牌由 onDiscardRes 处理动画，这里只补同步
            this.tableAreaView?.syncDiscard(data.discardPile);
            return;
        }

        // 他人弃牌：从 cardCountNode 飞向弃牌区
        const seat          = this.seatManager?.getSeatByUserId(data.playerId);
        const cardCountNode = seat?.cardCountNode;
        if (!cardCountNode || !this.tableAreaView) {
            this.tableAreaView?.syncDiscard(data.discardPile);
            return;
        }

        const flyCard = this.tableAreaView.makeDeckCard();
        const parent  = this.tableAreaView.node.parent!;
        parent.addChild(flyCard);
        const fromPos = cardCountNode.getWorldPosition();
        const toPos   = this.tableAreaView.discardNode.getWorldPosition();
        flyCard.setWorldPosition(fromPos);
        flyCard.setScale(0.3, 0.3, 1);

        FlyUtil.fly(flyCard, fromPos, toPos, {
            duration:  0.3,
            arcHeight: 150,
            rotate:    1,
            easing:    'quadOut',
            onComplete: () => {
                if (flyCard.isValid) flyCard.destroy();
                this.tableAreaView?.syncDiscard(data.discardPile);
            },
        });

        // 并行缩放：飞行过程中逐渐缩小至目标大小
        tween(flyCard)
            .to(0.2, { scale: new Vec3(0.6, 0.6, 1) }, { easing: 'quadIn' })
            .start();
    }

    protected onTake(data: TakeCardBroadcast): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        if (data.newMeld) {
            const seat = this.seatManager?.getSeatByUserId(data.playerId);
            seat?.meldField?.addMeld(data.newMeld);
        }
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

    protected onDrawRes(data: DrawResPayload): void {
        // 摸牌完成 → 进入出牌阶段（status 3:Action），主动更新 model，无需等 ActionChangeBroadcast
        this._syncPlayerField(this._perspectiveId, {
            handCardCount: data.handCardCount,
            status: 3,
        } as Partial<TongitsPlayerInfo>);
        this.tableAreaView?.setDeckDrawEnabled(false);
        // 选择摸牌 → 退出吃牌模式
        this._exitTakeMode();
        // popDeckCard + 落牌动画 由 HandCardPanel.addCard 统一处理
        if (data.drawnCard) this.handCardPanel?.addCard(data.drawnCard);
        this._refreshActionPanel();
        this._applyLayoffTips(data.layoffHints);
    }

    protected onMeldRes(data: MeldResPayload): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        if (data.newMeld) {
            const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
            selfSeat?.meldField?.addMeld(data.newMeld);
        }
        this._refreshActionPanel();
        this._applyLayoffTips(data.layoffHints);
    }

    protected onDiscardRes(data: DiscardCardRes): void {
        // 弃牌完成 → 不可操作（status 1），等待下一个 ActionChangeBroadcast
        this._syncPlayerField(this._perspectiveId, {
            handCardCount: data.handCardCount,
            status: 1,
        } as Partial<TongitsPlayerInfo>);
        // 从手牌区移除弃出的牌
        if (data.discardedCard) this.handCardPanel?.removeCard(data.discardedCard);
        // 更新弃牌堆
        if (data.discardPile?.length) this.tableAreaView?.syncDiscard(data.discardPile);
    }

    protected onTakeRes(data: TakeResPayload): void {
        // 吃牌成功 → 进入出牌阶段（status 3:Action），禁用摸牌/吃牌/挑战
        this._syncPlayerField(this._perspectiveId, {
            handCardCount: data.handCardCount,
            status: 3,
        } as Partial<TongitsPlayerInfo>);
        this.tableAreaView?.setDeckDrawEnabled(false);
        // 先退出吃牌模式（恢复 click handler、清除高亮），再修改手牌状态
        this._exitTakeMode();
        // 移除手牌区用于吃牌的牌（散牌或牌组内的牌，含牌组解散逻辑）
        this.handCardPanel?.removeTakeCards(this._pendingTakeCards);
        this._pendingTakeCards = [];
        // 刷新弃牌区视图（Model 已过滤被吃走的牌）
        this.tableAreaView?.syncDiscard(data.discardPile);
        if (data.newMeld) {
            const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
            selfSeat?.meldField?.addMeld(data.newMeld);
        }
        this._refreshActionPanel();
        this._applyLayoffTips(data.layoffHints);
    }
    
    protected onLayOffRes(data: LayOffResPayload): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        // removeCard 之前拿到那张牌的实际世界坐标作为飞行起点
        const handWorldPos = data.cardAdded
            ? (this.handCardPanel?.getCardWorldPos(data.cardAdded) ?? this.handCardPanel?.node.worldPosition.clone())
            : this.handCardPanel?.node.worldPosition.clone();
        // 从手牌区移除补出去的牌
        if (data.cardAdded) this.handCardPanel?.removeCard(data.cardAdded);
        // 自己补牌：从手牌区弧形飞向目标 meld 块
        const targetSeat = this.seatManager?.getSeatByUserId(data.targetPlayerId);
        targetSeat?.meldField?.layOffToMeld(
            data.targetMeldId,
            data.cardAdded,
            Number.MAX_SAFE_INTEGER,
            handWorldPos,
        );
        this._refreshActionPanel();
        this._applyLayoffTips(data.layoffHints);
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
        // 选择发起挑战 → 退出吃牌模式，禁用摸牌/吃牌/挑战
        this._exitTakeMode();
        this.tableAreaView?.setDeckDrawEnabled(false);
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
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }
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
        for (let i = 0; i < 3; i++) {
            const meldField = this.seatManager?.getSeatByIndex(i)?.meldField;
            meldField?.stopTurnHighlight();
            meldField?.clear();
        }
        this._clearLayoffTips();
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
        Nexus.off(TongitsEvents.CMD_GROUP,    this._onCmdGroup,   this);
        Nexus.off(TongitsEvents.CMD_UNGROUP,  this._onCmdUngroup, this);
        Nexus.off(TongitsEvents.CMD_DUMP_BTN,  this._onCmdDiscard, this);
        Nexus.off(TongitsEvents.CMD_DROP_BTN,  this._onCmdMeld,    this);
        Nexus.off(TongitsEvents.CMD_SAPAW_BTN, this._onCmdSapaw,   this);
        if (this.tableAreaView) {
            this.tableAreaView.onDeckDrawClick    = null;
            this.tableAreaView.onDiscardAreaClick = null;
        }
    }

    // ── 私有：本地手牌命令 ────────────────────────────────

    private _onCmdGroup(): void {
        this.handCardPanel?.onGroupBtn();
    }

    private _onCmdUngroup(): void {
        this.handCardPanel?.onUngroupBtn();
    }

    private _onCmdDiscard(): void {
        // 从手牌状态取出选中的散牌，立即从手牌区移除（乐观更新），再发送请求
        const card = this.handCardPanel?.onDumpBtn();
        if (card == null) return;
        this.discard(card);
    }

    private _onCmdMeld(): void {
        const group = this.handCardPanel?.onDropBtn();
        if (!group || group.cards.length === 0) return;
        this.meld(group.cards);
    }

    private _onCmdSapaw(): void {
        if (!this._lastLayoffHints) return;
        const selectedCard = this._handButtons?.selectedSingleCard ?? null;
        if (selectedCard == null) return;
        const candidates = this._lastLayoffHints.cardCandidates.get(selectedCard);
        if (!candidates || candidates.length === 0) return;

        // 优先选非自己的玩家（不管 meldId 如何），无则从自己的候选中选
        const others = candidates.filter(c => c.playerId !== this._perspectiveId);
        const pool   = others.length > 0 ? others : candidates;
        const picked = pool[Math.floor(Math.random() * pool.length)];

        this._clearMeldTips();
        this.layOff(selectedCard, picked.playerId, picked.meldId);
    }

    private _onDiscardAreaClick(): void {
        if (!this._canTake) return;
        const cards = this.handCardPanel?.getSelectedTakeCards() ?? [];
        if (cards.length === 0) return;
        this._pendingTakeCards = cards;
        this.take(cards);
    }

    /** 退出吃牌模式，清除高亮与提示 */
    private _exitTakeMode(): void {
        this._canTake = false;
        this.handCardPanel?.exitTakeMode();
        this.tableAreaView?.stopDiscardTip();
    }

    /**
     * 将 Model 预计算好的补牌提示应用到 View（仅手牌 tipNode）。
     * meld 块提示由 _updateMeldTipsForSelection() 在选牌变化时驱动。
     */
    private _applyLayoffTips(hints: LayoffHints): void {
        if (hints.tippedCards.size === 0) {
            this._clearLayoffTips();
            return;
        }
        this._lastLayoffHints = hints;
        this.handCardPanel?.showLayoffTips(hints.tippedCards);
        // meld 块提示由 _updateMeldTipsForSelection 驱动，此处先清除旧提示
        this._clearMeldTips();
    }

    /**
     * 根据当前选中的手牌，在对应玩家的 meld 块上显示补牌提示。
     * 仅当选中单张有 tip 标记的牌时触发；无候选时清除 meld 提示。
     */
    private _updateMeldTipsForSelection(): void {
        this._clearMeldTips();
        if (!this._lastLayoffHints) return;
        const selectedCard = this._handButtons?.selectedSingleCard ?? null;
        if (selectedCard == null) return;
        const candidates = this._lastLayoffHints.cardCandidates.get(selectedCard);
        if (!candidates || candidates.length === 0) return;

        // 按 playerId 分组
        const byPlayer = new Map<number, number[]>();
        for (const { playerId, meldId } of candidates) {
            if (!byPlayer.has(playerId)) byPlayer.set(playerId, []);
            byPlayer.get(playerId)!.push(meldId);
        }

        // 每个有候选的玩家显示 meld 块提示，绑定手动选定回调
        for (const [playerId, meldIds] of byPlayer) {
            const meldField = this.seatManager?.getSeatByUserId(playerId)?.meldField;
            if (!meldField) continue;
            meldField.showLayoffTipOnMelds(meldIds);
            // 闭包捕获 playerId 和 selectedCard，保证 onMeldTipClick 不依赖外部可变状态
            const card      = selectedCard;
            const pid       = playerId;
            meldField.onMeldTipClick = (meldId: number) => {
                this._clearMeldTips();
                this.layOff(card, pid, meldId);
            };
        }
    }

    /** 清除所有玩家 meld 块上的补牌提示节点与点击回调 */
    private _clearMeldTips(): void {
        for (const player of this._players) {
            const uid = player.playerInfo?.userId;
            if (!uid) continue;
            this.seatManager?.getSeatByUserId(uid)?.meldField?.clearLayoffTips();
        }
    }

    /** 清除所有补牌提示（手牌 tipNode + meld 块提示 + 缓存重置） */
    private _clearLayoffTips(): void {
        this._lastLayoffHints = null;
        this.handCardPanel?.clearLayoffTips();
        this._clearMeldTips();
    }

    private _onDeckDrawClick(): void {
        // 额外保护：只在轮到自己且 status===2(select) 时允许抽牌
        if (this._actionPlayerId !== this._perspectiveId) return;
        const self = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        if ((self?.status ?? 0) !== 2) return;
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
