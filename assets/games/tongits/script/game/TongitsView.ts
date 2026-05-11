import { _decorator, Vec3, tween, Node,Label } from 'cc';
import { BaseGameView } from 'db://assets/script/base/BaseGameView';
import { CHALLENGE_STATUS, GAME_STATUS, PLAYER_STATUS, PLAY_EMOJI_TYPE, TongitsModel, WIN_TYPE, flattenCards } from './TongitsModel';
import type { LayoffHints, ChallengeState, ActionChangePayload, DrawResPayload, MeldResPayload, TakeResPayload, LayOffResPayload } from './TongitsModel';
import { Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import { PlayerSeatManager } from './views/player/PlayerSeatManager';
import { WaitingPanel } from './views/panel/WaitingPanel';
import { ActionPanel } from './views/panel/ActionPanel';
import { HandCardPanel } from './views/handcard/HandCardPanel';
import type { ButtonStates, ServerCards } from '../utils/HandCardState';
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
    GameReadyBroadcast,
    JoinRoomRes,
    GameResultDetailsRes,
    DrawCardRes,
    MeldCardRes,
    DiscardCardRes,
    TakeCardRes,
    LayOffCardRes,
    ChallengeRes,
    SwitchAutoGroupCardsRes,
    GamePlayerGroupCardsRes,
    Cards,
} from '../proto/tongits';
import {GameStartEffect} from "./views/effect/GameStartEffect";
import { FlyUtil } from '../utils/FlyUtil';
import { CardNode, DEFAULT_CARD_W, CARD_SPACING } from './views/handcard/CardNode';
import { TableAreaView } from './views/panel/TableAreaView';
import { FightPanel }         from './views/panel/FightPanel';
import { TongitsPrompt }      from './views/panel/TongitsPrompt';
import { TongitsResultPanel } from './views/panel/TongitsResultPanel';
import {TongitsPanel} from "./views/panel/TongitsPanel";
import { PotTrophyPanel } from './views/panel/PotTrophyPanel';
import { DiscardHistoryPanel } from './views/panel/DiscardHistoryPanel';
import type { PotInfo } from '../proto/tongits';

/** proto Cards[] → HandCardState ServerCards[]（结构兼容，直接透传） */
function toServerCards(cards: Cards[] | undefined): ServerCards[] | undefined {
    if (!cards) return undefined;
    return cards as unknown as ServerCards[];
}
import {GuidePanel} from "db://assets/games/tongits/script/game/views/panel/GuidePanel";
import {ResultDetailPanel} from "db://assets/games/tongits/script/game/views/panel/ResultDetailPanel";
import { EmojiPlayer } from 'db://assets/script/lib/emoji/EmojiPlayer';
import { GameEvents } from 'db://assets/script/config/GameEvents';

const { ccclass, property } = _decorator;

/** 带 _isBackground 标记的 payload 类型辅助 */
type WithBg<T> = T & { _isBackground?: boolean };

interface ViewAnimationState {
    isDealing: boolean;
}

interface ViewHandInteractionState {
    canTake: boolean;
    lastTakeCandidates: number[][];
    handButtons: ButtonStates | null;
    pendingTakeCards: number[];
}

interface ViewLayoffState {
    lastLayoffHints: LayoffHints | null;
    layoffBannedIds: Set<number>;
}

interface ViewResultState {
    lastWinType: number;
}

/** View 层瞬态：发牌/手牌交互/补牌/结算等过程中的临时状态，重连时统一重置 */
interface ViewTransientState {
    animation: ViewAnimationState;
    hand: ViewHandInteractionState;
    layoff: ViewLayoffState;
    result: ViewResultState;
}

