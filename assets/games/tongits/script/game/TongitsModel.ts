import { Nexus } from 'db://nexus-framework/index';
import { BaseGameModel, ROOM_STATE, type JoinRoomData } from 'db://assets/script/base/BaseGameModel';
import { BaseGameEvents } from 'db://assets/script/base/BaseGameEvents';
import { ResultType } from 'db://assets/script/lib/websdk/WebSDKMessages';
import { MessageType } from '../proto/message_type';
import { TongitsEvents } from '../config/TongitsEvents';
import { MeldValidator } from '../utils/MeldValidator';
import { compareCards, SortMode, getPoint } from '../utils/CardDef';
import { judgeGroupType, GroupType } from '../utils/GroupAlgorithm';
import type {
    TongitsPlayerInfo,
    GameInfo,
    Meld,
    Cards,
    PlayerResult,
    GameStartBroadcast,
    GameResultBroadcast,
    RoomResetBroadcast,
    ActionChangeBroadcast,
    DrawCardBroadcast,
    MeldCardBroadcast,
    LayOffCardBroadcast,
    DiscardCardBroadcast,
    TakeCardBroadcast,
    ChallengeBroadcast,
    PKBroadcast,
    BeforeResultBroadcast,
    GameReadyBroadcast,
    DrawCardRes,
    MeldCardRes,
    DiscardCardRes,
    TakeCardRes,
    LayOffCardRes,
    ChallengeRes,
    SwitchAutoGroupCardsRes,
    GamePlayerGroupCardsRes,
} from '../proto/tongits';
import type { PlayerInfo } from 'db://assets/script/proto/game_common_room';

/** 玩家游戏内状态 */ // 吃牌，抽牌，发起挑战 三选一
export const enum PLAYER_STATUS {
    INIT = 1,
    SELECT = 2,
    ACTION = 3,
}

/** 游戏主状态 */
export const enum GAME_STATUS {
    WAITING = 1,
    PLAYING = 2,
    CHALLENGE = 3,
    BEFORE_RESULT = 4,
    RESULT = 5,
}

/** 挑战响应状态 */
export const enum CHALLENGE_STATUS {
    PENDING = 1,
    OWNER = 2,
    ACCEPT = 3,
    FOLD = 4,
    BURN = 5,
}

/** 结算前胜利类型 */
export const enum WIN_TYPE {
    TONGITS = 1,
    CHALLENGE = 2,
    DECK_EMPTY = 3,
}

/** WebSDK 播放表情类型 */
export const enum PLAY_EMOJI_TYPE {
    SPINE = 1,
    MESSAGE = 2,
}

/** 补牌提示数据（Model 计算后随事件 payload 传递给 View） */
export interface LayoffHints {
    /** 手牌中可以补牌的牌值集合 */
    tippedCards: Set<number>;
    /** 各玩家 meldField 中有候选的 meldId 列表（playerId → meldIds） */
    meldTipsByOwner: Map<number, number[]>;
    /** 每张手牌对应的可补候选列表（card → [{playerId, meldId}]） */
    cardCandidates: Map<number, { playerId: number; meldId: number }[]>;
}

/** 挑战阶段 View 所需状态 */
export interface ChallengeState {
    challengerId: number;
    acceptedIds: number[];
    foldedIds: number[];
    burnedIds: number[];
    perspectiveChangeStatus: number;
    shouldShowResponsePanel: boolean;
    responseCountdown: number;
    responseCardPoint: number;
}

/** ActionChange 事件的扩展 payload */
export interface ActionChangePayload extends ActionChangeBroadcast {
    takeCandidates: number[][];
    layoffHints: LayoffHints;
}

/** DrawRes 事件的扩展 payload */
export interface DrawResPayload extends DrawCardRes {
    layoffHints: LayoffHints;
}

/** MeldRes 事件的扩展 payload */
export interface MeldResPayload extends MeldCardRes {
    layoffHints: LayoffHints;
}

/** TakeRes 事件的扩展 payload */
export interface TakeResPayload extends TakeCardRes {
    layoffHints: LayoffHints;
    /** Model 过滤后的弃牌堆（吃牌后移除了被吃的牌） */
    discardPile: number[];
}

/** LayOffRes 事件的扩展 payload */
export interface LayOffResPayload extends LayOffCardRes {
    layoffHints: LayoffHints;
}

/** 将 Cards[] 展开为扁平 number[] */
export function flattenCards(cards: Cards[] | undefined): number[] {
    if (!cards || cards.length === 0) return [];
    const result: number[] = [];
    for (const g of cards) result.push(...g.handCards);
    return result;
}

/** GroupType → proto cardType 映射 */
function toProtoCardType(type: GroupType): number {
    if (type === GroupType.VALID)   return 1;
    if (type === GroupType.SPECIAL) return 2;
    return 0;
}

/** 计算一组牌的点数 */
function calcCardPoint(cards: number[]): number {
    return cards.reduce((sum, c) => sum + getPoint(c), 0);
}

/** 从 Cards[] 中移除指定牌值（空组自动剔除，重算 cardType / cardPoint） */
function removeFromCards(groups: Cards[] | undefined, toRemove: number[]): Cards[] {
    if (!groups) return [];
    const removeSet = new Set(toRemove);
    return groups
        .map(g => {
            const remaining = g.handCards.filter((c: number) => !removeSet.has(c));
            if (remaining.length === 0) return null;
            // 牌值未变化，保持原数据
            if (remaining.length === g.handCards.length) return g;
            return {
                ...g,
                handCards: remaining,
                cardType:  toProtoCardType(judgeGroupType(remaining)),
                cardPoint: calcCardPoint(remaining),
            };
        })
        .filter((g): g is Cards => g !== null);
}

/**
 * Tongits Model：继承 BaseGameModel，补充 tongits 特有的数据操作与广播处理。
 */
export class TongitsModel extends BaseGameModel<TongitsPlayerInfo, GameInfo> {

    private _isGroupSort = true;

    /**
     * 结算前阶段（BeforeResultBroadcast）的倒计时结束时间戳（ms）。
     * GameInfo 协议无此字段，由 model 独立缓存，供 View 重连时还原用。
     */
    beforeResultCountdownEnd: number = 0;

