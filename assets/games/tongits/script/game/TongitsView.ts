import { _decorator, Vec3, tween, Node } from 'cc';
import { BaseGameView } from 'db://assets/script/base/BaseGameView';
import { TongitsModel } from './TongitsModel';
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
import { CardNode, DEFAULT_CARD_W, CARD_SPACING } from '../views/handcard/CardNode';
import { TableAreaView } from '../views/panel/TableAreaView';
import { FightPanel }         from '../views/panel/FightPanel';
import { TongitsPrompt }      from '../views/panel/TongitsPrompt';
import { TongitsResultPanel } from '../views/panel/TongitsResultPanel';
import {TongitsPanel} from "db://assets/games/tongits/script/views/panel/TongitsPanel";
import { PotTrophyPanel } from '../views/panel/PotTrophyPanel';
import { DiscardHistoryPanel } from '../views/panel/DiscardHistoryPanel';
import type { PotInfo } from '../proto/tongits';

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

    @property({ type: FightPanel, tooltip: '挑战/比牌/烧死动画容器' })
    fightPanel: FightPanel | null = null;

    @property({ type: TongitsPrompt, tooltip: 'Tongits 提示浮层' })
    tongitsPrompt: TongitsPrompt | null = null;

    @property({ type: TongitsPanel, tooltip: '达成 Tongits 结算展示面板' })
    TongitsPanel: TongitsPanel | null = null;

    @property({ type: TongitsResultPanel, tooltip: 'result结算展示面板' })
    tongitsResultPanel: TongitsResultPanel | null = null;

    /** 顶部底池奖杯面板（两个奖杯图标 + 飞行动画） */
    @property({ type: PotTrophyPanel, tooltip: '顶部底池奖杯面板' })
    potTrophyPanel: PotTrophyPanel | null = null;

    /** 弃牌历史记录面板 */
    @property({ type: DiscardHistoryPanel, tooltip: '弃牌历史记录面板' })
    discardHistoryPanel: DiscardHistoryPanel | null = null;

    // ── Model 只读引用快捷方式 ────────────────────────────

    private get tongitsModel(): TongitsModel | null {
        return this._model as TongitsModel | null;
    }

    // ── 从 Model 派生的只读属性（取代冗余缓存字段） ────────

    /** 自己的 userId（进房后固定不变） */
    private get _selfUserId(): number {
        return this.tongitsModel?.myUserId ?? 0;
    }

    /** 当前可操作玩家（来自 ActionChangeBroadcast） */
    private get _actionPlayerId(): number {
        return this.tongitsModel?.getActionPlayerId() ?? 0;
    }

    /** 游戏是否已开始（status >= 2） */
    private get _isGameStarted(): boolean {
        return ((this.tongitsModel?.gameInfo as GameInfo | null)?.status ?? 1) >= 2;
    }

    /** 自己是否是房主 */
    private get _isLocalOwner(): boolean {
        return (this.tongitsModel?.self?.playerInfo?.post ?? 0) === 1;
    }

    // ── 从 Model 派生（直接读，无需缓存） ────────────────

    private get _players(): TongitsPlayerInfo[] {
        return (this.tongitsModel?.players ?? []) as TongitsPlayerInfo[];
    }

    private get _gameInfo(): GameInfo | null {
        return this.tongitsModel?.gameInfo as GameInfo | null;
    }

    // ── 缓存本地状态 ─────────────────────────────────────

    /**
     * 视角玩家 userId：
     *   - 普通玩家：与 _selfUserId 相同（getPerspectiveId() 返回 0，回退到 myUserId）
     *   - 观战者：gameInfo.perspectiveId（被观战玩家的 id）
     * 所有座位排列、手牌显示、操作按钮等 view 逻辑均以此为基准。
     */
    private get _perspectiveId(): number {
        return this.tongitsModel?.getPerspectiveId() || this._selfUserId;
    }
    /** 缓存 BeforeResult 的胜利类型，供 onGameResult 传给结算面板 */
    private _lastWinType: number = 0;
    /** 发牌动画进行中，此期间拦截操作按钮刷新 */
    private _isDealing: boolean = false;
    /** 手牌状态机最新的按钮可用状态 */
    private _handButtons: ButtonStates | null = null;
    /** 当前是否处于可吃牌状态 */
    private _canTake: boolean = false;
    /** 已发出 CMD_TAKE 时使用的手牌（等待 TakeRes 后移除） */
    private _pendingTakeCards: number[] = [];
    /** Model 最近计算的补牌提示（供选牌后展示 meld 候选用） */
    private _lastLayoffHints: LayoffHints | null = null;
    /** 本局被补牌的玩家 id 集合（下次轮到该玩家操作时清除） */
    private _layoffBannedIds: Set<number> = new Set();

    protected onLoad() {
        super.onLoad();
        this.init();
    }

    init(){
        if (this.tableAreaView) this.tableAreaView.node.active = false;
        if (this.actionPanel) this.actionPanel.node.active = false;
        this.actionPanel?.hideAll();
        if (this.fightPanel) {
            this.fightPanel.zoneResolver = (uid) => this.seatManager.getFightZoneByUserId(uid);
            // Challenge 按钮(true) → changeStatus 3(接受)；Fold 按钮(false) → changeStatus 4(拒绝)
            this.fightPanel.onChallengeResponse = (accepted) => {
                this.challenge(accepted ? 3 : 4);
            };
        }
        if (this.tongitsPrompt) {
            this.tongitsPrompt.onClick = () => {
                Nexus.emit(TongitsEvents.CMD_TONGITS_CLICK);
            };
            this.tongitsPrompt.node.active = false;
        }
        if (this.tongitsResultPanel) {
            this.tongitsResultPanel.node.active = false;
        }
        if (this.tableAreaView) {
            this.tableAreaView.onHistoryClick = () => {
                this.discardHistoryPanel?.show((this.tongitsModel?.gameInfo as GameInfo | null)?.discardPile ?? []);
            };
        }
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
                // setContext 用 _data.cardPoint 初始化点数，紧接着用本地手牌实时计算值覆盖
                const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
                selfSeat?.updateGamePoint(this.handCardPanel?.point ?? 0);
                if (this.actionPanel) {this.actionPanel.node.active = true;}
            };
            // 手牌选中状态变化 → 实时更新按钮可交互状态
            this.handCardPanel.onSelectionChange = (info) => {
                this._handButtons = info.buttons;
                if (this._isDealing) return;
                // group/ungroup 是本地操作，不受回合限制，始终随选牌状态更新
                this.actionPanel?.refreshGroupButtons(info.buttons);
                // 实时更新自己的手牌点数（本地计算值）
                const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
                selfSeat?.updateGamePoint(this.handCardPanel.point);
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
        this.listen(TongitsEvents.HAS_TONGITS,                          ()  => this._onHasTongits());
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

        const status = this._gameInfo?.status ?? 1;
        // status 2=游戏中 / 3=挑战中 视为游戏已开始
        const inGame = status >= 2 && status <= 3;

        this.seatManager?.setContext(this._isLocalOwner, this._isGameStarted);
        this._refreshAllSeats();
        this._refreshPanelVisibility();

        if (!inGame) {
            // status=1 等待中：正常显示 WaitingPanel
            this.waitingPanel?.refresh(data.self ?? null, this._isLocalOwner);
        } else {
            // status=2/3 游戏进行中：先清理 UI 瞬态，再从快照还原
            this._resetUITransientState();
            this._restoreGameInProgress();
        }
    }

    /**
     * 清理 View 层纯 UI 瞬态，在快照同步前调用。
     * Layer 4 状态（动画/交互模式/临时标记）直接丢弃，不尝试恢复。
     */
    private _resetUITransientState(): void {
        this._isDealing = false;
        this._canTake = false;
        this._handButtons = null;
        this._lastLayoffHints = null;
        this._layoffBannedIds.clear();
        this._pendingTakeCards = [];
        this.handCardPanel?.exitTakeMode();
        this.gameStartEffect?.node && (this.gameStartEffect.node.active = false);
    }

    /**
     * 重连/中途进入时，按 JoinRoomRes 数据还原游戏中 UI。
     * 调用前 _players / _gameInfo / _perspectiveId 已全部赋值。
     */
    private _restoreGameInProgress(): void {
        const gi         = this._gameInfo as GameInfo;
        const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._perspectiveId);

        // 1. 桌面区：牌堆 + 弃牌
        if (this.tableAreaView) {
            this.tableAreaView.node.active = true;
            this.tableAreaView.setupDeck(gi.deckCardCount ?? 0);
            const pile = gi.discardPile?.length
                ? gi.discardPile
                : gi.discardCard ? [gi.discardCard] : [];
            this.tableAreaView.syncDiscard(pile);
        }

        // 2. 各玩家已放出的牌组（无动画直接还原）
        for (const player of this._players) {
            const uid = player.playerInfo?.userId;
            if (!uid || !player.displayedMelds?.length) continue;
            this.seatManager?.getSeatByUserId(uid)?.meldField?.setMelds(player.displayedMelds);
        }

        // 3. 自己手牌（无动画）
        this.handCardPanel?.showCards(selfPlayer?.handCards ?? []);
        this.handCardPanel?.setDragEnabled(true);

        // 4. 操作面板显示（全部禁用，等后续 _refreshActionPanel 按条件开启）
        if (this.actionPanel) {
            this.actionPanel.node.active = true;
            this.actionPanel.showAll();
        }

        // 5. 当前操作玩家高亮 + 倒计时
        const actionId     = gi.actionPlayerId;
        const actionPlayer = this._players.find(p => p.playerInfo?.userId === actionId);
        this.seatManager?.updateActionPlayer(actionId);
        if (actionPlayer && (actionPlayer.countdown ?? 0) > 0) {
            // JoinRoomRes 中 countdown 为服务端 Unix 秒时间戳，转换为毫秒
            this.seatManager?.updateCountdown(actionId, actionPlayer.countdown * 1000);
        }
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }
        this.seatManager?.getSeatByUserId(actionId)?.meldField?.startTurnHighlight();

        // 6. 若轮到自己，恢复操作按钮可交互状态
        if (actionId === this._perspectiveId) {
            this._refreshActionPanel();
            if (selfPlayer && (selfPlayer.status ?? 0) === 2) {
                // SELECT 阶段：牌堆可点击抽牌
                this.handCardPanel?.setDeckDrawEnabled(true);
            }
        }

        // 7. status=3 挑战中：还原挑战 UI
        if (gi.status === 3) {
            this._restoreChallengeUI();
        }
    }

    /**
     * 重连时按各玩家 changeStatus 还原挑战阶段 UI。
     * changeStatus: 1=待响应 2=发起方 3=接受 4=拒绝 5=烧死
     */
    private _restoreChallengeUI(): void {
        const challenger = this._players.find(p => p.changeStatus === 2);
        if (!challenger) return;

        const challengerId = challenger.playerInfo?.userId ?? 0;

        // 先激活面板、播发起方动画
        this.fightPanel?.onPlayerChallenge(challengerId);

        // 其他玩家按各自 changeStatus 播对应动画
        for (const player of this._players) {
            const uid = player.playerInfo?.userId;
            if (!uid || uid === challengerId) continue;
            switch (player.changeStatus) {
                case 3: this.fightPanel?.onPlayerAccept(uid); break;
                case 4: this.fightPanel?.onPlayerFold(uid);   break;
                case 5: this.fightPanel?.onPlayerBurn(uid);   break;
            }
        }

        // 若自己尚未响应（changeStatus=1 且不是发起方 且非观战），弹出响应面板
        const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._selfUserId);
        const selfCs     = selfPlayer?.changeStatus ?? 0;
        if (selfCs === 1 && challengerId !== this._selfUserId && !this.tongitsModel?.isSpectator()) {
            const cd = (selfPlayer?.countdown ?? 0) > 0
                ? selfPlayer!.countdown * 1000
                : Date.now() + 10000;
            this.fightPanel?.showResponsePanel(selfPlayer?.cardPoint ?? 0, cd);
        }
    }

    protected onPlayersUpdated(_players: TongitsPlayerInfo[]): void {
        this._refreshAllSeats();
    }

    protected onGameInfoUpdated(_gameInfo: GameInfo): void {
        // model 已原地更新 gameInfo，getter 直接读取，无需缓存
    }

    protected onSelfUpdated(self: TongitsPlayerInfo): void {
        this.seatManager?.setContext(this._isLocalOwner, this._isGameStarted);
        this._refreshAllSeats();
        // 准备状态变化时刷新 WaitingPanel
        if (!this._isGameStarted) {
            this.waitingPanel?.refresh(self, this._isLocalOwner);
        }
    }

    protected onGameStart(data: GameStartBroadcast): void {
        console.log('onGameStart', data);
        this._resetToPreGame();
        // 游戏开始立即隐藏所有座位的 kickBtn（不等发牌动画完成）
        this.seatManager?.setContext(this._isLocalOwner, true);
        // waitingPanel 立即隐藏，actionPanel 等动画回调时与 cardCountNode 同步显示
        this._refreshPanelVisibility();

        if (data.players) {
            this._refreshAllSeats();
        }

        // 初始化顶部奖杯数字（pot.winCount = 底池已累积局数）
        this.potTrophyPanel?.setWinCount(data.gameInfo?.pot?.winCount ?? 0);

        // 标记发牌中，拦截期间的 ActionChange 按钮刷新
        this._isDealing = true;

        const selfPlayer = this._players.find(p => p.playerInfo?.userId === this._perspectiveId);
        const potAmount = (data.gameInfo?.pot?.base ?? 0);
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
        // 若该玩家本局被补牌，轮到他操作时解除 ban（清遮罩 + 移出集合）
        // SELF 的 ban 要等到自己弃牌后才解除（onDiscardRes 处理），这里跳过
        if (this._layoffBannedIds.has(data.actionPlayerId) && data.actionPlayerId !== this._perspectiveId) {
            this._layoffBannedIds.delete(data.actionPlayerId);
            this.seatManager?.getSeatByUserId(data.actionPlayerId)?.meldField?.clearAllMasks();
        }
        this.seatManager?.updateActionPlayer(data.actionPlayerId);
        this.seatManager?.updateCountdown(data.actionPlayerId, data.countdown);

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
            // 每次回合切换都刷新面板：非自己回合时仅用于恢复 ban 标志（其他按钮因 status=INIT 保持禁用）
            this._refreshActionPanel();

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

        // 服务端替自己自动摸牌（压后台超时）：drawnCard 有值，直接加入手牌区
        if (data.playerId === this._perspectiveId) {
            if (data.drawnCard) {
                this.tableAreaView?.popDeckCard()?.destroy();
                this.handCardPanel?.addCard(data.drawnCard);
            }
            return;
        }

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
        // 目标玩家被补牌，记入 ban 集合
        this._layoffBannedIds.add(data.targetPlayerId);
        this._refreshActionPanel();
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
            // 服务端替自己自动弃牌（压后台超时）：移除手牌并同步弃牌堆
            // 正常自己弃牌由 onDiscardRes 处理，此处作为兜底（discardedCard 协议有值）
            if (data.discardedCard) this.handCardPanel?.removeCard(data.discardedCard);
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

        const flyCard   = this.tableAreaView.makeDeckCard();
        const flyCardCn = flyCard.getComponent(CardNode);
        const discardedCard = data.discardPile[data.discardPile.length - 1];
        if (flyCardCn) { flyCardCn.setCard(discardedCard); flyCardCn.setFaceDown(false); }

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
        if (!data.newMeld) return;

        const seat          = this.seatManager?.getSeatByUserId(data.playerId);
        const discardPos    = this.tableAreaView?.discardNode?.getWorldPosition().clone();
        const handPos       = seat?.cardCountNode?.getWorldPosition().clone();
        // 提前算出新 block 实际落点（世界坐标中心），作为飞牌精确终点
        const meldTargetPos = seat?.meldField?.calcNextMeldWorldPos(data.newMeld.cards.length)
                           ?? seat?.meldField?.contentNode?.getWorldPosition().clone()
                           ?? discardPos;

        // 手牌中参与吃牌的张数（牌组总数 - 1 张弃牌）
        const handCardCount = (data.newMeld.cards.length - 1);

        if (!discardPos || !this.tableAreaView) {
            // 降级：直接更新 UI（移除顶牌 = 最后一张）
            this.tableAreaView.syncDiscard(this.tableAreaView.discardPile.slice(0, -1));
            seat?.meldField?.addMeld(data.newMeld);
            return;
        }

        const FLY_DUR    = 0.35;
        const MELD_SCALE = 0.4;                       // 与 PlayerMeldField.CARD_SCALE 保持一致
        const CW         = DEFAULT_CARD_W * MELD_SCALE; // 单张牌缩放后宽度 = 32
        const STEP       = CARD_SPACING   * MELD_SCALE; // 牌间距缩放后 = 25.6
        const EXPAND_DUR     = 0.14;
        const EXPAND_STAGGER = 0.03;
        const parent = this.tableAreaView.node.parent!;

        // 手牌中参与吃牌的牌值（牌组全部牌 - 弃牌那张）
        const handCardIds = [...data.newMeld.cards];
        const discardIdx  = handCardIds.indexOf(data.discard);
        if (discardIdx !== -1) handCardIds.splice(discardIdx, 1);

        // 牌起飞时立即移除弃牌堆顶牌（最后一张）
        this.tableAreaView.syncDiscard(this.tableAreaView.discardPile.slice(0, -1));

        // ── 两路飞牌都落地后展示新牌组 ───────────────────────────
        let doneCount = 0;
        const onOneDone = () => {
            doneCount++;
            if (doneCount < 2) return;
            seat?.meldField?.addMeld(data.newMeld!);
        };

        const fromPos = handPos ?? discardPos;

        // ── 1. 手牌 block 从 handPos 飞出（叠放起步，飞行中展开）──
        const handBlock = new Node('HandFlyBlock');
        parent.addChild(handBlock);
        handBlock.setWorldPosition(fromPos);
        handBlock.setScale(0.5, 0.5, 1);
        for (let i = 0; i < handCardIds.length; i++) {
            const n  = this.tableAreaView.makeDeckCard();
            const cn = n.getComponent(CardNode);
            if (cn) { cn.setCard(handCardIds[i]); cn.setFaceDown(false); }
            n.setScale(MELD_SCALE, MELD_SCALE, 1);
            n.setPosition(CW / 2, 0, 0); // 叠放：所有牌叠在同一位置
            handBlock.addChild(n);
        }
        // block 整体飞行
        FlyUtil.fly(handBlock, fromPos, meldTargetPos!, {
            duration:   FLY_DUR,
            arcHeight:  120,
            easing:     'quadOut',
            onComplete: () => { if (handBlock.isValid) handBlock.destroy(); onOneDone(); },
        });
        // block 飞行中放大至正常（0.5 → 1）
        tween(handBlock).to(FLY_DUR, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
        // 各张牌在 block 内从叠放位置展开
        for (let i = 0; i < handCardIds.length; i++) {
            tween(handBlock.children[i])
                .delay(i * EXPAND_STAGGER)
                .to(EXPAND_DUR, { position: new Vec3(CW / 2 + i * STEP, 0, 0) }, { easing: 'quadOut' })
                .start();
        }

        // ── 2. 弃牌区顶牌单独飞向牌组（正面显示）────────────────
        const discardFly = this.tableAreaView.makeDeckCard();
        const discardCn  = discardFly.getComponent(CardNode);
        if (discardCn) { discardCn.setCard(data.discard); discardCn.setFaceDown(false); }
        parent.addChild(discardFly);
        discardFly.setScale(1, 1, 1);
        FlyUtil.fly(discardFly, discardPos, meldTargetPos!, {
            duration:   FLY_DUR,
            arcHeight:  80,
            easing:     'quadOut',
            onComplete: () => { if (discardFly.isValid) discardFly.destroy(); onOneDone(); },
        });
        tween(discardFly).to(FLY_DUR, { scale: new Vec3(MELD_SCALE, MELD_SCALE, 1) }, { easing: 'quadOut' }).start();
    }

    protected onChallenge(data: ChallengeBroadcast): void {
        console.log("data", data);
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

        // ── FightPanel：先重置再播发起方挑战动画（同一时刻只允许一人发起）──
        if (this.fightPanel) {
            this.fightPanel.reset();
            this.fightPanel.onPlayerChallenge(data.playerId);

            // 自己不是发起方且是玩家（非观战）→ 弹出 Challenge/Fold 响应面板
            if (data.playerId !== this._selfUserId && !this.tongitsModel?.isSpectator()) {
                console.log("弹出 Challenge/Fold 响应面板")
                const selfBp    = data.basePlayers?.find(bp => bp.playerId === this._selfUserId);
                const countdown = selfBp?.countdown ?? Date.now() + 10000;
                const selfInfo  = this._players.find(p => p.playerInfo?.userId === this._selfUserId);
                const points    = selfInfo?.cardPoint ?? 0;
                this.fightPanel.showResponsePanel(points, countdown);
            }
        }
    }

    // ── 自己操作的 RES 响应 ────────────────────────────────

    protected onDrawRes(data: DrawResPayload): void {
        // 摸牌完成 → 进入出牌阶段（status 3:Action），主动更新 model，无需等 ActionChangeBroadcast
        this._syncPlayerField(this._selfUserId, {
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
        this._syncPlayerField(this._selfUserId, { handCardCount: data.handCardCount });
        if (data.newMeld) {
            const selfSeat = this.seatManager?.getSeatByUserId(this._selfUserId);
            selfSeat?.meldField?.addMeld(data.newMeld);
        }
        this._refreshActionPanel();
        this._applyLayoffTips(data.layoffHints);
    }

    protected onDiscardRes(data: DiscardCardRes): void {
        // 弃牌完成 → 不可操作（status 1），等待下一个 ActionChangeBroadcast
        this._syncPlayerField(this._selfUserId, {
            handCardCount: data.handCardCount,
            status: 1,
        } as Partial<TongitsPlayerInfo>);
        // 从手牌区移除弃出的牌
        if (data.discardedCard) this.handCardPanel?.removeCard(data.discardedCard);
        // 更新弃牌堆
        if (data.discardPile?.length) this.tableAreaView?.syncDiscard(data.discardPile);
        // 弃牌完成才解除 ban（含清遮罩），让挑战禁止标记持续到打完牌
        if (this._layoffBannedIds.has(this._selfUserId)) {
            this._layoffBannedIds.delete(this._selfUserId);
            this.seatManager?.getSeatByUserId(this._selfUserId)?.meldField?.clearAllMasks();
            this._refreshActionPanel();
        }
    }

    protected onTakeRes(data: TakeResPayload): void {
        // 吃牌成功 → 进入出牌阶段（status 3:Action），禁用摸牌/吃牌/挑战
        this._syncPlayerField(this._selfUserId, {
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
            const selfSeat = this.seatManager?.getSeatByUserId(this._selfUserId);
            selfSeat?.meldField?.addMeld(data.newMeld);
        }
        this._refreshActionPanel();
        this._applyLayoffTips(data.layoffHints);
    }
    
    protected onLayOffRes(data: LayOffResPayload): void {
        this._syncPlayerField(this._selfUserId, { handCardCount: data.handCardCount });
        // 目标玩家被补牌，记入 ban 集合（含自己补自己的情形）
        this._layoffBannedIds.add(data.targetPlayerId);
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

        // 自己选择后播放对应动画（2=发起挑战 / 3=接受 / 4=拒绝）
        if (this.fightPanel) {
            const selfBp = data.basePlayers?.find(bp => bp.playerId === this._selfUserId);
            if (selfBp) {
                switch (selfBp.changeStatus) {
                    case 2:
                        // 自己是挑战发起方：ChallengeBroadcast 被 model 拦截不透传，
                        // 在此补齐面板激活与挑战动画
                        this.fightPanel.reset();
                        this.fightPanel.onPlayerChallenge(this._selfUserId);
                        break;
                    case 3: this.fightPanel.onPlayerAccept(this._selfUserId); break;
                    case 4: this.fightPanel.onPlayerFold(this._selfUserId);   break;
                }
            }
        }

        // 选择后 → 退出吃牌模式，禁用摸牌/吃牌/挑战
        this._exitTakeMode();
        this.tableAreaView?.setDeckDrawEnabled(false);
        if (!this._isDealing && this._actionPlayerId === this._perspectiveId) {
            this._refreshActionPanel();
        }
        this._refreshAllSeats();
    }

    protected onPK(_data: PKBroadcast): void {
        const data = _data as PKBroadcast;
        console.log("data:",data)
        // PK 会改变 challenge 的状态字段（用于 fight 按钮交互）
        this._syncPlayerField(data.playerId, {
            changeStatus: data.changeStatus,
        } as Partial<TongitsPlayerInfo>);
        if (!this._isDealing && this._actionPlayerId === this._perspectiveId) {
            this._refreshActionPanel();
        }
        this._refreshAllSeats();

        // ── FightPanel：按 changeStatus 播对应动画 ─────────────
        if (this.fightPanel) {
            // 1:默认待选择 2:发起 3:接受 4:拒绝 5:烧死
            switch (data.changeStatus) {
                case 3: this.fightPanel.onPlayerAccept(data.playerId); break; // 接受
                case 4: this.fightPanel.onPlayerFold(data.playerId);   break; // 折牌
                case 5: this.fightPanel.onPlayerBurn(data.playerId);   break; // 烧死
            }
        }
    }

    protected onBeforeResult(data: BeforeResultBroadcast): void {
        console.log("onBeforeResult:",data);
        // 游戏即将结算：清除所有玩家倒计时 + 禁止手牌交互 + 清理游戏进行态 UI
        this.seatManager?.updateActionPlayer(0);
        this.handCardPanel?.setDragEnabled(false);
        this._clearGameplayState();
        if (data.players) {
            this._refreshAllSeats();
        }
        /** 胜利类型  1 tongits 2 挑战 3 时间结束比大小: */
        // 缓存 winType，onGameResult 收到完整结算数据后再显示结算面板
        this._lastWinType = data.winType;

        // 结算前：在座位头像旁显示所有玩家手牌点数（赢/输背景）
        this.seatManager?.showResultPoints(data.winnerId);

        const pot = data.pot;
        if (data.winType === 1) { //tongits
            const players = data.players ?? [];
            const winner  = players.find(p => p.playerInfo?.userId === data.winnerId);
            console.log('[TongitsView] winType=1 TongitsPanel=', this.TongitsPanel, 'winner=', winner?.playerInfo?.userId);
            if (this.TongitsPanel && winner) {
                this.TongitsPanel.onHide = () => this._showWinnerBonus(players, pot);
                this.TongitsPanel.show(winner);
            } else {
                this._showWinnerBonus(players, pot);
            }
        } else if (data.winType === 2 && this.fightPanel) { //挑战
            this.fightPanel.onBeforeResult();
            const players = data.players ?? [];
            const infos = players
                .filter(p => (p.handCards?.length ?? 0) > 0)
                .map(p => ({
                    userId: p.playerInfo!.userId,
                    cards:  p.handCards,
                    points: p.cardPoint ?? 0,
                    isWin:  p.isWin ?? false,
                }));
            if (infos.length > 0) {
                this.fightPanel.showShowdown(infos, () => this._showWinnerBonus(players, pot));
            }
        } else if (data.winType === 3) { //摸完牌
            this._showWinnerBonus(data.players ?? [], pot);
        }
    }

    /** 收到 hasTongits=true，显示 Tongits 提示浮层 */
    private _onHasTongits(): void {
        if (!this.tongitsPrompt) return;
        this.tongitsPrompt.node.active = true;
        this.tongitsPrompt.show();
    }

    /** 显示赢家奖励动画（winType=2 showdown 完成后 & winType=3 直接调用） */
    private _showWinnerBonus(players: TongitsPlayerInfo[], pot?: PotInfo): void {
        // 展示除自己以外所有玩家的手牌
        for (const player of players) {
            const uid = player.playerInfo?.userId;
            if (!uid || uid === this._perspectiveId || !player.handCards?.length) continue;
            this.seatManager?.getSeatByUserId(uid)?.meldField?.showHandCards(player.handCards);
        }
        const winner = players.find(p => p.isWin);
        if (winner) {
            const bonus = winner.playerInfo?.coinChanged ?? 0;
            this.seatManager?.showWin(winner.playerInfo!.userId, bonus);
        }

        // 奖杯动画：在赢家座位显示奖杯，飞向顶部 Trophy1
        console.log('[Trophy] _showWinnerBonus pot=', pot, 'potTrophyPanel=', this.potTrophyPanel, 'winner=', winner?.playerInfo?.userId);
        if (pot !== undefined && this.potTrophyPanel) {
            const winCount = pot.winCount ?? 0;
            // 更新顶部 Trophy1 上的数字（结算时再次刷新）
            this.potTrophyPanel.setWinCount(winCount);

            if (winner) {
                const winnerSeat = this.seatManager?.getSeatByUserId(winner.playerInfo!.userId);
                console.log('[Trophy] winnerSeat=', winnerSeat, 'trophyNode=', winnerSeat?.trophyNode);
                if (winnerSeat) {
                    const fromPos = winnerSeat.showTrophy(winCount);
                    console.log('[Trophy] fromPos=', fromPos);
                    // toPot2=false：暂时始终飞向 Trophy1，后续按 pot.useId 判断再决定
                    this.potTrophyPanel.playTrophyFly(fromPos, false);
                }
            }
        }
    }

    protected onGameResult(data: GameResultBroadcast): void {
        // 结算通知到达，兜底清理（onBeforeResult 未触发时的保底）
        this.handCardPanel?.setDragEnabled(false);
        this.seatManager?.updateActionPlayer(0);
        this._clearGameplayState();
        this.actionPanel?.hideAll();
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }

        // 收到结算数据后打开结算面板
        if (this.tongitsResultPanel && data.playerResults?.length) {
            const snapshots = this.seatManager?.getSeatSnapshots() ?? [];
            this.tongitsResultPanel.onDetails = () => this.dispatch(TongitsEvents.CMD_RESULT_DETAILS);
            // countdown 为服务端 Unix 秒时间戳，转换为毫秒传给结算面板倒计时
            const endTimestamp = (data.countdown ?? 0) > 0 ? data.countdown * 1000 : 0;
            this.tongitsResultPanel.show(
                snapshots,
                data.playerResults,
                data.winnerId,
                this._lastWinType,
                this._perspectiveId,
                endTimestamp,
            );
        }
    }

    protected onRoomReset(data: RoomResetBroadcast): void {
        this._resetToPreGame();
        const self = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        this.waitingPanel?.refresh(self, this._isLocalOwner);
    }

    /** 重置到进房间初始状态 */
    private _resetToPreGame(): void {
        this.handCardPanel?.setDragEnabled(true);
        this._isDealing = false;
        this._handButtons = null;
        this.seatManager?.resetZoneMap();
        this._layoffBannedIds.clear();
        this.seatManager?.setContext(this._isLocalOwner, false);
        this.seatManager?.updateActionPlayer(0);
        for (let i = 0; i < 3; i++) {
            const seat = this.seatManager?.getSeatByIndex(i);
            seat?.meldField?.stopTurnHighlight();
            seat?.meldField?.clear();
            seat?.resetWin();
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
        this.tongitsPrompt?.hide();
        this.tongitsPrompt?.node && (this.tongitsPrompt.node.active = false);
        if (this.tongitsResultPanel) {
            this.tongitsResultPanel.onHide    = null;
            this.tongitsResultPanel.onDetails = null;
            this.tongitsResultPanel.hide();
        }
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
        console.log("打牌：",card)
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
        if (this.tongitsModel?.isSpectator()) return;
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

    /**
     * 游戏进入结算阶段时的统一清理：
     *   - 退出吃牌模式（清除高亮/遮罩）
     *   - 清除补牌提示（手牌 tipNode + meld 块提示）
     *   - 停止所有座位 meldField 回合呼吸高亮
     *   - 禁用 ActionPanel 所有按钮点击
     * onBeforeResult / onGameResult 均调用此方法。
     */
    private _clearGameplayState(): void {
        this._exitTakeMode();
        this._clearLayoffTips();
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }
        this.actionPanel?.disableAll();
    }

    private _onDeckDrawClick(): void {
        // 额外保护：只在轮到自己且 status===2(select) 时允许抽牌，观战者不可操作
        if (this.tongitsModel?.isSpectator()) return;
        if (this._actionPlayerId !== this._perspectiveId) return;
        const self = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        if ((self?.status ?? 0) !== 2) return;
        this.draw();
    }

    /** 用当前缓存状态刷新 ActionPanel 的可交互状态 */
    private _refreshActionPanel(): void {
        const isBanned = this._layoffBannedIds.has(this._perspectiveId);
        // 非自己回合：只有 ban 标志需要更新时才继续，其余按钮状态不变
        if (this._actionPlayerId !== this._perspectiveId && !isBanned) return;
        const self     = this._players.find(p => p.playerInfo?.userId === this._perspectiveId) ?? null;
        this.actionPanel?.refresh(self, this._gameInfo, this._handButtons ?? undefined, isBanned);
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _refreshAllSeats(): void {
        this.seatManager?.refreshFromPlayers(this._players, this._perspectiveId);
    }


    private _syncPlayerField(playerId: number, _patch: Partial<TongitsPlayerInfo>): void {
        // model 在 notify 前已通过 updatePlayerById 原地更新，直接从 getter 读取最新数据
        const player = this._players.find(p => p.playerInfo?.userId === playerId);
        if (!player) return;
        this.seatManager?.getSeatByUserId(playerId)?.setData(
            player,
            player.playerInfo?.userId === this._perspectiveId,
        );
        // setData 内部 _refresh() 会用 _data.cardPoint（服务端字段，游戏中始终为 0）覆盖 pointLabel。
        // 若更新的是视角玩家且游戏进行中，立即用本地手牌计算值覆盖，保持点数显示准确。
        if (playerId === this._perspectiveId && this._isGameStarted) {
            this.seatManager?.getSeatByUserId(playerId)?.updateGamePoint(this.handCardPanel?.point ?? 0);
        }
    }

}