/** 创建默认瞬态（所有字段归零） */
function createDefaultTransientState(): ViewTransientState {
    return {
        animation: { isDealing: false },
        hand: {
            canTake: false,
            lastTakeCandidates: [],
            handButtons: null,
            pendingTakeCards: [],
        },
        layoff: {
            lastLayoffHints: null,
            layoffBannedIds: new Set<number>(),
        },
        result: { lastWinType: 0 },
    };
}

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

    // ══════════════════════════════════════════════════════════
    // ── @property 子组件引用（Inspector 中拖入） ─────────────
    // ══════════════════════════════════════════════════════════

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

    @property({ type: ResultDetailPanel, tooltip: '结算详情子面板（默认 active=false）' })
    detailPanel: ResultDetailPanel | null = null;

    @property({ type: GuidePanel, tooltip: '引导' })
    guidePanel: GuidePanel | null = null;

    @property({ type: Label, tooltip: '费用/底注按钮 文字金额' })
    costLabel: Label = null!;

    // ══════════════════════════════════════════════════════════
    // ── Model 只读引用 ──────────────────────────────────────
    // ══════════════════════════════════════════════════════════

    /** TongitsModel 类型安全的快捷引用 */
    private get tongitsModel(): TongitsModel | null {
        return this._model as TongitsModel | null;
    }

    /** 当前可操作玩家（来自 ActionChangeBroadcast） */
    private get _actionPlayerId(): number {
        return this.tongitsModel?.currentTurnPlayerId ?? 0;
    }

    /** 游戏是否已开始 */
    private get _isGameStarted(): boolean {
        return this.tongitsModel?.isGameStarted ?? false;
    }

    /** 自己是否是房主 */
    private get _isLocalOwner(): boolean {
        return this.tongitsModel?.isLocalOwner ?? false;
    }

    /** 当前房间内所有玩家列表 */
    private get _players(): TongitsPlayerInfo[] {
        return (this.tongitsModel?.players ?? []) as TongitsPlayerInfo[];
    }

    /** 当前游戏信息（牌堆、弃牌堆、操作玩家等） */
    private get _gameInfo(): GameInfo | null {
        return this.tongitsModel?.gameInfo as GameInfo | null;
    }

    /** 视角玩家 ID：由服务端 gameInfo.perspectiveId 决定 */
    private get _perspectiveId(): number {
        return this.tongitsModel?.perspectivePlayerId ?? 0;
    }

    private get gameStatus(): number {
        return this.tongitsModel?.getGameStatus() ?? GAME_STATUS.WAITING;
    }

    /**
     * 判断给定 userId 是否不是当前视角玩家。
     * 注意：这不是"是否观战者"——观战身份判定请用 _isLocalSpectator。
     * 这里仅用于事件目标 / 操作玩家是否落在视角焦点上。
     */
    private isNotPerspectivePlayer(userId:number):boolean{
        return this.tongitsModel?.isNotPerspectivePlayer(userId) ?? true;
    }

    /** 判断给定 userId 是否是当前视角玩家。 */
    private isPerspectivePlayer(userId: number): boolean {
        return this.tongitsModel?.isPerspectivePlayer(userId) ?? false;
    }

    /**
     * 本地用户是否为观战者。判据：mySeat <= 0（协议直接保证，BaseGameModel.isSpectator）。
     * 与 perspectiveId 解耦——即使服务端 perspectiveId 异常，也能正确识别身份。
     */
    private get _isLocalSpectator(): boolean {
        return this.tongitsModel?.isSpectator() ?? true;
    }

    /** 当前是否轮到视角玩家 */
    private get _isPerspectiveTurn(): boolean {
        return this.tongitsModel?.isPerspectiveTurn ?? false;
    }

    /** 当前视角玩家是否可摸牌 */
    private get _canPerspectiveDraw(): boolean {
        return this.tongitsModel?.canPerspectiveDraw ?? false;
    }

    /** 当前视角玩家是否可操作 */
    private get _canPerspectiveOperate(): boolean {
        return this.tongitsModel?.canPerspectiveOperate ?? false;
    }

    /** 当前视角玩家是否处于出牌/补牌阶段 */
    private get _isPerspectiveActioning(): boolean {
        return this.tongitsModel?.isPerspectiveActioning ?? false;
    }

    /** 当前视角手牌快照 */
    private _getPerspectiveHandSnapshot(): {
        player: TongitsPlayerInfo | undefined;
        count: number;
        flatHand: number[];
        serverGroups: ServerCards[] | undefined;
    } {
        const player = this.tongitsModel?.perspectivePlayer;
        const flatHand = flattenCards(player?.groupCards);
        return {
            player,
            count: player?.handCardCount ?? flatHand.length,
            flatHand,
            serverGroups: toServerCards(player?.groupCards),
        };
    }

    /** 按当前视角从 Model 全量刷新手牌显示 */
    private _refreshPerspectiveHandFromModel(): void {
        const { count, flatHand, serverGroups } = this._getPerspectiveHandSnapshot();
        if (this._isLocalSpectator) {
            this.seatManager?.getSeatByUserId(this._perspectiveId)?.hidePoint();
            this.handCardPanel?.showCards(count);
            return;
        }
        this.handCardPanel?.showCards(count, flatHand, serverGroups);
    }

    /** 后台/无动画路径：按 Model 全量重建手牌 */
    private _rebuildHandFromModel(): void {
        this._refreshPerspectiveHandFromModel();
    }

    /**
     * 观战时根据当前视角玩家最新 handCardCount 全量重刷拍背手牌。
     * 发牌动画进行中跳过（避免打断 dealCards 异步流）。
     */
    private _refreshSpectatorHand(): void {
        if (!this._isLocalSpectator) return;
        if (this._isDealing) return;
        this._refreshPerspectiveHandFromModel();
    }

    /**
     * 弃牌后核对手牌：本地 view._state 与 model.groupCards 不一致时，按 model 全量重建。
     * 一致时不动（保留手动分组 / autoGroup 状态）。
     * 弃牌是回合最后一步，是最稳定的同步点——用来兜底自己操作 vs 服务端代操作的偶发冲突。
     */
    private _verifyHandSync(): void {
        if (this._isLocalSpectator) return;
        if (this._isDealing) return;

        const viewCards = this.handCardPanel?.getAllHandCards() ?? [];
        const modelCards = this.tongitsModel?.handCards ?? [];
        const view = [...viewCards].sort((a, b) => a - b);
        const model = [...modelCards].sort((a, b) => a - b);

        const mismatch = view.length !== model.length
            || view.some((c, i) => c !== model[i]);

        if (mismatch) {
            console.warn('[TongitsView] hand desync detected, resync from model. view=', view, ' model=', model);
            this._rebuildHandFromModel();
        }
    }

    /** 从手牌移除若干牌后核对 model，一般用于牌组/补牌/吃牌。 */
    private _removeHandCardsAndVerify(cards: number[] | undefined): void {
        if (!cards?.length) return;
        this.handCardPanel?.removeTakeCards(cards);
        this._verifyHandSync();
    }

    /** 从手牌移除单张牌后核对 model，一般用于弃牌。 */
    private _removeHandCardAndVerify(card: number | undefined): void {
        if (!card) return;
        this.handCardPanel?.removeCard(card);
        this._verifyHandSync();
    }

    /** 自己 RES 后又收到自己的广播时，避免同一张牌被 UI 重复加入。 */
    private _isHandAlreadyUpdated(handCardCount: number, card?: number): boolean {
        if (this._isLocalSpectator) return false;
        const current = this.handCardPanel?.getAllHandCards() ?? [];
        if (current.length !== handCardCount) return false;
        return card ? current.includes(card) : true;
    }

    // ══════════════════════════════════════════════════════════
    // ── 本地瞬态（统一管理，重连时一键重置） ────────────────
    // ══════════════════════════════════════════════════════════

    /** View 层瞬态集合 */
    private _ts: ViewTransientState = createDefaultTransientState();

    private get _isDealing(): boolean {
        return this._ts.animation.isDealing;
    }

    private get _lastWinType(): number {
        return this._ts.result.lastWinType;
    }

    private get _canTake(): boolean {
        return this._ts.hand.canTake;
    }

    private get _takeCandidates(): number[][] {
        return this._ts.hand.lastTakeCandidates;
    }

    private get _handButtons(): ButtonStates | null {
        return this._ts.hand.handButtons;
    }

    private get _layoffHints(): LayoffHints | null {
        return this._ts.layoff.lastLayoffHints;
    }

    private _setDealing(value: boolean): void {
        this._ts.animation.isDealing = value;
    }

    private _setHandButtons(buttons: ButtonStates | null): void {
        this._ts.hand.handButtons = buttons;
    }

    private _setTakeCandidates(candidates: number[][]): void {
        this._ts.hand.canTake = candidates.length > 0;
        this._ts.hand.lastTakeCandidates = candidates;
    }

    private _clearTakeState(): void {
        this._setTakeCandidates([]);
    }

    private _setPendingTakeCards(cards: number[]): void {
        this._ts.hand.pendingTakeCards = cards;
    }

    private _consumePendingTakeCards(): number[] {
        const cards = this._ts.hand.pendingTakeCards;
        this._ts.hand.pendingTakeCards = [];
        return cards;
    }

    private _isLayoffTargetBanned(playerId: number): boolean {
        return this._ts.layoff.layoffBannedIds.has(playerId);
    }

    private _banLayoffTarget(playerId: number): void {
        this._ts.layoff.layoffBannedIds.add(playerId);
    }

    private _unbanLayoffTarget(playerId: number): void {
        this._ts.layoff.layoffBannedIds.delete(playerId);
    }

    private _setLayoffHints(hints: LayoffHints | null): void {
        this._ts.layoff.lastLayoffHints = hints;
    }

    private _setLastWinType(winType: number): void {
        this._ts.result.lastWinType = winType;
    }

    private _showActionPanelShell(): void {
        if (!this.actionPanel) return;
        this.actionPanel.node.active = true;
        this.actionPanel.showAll();
    }

    private _hideActionPanel(): void {
        this.actionPanel?.hideAll();
        if (this.actionPanel?.node) this.actionPanel.node.active = false;
    }

    private _resetActionPanelForTurn(): void {
        this.actionPanel?.resetForTurn();
    }

    private _disableActionPanel(): void {
        this.actionPanel?.disableAll();
    }

    private _refreshActionPanelGroupButtons(): void {
        this.actionPanel?.refreshGroupButtons(this._handButtons ?? undefined);
    }

    private _isActionPanelVisibleStatus(): boolean {
        return this.gameStatus === GAME_STATUS.PLAYING || this.gameStatus === GAME_STATUS.CHALLENGE;
    }

    /** ActionPanel 脏标记，帧末统一刷新，避免同帧多次重复计算 */
    private _actionPanelDirty = false;

    // ══════════════════════════════════════════════════════════
    // ── 生命周期 ────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════

    /** Cocos 生命周期：节点加载完成，调用 init 初始化各子面板 */
    protected onLoad() {
        super.onLoad();
        this.init();
    }

    /** 场景就绪 */
    protected async onReady(params:any){
        super.onReady(params);
        await Nexus.audio.playMusic('res/audios/Tongits_bg', true);
        let guidOpen = Nexus.storage.get("guid");
        if(!guidOpen){
            this.guidePanel.show();
        }
    }

    /** Cocos 生命周期：节点销毁，注销所有事件监听 */
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
        if (this.handCardPanel) {
            this.handCardPanel.onGroupsChange = null;
        }
    }

    /**
     * 初始化所有子面板到"什么都不显示"的状态，并绑定回调。
     * 在 onLoad 与 onRoomJoined 都会调用，必须幂等。
     */
    init(){
        // ── 浮层 / 引导 / 详情 / 历史 ─────────────────────────
        this.guidePanel?.hide?.();
        if (this.guidePanel?.node) this.guidePanel.node.active = false;
        if (this.detailPanel?.node) this.detailPanel.node.active = false;
        this.discardHistoryPanel?.hide();
        if (this.discardHistoryPanel?.node) this.discardHistoryPanel.node.active = false;

        // ── 结算面板 / Tongits 提示 ──────────────────────────
        this.TongitsPanel?.hide();
        if (this.TongitsPanel?.node) this.TongitsPanel.node.active = false;
        this.tongitsPrompt?.hide();
        if (this.tongitsPrompt?.node) this.tongitsPrompt.node.active = false;
        if (this.tongitsResultPanel) {
            this.tongitsResultPanel.onHide = null;
            this.tongitsResultPanel.hide();
            this.tongitsResultPanel.node.active = false;
        }

        // ── 等待 / 操作面板 ──────────────────────────────────
        this.waitingPanel?.hide();
        if (this.waitingPanel?.node) this.waitingPanel.node.active = false;
        this._hideActionPanel();

        // ── 牌桌主体（牌堆 / 弃牌 / 手牌） ────────────────────
        this.tableAreaView?.clear();
        if (this.tableAreaView?.node) this.tableAreaView.node.active = false;
        this.handCardPanel?.clear();
        this.handCardPanel?.setDeckDrawEnabled(false);

        // ── 开场动画 / 挑战面板 ──────────────────────────────
        if (this.gameStartEffect?.node) this.gameStartEffect.node.active = false;
        this.fightPanel?.reset();

        // ── 顶部底池奖杯：清零 winCount（trophy2 由自身 onLoad 隐藏） ──
        this.potTrophyPanel?.setWinCount(0);

        // ── 座位常驻视图：清 meldField + 重置赢家奖杯/赢动画 ──
        for (let i = 0; i < 3; i++) {
            const seat = this.seatManager?.getSeatByIndex(i);
            seat?.meldField?.clear();
            seat?.meldField?.stopTurnHighlight();
            seat?.resetWin();
        }

        // ── 回调绑定 ─────────────────────────────────────────
        if (this.fightPanel) {
            this.fightPanel.zoneResolver = (uid) => this.seatManager.getFightZoneByUserId(uid);
            // Challenge 按钮(true) → 接受；Fold 按钮(false) → 拒绝
            this.fightPanel.onChallengeResponse = (accepted) => {
                this.challenge(accepted ? 3 : 4);
            };
        }
        if (this.tongitsPrompt) {
            this.tongitsPrompt.onClick = () => {
                Nexus.emit(TongitsEvents.CMD_TONGITS_CLICK);
            };
        }
        if (this.tableAreaView) {
            this.tableAreaView.onHistoryClick = () => {
                this.discardHistoryPanel?.show((this.tongitsModel?.gameInfo as GameInfo | null)?.discardPile ?? []);
            };
        }

        // 顶部 costLabel 初始化（model 未就位时显示 "0"，避免编辑器占位文字外露）
        this._refreshCostLabel();
    }

    // ══════════════════════════════════════════════════════════
    // ── 事件注册 ────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════

    protected override registerGameEvents(): void {
        if (this.handCardPanel) {
            // 合并完成、展开前 → 显示所有按钮（禁用状态）
            this.handCardPanel.onDealMergeComplete = () => {
                this._setDealing(false);
                // 发牌期间收到的 ActionChange 只更新了 model，UI 刷新被拦截。
                // 此时 model 已是最新，直接补刷发完牌后应有的状态。
                this.handCardPanel?.setDeckDrawEnabled(this._canPerspectiveDraw);
                if (this.tableAreaView) this.tableAreaView.node.active = true;
                this._flushActionPanel();
                // cardCountNode 与 actionPanel 同时显示
                this.seatManager?.setContext(this._isLocalOwner, true);
                // setContext 用 _data.cardPoint 初始化点数，紧接着用本地手牌实时计算值覆盖
                const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
                if (this._isLocalSpectator) {
                    selfSeat?.hidePoint();
                } else {
                    selfSeat?.updateGamePoint(this.handCardPanel?.point ?? 0);
                }
            };
            // 手牌选中状态变化 → 实时更新按钮可交互状态
            this.handCardPanel.onSelectionChange = (info) => {
                this._setHandButtons(info.buttons);
                if (this._isDealing) return;
                // group/ungroup 是本地操作，不受回合限制，始终随选牌状态更新
                this._refreshActionPanelGroupButtons();
                // 实时更新自己的手牌点数（本地计算值，观战时隐藏）
                const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
                if (this._isLocalSpectator) {
                    selfSeat?.hidePoint();
                } else {
                    selfSeat?.updateGamePoint(this.handCardPanel.point);
                }
                // drop/dump/sapaw/fight 只在轮到视角玩家时开启
                if (this._isPerspectiveTurn) {
                    this._markActionPanelDirty();
                    // 选中变化时更新 meld 块提示（只在有补牌候选时驱动）
                    this._updateMeldTipsForSelection();
                }
            };
            this.handCardPanel.onGroupsChange = (groups) => {
                Nexus.emit(TongitsEvents.CMD_PLAYER_GROUP_CARDS, {
                    targetGroupCards: groups as unknown as Cards[],
                });
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
        // 组牌响应
        this.listen<SwitchAutoGroupCardsRes>(TongitsEvents.SWITCH_AUTO_GROUP_RES, (d) => this._onSwitchAutoGroupRes(d));
        this.listen<GamePlayerGroupCardsRes>(TongitsEvents.PLAYER_GROUP_CARDS_RES, (d) => this._onPlayerGroupCardsRes(d));
        // 游戏即将开始
        this.listen<GameReadyBroadcast>(TongitsEvents.GAME_READY, (d) => this._onGameReady(d));
        // 结算
        this.listen<BeforeResultBroadcast>(TongitsEvents.BEFORE_RESULT, (d) => this.onBeforeResult(d));
        this.listen<GameResultBroadcast>(TongitsEvents.GAME_RESULT,     (d) => this.onGameResult(d));
        this.listen<RoomResetBroadcast>(TongitsEvents.ROOM_RESET,       (d) => this.onRoomReset(d));
        this.listen<GameResultDetailsRes>(TongitsEvents.RESULT_DETAILS, (d) => this.onResultDetails(d));

        // WebSDK 表情/文字气泡
        this.listen<{ userId: number; type: number; content: string }>(
            GameEvents.PLAY_EMOJI, (d) => this._onPlayEmoji(d),
        );
    }


    // ══════════════════════════════════════════════════════════
    // ── UI 状态总控（按 gameInfo.status 全量重建 UI） ──────
    // ══════════════════════════════════════════════════════════



    // ══════════════════════════════════════════════════════════
    // ── BaseGameView 回调（Model → View） ───────────────────
    // ══════════════════════════════════════════════════════════

    /** 进房回调：根据房间状态决定显示等待面板还是还原游戏中 UI */
    protected onRoomJoined(data: JoinRoomRes): void {
        this.init();

        // 进房先确定观战身份，后续手牌渲染、排序按钮、ActionPanel 等都依赖此标志
        const isSpec = this._isLocalSpectator;
        this.handCardPanel?.setSpectatorMode(isSpec);
        if (isSpec) {
            this.seatManager?.getSeatByUserId(this._perspectiveId)?.hidePoint();
        }

        this.seatManager?.setContext(this._isLocalOwner, this._isGameStarted);
        this._refreshAllSeats();
        this._refreshPanelVisibility();

        // 清 view 瞬态后按 status 全量重建 UI
        this._resetUITransientState();
        this._applyUIByStatus(this.gameStatus ?? GAME_STATUS.WAITING);
    }

    /**
     * UI 状态总控入口：按当前 gameInfo.status 全量重建 UI。
     * 幂等：可重复调用，不依赖之前状态。
     *
     * 调用场景：
     *   - onRoomJoined 进房 / 重连 / 切后台回前台 后还原 UI
     *   - 调试/手动刷新
     *
     * status 含义见 GAME_STATUS。
     */
    private _applyUIByStatus(status: number): void {
        //根据状态来决定游戏UI
        switch (status) {
            case GAME_STATUS.WAITING:       this._applyStatusWaiting();      break;
            case GAME_STATUS.PLAYING:       this._applyStatusPlaying();      break;
            case GAME_STATUS.CHALLENGE:     this._applyStatusChallenge();    break;
            case GAME_STATUS.BEFORE_RESULT: this._applyStatusBeforeResult(); break;
            case GAME_STATUS.RESULT:        this._applyStatusResult();       break;
            default:
                console.warn('[TongitsView] _applyUIByStatus unknown status:', status);
                break;
        }
    }

    /** 等待阶段：等待面板可见，桌面/手牌/操作面板全部清空隐藏 */
    private _applyStatusWaiting(): void {
        // _refreshPanelVisibility 已根据 _isGameStarted 拉起 waitingPanel；这里只补 refresh 数据
        const self = this.tongitsModel?.selfPlayer ?? null;
        const baseScore = this.tongitsModel?.getBetAmount() ?? 0;
        this.waitingPanel?.refresh(self, this._isLocalOwner, baseScore);
        // 等待阶段也要显示已积累的奖池金额（不依赖 useId 是否在房间）
        this._refreshPotDisplay();
    }

    /**
     * 还原顶部奖池显示（base 金额 + winCount 数字 + 座位奖杯归属）。
     * 等待 / 游戏中两个状态共用——只要房间存在 pot 信息，金额就要展示给所有玩家。
     */
    private _refreshPotDisplay(): void {
        const pot = this._gameInfo?.pot;
        const potBase = pot?.base ?? 0;
        if (potBase > 0) {
            this.gameStartEffect?.setPotAmount(potBase);
        } else if (this.gameStartEffect?.node) {
            this.gameStartEffect.node.active = false;
        }
        this.potTrophyPanel?.setWinCount(pot?.winCount ?? 0);
        this._refreshPotTrophyOnSeats();
    }

    /**
     * 按 pot.useId 同步座位上的 trophy 显隐：
     *   - 归属玩家（座位 userId === pot.useId）→ showTrophy(winCount)
     *   - 其他座位 → hideTrophy
     * 玩家中途坐下、离开、换座或 pot.useId 变化时调用。
     */
    private _refreshPotTrophyOnSeats(): void {
        const pot = this._gameInfo?.pot;
        const ownerId = pot?.useId ?? 0;
        const winCount = pot?.winCount ?? 0;
        for (let i = 0; i < 3; i++) {
            const seat = this.seatManager?.getSeatByIndex(i);
            if (!seat) continue;
            if (ownerId && seat.getUserId() === ownerId) {
                seat.showTrophy(winCount);
            } else {
                seat.hideTrophy();
            }
        }
    }

    /** 游戏中：桌面 / 手牌 / meld / turn 高亮 / 倒计时 全量还原 */
    private _applyStatusPlaying(): void {
        const gi = this._gameInfo as GameInfo;
        if (!gi) return;
        const selfPlayer = this.tongitsModel?.perspectivePlayer;
        // 0. 顶部奖池还原（重连/中途进入，不播开场动画），与等待状态共用
        this._refreshPotDisplay();

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

        // 3. 自己手牌（无动画，观战时显示拍背占位）
        const isSpec = this._isLocalSpectator;
        this.handCardPanel?.setSpectatorMode(isSpec);
        if (isSpec) {
            this.seatManager?.getSeatByUserId(this._perspectiveId)?.hidePoint();
        } else {
            this.handCardPanel?.setDragEnabled(true);
            // 用服务端下发的 isAuto 同步本地状态（默认 true），避免重连/上一局关过后
            // 本地 _state 与服务端不一致，导致摸牌仍走 merge-expand 动画。
            this.handCardPanel?.setAutoGroupEnabled(selfPlayer?.isAuto ?? true);
        }
        this._refreshPerspectiveHandFromModel();

        // 4. 当前操作玩家高亮 + 倒计时
        const actionId     = gi.actionPlayerId;
        const actionPlayer = this.tongitsModel?.getPlayer(actionId);
        this.seatManager?.updateActionPlayer(actionId);
        if (actionPlayer && (actionPlayer.countdown ?? 0) > 0) {
            // JoinRoomRes 中 countdown 为服务端 Unix 秒时间戳，转换为毫秒
            this.seatManager?.updateCountdown(actionId, actionPlayer.countdown * 1000);
        }
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }
        this.seatManager?.getSeatByUserId(actionId)?.meldField?.startTurnHighlight();

        // 5. 若轮到视角玩家且非观战，先恢复吃牌/补牌状态
        if (this._canPerspectiveOperate) {
            if (this._canPerspectiveDraw) {
                // SELECT 阶段：牌堆可点击抽牌 + 用 model 重算吃牌候选 / 补牌提示
                this.handCardPanel?.setDeckDrawEnabled(true);
                const takeCandidates = this.tongitsModel?.computeTakeCandidates() ?? [];
                if (takeCandidates.length > 0) {
                    this._setTakeCandidates(takeCandidates);
                    this.handCardPanel?.enterTakeMode(takeCandidates);
                    this.tableAreaView?.startDiscardTip();
                }
                const hints = this.tongitsModel?.computeLayoffHints();
                if (hints) this._applyLayoffTips(hints);
            } else if (this._isPerspectiveActioning) {
                // ACTION 阶段（已摸/吃，待出牌）：仅恢复补牌提示
                const hints = this.tongitsModel?.computeLayoffHints();
                if (hints) this._applyLayoffTips(hints);
            }
        }

        // 6. 最后统一刷新操作面板，确保 handButtons / layoffHints 已经是最新
        this._flushActionPanel();
    }

    /** 挑战中：在 Playing 基础上叠加 FightPanel + ChallengeResponsePanel */
    private _applyStatusChallenge(): void {
        this._applyStatusPlaying();
        this._applyChallengeOverlay();
    }

    /** 结算前：在 Playing 基础上叠加 禁用手牌 / 清 gameplay / 显示结果点数 */
    private _applyStatusBeforeResult(): void {
        this._applyStatusPlaying();
        this._applyBeforeResultOverlay();
        const snapshot = this._buildBeforeResultSnapshotFromModel();
        if (snapshot) {
            this._showBeforeResultPresentation(snapshot);
        }
    }

    /**
     * 结算中：在 BeforeResult 基础上叠加结算面板（用 model 缓存兜底）。
     * 重连时若 model.lastPlayerResults 为空，则降级为只显示结果点数（兜底由后续 RoomReset 修复）。
     */
    private _applyStatusResult(): void {
        this._applyStatusPlaying();
        this._applyBeforeResultOverlay();

        const results = this.tongitsModel?.lastPlayerResults ?? [];
        if (!this.tongitsResultPanel || results.length === 0) {
            if (results.length === 0) {
                console.warn('[TongitsView] _applyStatusResult: no cached playerResults; result panel skipped');
            }
            return;
        }
        const winner   = this.tongitsModel?.winnerPlayer;
        const winnerId = winner?.playerInfo?.userId ?? 0;
        const winType  = (this._gameInfo as GameInfo)?.winType ?? this._lastWinType ?? 0;
        // 重连时 countdown 不可知，传 0 让结算面板使用其默认逻辑
        this._showResultPanel(results, winnerId, winType, 0);
    }



    /** 玩家列表变更回调：刷新所有座位 UI */
    protected onPlayersUpdated(_players: TongitsPlayerInfo[]): void {
        this._refreshAllSeats();
        // 玩家坐下/离开/换座后立即按 pot.useId 同步座位奖杯归属
        this._refreshPotTrophyOnSeats();
    }

    /** 游戏信息变更回调：Model 已原地更新，getter 直接读取 */
    protected onGameInfoUpdated(_gameInfo: GameInfo): void {
        // gameInfo.betAmount 是房间底分，每次 gameInfo 变化时同步到顶部 costLabel
        this._refreshCostLabel();
    }

    /** 把 gameInfo.betAmount 同步到 TongitsView 顶部 costLabel */
    private _refreshCostLabel(): void {
        if (!this.costLabel) return;
        const baseScore = this.tongitsModel?.getBetAmount() ?? 0;
        this.costLabel.string = String(baseScore);
    }

    /** 自己信息变更回调：刷新座位和等待面板 */
    protected onSelfUpdated(self: TongitsPlayerInfo): void {
        this.seatManager?.setContext(this._isLocalOwner, this._isGameStarted);
        this._refreshAllSeats();
        // 准备状态变化时刷新 WaitingPanel
        if (!this._isGameStarted) {
            const baseScore = this.tongitsModel?.getBetAmount() ?? 0;
            this.waitingPanel?.refresh(self, this._isLocalOwner,baseScore);
        }

        // 观战 ↔ 正常 模式切换（中途坐下 / 失去座位）
        const wasSpec = this.handCardPanel?.isSpectatorMode ?? false;
        const isSpec  = this._isLocalSpectator;
        if (wasSpec !== isSpec) {
            this.handCardPanel?.setSpectatorMode(isSpec);
            // 重新渲染手牌：观战→正常 用真实手牌，正常→观战 用占位（不传 groupCards 自动拍背）
            if (this._isGameStarted) {
                this._refreshPerspectiveHandFromModel();
                if (!isSpec) {
                    this.handCardPanel?.setDragEnabled(true);
                }
            }
            this._markActionPanelDirty();
        }
    }

    // ══════════════════════════════════════════════════════════
    // ── 广播回调（他人操作 + 全局广播） ─────────────────────
    // ══════════════════════════════════════════════════════════

    /** 游戏开始广播：重置 UI、播放开场动画、发牌 */
    protected onGameStart(data: WithBg<GameStartBroadcast>): void {
        this._resetToPreGame();
        // 先标记为未开始，发牌动画完成后由 onDealMergeComplete 回调中 setContext(_, true) 显示 cardCountNode
        this.seatManager?.setContext(this._isLocalOwner, false);
        this._refreshPanelVisibility();

        if (data.players) {
            this._refreshAllSeats();
        }

        // pot 显示（GameStartBroadcast 独占数据，状态机不管）：winCount + 座位奖杯归属
        this.potTrophyPanel?.setWinCount(data.gameInfo?.pot?.winCount ?? 0);
        this._refreshPotTrophyOnSeats();

        if (data._isBackground) {
            // 后台：跳过开场动画，直接显示 cardCountNode + 走状态机重建
            this.seatManager?.setContext(this._isLocalOwner, true);
            this._applyUIByStatus(GAME_STATUS.PLAYING);
            return;
        }

        // 前台：观战检测 + 计算发牌渲染参数
        const selfPlayer = this.tongitsModel?.perspectivePlayer;
        const isSpec = this._isLocalSpectator;
        this.handCardPanel?.setSpectatorMode(isSpec);
        if (isSpec) {
            this.seatManager?.getSeatByUserId(this._perspectiveId)?.hidePoint();
        } else {
            // 同步服务端 isAuto 状态，避免新局起手后摸牌仍走 merge-expand
            this.handCardPanel?.setAutoGroupEnabled(selfPlayer?.isAuto ?? true);
        }
        const hand = this._getPerspectiveHandSnapshot();
        const groupCards = isSpec ? undefined : hand.flatHand;
        const serverGroups = isSpec ? undefined : hand.serverGroups;

        // 前台：完整开场动画 + 发牌
        this._setDealing(true);
        const potAmount = (data.gameInfo?.pot?.base ?? 0);
        const avatarPositions = this.seatManager?.getAvatarWorldPositions() ?? [];

        this.gameStartEffect?.playSequence(
            avatarPositions,
            potAmount,
            () => {
                if (this.tableAreaView) this.tableAreaView.node.active = true;
                this.handCardPanel?.dealCards(
                    hand.count,
                    groupCards,
                    data.gameInfo?.deckCardCount ?? 0,
                    async ()=>{
                        await Nexus.audio.playSfx("res/audios/send_card");
                    },
                    serverGroups,
                );
            },
        );
    }

    /** 回合切换广播：更新高亮座位、倒计时、吃牌/补牌交互模式 */
    protected onActionChange(data: ActionChangePayload): void {
        // 若该玩家本局被补牌，轮到他操作时解除 ban（清遮罩 + 移出集合）
        // SELF 的 ban 要等到自己弃牌后才解除（onDiscardRes 处理），这里跳过
        if (this._isLayoffTargetBanned(data.actionPlayerId) && this.isNotPerspectivePlayer(data.actionPlayerId)) {
            this._unbanLayoffTarget(data.actionPlayerId);
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

        // 每回合切换由 ActionPanel 刷新中心统一重置/启用
        if (!this._isDealing) {
            // SELECT 阶段：可抽牌/吃牌/挑战 → 开启牌堆点击；其他阶段关闭
            this.handCardPanel?.setDeckDrawEnabled(this._canPerspectiveDraw);
            // 每次回合切换都刷新面板：非自己回合时仅用于恢复 ban 标志（其他按钮因 status=INIT 保持禁用）
            this._markActionPanelDirty();

            // 吃牌模式：Model 已计算好候选，View 直接应用
            if (this._canPerspectiveDraw) {
                if (data.takeCandidates.length > 0) {
                    this._setTakeCandidates(data.takeCandidates);
                    this.handCardPanel?.enterTakeMode(data.takeCandidates);
                    this.tableAreaView?.startDiscardTip();
                } else {
                    this._clearTakeState();
                }
                this._applyLayoffTips(data.layoffHints);
            } else if (this._isPerspectiveTurn && this._isPerspectiveActioning) {
                this._exitTakeMode();
                this._applyLayoffTips(data.layoffHints);
            } else {
                this._exitTakeMode();
                this._clearLayoffTips();
            }
        }
    }

    /** 摸牌广播：自己自动摸牌直接加手牌，他人摸牌播飞牌动画 */
    protected onDraw(data: WithBg<DrawCardBroadcast>): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });

        // 广播中出现自己 = 服务端代操作；观战时被观察者摸牌也走此分支
        if (this.isPerspectivePlayer(data.playerId)) {
            this._exitTakeMode();
            if (this._isLocalSpectator) {
                // 观战：服务端不下发 drawnCard（隐私），按 handCardCount 重刷拍背手牌
                this.tableAreaView?.popDeckCard()?.destroy();
                this._refreshSpectatorHand();
            } else if (data.drawnCard) {
                if (this._isHandAlreadyUpdated(data.handCardCount, data.drawnCard)) {
                    this.tableAreaView?.popDeckCard()?.destroy();
                    this.tableAreaView?.setDeckDrawEnabled(false);
                    this._markActionPanelDirty();
                    return;
                }
                if (data._isBackground) {
                    // 后台：用全量刷新代替有动画的 addCard
                    this.tableAreaView?.popDeckCard()?.destroy();
                    this._rebuildHandFromModel();
                } else {
                    // 前台有动画：ceremony 内部会调用 popDeckCard，此处不重复调用
                    const groups = toServerCards(data.groupCards);
                    this.handCardPanel?.addCard(data.drawnCard, groups);
                }
            } else {
                this.tableAreaView?.popDeckCard()?.destroy();
            }
            this.tableAreaView?.setDeckDrawEnabled(false);
            this._markActionPanelDirty();
            return;
        }

        // 他人摸牌
        if (data._isBackground) {
            // 后台：直接移除牌堆顶牌，不播飞牌动画
            this.tableAreaView?.popDeckCard()?.destroy();
            return;
        }

        // 前台：牌堆弹出顶部节点并飞向对应座位
        const pileTop = this.tableAreaView?.popDeckCard();
        if (!pileTop?.isValid) return;

        const seat          = this.seatManager?.getSeatByUserId(data.playerId);
        const avatarNode    = seat?.cardCountNode;
        if (!avatarNode) { pileTop.destroy(); return; }

        const parent   = this.tableAreaView.node.parent!;
        const fromPos  = pileTop.getWorldPosition();
        parent.addChild(pileTop);
        const toPos = avatarNode.getWorldPosition();
        pileTop.setScale(0.5, 0.5, 1);

        FlyUtil.fly(pileTop, fromPos, toPos, {
            duration:  0.3,
            arcHeight: 150,
            rotate:    1,
            easing:    'quadOut',
            onComplete: () => { if (pileTop.isValid) pileTop.destroy(); },
        });
        tween(pileTop)
            .to(0.3, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .start();
    }

    /** 出牌组广播：服务端代操作时自己也会收到，需处理手牌移除和 meld 添加 */
    protected onMeld(data: WithBg<MeldCardBroadcast>): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        if (this.isPerspectivePlayer(data.playerId) && data.newMeld) {
            if (this._isLocalSpectator) {
                this._refreshSpectatorHand();
            } else {
                this._removeHandCardsAndVerify(data.newMeld.cards);
            }
            this._markActionPanelDirty();
        }
        if (data.newMeld) {
            const seat = this.seatManager?.getSeatByUserId(data.playerId);
            if (seat) {
                if (data._isBackground) {
                    // 后台：无动画直接添加 meld
                    seat.meldField?.addMeld(data.newMeld, undefined, true);
                } else {
                    const fromWorldPos = seat.node.worldPosition.clone();
                    seat.meldField?.addMeld(data.newMeld, fromWorldPos);
                }
            }
        }
    }

    /** 补牌广播：服务端代操作时自己也会收到，需处理手牌移除和 ban */
    protected onLayOff(data: WithBg<LayOffCardBroadcast>): void {
        this._syncPlayerField(data.actionPlayerId, { handCardCount: data.handCardCount });
        this._banLayoffTarget(data.targetPlayerId);
        this._markActionPanelDirty();
        if (this.isPerspectivePlayer(data.actionPlayerId) && data.cardAdded) {
            if (this._isLocalSpectator) {
                this._refreshSpectatorHand();
            } else {
                this._removeHandCardsAndVerify([data.cardAdded]);
            }
        }
        const targetSeat = this.seatManager?.getSeatByUserId(data.targetPlayerId);
        if (targetSeat) {
            if (data._isBackground) {
                // 后台：直接更新 meld 数据，无飞牌动画
                targetSeat.meldField?.layOffToMeld(data.targetMeldId, data.cardAdded, undefined, 1, true);
            } else {
                const actionSeat = this.seatManager?.getSeatByUserId(data.actionPlayerId);
                const fromWorldPos = (this.isPerspectivePlayer(data.actionPlayerId))
                    ? this.handCardPanel?.node.worldPosition.clone()
                    : actionSeat?.cardCountNode?.getWorldPosition().clone()
                        ?? actionSeat?.node.worldPosition.clone();
                targetSeat.meldField?.layOffToMeld(
                    data.targetMeldId, data.cardAdded, fromWorldPos, 0.3,
                );
            }
        }
    }

    /** 弃牌广播：自己自动弃牌直接移除手牌，他人弃牌播飞牌动画到弃牌区 */
    protected onDiscard(data: WithBg<DiscardCardBroadcast>): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        if (!data.discardPile?.length) return;
        // 广播中出现自己 = 服务端代操作
        if (this.isPerspectivePlayer(data.playerId)) {
            if (this._isLocalSpectator) {
                this._refreshSpectatorHand();
            } else if (data.discardedCard) {
                this._removeHandCardAndVerify(data.discardedCard);
            }
            this.tableAreaView?.syncDiscard(data.discardPile);
            this._clearLayoffTips();
            if (this._isLayoffTargetBanned(this._perspectiveId)) {
                this._unbanLayoffTarget(this._perspectiveId);
                this.seatManager?.getSeatByUserId(this._perspectiveId)?.meldField?.clearAllMasks();
            }
            // 弃牌是回合最后一步，_removeHandCardAndVerify 已完成一致性核对。
            this._markActionPanelDirty();
            return;
        }

        if (data._isBackground) {
            // 后台：直接更新弃牌堆，不播飞牌动画
            this.tableAreaView?.syncDiscard(data.discardPile);
            return;
        }

        // 前台：从 cardCountNode 飞向弃牌区
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
        tween(flyCard)
            .to(0.2, { scale: new Vec3(0.6, 0.6, 1) }, { easing: 'quadIn' })
            .start();
    }

    /** 吃牌广播：服务端代操作时自己也会收到，需处��手牌移除和 meld 添加 */
    protected onTake(data: WithBg<TakeCardBroadcast>): void {
        this._syncPlayerField(data.playerId, { handCardCount: data.handCardCount });
        if (!data.newMeld) return;

        // 服务端代操作时自己的手牌需要在 View 侧移除 + 退出吃牌模式
        if (this.isPerspectivePlayer(data.playerId)) {
            this._exitTakeMode();
            // 清掉本地可能残留的 pendingTakeCards（玩家发了 take 请求但被代打掉的竞态场景）
            this._setPendingTakeCards([]);
            if (this._isLocalSpectator) {
                this._refreshSpectatorHand();
            } else if (data.discard) {
                const usedFromHand = data.newMeld.cards.filter(c => c !== data.discard);
                if (usedFromHand.length > 0) {
                    this._removeHandCardsAndVerify(usedFromHand);
                }
            }
            this.tableAreaView?.setDeckDrawEnabled(false);
            this._markActionPanelDirty();
        }

        if (data._isBackground) {
            // 后台：直接更新弃牌堆 + 添加 meld，不播飞牌动画
            const seat = this.seatManager?.getSeatByUserId(data.playerId);
            this.tableAreaView?.syncDiscard(this.tableAreaView?.discardPile?.slice(0, -1) ?? []);
            seat?.meldField?.addMeld(data.newMeld!, undefined, true);
            return;
        }

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

    /** 挑战广播：同步各玩家挑战状态，播发起方动画，弹出响应面板 */
    protected onChallenge(data: WithBg<ChallengeBroadcast>): void {
        this.fightPanel?.reset();
        if (data.basePlayers) {
            for (const bp of data.basePlayers) {
                this._syncPlayerField(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: bp.countdown,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        if (!this._isDealing && this._canPerspectiveOperate) {
            this._markActionPanelDirty();
        }
        this._refreshAllSeats();

        // 后台：跳过 FightPanel 动画
        if (data._isBackground) {
            return;
        }

        // ── FightPanel：先重置再播发起方挑战动画（同一时刻只允许一人发起）──
        if (this.fightPanel) {
            const state = this.tongitsModel?.getChallengeState({
                challengerId: data.playerId,
                cardPoint: data.cardPoint ?? 0,
                basePlayers: data.basePlayers,
            });
            if (state) this._applyChallengeState(state);
        } else {
            console.warn('[onChallenge] fightPanel is null — Inspector 引用未拖入');
        }
    }

    /** PK 广播：更新玩家挑战状态，播接受/拒绝/烧死动画 */
    protected onPK(_data: WithBg<PKBroadcast>): void {
        const data = _data;
        // PK 会改变 challenge 的状态字段（用于 fight 按钮交互）
        this._syncPlayerField(data.playerId, {
            changeStatus: data.changeStatus,
        } as Partial<TongitsPlayerInfo>);
        if (!this._isDealing && this._canPerspectiveOperate) {
            this._markActionPanelDirty();
        }
        this._refreshAllSeats();

        // 后台：跳过 FightPanel 动画
        if (data._isBackground) return;

        this._playChallengeResponseAnimation(data.playerId, data.changeStatus);
    }

    // ══════════════════════════════════════════════════════════
    // ── 自己操作响应（Controller wsRequest 返回后） ──────────
    // ══════════════════════════════════════════════════════════

    /** 自己摸牌响应：退出吃牌模式，加入手牌，刷新操作按钮和补牌提示 */
    protected onDrawRes(data: WithBg<DrawResPayload>): void {
        // 摸牌完成 → 进入 ACTION 阶段，主动更新 model，无需等 ActionChangeBroadcast
        this._syncPlayerField(this._perspectiveId, {
            handCardCount: data.handCardCount,
            status: PLAYER_STATUS.ACTION,
        } as Partial<TongitsPlayerInfo>);
        this.tableAreaView?.setDeckDrawEnabled(false);
        // 选择摸牌 → 退出吃牌模式
        this._exitTakeMode();
        // popDeckCard + 落牌动画 由 HandCardPanel.addCard 统一处理
        if (this._isLocalSpectator) {
            // 观战防御：服务端可能不下发 drawnCard，按 handCardCount 重刷
            this._refreshSpectatorHand();
        } else if (data.drawnCard) {
            if (data._isBackground) {
                this._rebuildHandFromModel();
            } else {
                // 摸牌动画 + 服务端分组一次完成，不再二次刷新
                const groups = toServerCards(data.groupCards);
                this.handCardPanel?.addCard(data.drawnCard, groups);
            }
        }
        this._markActionPanelDirty();
        this._applyLayoffTips(data.layoffHints);
    }

    /** 自己出牌组响应：在 meldField 添加新牌组，刷新操作按钮和补牌提示 */
    protected onMeldRes(data: MeldResPayload): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        if (data.newMeld) {
            this._removeHandCardsAndVerify(data.newMeld.cards);
            const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
            selfSeat?.meldField?.addMeld(data.newMeld);
        }
        this._markActionPanelDirty();
        this._applyLayoffTips(data.layoffHints);
    }

    /** 自己弃牌响应：移除手牌，更新弃牌堆，解除补牌 ban */
    protected onDiscardRes(data: DiscardCardRes): void {
        // 弃牌完成 → 不可操作，等待下一个 ActionChangeBroadcast
        this._syncPlayerField(this._perspectiveId, {
            handCardCount: data.handCardCount,
            status: PLAYER_STATUS.INIT,
        } as Partial<TongitsPlayerInfo>);
        // 从手牌区移除弃出的牌
        if (data.discardedCard) this._removeHandCardAndVerify(data.discardedCard);
        // 更新弃牌堆
        if (data.discardPile?.length) this.tableAreaView?.syncDiscard(data.discardPile);
        // 弃牌后回合结束，清除补牌提示（手牌 tip + meld 块提示），与代打 onDiscard 路径对齐
        this._clearLayoffTips();
        // 弃牌完成才解除 ban（含清遮罩），让挑战禁止标记持续到打完牌
        if (this._isLayoffTargetBanned(this._perspectiveId)) {
            this._unbanLayoffTarget(this._perspectiveId);
            this.seatManager?.getSeatByUserId(this._perspectiveId)?.meldField?.clearAllMasks();
            this._markActionPanelDirty();
        }
        // 弃牌是回合最后一步，_removeHandCardAndVerify 已完成一致性核对。
    }

    /** 自己吃牌响应：退出吃牌模式，移除手牌，添加 meld,刷新弃牌堆 */
    protected onTakeRes(data: TakeResPayload): void {
        // 吃牌成功 → 进入 ACTION 阶段，禁用摸牌/吃牌/挑战
        this._syncPlayerField(this._perspectiveId, {
            handCardCount: data.handCardCount,
            status: PLAYER_STATUS.ACTION,
        } as Partial<TongitsPlayerInfo>);
        this.tableAreaView?.setDeckDrawEnabled(false);
        // 先退出吃牌模式（恢复 click handler、清除高亮），再修改手牌状态
        this._exitTakeMode();
        // 移除手牌区用于吃牌的牌（散牌或牌组内的牌，含牌组解散逻辑）
        this._removeHandCardsAndVerify(this._consumePendingTakeCards());
        // 刷新弃牌区视图（Model 已过滤被吃走的牌）
        this.tableAreaView?.syncDiscard(data.discardPile);
        if (data.newMeld) {
            const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
            selfSeat?.meldField?.addMeld(data.newMeld);
        }
        this._markActionPanelDirty();
        this._applyLayoffTips(data.layoffHints);
    }

    /** 自己补牌响应：从手牌飞向目标 meld，记入 ban 集合 */
    protected onLayOffRes(data: WithBg<LayOffResPayload>): void {
        this._syncPlayerField(this._perspectiveId, { handCardCount: data.handCardCount });
        this._banLayoffTarget(data.targetPlayerId);
        // 用 removeTakeCards 而非 removeCard，确保被补出的牌即使在 group 内也能正确移除
        if (data.cardAdded) this._removeHandCardsAndVerify([data.cardAdded]);
        const targetSeat = this.seatManager?.getSeatByUserId(data.targetPlayerId);
        if (data._isBackground) {
            // 后台：直接更新 meld，无飞牌动画
            targetSeat?.meldField?.layOffToMeld(data.targetMeldId, data.cardAdded, undefined, 1, true);
        } else {
            const handWorldPos = data.cardAdded
                ? (this.handCardPanel?.getCardWorldPos(data.cardAdded) ?? this.handCardPanel?.node.worldPosition.clone())
                : this.handCardPanel?.node.worldPosition.clone();
            targetSeat?.meldField?.layOffToMeld(
                data.targetMeldId, data.cardAdded, handWorldPos,
            );
        }
        this._markActionPanelDirty();
        this._applyLayoffTips(data.layoffHints);
    }

    /** 自己挑战响应：播放挑战/接受/拒绝动画，退出吃牌模式 */
    protected onChallengeRes(data: ChallengeRes): void {
        // 不调 fightPanel.reset()——reset 会清掉所有方向的 zone 动画，
        // 包括其他玩家正在播放的挑战发起动画。各 zone 是按方向独立的，
        // 自己只播自己方向（onPlayerAccept/Fold/Challenge）即可。
        if (data.basePlayers) {
            for (const bp of data.basePlayers) {
                this._syncPlayerField(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: bp.countdown,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        const selfBp = data.basePlayers?.find(bp => this.isPerspectivePlayer(bp.playerId));
        if (selfBp) {
            this._playChallengeResponseAnimation(this._perspectiveId, selfBp.changeStatus);
        } else {
            console.warn('[onChallengeRes] selfBp not found in basePlayers — server didn\'t echo back self');
        }

        // 选择后 → 退出吃牌模式，禁用摸牌/吃牌/挑战
        this._exitTakeMode();
        this.tableAreaView?.setDeckDrawEnabled(false);
        if (!this._isDealing && this._canPerspectiveOperate) {
            this._markActionPanelDirty();
        }
        this._refreshAllSeats();
    }

    // ══════════════════════════════════════════════════════════
    // ── 结算流程 ────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════

    /** 结算前广播：禁用操作，按 winType 播放 Tongits/挑战亮牌/摸完牌结算动画 */
    protected onBeforeResult(data: WithBg<BeforeResultBroadcast>): void {
        this._prepareBeforeResultPresentation();
        if (data.players) {
            this._refreshAllSeats();
        }

        // 缓存 winType，onGameResult 收到完整结算数据后再显示结算面板
        this._setLastWinType(data.winType);

        // 结算前：在座位头像旁显示所有玩家手牌点数（赢/输背景）
        this.seatManager?.showResultPoints(data.winnerId);

        // 后台：跳过结算动画（Tongits/挑战亮牌/奖杯飞行）
        if (data._isBackground) return;

        this._showBeforeResultPresentation(data);
    }

    /** 结算广播：兜底清理游戏态，打开结算面板展示最终数据 */
    protected onGameResult(data: GameResultBroadcast): void {
        this._prepareResultPanelPresentation();
        this._openResultPanel(data);
    }

    /** 进入结算前表现前的统一清理 */
    private _prepareBeforeResultPresentation(): void {
        this.seatManager?.updateActionPlayer(0);
        this.handCardPanel?.setDragEnabled(false);
        this._clearGameplayState();
    }

    /** 结算广播到达时的兜底清理 */
    private _prepareResultPanelPresentation(): void {
        this.handCardPanel?.setDragEnabled(false);
        this.seatManager?.updateActionPlayer(0);
        this._clearGameplayState();
        this._hideActionPanel();
        for (let i = 0; i < 3; i++) {
            this.seatManager?.getSeatByIndex(i)?.meldField?.stopTurnHighlight();
        }
    }

    /** 按胜利类型播放结算前表现 */
    private _showBeforeResultPresentation(data: WithBg<BeforeResultBroadcast>): void {
        switch (data.winType) {
            case WIN_TYPE.TONGITS:
                this._showTongitsBeforeResult(data);
                break;
            case WIN_TYPE.CHALLENGE:
                this._showChallengeBeforeResult(data);
                break;
            case WIN_TYPE.DECK_EMPTY:
                this._showDeckEmptyBeforeResult(data);
                break;
            default:
                this._showDeckEmptyBeforeResult(data);
                break;
        }
    }

    /** Tongits 胜利表现 */
    private _showTongitsBeforeResult(data: WithBg<BeforeResultBroadcast>): void {
        const players = data.players ?? [];
        const winner = players.find(p => p.playerInfo?.userId === data.winnerId);
        if (this.TongitsPanel && winner) {
            this.TongitsPanel.onHide = () => this._showWinnerBonus(players, data.pot);
            const display = this.tongitsModel?.buildShowdownDisplay(winner) ?? winner.groupCards ?? [];
            this.TongitsPanel.show(winner, display);
        } else {
            this._showWinnerBonus(players, data.pot);
        }
    }

    /** 挑战胜利表现 */
    private _showChallengeBeforeResult(data: WithBg<BeforeResultBroadcast>): void {
        const players = data.players ?? [];
        if (!this.fightPanel) {
            this._showWinnerBonus(players, data.pot);
            return;
        }
        this.fightPanel.onBeforeResult();
        const infos = players
            .filter(p => flattenCards(p.groupCards).length > 0)
            .map(p => ({
                userId: p.playerInfo!.userId,
                cards:  flattenCards(p.groupCards),
                points: p.cardPoint ?? 0,
                isWin:  p.isWin ?? false,
            }));
        if (infos.length > 0) {
            this.fightPanel.showShowdown(infos, () => this._showWinnerBonus(players, data.pot));
        } else {
            this._showWinnerBonus(players, data.pot);
        }
    }

    /** 摸完牌结算表现 */
    private _showDeckEmptyBeforeResult(data: WithBg<BeforeResultBroadcast>): void {
        this._showWinnerBonus(data.players ?? [], data.pot);
    }

    /** 打开最终结算面板 */
    private _openResultPanel(data: GameResultBroadcast): void {
        if (!this.tongitsResultPanel || !data.playerResults?.length) return;
        const endTimestamp = (data.countdown ?? 0) > 0 ? data.countdown * 1000 : 0;
        this._showResultPanel(
            data.playerResults,
            data.winnerId,
            this._lastWinType,
            endTimestamp,
        );
    }

    /** 统一打开最终结算面板，并绑定关闭后的收尾清理 */
    private _showResultPanel(
        playerResults: GameResultBroadcast['playerResults'],
        winnerId: number,
        winType: number,
        endTimestamp: number,
    ): void {
        if (!this.tongitsResultPanel || !playerResults?.length) return;
        this.tongitsResultPanel.onHide = () => this._handleResultPanelClosed();
        const snapshots = this.seatManager?.getSeatSnapshots() ?? [];
        this.tongitsResultPanel.show(
            snapshots,
            playerResults,
            winnerId,
            winType,
            this._perspectiveId,
            endTimestamp,
        );
    }

    /** 结算面板关闭后，先把本局展示残留收掉；真正房间数据以后续 RoomReset 为准 */
    private _handleResultPanelClosed(): void {
        if (this.tongitsResultPanel) {
            this.tongitsResultPanel.onHide = null;
        }
        this._resetToPreGame();
    }

    /** 房间重置广播：回到等待状态，刷新 WaitingPanel */
    protected onRoomReset(data: RoomResetBroadcast): void {
        this._resetToPreGame();
        // 状态机统一处理等待 UI（_applyStatusWaiting 内部用 tongitsModel.self，
        // 不依赖 gameInfo.perspectiveId——RoomReset 后 perspectiveId 通常被服务端清为 0）
        this._applyUIByStatus(GAME_STATUS.WAITING);
    }

    /** 结算详情响应：用服务端最新数据刷新详情面板 */
    protected onResultDetails(data: GameResultDetailsRes): void {
        // 用服务端最新数据刷新详情面板（与 onGameResult 缓存的数据一致，但以服务端为准）
        if (data.playerResults?.length) {
            this.tongitsResultPanel?.showDetails(data.playerResults);
        }
    }

    // ══════════════════════════════════════════════════════════
    // ── View → Controller 命令（由 UI 事件调用） ────────────
    // ══════════════════════════════════════════════════════════

    /** 派发摸牌命令 */
    protected draw(): void { this.dispatch(TongitsEvents.CMD_DRAW); }
    /** 派发出牌组命令 */
    protected meld(cards: number[]): void { this.dispatch(TongitsEvents.CMD_MELD, { cards }); }
    /** 派发补牌命令 */
    protected layOff(card: number, targetPlayerId: number, targetMeldId: number): void {
        this.dispatch(TongitsEvents.CMD_LAY_OFF, { card, targetPlayerId, targetMeldId });
    }
    /** 派发弃牌命令 */
    protected discard(card: number): void { this.dispatch(TongitsEvents.CMD_DISCARD, { card }); }
    /** 派发吃牌命令 */
    protected take(cardsFromHand: number[]): void { this.dispatch(TongitsEvents.CMD_TAKE, { cardsFromHand }); }
    /** 派发挑战/接受/拒绝命令 */
    protected challenge(changeStatus: number): void { this.dispatch(TongitsEvents.CMD_CHALLENGE, { changeStatus }); }
    /** 派发房主开始游戏命令 */
    protected startGame(): void { this.dispatch(TongitsEvents.CMD_START_GAME); }
    /** 派发 Tongits 胜利点击确认命令 */
    protected tongitsClick(): void { this.dispatch(TongitsEvents.CMD_TONGITS_CLICK); }
    /** 派发请求结算详情命令 */
    protected resultDetails(): void { this.dispatch(TongitsEvents.CMD_RESULT_DETAILS); }
    /** 派发打开 Mock 面板命令（调试用） */
    protected openMock(){ this.dispatch(TongitsEvents.CMD_OPEN_MOCK); }

    // ══════════════════════════════════════════════════════════
    // ── UI 事件处理（按钮/点击 → 填充数据后 dispatch） ──────
    // ══════════════════════════════════════════════════════════

    /** 牌堆点击：校验轮次和状态后派发摸牌命令 */
    private _onDeckDrawClick(): void {
        // 额外保护：只在轮到自己且 SELECT 阶段时允许抽牌，观战者不可操作
        if (!this._canPerspectiveDraw) return;
        this.draw();
    }

    /** 弃牌区点击：吃牌模式下获取选中手牌后派发吃牌命令 */
    private _onDiscardAreaClick(): void {
        if (this._isLocalSpectator) return;
        if (!this._canTake) return;
        const cards = this.handCardPanel?.getSelectedTakeCards() ?? [];
        if (cards.length === 0) return;
        this._setPendingTakeCards(cards);
        this.take(cards);
    }

    /** Group 按钮：将选中的散牌组合为牌组（本地操作） */
    private _onCmdGroup(): void {
        this.handCardPanel?.onGroupBtn();
    }

    /** Ungroup 按钮：将选中的牌组拆散为散牌（本地操作） */
    private _onCmdUngroup(): void {
        this.handCardPanel?.onUngroupBtn();
    }

    /** Dump 按钮：取出选中散牌，派发弃牌请求；成功响应后再移除 UI */
    private _onCmdDiscard(): void {
        const card = this.handCardPanel?.onDumpBtn();
        if (card == null) return;
        this.discard(card);
    }

    /** Drop 按钮：取出选中牌组并派发请求；成功响应后再移除 UI */
    private _onCmdMeld(): void {
        const group = this.handCardPanel?.onDropBtn();
        if (!group || group.cards.length === 0) return;
        this.meld(group.cards);
    }

    /** Sapaw 按钮：取选中单牌匹配补牌候选，优先补给他人 */
    private _onCmdSapaw(): void {
        const hints = this._layoffHints;
        if (!hints) return;
        const selectedCard = this._handButtons?.selectedSingleCard ?? null;
        if (selectedCard == null) return;
        const candidates = hints.cardCandidates.get(selectedCard);
        if (!candidates || candidates.length === 0) return;

        // 优先选非自己的玩家（不管 meldId 如何），无则从自己的候选中选
        const others = candidates.filter(c => this.isNotPerspectivePlayer(c.playerId));
        const pool   = others.length > 0 ? others : candidates;
        const picked = pool[Math.floor(Math.random() * pool.length)];

        this._clearMeldTips();
        this.layOff(selectedCard, picked.playerId, picked.meldId);
    }

    // ══════════════════════════════════════════════════════════
    // ── 状态重置 / 快照还原 ─────────────────────────────────
    // ══════════════════════════════════════════════════════════

    /** 重置到进房间初始状态 */
    private _resetToPreGame(): void {
        this.handCardPanel?.setDragEnabled(true);
        this._ts = createDefaultTransientState();
        this.seatManager?.resetZoneMap();
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
        this._hideActionPanel();
        this.tongitsPrompt?.hide();
        this.tongitsPrompt?.node && (this.tongitsPrompt.node.active = false);
        if (this.tongitsResultPanel) {
            this.tongitsResultPanel.onHide = null;
            this.tongitsResultPanel.hide();
        }
    }

    /**
     * 清理 View 层纯 UI 瞬态，在快照同步前调用。
     * Layer 4 状态（动画/交互模式/临时标记）直接丢弃，不尝试恢复。
     */
    private _resetUITransientState(): void {
        this._ts = createDefaultTransientState();
        this.handCardPanel?.exitTakeMode();
        this.gameStartEffect?.node && (this.gameStartEffect.node.active = false);
    }


    /** 状态机叠加层（结算前/结算中用）：禁用操作，显示结果点数 */
    private _applyBeforeResultOverlay(): void {
        this.handCardPanel?.setDragEnabled(false);
        this._clearGameplayState();
        // GameInfo 不含 winnerId，从 players.isWin 反推
        const winner = this.tongitsModel?.winnerPlayer;
        const winnerId = winner?.playerInfo?.userId ?? 0;
        this.seatManager?.showResultPoints(winnerId);
    }

    /** 从 Model 当前快照拼出结算前表现所需数据，用于重连/后台恢复 */
    private _buildBeforeResultSnapshotFromModel(): WithBg<BeforeResultBroadcast> | null {
        const players = this._players;
        const gameInfo = this._gameInfo;
        const winType = gameInfo?.winType ?? this._lastWinType;
        if (!players.length || !winType) return null;

        const winner = this.tongitsModel?.winnerPlayer;
        const winnerId = winner?.playerInfo?.userId
            ?? players.find(p => p.isWin)?.playerInfo?.userId
            ?? 0;
        const countdownEnd = this.tongitsModel?.beforeResultCountdownEnd ?? 0;
        return {
            winnerId,
            winType,
            players,
            countdown: countdownEnd > 0 ? Math.floor(countdownEnd / 1000) : 0,
            pot: gameInfo?.pot,
            userId: this._perspectiveId,
        };
    }

    /** 状态机叠加层（挑战中用）：按 Model 的挑战状态还原 FightPanel。 */
    private _applyChallengeOverlay(): void {
        const state = this.tongitsModel?.getChallengeState();
        if (state) this._applyChallengeState(state);
    }

    /** 按 Model 产出的挑战状态恢复/播放 FightPanel */
    private _applyChallengeState(state: ChallengeState): void {
        if (!this.fightPanel || !state.challengerId) return;
        this.fightPanel.node.active = true;
        this.fightPanel.onPlayerChallenge(state.challengerId);

        for (const uid of state.acceptedIds) {
            if (uid !== state.challengerId) this.fightPanel.onPlayerAccept(uid);
        }
        for (const uid of state.foldedIds) {
            if (uid !== state.challengerId) this.fightPanel.onPlayerFold(uid);
        }
        for (const uid of state.burnedIds) {
            if (uid !== state.challengerId) this.fightPanel.onPlayerBurn(uid);
        }

        if (state.shouldShowResponsePanel) {
            this.fightPanel.showResponsePanel(state.responseCardPoint, state.responseCountdown);
        }
    }

    /** 播放单个玩家的挑战响应动画 */
    private _playChallengeResponseAnimation(playerId: number, changeStatus: number): void {
        if (!this.fightPanel || !playerId) return;
        this.fightPanel.node.active = true;
        switch (changeStatus) {
            case CHALLENGE_STATUS.OWNER:
                this.fightPanel.onPlayerChallenge(playerId);
                break;
            case CHALLENGE_STATUS.ACCEPT:
                this.fightPanel.onPlayerAccept(playerId);
                break;
            case CHALLENGE_STATUS.FOLD:
                this.fightPanel.onPlayerFold(playerId);
                break;
            case CHALLENGE_STATUS.BURN:
                this.fightPanel.onPlayerBurn(playerId);
                break;
        }
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
        this._disableActionPanel();
    }

    // ══════════════════════════════════════════════════════════
    // ── UI 刷新 ─────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════

    /**
     * 根据 _isGameStarted 控制 waitingPanel 显隐。
     * actionPanel 由动画回调（与 cardCountNode 同步）单独控制。
     */
    private _refreshPanelVisibility(): void {
        if (this.waitingPanel) {
            const visible = !this._isGameStarted;
            this.waitingPanel.node.active = visible;
            if (!visible) this.waitingPanel.hide();
        }
    }

    /**
     * 标记 ActionPanel 需要刷新（脏标记）。
     * 同帧内多次调用只会在帧末执行一次 _flushActionPanel，避免重复计算。
     */
    private _markActionPanelDirty(): void {
        if (this._actionPanelDirty) return;
        this._actionPanelDirty = true;
        this.scheduleOnce(this._flushActionPanel, 0);
    }

    /** 帧末统一刷新 ActionPanel 的可交互状态 */
    private _flushActionPanel(): void {
        this._actionPanelDirty = false;
        if (!this.actionPanel) return;

        if (!this._isActionPanelVisibleStatus()) {
            this._hideActionPanel();
            return;
        }

        if (this._isDealing) {
            this._disableActionPanel();
            return;
        }

        this._showActionPanelShell();
        this._resetActionPanelForTurn();

        if (this._isLocalSpectator) {
            this._disableActionPanel();
            return;
        }

        const isBanned = this._isLayoffTargetBanned(this._perspectiveId);
        if (!this._isPerspectiveTurn && !isBanned) {
            this._disableActionPanel();
            this._refreshActionPanelGroupButtons();
            return;
        }

        const self = this.tongitsModel?.perspectivePlayer ?? null;
        this.actionPanel?.refresh(self, this._gameInfo, this._handButtons ?? undefined, isBanned);
    }

    /** 按当前 players 数据刷新所有座位 UI */
    private _refreshAllSeats(): void {
        // selfUserId 用于 isSelf 标志（kickBtn / cardCountNode / pointNode 显隐），始终是本地真实用户
        // viewId 用于决定视角座位中心，游戏中=perspectiveId（观战时为被观察者），未开始时降级为 selfUserId
        // isSelfSeated 决定"未坐下时空座优先底部"：从 model.self.seat 是否 > 0 判断
        const selfUserId = this.tongitsModel?.selfPlayerId ?? 0;
        const viewId = this._perspectiveId || selfUserId;
        const isSelfSeated = this.tongitsModel?.isSelfSeated ?? false;
        this.seatManager?.refreshFromPlayers(this._players, selfUserId, viewId, isSelfSeated);
        // refreshFromPlayers 内部 setData 用服务端 cardPoint（游戏中恒为 0）覆盖点数显示；
        // 游戏进行中立即用本地手牌实时计算值覆盖，保持准确。
        if (this._isGameStarted) {
            const selfSeat = this.seatManager?.getSeatByUserId(this._perspectiveId);
            if (this._isLocalSpectator) {
                selfSeat?.hidePoint();
            } else {
                selfSeat?.updateGamePoint(this.handCardPanel?.point ?? 0);
            }
        }
    }

    /** 同步单个玩家的座位 UI（Model 已更新，此处仅刷新视图） */
    private _syncPlayerField(playerId: number, _patch: Partial<TongitsPlayerInfo>): void {
        // model 在 notify 前已通过 updatePlayerById 原地更新，直接从 getter 读取最新数据
        const player = this.tongitsModel?.getPlayer(playerId);
        if (!player) return;
        this.seatManager?.getSeatByUserId(playerId)?.setData(
            player,
            this.isPerspectivePlayer(player.playerInfo?.userId ?? 0),
        );
        // setData 内部 _refresh() 会用 _data.cardPoint（服务端字段，游戏中始终为 0）覆盖 pointLabel。
        // 若更新的是视角玩家且游戏进行中，立即用本地手牌计算值覆盖，保持点数显示准确。
        if (this.isPerspectivePlayer(playerId) && this._isGameStarted) {
            const seat = this.seatManager?.getSeatByUserId(playerId);
            if (this._isLocalSpectator) {
                // 观战时手牌全程拍背，没有本地点数；强制隐藏 setData 后可能被重启的 pointNode
                seat?.hidePoint();
            } else {
                seat?.updateGamePoint(this.handCardPanel?.point ?? 0);
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // ── 吃牌 / 补牌交互 ────────────────────────────────────
    // ══════════════════════════════════════════════════════════

    /**
     * 组牌刷新后恢复吃牌/补牌交互状态。
     * 节点重建后高亮丢失，需用缓存数据重新应用。
     */
    private _restoreInteractionState(): void {
        // 恢复吃牌高亮
        if (this._canTake && this._takeCandidates.length > 0) {
            this.handCardPanel?.enterTakeMode(this._takeCandidates);
        }
        // 恢复补牌提示
        const hints = this._layoffHints;
        if (hints) this._applyLayoffTips(hints);
    }

    /** 退出吃牌模式，清除高亮与提示 */
    private _exitTakeMode(): void {
        this._clearTakeState();
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
        this._setLayoffHints(hints);
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
        const hints = this._layoffHints;
        if (!hints) return;
        // SELECT 阶段不可补牌，仅 ACTION 阶段才驱动 meld 区域提示
        const selfPlayer = this.tongitsModel?.perspectivePlayer;
        if ((selfPlayer?.status ?? 0) !== 3) return;
        const selectedCard = this._handButtons?.selectedSingleCard ?? null;
        if (selectedCard == null) return;
        const candidates = hints.cardCandidates.get(selectedCard);
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
        this._setLayoffHints(null);
        this.handCardPanel?.clearLayoffTips();
        this._clearMeldTips();
    }

    /** WebSDK 播放表情/文字气泡 */
    private _onPlayEmoji(data: { userId: number; type: number; content: string }): void {
        const isResultOpen = this.tongitsResultPanel?.node.active ?? false;

        // 文字气泡：仅结算面板打开时显示，使用 PlayerResultItem.showMessage
        if (data.type === PLAY_EMOJI_TYPE.MESSAGE) {
            if (isResultOpen) {
                this.tongitsResultPanel!.showPlayerMessage(data.userId, data.content);
            }
            return;
        }

        // Spine 表情：结算面板打开时挂到 playerItem，否则挂到游戏座位
        let targetNode: Node | null = null;
        if (isResultOpen) {
            targetNode = this.tongitsResultPanel!.getPlayerItemNode(data.userId);
        }
        if (!targetNode) {
            const seat = this.seatManager?.getSeatByUserId(data.userId);
            targetNode = seat?.node ?? null;
        }
        if (!targetNode) return;

        EmojiPlayer.getInstance().play({ name: data.content, targetNode });
    }

    /** 收到 hasTongits=true，显示 Tongits 提示浮层 */
    private _onHasTongits(): void {
        if (!this.tongitsPrompt) return;
        this.tongitsPrompt.node.active = true;
        this.tongitsPrompt.show();
    }

    /** 游戏即将开始倒计时：隐藏操作按钮，显示开始倒计时 */
    private _onGameReady(data: GameReadyBroadcast): void {
        this.waitingPanel?.showGameStartCountdown(data.countdownSeconds, data.startTime);
    }

    /** 切换自动组牌响应：同步 autoGroup 开关 + 用服务端分组刷新手牌 + 恢复交互状态 */
    private async _onSwitchAutoGroupRes(data: SwitchAutoGroupCardsRes): Promise<void> {
        if (!this.handCardPanel) return;
        const groups = toServerCards(data.groupCards);
        if (!groups) return;
        // setAutoGroupEnabled 先于 refresh，使 setCardsWithServerGroups 内能读到正确的 _lastAutoSortMode
        this.handCardPanel.setAutoGroupEnabled(data.isAuto);
        if (data.isAuto) {
            // 开启：用服务端分组重建并按当前 sortMode 排序，等动画完成后恢复交互
            await this.handCardPanel.refreshWithServerGroupsAnimated(groups);
        } else {
            // 关闭：按开启时记录的 sortMode 重排，无动画
            this.handCardPanel.refreshWithServerGroups(groups);
        }
        this._restoreInteractionState();
    }

    /** 手动组牌响应：用服务端分组刷新手牌 + 恢复交互状态 */
    private _onPlayerGroupCardsRes(data: GamePlayerGroupCardsRes): void {
        const groups = toServerCards(data.groupCards);
        if (!groups) return;
        this.handCardPanel?.refreshWithServerGroups(groups);
        this._restoreInteractionState();
    }

    /** 显示赢家奖励动画（挑战亮牌完成后或摸完牌结算时调用） */
    private _showWinnerBonus(players: TongitsPlayerInfo[], pot?: PotInfo): void {
        // 展示除自己以外所有玩家的手牌
        for (const player of players) {
            const uid = player.playerInfo?.userId;
            const flat = flattenCards(player.groupCards);
            if (!uid || this.isPerspectivePlayer(uid) || !flat.length) continue;
            this.seatManager?.getSeatByUserId(uid)?.meldField?.showHandCards(flat);
        }
        const winner = players.find(p => p.isWin);
        if (winner) {
            const bonus = winner.playerInfo?.coinChanged ?? 0;
            this.seatManager?.showWin(winner.playerInfo!.userId, bonus);
        }

        // 奖杯动画：在赢家座位显示奖杯，飞向顶部 Trophy1
        if (pot !== undefined && this.potTrophyPanel) {
            const winCount = pot.winCount ?? 0;
            // 更新顶部 Trophy1 上的数字（结算时再次刷新）
            this.potTrophyPanel.setWinCount(winCount);

            if (winner) {
                const winnerSeat = this.seatManager?.getSeatByUserId(winner.playerInfo!.userId);
                if (winnerSeat) {
                    const fromPos = winnerSeat.showTrophy(winCount);
                    // toPot2=false：暂时始终飞向 Trophy1，后续按 pot.useId 判断再决定
                    this.potTrophyPanel.playTrophyFly(fromPos, false);
                }
            }
        }
    }
}