    /**
     * 最近一局的结算详情（GameResultBroadcast.playerResults）。
     * 供结算面板重连时兜底展示；主动请求 3029 会覆盖此值。
     */
    lastPlayerResults: PlayerResult[] = [];

    // ── JoinRoom ─────────────────────────────────────────

    override joinRoom(res: JoinRoomData<TongitsPlayerInfo, GameInfo>): void {
        super.joinRoom(res);
        // 强不变量：mySeat > 0 时 perspectiveId 必须是自己；mySeat === 0（观战）才尊重服务端值。
        // 防止服务端异常下发其他 userId 导致玩家被误判观战或看到别人的手牌。
        this._enforcePerspective();
        // 服务端 players[] 中自己的数据可能不含 groupCards（手牌仅通过 self 下发）；
        // 将 self 的完整数据合并到 players[] 对应项，确保 View 能读到手牌。
        if (this.self && this.myUserId) {
            this.updatePlayerById(this.myUserId, this.self);
        }
    }

    // ── Tongits Getters ──────────────────────────────────

    /** 本地玩家信息（真实自己，不等同于观战视角玩家） */
    get selfPlayer(): TongitsPlayerInfo | null {
        return this.self as TongitsPlayerInfo | null;
    }

    /** 本地玩家 ID */
    get selfPlayerId(): number {
        return this.myUserId;
    }

    /** 本地玩家座位号 */
    get selfSeat(): number {
        return this.mySeat;
    }

    /** 本地玩家是否已入座 */
    get isSelfSeated(): boolean {
        return this.mySeat > 0;
    }

    /** 本地玩家是否是房主 */
    get isLocalOwner(): boolean {
        return (this.selfPlayer?.playerInfo?.post ?? 0) === 1;
    }

    /** 游戏状态 */
    getGameStatus(): GAME_STATUS {
        return ((this.gameInfo as GameInfo)?.status ?? GAME_STATUS.WAITING) as GAME_STATUS;
    }

    /** 游戏是否已开始 */
    get isGameStarted(): boolean {
        return this.getGameStatus() >= GAME_STATUS.PLAYING;
    }

    /** 最大座位数 */
    getMaxSeats(): number {
        return (this.roomInfo as any)?.maxSeat ?? 3;
    }

    /** 当前操作玩家 ID */
    getActionPlayerId(): number {
        return (this.gameInfo as GameInfo)?.actionPlayerId ?? 0;
    }

    /** 当前操作玩家 ID */
    get currentTurnPlayerId(): number {
        return this.getActionPlayerId();
    }

    /** 当前操作玩家 */
    getActionPlayer(): TongitsPlayerInfo | undefined {
        return this.getPlayerByUserId(this.getActionPlayerId());
    }

    /** 当前操作玩家 */
    get currentTurnPlayer(): TongitsPlayerInfo | undefined {
        return this.getActionPlayer();
    }

    /** 当前是否轮到视角玩家 */
    get isPerspectiveTurn(): boolean {
        const actionPlayerId = this.getActionPlayerId();
        return actionPlayerId > 0 && this.isPerspectivePlayer(actionPlayerId);
    }

    /** 当前操作玩家倒计时 */
    getActionPlayerCountdown(): number {
        return this.getActionPlayer()?.countdown ?? 0;
    }

    /** 视角玩家 ID（观战时为被观战者，非观战时为自己） */
    getPerspectiveId(): number {
        return (this.gameInfo as GameInfo)?.perspectiveId ?? 0;
    }

    /** 视角玩家 ID（观战时为被观战者，非观战时为自己） */
    get perspectivePlayerId(): number {
        return this.getPerspectiveId();
    }

    /** 视角玩家（手牌展示和操作焦点使用） */
    get perspectivePlayer(): TongitsPlayerInfo | undefined {
        return this.getPlayerByUserId(this.getPerspectiveId());
    }

    /** 视角玩家当前操作状态 */
    get perspectiveStatus(): number {
        return this.perspectivePlayer?.status ?? PLAYER_STATUS.INIT;
    }

    /** 视角玩家是否处于选择阶段（摸牌/吃牌/挑战） */
    get isPerspectiveSelecting(): boolean {
        return this.perspectiveStatus === PLAYER_STATUS.SELECT;
    }

    /** 视角玩家是否处于行动阶段（出牌/补牌） */
    get isPerspectiveActioning(): boolean {
        return this.perspectiveStatus === PLAYER_STATUS.ACTION;
    }

    /** 视角玩家是否可以摸牌 */
    get canPerspectiveDraw(): boolean {
        return !this.isSpectator() && this.isPerspectiveTurn && this.isPerspectiveSelecting;
    }

    /** 视角玩家是否可以刷新操作按钮 */
    get canPerspectiveOperate(): boolean {
        return !this.isSpectator() && this.isPerspectiveTurn;
    }

    /** 按 userId 获取玩家 */
    getPlayer(userId: number): TongitsPlayerInfo | undefined {
        return this.getPlayerByUserId(userId);
    }

    /** 当前赢家（结算/结算前展示使用） */
    get winnerPlayer(): TongitsPlayerInfo | undefined {
        return this.players.find(p => p.isWin);
    }

    /** 当前挑战发起者 */
    get challengeOwner(): TongitsPlayerInfo | undefined {
        return this.players.find(p => p.changeStatus === CHALLENGE_STATUS.OWNER);
    }

    /** 当前挑战状态（供 View 恢复/播放 FightPanel 使用） */
    getChallengeState(options?: {
        challengerId?: number;
        cardPoint?: number;
        basePlayers?: ChallengeBroadcast['basePlayers'];
    }): ChallengeState {
        const basePlayers = options?.basePlayers;
        const challengerId = options?.challengerId
            ?? basePlayers?.find(p => p.changeStatus === CHALLENGE_STATUS.OWNER)?.playerId
            ?? this.challengeOwner?.playerInfo?.userId
            ?? 0;
        const acceptedIds: number[] = [];
        const foldedIds: number[] = [];
        const burnedIds: number[] = [];

        const pushStatus = (playerId: number, changeStatus: number) => {
            switch (changeStatus) {
                case CHALLENGE_STATUS.ACCEPT: acceptedIds.push(playerId); break;
                case CHALLENGE_STATUS.FOLD:   foldedIds.push(playerId);   break;
                case CHALLENGE_STATUS.BURN:   burnedIds.push(playerId);   break;
            }
        };

        if (basePlayers?.length) {
            for (const p of basePlayers) pushStatus(p.playerId, p.changeStatus);
        } else {
            for (const p of this.players) {
                const uid = p.playerInfo?.userId ?? 0;
                if (uid) pushStatus(uid, p.changeStatus ?? 0);
            }
        }

        const perspectiveId = this.getPerspectiveId();
        const perspectivePlayer = this.perspectivePlayer;
        const perspectiveBasePlayer = basePlayers?.find(p => p.playerId === perspectiveId);
        const perspectiveChangeStatus = perspectiveBasePlayer?.changeStatus
            ?? perspectivePlayer?.changeStatus
            ?? 0;
        const rawCountdown = perspectiveBasePlayer?.countdown ?? perspectivePlayer?.countdown ?? 0;
        const responseCountdown = rawCountdown > 0
            ? (basePlayers?.length ? rawCountdown : rawCountdown * 1000)
            : Date.now() + 10000;

        return {
            challengerId,
            acceptedIds,
            foldedIds,
            burnedIds,
            perspectiveChangeStatus,
            shouldShowResponsePanel:
                perspectiveChangeStatus === CHALLENGE_STATUS.PENDING
                && challengerId > 0
                && !this.isPerspectivePlayer(challengerId)
                && !this.isSpectator(),
            responseCountdown,
            responseCardPoint: options?.cardPoint ?? perspectivePlayer?.cardPoint ?? 0,
        };
    }

    /** 是否是当前视角玩家 */
    isPerspectivePlayer(userId: number): boolean {
        return userId === this.getPerspectiveId();
    }

    /** 是否不是当前视角玩家 */
    isNotPerspectivePlayer(userId: number): boolean {
        return !this.isPerspectivePlayer(userId);
    }

    /** 当前下注币值 */
    getBetAmount(): number {
        return (this.gameInfo as GameInfo)?.betAmount ?? 0;
    }

    /** 手牌排序方式 */
    getIsGroupSort(): boolean { return this._isGroupSort; }
    setIsGroupSort(v: boolean): void { this._isGroupSort = v; }

    /** 获取手牌扁平数组（支持观战视角），向后兼容 View / MeldValidator */
    getHandCards(): number[] {
        return flattenCards(this.getPlayerByUserId(this.getPerspectiveId())?.groupCards);
    }

    /** 当前视角手牌扁平数组 */
    get handCards(): number[] {
        return this.getHandCards();
    }

    /** 获取服务端分组手牌 Cards[]（供组牌功能使用） */
    getHandCardGroups(): Cards[] {
        return this.getPlayerByUserId(this.getPerspectiveId())?.groupCards ?? [];
    }

    /** 当前视角手牌分组 */
    get handGroups(): Cards[] {
        return this.getHandCardGroups();
    }

    /** 获取空座位列表 */
    getEmptySeats(): number[] {
        const occupied = new Set<number>();
        const max = this.getMaxSeats();
        for (const p of this.players) {
            const seat = p.playerInfo?.seat;
            if (seat && seat > 0 && seat <= max) occupied.add(seat);
        }
        const empty: number[] = [];
        for (let i = 1; i <= max; i++) {
            if (!occupied.has(i)) empty.push(i);
        }
        return empty;
    }

    /** 是否纯观战（没坐下 + 没空位） */
    isPureSpectator(): boolean {
        return this.isSpectator() && (this.players.length >= this.getMaxSeats());
    }

    /**
     * 获取以自己为视角排列的玩家列表（逆时针）。
     * 旁观模式下：有空座 → 空座优先；无空座 → 以 perspectiveId 为视角。
     */
    getPlayersWithPosition(): Array<{ player: TongitsPlayerInfo | null; seat: number; isSelf: boolean }> {
        const max = this.getMaxSeats();
        const selfId = this.getPerspectiveId();
        const playersMap = new Map<number, TongitsPlayerInfo>();
        for (const p of this.players) {
            const seat = p.playerInfo?.seat;
            if (seat) playersMap.set(seat, p);
        }

        if (this.mySeat > 0) {
            return this._buildBySeat(this.mySeat, max, playersMap, selfId);
        }

        if (playersMap.size < max) {
            return this._buildEmptyFirst(max, playersMap, selfId);
        }

        const pid = this.getPerspectiveId();
        let viewSeat = 1;
        if (pid) {
            const pp = this.players.find(p => p.playerInfo?.userId === pid);
            viewSeat = pp?.playerInfo?.seat ?? 1;
        }
        return this._buildBySeat(viewSeat, max, playersMap, selfId);
    }

    private _buildBySeat(viewSeat: number, max: number, map: Map<number, TongitsPlayerInfo>, selfId: number) {
        const result: Array<{ player: TongitsPlayerInfo | null; seat: number; isSelf: boolean }> = [];
        for (let i = 0; i < max; i++) {
            const seat = ((viewSeat - 1 + i) % max) + 1;
            const player = map.get(seat) ?? null;
            result.push({ player, seat, isSelf: player?.playerInfo?.userId === selfId });
        }
        return result;
    }

    private _buildEmptyFirst(max: number, map: Map<number, TongitsPlayerInfo>, selfId: number) {
        const empty: Array<{ player: null; seat: number; isSelf: false }> = [];
        const occupied: Array<{ player: TongitsPlayerInfo; seat: number; isSelf: boolean }> = [];
        for (let seat = 1; seat <= max; seat++) {
            const p = map.get(seat);
            if (p) occupied.push({ player: p, seat, isSelf: p.playerInfo?.userId === selfId });
            else empty.push({ player: null, seat, isSelf: false });
        }
        return [...empty, ...occupied];
    }

    // ── WS 广播注册 ──────────────────────────────────────

    protected override registerGameHandlers(): void {
        // guard 包装：冻结期间所有广播直接丢弃，防止积压旧消息污染快照同步后的状态
        const guard = <T>(fn: (msg: T) => void) => (msg: T) => {
            if (!this.handleBroadcast()) return;
            fn(msg);
        };
        Nexus.net.onWsMsg(MessageType.TONGITS_START_GAME_BROADCAST,    guard(this._onGameStart.bind(this)),      this);
        Nexus.net.onWsMsg(MessageType.TONGITS_ACTION_CHANGE_BROADCAST,  guard(this._onActionChange.bind(this)),   this);
        Nexus.net.onWsMsg(MessageType.TONGITS_DRAW_BROADCAST,           guard(this._onDrawBroadcast.bind(this)),  this);
        Nexus.net.onWsMsg(MessageType.TONGITS_MELD_BROADCAST,           guard(this._onMeldBroadcast.bind(this)),  this);
        Nexus.net.onWsMsg(MessageType.TONGITS_LAYOFF_BROADCAST,         guard(this._onLayOffBroadcast.bind(this)), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_DISCARD_BROADCAST,        guard(this._onDiscardBroadcast.bind(this)), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_TAKE_BROADCAST,           guard(this._onTakeBroadcast.bind(this)),  this);
        Nexus.net.onWsMsg(MessageType.TONGITS_CHALLENGE_BROADCAST,      guard(this._onChallenge.bind(this)),      this);
        Nexus.net.onWsMsg(MessageType.TONGITS_PK_BROADCAST,             guard(this._onPK.bind(this)),             this);
        Nexus.net.onWsMsg(MessageType.TONGITS_GAME_WIN_BROADCAST,       guard(this._onBeforeResult.bind(this)),   this);
        Nexus.net.onWsMsg(MessageType.TONGITS_GAME_RESULT_BROADCAST,    guard(this._onGameResult.bind(this)),     this);
        Nexus.net.onWsMsg(MessageType.TONGITS_ROOM_RESET_BROADCAST,     guard(this._onRoomReset.bind(this)),      this);
        Nexus.net.onWsMsg(MessageType.TONGITS_GAME_READY_BROADCAST,     guard(this._onGameReady.bind(this)),      this);
    }

    // ── 广播处理（更新 Model 数据 + notify View） ────────

    private _onGameStart(msg: unknown): void {
        const data = msg as GameStartBroadcast;
        this.updateRoomInfo({ roomStatus: ROOM_STATE.GAME });
        if (data.gameInfo) this.updateGameInfo(data.gameInfo);
        // 服务端 GameStartBroadcast.gameInfo 可能不携带 status 字段（protobuf 默认值省略）；
        // 游戏开始后 status 固定为 2，在此补齐，确保 View 层 _isGameStarted 正确返回 true。
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.status = 2;
        this._enforcePerspective();
        if (data.players) {
            this.updatePlayers(data.players);
            // 仅在视角是自己时同步 self；观战时 self 是观战者本人信息，不能被被观察者覆盖
            if (this.getPerspectiveId() === this.myUserId) {
                const self = data.players.find(p => p.playerInfo?.userId === this.myUserId);
                if (self) this.updateSelf(self);
            }
        }
        this.notify(TongitsEvents.GAME_START, data);
        // 平台上报：游戏开始（座位/userId 用自己的，观战时 mySeat=0）
        this.notify(BaseGameEvents.GAME_STARTED, { userId: this.myUserId, seat: this.mySeat });
    }

    private _onActionChange(msg: ActionChangeBroadcast): void {
        const data = msg as ActionChangeBroadcast;
        // 服务端 countdown 为 Unix 时间戳（秒），统一转为毫秒供客户端使用
        const countdownMs = data.countdown * 1000;
        const gi = this.gameInfo as GameInfo | null;
        if (gi) {
            gi.actionPlayerId = data.actionPlayerId;
            // 新回合开始，游戏回到正常游戏中阶段（挑战结束后 status 可能为 3）
            gi.status = 2;
        }
        // 新回合开始，重置所有玩家的挑战状态（挑战阶段残留的 changeStatus 清零）
        for (const p of this.players) {
            const uid = p.playerInfo?.userId;
            if (uid && p.changeStatus !== 1) {
                this.updatePlayerById(uid, { changeStatus: 1 } as Partial<TongitsPlayerInfo>);
            }
        }
        const actionUpdate: Partial<TongitsPlayerInfo> = {
            status: data.status,
            countdown: countdownMs,
            isFight: data.isFight,
        };
        // 服务端在 ActionChange 中下发最新分组手牌，同步到 Model
        if (data.actionPlayerId === this.getPerspectiveId() || data.groupCards.length > 0) {
            actionUpdate.groupCards = data.groupCards;
        }
        this.updatePlayerById(data.actionPlayerId, actionUpdate as Partial<TongitsPlayerInfo>);

        // 计算吃牌候选和补牌提示（仅轮到视角玩家且在 SELECT 阶段时）
        let takeCandidates: number[][] = [];
        let layoffHints: LayoffHints = this._emptyLayoffHints();
        if (data.actionPlayerId === this.getPerspectiveId() && data.status === PLAYER_STATUS.SELECT) {
            const groupCards = this.getHandCards();
            const pile = gi?.discardPile ?? [];
            const discardCard = pile.length > 0 ? pile[pile.length - 1] : 0;
            if (discardCard) {
                takeCandidates = MeldValidator.findTakeCandidates(groupCards, discardCard);
            }
            layoffHints = this._computeLayoffHints(groupCards);
        }

        const payload: ActionChangePayload = { ...data, countdown: countdownMs, takeCandidates, layoffHints };
        this.notify(TongitsEvents.ACTION_CHANGE, payload);
    }

    private _onDrawBroadcast(msg: unknown): void {
        const data = msg as DrawCardBroadcast;
        // 自己操作时广播不含自己（走 applyDrawRes）；
        // 广播中出现自己 = 服务端代操作，正常处理即可

        const player = this.getPlayerByUserId(data.playerId);
        if (player) {
            if (
                data.playerId === this.getPerspectiveId()
                && data.drawnCard
                && player.handCardCount === data.handCardCount
                && flattenCards(player.groupCards).includes(data.drawnCard)
            ) {
                return;
            }
            const updates: Partial<TongitsPlayerInfo> = { handCardCount: data.handCardCount };
            // 服务端返回分组手牌时直接使用；否则仅更新 handCardCount（其他玩家手牌不可见）
            if (data.playerId === this.getPerspectiveId() || data.groupCards.length > 0) {
                updates.groupCards = data.groupCards;
            }
            updates.status = PLAYER_STATUS.ACTION;
            this.updatePlayerById(data.playerId, updates);
        }
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.deckCardCount = Math.max(0, (gi.deckCardCount ?? 0) - 1);
        this.notify(TongitsEvents.DRAW, data);
    }

    private _onMeldBroadcast(msg: unknown): void {
        const data = msg as MeldCardBroadcast;
        // 自己操作时广播不含自己（走 applyMeldRes）；
        // 广播中出现自己 = 服务端代操作，正常处理即可
        const sortedMeld = data.newMeld
            ? { ...data.newMeld, cards: [...data.newMeld.cards].sort((a, b) => compareCards(a, b, SortMode.BY_RANK)) }
            : undefined;
        const player = this.getPlayerByUserId(data.playerId);
        if (player && sortedMeld) {
            if ((player.displayedMelds ?? []).some(m => m.meldId === sortedMeld.meldId)) {
                return;
            }
            const updates: Partial<TongitsPlayerInfo> = {
                groupCards: removeFromCards(player.groupCards, sortedMeld.cards),
                displayedMelds: [...(player.displayedMelds ?? []), sortedMeld],
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.ACTION,
            };
            this.updatePlayerById(data.playerId, updates);
        }
        this.notify(TongitsEvents.MELD, sortedMeld ? { ...data, newMeld: sortedMeld } : data);
    }

    private _onLayOffBroadcast(msg: unknown): void {
        const data = msg as LayOffCardBroadcast;
        // 自己操作时广播不含自己（走 applyLayOffRes）；
        // 广播中出现自己 = 服务端代操作，正常处理即可
        // 更新目标牌组
        const target = this.getPlayerByUserId(data.targetPlayerId);
        if (target) {
            const alreadyApplied = (target.displayedMelds ?? []).some(m =>
                m.meldId === data.targetMeldId && m.cards.includes(data.cardAdded),
            );
            if (alreadyApplied) return;
            const melds = target.displayedMelds?.map(m => {
                if (m.meldId === data.targetMeldId) {
                    // 顺子按 rank 升序，刻子按花色 ♦→♣→♥→♠；BY_RANK 两种都正确
                    const sorted = [...m.cards, data.cardAdded].sort((a, b) => compareCards(a, b, SortMode.BY_RANK));
                    return { ...m, cards: sorted, highlightCards: data.cardAdded };
                }
                return m;
            }) ?? [];
            this.updatePlayerById(data.targetPlayerId, { displayedMelds: melds } as Partial<TongitsPlayerInfo>);
        }
        // 从操作者手牌移除
        const action = this.getPlayerByUserId(data.actionPlayerId);
        if (action) {
            this.updatePlayerById(data.actionPlayerId, {
                groupCards: removeFromCards(action.groupCards, [data.cardAdded]),
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.SELECT,
            } as Partial<TongitsPlayerInfo>);
        }
        this.notify(TongitsEvents.LAY_OFF, data);
    }

    private _onDiscardBroadcast(msg: unknown): void {
        const data = msg as DiscardCardBroadcast;
        // 自己操作时广播不含自己（走 applyDiscardRes）；
        // 广播中出现自己 = 服务端代操作，正常处理即可

        const player = this.getPlayerByUserId(data.playerId);
        if (player) {
            const updates: Partial<TongitsPlayerInfo> = {
                groupCards: data.discardedCard ? removeFromCards(player.groupCards, [data.discardedCard]) : player.groupCards,
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.INIT,
            };
            // 解锁牌组
            if (data.unlockMelds?.length) {
                updates.displayedMelds = player.displayedMelds?.map(m =>
                    data.unlockMelds.includes(m.meldId) ? { ...m, locked: false } : m
                ) ?? [];
            }
            this.updatePlayerById(data.playerId, updates);
        }
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.discardPile = data.discardPile ?? [];
        this.notify(TongitsEvents.DISCARD, data);
    }

    private _onTakeBroadcast(msg: unknown): void {
        const data = msg as TakeCardBroadcast;
        // 自己操作时广播不含自己（走 applyTakeRes）；
        // 广播中出现自己 = 服务端代操作，正常处理即可
        const sortedMeld = data.newMeld
            ? { ...data.newMeld, cards: [...data.newMeld.cards].sort((a, b) => compareCards(a, b, SortMode.BY_RANK)) }
            : undefined;
        const player = this.getPlayerByUserId(data.playerId);
        if (player && sortedMeld) {
            if ((player.displayedMelds ?? []).some(m => m.meldId === sortedMeld.meldId)) {
                return;
            }
            const updates: Partial<TongitsPlayerInfo> = {
                displayedMelds: [...(player.displayedMelds ?? []), sortedMeld],
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.ACTION,
            };
            // 吃牌时从手牌移除：newMeld.cards 中除了弃牌(discard)以外的牌来自手牌
            if (player.groupCards && data.discard) {
                const usedFromHand = sortedMeld.cards.filter(c => c !== data.discard);
                updates.groupCards = removeFromCards(player.groupCards, usedFromHand);
            }
            this.updatePlayerById(data.playerId, updates);
        }
        const gi = this.gameInfo as GameInfo | null;
        // 吃牌始终取走弃牌堆顶牌（最后一张），用 slice 比按值 filter 更可靠
        if (gi) gi.discardPile = gi.discardPile?.slice(0, -1) ?? [];
        this.notify(TongitsEvents.TAKE, sortedMeld ? { ...data, newMeld: sortedMeld } : data);
    }

    private _onChallenge(msg: unknown): void {
        const data = msg as ChallengeBroadcast;
        // 自己发起的挑战：applyChallengeRes 已处理了 changeStatus/countdown，
        // 但 gi.status 和 basePlayers 中其他玩家仍需在此更新，不能完全跳过。
        // 观战者即使 perspectiveId 与发起人相同，也不算"自己发起"（没有 ChallengeRes）
        const isSelfChallenger = data.playerId === this.getPerspectiveId() && !this.isSpectator();

        // 游戏状态进入挑战阶段
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.status = 3;

        if (data.basePlayers) {
            for (const bp of data.basePlayers) {
                // 视角玩家发起时 applyChallengeRes 已更新了 self 的 changeStatus/countdown，跳过避免重复
                if (isSelfChallenger && bp.playerId === this.getPerspectiveId()) continue;
                // 服务端 countdown 为 Unix 秒时间戳，转为毫秒
                const countdownMs = bp.countdown > 0 ? bp.countdown * 1000 : 0;
                this.updatePlayerById(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: countdownMs,
                } as Partial<TongitsPlayerInfo>);
            }
        }

        // 自己发起时 ChallengeBroadcast 已在 onChallengeRes 处理过 View，此处不重复 notify
        if (isSelfChallenger) return;

        // basePlayers 的 countdown 统一转为 ms 后再透传给 View
        const normalized: ChallengeBroadcast = data.basePlayers ? {
            ...data,
            basePlayers: data.basePlayers.map(bp => ({
                ...bp,
                countdown: bp.countdown > 0 ? bp.countdown * 1000 : 0,
            })),
        } : data;
        this.notify(TongitsEvents.CHALLENGE, normalized);
    }

    private _onPK(msg: unknown): void {
        const data = msg as PKBroadcast;
        this.updatePlayerById(data.playerId, { changeStatus: data.changeStatus } as Partial<TongitsPlayerInfo>);
        this.notify(TongitsEvents.PK, data);
    }

    private _onBeforeResult(msg: unknown): void {
        const data = msg as BeforeResultBroadcast;
        if (data.players) {
            this.updatePlayers(data.players);
            // 仅在视角是自己时同步 self；观战时 self 是观战者本人信息，不能被被观察者覆盖
            if (this.getPerspectiveId() === this.myUserId) {
                const self = data.players.find(p => p.playerInfo?.userId === this.myUserId);
                if (self) this.updateSelf(self);
            }
        }
        const gi = this.gameInfo as GameInfo | null;
        if (gi) {
            if (data.winType) gi.winType = data.winType;
            if (data.pot) gi.pot = data.pot;
            gi.status = 4; // 结算前阶段
        }
        // 缓存结算前倒计时（服务端为 Unix 秒时间戳，转为毫秒）
        if (data.countdown > 0) {
            this.beforeResultCountdownEnd = data.countdown * 1000;
        }
        this.notify(TongitsEvents.BEFORE_RESULT, data);
    }

    private _onGameResult(msg: unknown): void {
        const data = msg as GameResultBroadcast;
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.status = 5;
        // 缓存结算数据，供结算面板重连时兜底展示（主动请求 3029 会覆盖）
        if (data.playerResults?.length) {
            this.lastPlayerResults = data.playerResults;
            // 从 playerResults 中提取玩家数据同步到 Model
            const players = data.playerResults
                .map(r => r.playerInfo)
                .filter((p): p is TongitsPlayerInfo => !!p);
            if (players.length > 0) {
                this.updatePlayers(players);
                // 仅在视角是自己时同步 self；观战时 self 是观战者本人信息，不能被被观察者覆盖
                if (this.getPerspectiveId() === this.myUserId) {
                    const self = players.find(p => p.playerInfo?.userId === this.myUserId);
                    if (self) this.updateSelf(self);
                }
            }
        }
        this.notify(TongitsEvents.GAME_RESULT, data);
        // 平台上报：游戏结束（仅参与玩家上报，观战者跳过）
        if (this.mySeat > 0) {
            const resultType = data.winnerId === this.myUserId ? ResultType.WIN : ResultType.LOSE;
            this.notify(BaseGameEvents.GAME_ENDED, { resultType });
        }
    }

    private _onGameReady(msg: unknown): void {
        const data = msg as GameReadyBroadcast;
        this.notify(TongitsEvents.GAME_READY, data);
    }

    private _onRoomReset(msg: unknown): void {
        const data = msg as RoomResetBroadcast;
        if (data.gameInfo) this.updateGameInfo(data.gameInfo);
        if (data.players) this.updatePlayers(data.players);
        if (data.self) this.updateSelf(data.self);
        // 重置房间状态为等待
        this.updateRoomInfo({ roomStatus: ROOM_STATE.WAIT });
        // RoomReset 后服务端会清空 perspectiveId，统一走强不变量兜底。
        this._enforcePerspective();
        this.notify(TongitsEvents.ROOM_RESET, data);
        // 平台上报：游戏重置回等待状态
        this.notify(BaseGameEvents.GAME_PHASE_RESET);
    }

    // ── 自己操作的响应（wsRequest 返回后调用，更新本地数据）──

    /** 抽牌响应 */
    applyDrawRes(res: DrawCardRes): void {
        const pid = this.getPerspectiveId();
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        // 服务端返回分组手牌时直接使用；否则将摸到的牌追加到散牌组（兼容 Mock / 旧服务端）
        let newHandCards: Cards[];
        if (res.groupCards) {
            newHandCards = res.groupCards;
        } else {
            const flat = flattenCards(player.groupCards);
            if (res.drawnCard) flat.push(res.drawnCard);
            newHandCards = flat.length > 0
                ? [{ groupId: 0, handCards: flat, cardType: 0, cardPoint: 0 }]
                : [];
        }
        this.updatePlayerById(pid, {
            groupCards: newHandCards,
            handCardCount: res.handCardCount,
            isFight: res.hasTongits,
            status: PLAYER_STATUS.ACTION,
        } as Partial<TongitsPlayerInfo>);
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.deckCardCount = Math.max(0, (gi.deckCardCount ?? 0) - 1);
        const flatHand = flattenCards(newHandCards);
        const layoffHints = this._computeLayoffHints(flatHand);
        this.notify<DrawResPayload>(TongitsEvents.DRAW_RES, { ...res, layoffHints });
        if (res.hasTongits) this.notify(TongitsEvents.HAS_TONGITS);
    }

    /** 出牌组响应 */
    applyMeldRes(res: MeldCardRes): void {
        if (!res.newMeld) return;
        const pid = this.getPerspectiveId();
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const newHandCards = removeFromCards(player.groupCards, res.newMeld.cards);
        const sortedMeld = { ...res.newMeld, cards: [...res.newMeld.cards].sort((a, b) => compareCards(a, b, SortMode.BY_RANK)) };
        this.updatePlayerById(pid, {
            groupCards: newHandCards,
            displayedMelds: [...(player.displayedMelds ?? []), sortedMeld],
            handCardCount: res.handCardCount,
            isFight: res.hasTongits,
            status: PLAYER_STATUS.ACTION,
        } as Partial<TongitsPlayerInfo>);
        // updatePlayerById 已更新 displayedMelds，_computeLayoffHints 读最新 players 数据
        const flatHand = flattenCards(newHandCards);
        const layoffHints = this._computeLayoffHints(flatHand);
        this.notify<MeldResPayload>(TongitsEvents.MELD_RES, { ...res, newMeld: sortedMeld, layoffHints });
        if (res.hasTongits) this.notify(TongitsEvents.HAS_TONGITS);
    }

    /** 弃牌响应 */
    applyDiscardRes(res: DiscardCardRes): void {
        const pid = this.getPerspectiveId();
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const updates: Partial<TongitsPlayerInfo> = {
            groupCards: res.discardedCard ? removeFromCards(player.groupCards, [res.discardedCard]) : player.groupCards,
            handCardCount: res.handCardCount,
            status: PLAYER_STATUS.INIT,
        };
        if (res.unlockMelds?.length) {
            updates.displayedMelds = player.displayedMelds?.map(m =>
                res.unlockMelds.includes(m.meldId) ? { ...m, locked: false } : m
            ) ?? [];
        }
        this.updatePlayerById(pid, updates);
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.discardPile = res.discardPile ?? [];
        this.notify<DiscardCardRes>(TongitsEvents.DISCARD_RES, res);
    }

    /** 吃牌响应 */
    applyTakeRes(res: TakeCardRes): void {
        if (!res.newMeld) return;
        const pid = this.getPerspectiveId();
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const sortedMeld = { ...res.newMeld, cards: [...res.newMeld.cards].sort((a, b) => compareCards(a, b, SortMode.BY_RANK)) };
        const updates: Partial<TongitsPlayerInfo> = {
            displayedMelds: [...(player.displayedMelds ?? []), sortedMeld],
            handCardCount: res.handCardCount,
            isFight: res.hasTongits,
            status: PLAYER_STATUS.ACTION,
        };
        let newHandCards: Cards[] = player.groupCards ?? [];
        if (res.discard) {
            const usedFromHand = res.newMeld.cards.filter(c => c !== res.discard);
            newHandCards = removeFromCards(newHandCards, usedFromHand);
            updates.groupCards = newHandCards;
        }
        this.updatePlayerById(pid, updates);
        const gi = this.gameInfo as GameInfo | null;
        if (gi) {
            // 吃牌始终取走弃牌堆顶牌（最后一张），用 slice 比按值 filter 更可靠
            gi.discardPile = gi.discardPile?.slice(0, -1) ?? [];
        }
        const flatHand = flattenCards(newHandCards);
        const layoffHints = this._computeLayoffHints(flatHand);
        this.notify<TakeResPayload>(TongitsEvents.TAKE_RES, { ...res, newMeld: sortedMeld, layoffHints, discardPile: gi?.discardPile ?? [] });
        if (res.hasTongits) this.notify(TongitsEvents.HAS_TONGITS);
    }

    /** 补牌/压牌响应 */
    applyLayOffRes(res: LayOffCardRes): void {
        const pid = this.getPerspectiveId();
        // 更新目标牌组
        const target = this.getPlayerByUserId(res.targetPlayerId);
        if (target) {
            const melds = target.displayedMelds?.map(m => {
                if (m.meldId === res.targetMeldId) {
                    // 顺子按 rank 升序，刻子按花色 ♦→♣→♥→♠；BY_RANK 两种都正确
                    const sorted = [...m.cards, res.cardAdded].sort((a, b) => compareCards(a, b, SortMode.BY_RANK));
                    return { ...m, cards: sorted, highlightCards: res.cardAdded };
                }
                return m;
            }) ?? [];
            this.updatePlayerById(res.targetPlayerId, { displayedMelds: melds } as Partial<TongitsPlayerInfo>);
        }
        // 从自己手牌移除
        const me = this.getPlayerByUserId(pid);
        let newHandCards: Cards[] = me?.groupCards ?? [];
        if (me) {
            newHandCards = removeFromCards(me.groupCards, [res.cardAdded]);
            this.updatePlayerById(pid, {
                groupCards: newHandCards,
                handCardCount: res.handCardCount,
                status: PLAYER_STATUS.ACTION,
            } as Partial<TongitsPlayerInfo>);
        }
        // 更新完 displayedMelds 和手牌后再计算（反映最新牌组状态）
        const flatHand = flattenCards(newHandCards);
        const layoffHints = this._computeLayoffHints(flatHand);
        this.notify<LayOffResPayload>(TongitsEvents.LAY_OFF_RES, { ...res, layoffHints });
        if (res.hasTongits) this.notify(TongitsEvents.HAS_TONGITS);
    }

    // ── 私有：视角强不变量 ────────────────────────────────

    /**
     * 强不变量：mySeat > 0 时 perspectiveId 必须等于 myUserId（玩家只看自己）。
     * mySeat === 0（观战）时尊重服务端值——观战者视角是被观察玩家。
     * 在 joinRoom / RoomReset / GameStart 三个入口统一调用。
     */
    private _enforcePerspective(): void {
        const gi = this.gameInfo as GameInfo | null;
        if (!gi) return;
        if (this.mySeat > 0) {
            if (gi.perspectiveId !== this.myUserId) {
                gi.perspectiveId = this.myUserId;
            }
        }
    }

    // ── 私有：提示数据计算 ────────────────────────────────

    /** 空提示数据（无候选时使用） */
    private _emptyLayoffHints(): LayoffHints {
        return { tippedCards: new Set(), meldTipsByOwner: new Map(), cardCandidates: new Map() };
    }

    /**
     * 重连/状态还原用：根据当前 model 数据计算视角玩家的吃牌候选。
     * 弃牌堆为空或无可组合候选时返回空数组。
     */
    computeTakeCandidates(): number[][] {
        const gi = this.gameInfo as GameInfo | null;
        const pile = gi?.discardPile ?? [];
        const discardCard = pile.length > 0 ? pile[pile.length - 1] : 0;
        if (!discardCard) return [];
        return MeldValidator.findTakeCandidates(this.getHandCards(), discardCard);
    }

    /** 重连/状态还原用：根据当前 model 数据计算视角玩家的补牌提示。 */
    computeLayoffHints(): LayoffHints {
        return this._computeLayoffHints(this.getHandCards());
    }

    /**
     * 结算亮牌：将玩家的 displayedMelds 合并到 groupCards 后面，输出统一的 Cards[]。
     *
     * 规则：
     *   - groupCards 原样保留（含散牌组 cardType=0 与有效组 cardType>0）
     *   - displayedMelds 转为 Cards 项追加：cardType 用 judgeGroupType 重算（1=有效, 2=特殊）
     *   - groupId 在原数据基础上递增，避免与手牌组冲突
     *   - cardPoint 按组内点数和重算（tongits 时散牌组为空，整体散牌点数=0）
     *
     * 返回新数组，不修改原 player 数据。
     */
    buildShowdownDisplay(player: TongitsPlayerInfo): Cards[] {
        const result: Cards[] = [];

        // 1. 手牌中的服务端分组（保留原 cardType / cardPoint）
        if (player.groupCards) {
            for (const g of player.groupCards) {
                result.push({ ...g, handCards: [...(g.handCards ?? [])] });
            }
        }

        // 2. displayedMelds 追加为 Cards 项
        let nextGroupId = result.reduce((m, g) => Math.max(m, g.groupId ?? 0), 0) + 1;
        if (player.displayedMelds) {
            for (const m of player.displayedMelds) {
                const cards = m.cards ?? [];
                if (cards.length === 0) continue;
                result.push({
                    groupId:   nextGroupId++,
                    handCards: [...cards],
                    cardType:  toProtoCardType(judgeGroupType(cards)),
                    cardPoint: calcCardPoint(cards),
                });
            }
        }

        return result;
    }

    /**
     * 计算手牌中哪些牌可以补入哪些玩家的牌组。
     * 逐玩家检测避免不同玩家 meldId 碰撞。
     */
    private _computeLayoffHints(groupCards: number[]): LayoffHints {
        if (groupCards.length === 0) return this._emptyLayoffHints();
        const tippedCards     = new Set<number>();
        const meldTipsByOwner = new Map<number, number[]>();
        const cardCandidates  = new Map<number, { playerId: number; meldId: number }[]>();
        for (const player of this.players) {
            const uid = player.playerInfo?.userId;
            if (!uid) continue;
            const meldData = (player.displayedMelds ?? []).map(m => ({ meldId: m.meldId, cards: m.cards }));
            if (meldData.length === 0) continue;
            const candidateMap = MeldValidator.findLayoffCandidates(groupCards, meldData);
            if (candidateMap.size === 0) continue;
            for (const [card, meldIds] of candidateMap) {
                tippedCards.add(card);
                if (!cardCandidates.has(card)) cardCandidates.set(card, []);
                for (const meldId of meldIds) {
                    cardCandidates.get(card)!.push({ playerId: uid, meldId });
                }
            }
            const affectedIds = new Set<number>();
            for (const ids of candidateMap.values()) {
                for (const id of ids) affectedIds.add(id);
            }
            meldTipsByOwner.set(uid, [...affectedIds]);
        }
        return { tippedCards, meldTipsByOwner, cardCandidates };
    }

    /** 挑战响应 */
    applyChallengeRes(res: ChallengeRes): void {
        if (res.basePlayers) {
            for (const bp of res.basePlayers) {
                // 服务端 countdown 为 Unix 秒时间戳，统一转为毫秒
                const countdownMs = bp.countdown > 0 ? bp.countdown * 1000 : 0;
                this.updatePlayerById(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: countdownMs,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        // 透传给 View 时同样转为 ms
        const normalized: ChallengeRes = res.basePlayers ? {
            ...res,
            basePlayers: res.basePlayers.map(bp => ({
                ...bp,
                countdown: bp.countdown > 0 ? bp.countdown * 1000 : 0,
            })),
        } : res;
        this.notify<ChallengeRes>(TongitsEvents.CHALLENGE_RES, normalized);
    }

    /** 切换自动组牌响应：更新 isAuto 和手牌分组 */
    applySwitchAutoGroupRes(res: SwitchAutoGroupCardsRes): void {
        const pid = this.getPerspectiveId();
        const updates: Partial<TongitsPlayerInfo> = { isAuto: res.isAuto };
        updates.groupCards = res.groupCards;
        this.updatePlayerById(pid, updates);
        this.notify<SwitchAutoGroupCardsRes>(TongitsEvents.SWITCH_AUTO_GROUP_RES, res);
    }

    /** 手动组牌响应：更新手牌分组 */
    applyPlayerGroupCardsRes(res: GamePlayerGroupCardsRes): void {
        const pid = this.getPerspectiveId();
        this.updatePlayerById(pid, { groupCards: res.groupCards } as Partial<TongitsPlayerInfo>);
        this.notify<GamePlayerGroupCardsRes>(TongitsEvents.PLAYER_GROUP_CARDS_RES, res);
    }
}
