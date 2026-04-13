import { Nexus } from 'db://nexus-framework/index';
import { BaseGameModel, ROOM_STATE, type JoinRoomData } from 'db://assets/script/base/BaseGameModel';
import { MessageType } from '../proto/message_type';
import { TongitsEvents } from '../config/TongitsEvents';
import { MeldValidator } from '../utils/MeldValidator';
import type {
    TongitsPlayerInfo,
    GameInfo,
    Meld,
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
    DrawCardRes,
    MeldCardRes,
    DiscardCardRes,
    TakeCardRes,
    LayOffCardRes,
    ChallengeRes,
} from '../proto/tongits';
import type { PlayerInfo } from 'db://assets/script/proto/game_common_room';

/** 玩家游戏内状态 */ // 吃牌，抽牌，发起挑战 三选一
const enum PLAYER_STATUS {
    INIT = 1,
    SELECT = 2,
    ACTION = 3,
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

/**
 * Tongits Model：继承 BaseGameModel，补充 tongits 特有的数据操作与广播处理。
 */
export class TongitsModel extends BaseGameModel<TongitsPlayerInfo, GameInfo> {

    private _isGroupSort = true;

    // ── JoinRoom ─────────────────────────────────────────

    override joinRoom(res: JoinRoomData<TongitsPlayerInfo, GameInfo>): void {
        super.joinRoom(res);
        console.log('【TongitsModel】joinRoom roomInfo:', this.roomInfo);
        console.log('【TongitsModel】joinRoom players:', this.players);
        console.log('【TongitsModel】joinRoom self:', this.self);
        console.log('【TongitsModel】joinRoom gameInfo:', this.gameInfo);
        console.log('【TongitsModel】joinRoom watchers:', this.watchers, 'speakers:', this.speakers);
    }

    // ── Tongits Getters ──────────────────────────────────

    /** 游戏状态 */
    getGameStatus(): number {
        return (this.gameInfo as GameInfo)?.status ?? 1;
    }

    /** 最大座位数 */
    getMaxSeats(): number {
        return (this.roomInfo as any)?.maxSeat ?? 3;
    }

    /** 当前操作玩家 ID */
    getActionPlayerId(): number {
        return (this.gameInfo as GameInfo)?.actionPlayerId ?? 0;
    }

    /** 当前操作玩家 */
    getActionPlayer(): TongitsPlayerInfo | undefined {
        return this.getPlayerByUserId(this.getActionPlayerId());
    }

    /** 当前操作玩家倒计时 */
    getActionPlayerCountdown(): number {
        return this.getActionPlayer()?.countdown ?? 0;
    }

    /** 视角玩家 ID（观战时使用） */
    getPerspectiveId(): number {
        return (this.gameInfo as GameInfo)?.perspectiveId ?? 0;
    }

    /** 当前下注币值 */
    getBetAmount(): number {
        return (this.gameInfo as GameInfo)?.betAmount ?? 0;
    }

    /** 手牌排序方式 */
    getIsGroupSort(): boolean { return this._isGroupSort; }
    setIsGroupSort(v: boolean): void { this._isGroupSort = v; }

    /** 获取手牌（支持观战视角） */
    getHandCards(): number[] {
        let pid = this.getPerspectiveId();
        if (!pid) pid = this.myUserId;
        return this.getPlayerByUserId(pid)?.handCards ?? [];
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
        const selfId = this.myUserId;
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
        Nexus.net.onWsMsg(MessageType.TONGITS_START_GAME_BROADCAST, this._onGameStart.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_ACTION_CHANGE_BROADCAST, this._onActionChange.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_DRAW_BROADCAST, this._onDrawBroadcast.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_MELD_BROADCAST, this._onMeldBroadcast.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_LAYOFF_BROADCAST, this._onLayOffBroadcast.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_DISCARD_BROADCAST, this._onDiscardBroadcast.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_TAKE_BROADCAST, this._onTakeBroadcast.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_CHALLENGE_BROADCAST, this._onChallenge.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_PK_BROADCAST, this._onPK.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_GAME_WIN_BROADCAST, this._onBeforeResult.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_GAME_RESULT_BROADCAST, this._onGameResult.bind(this), this);
        Nexus.net.onWsMsg(MessageType.TONGITS_ROOM_RESET_BROADCAST, this._onRoomReset.bind(this), this);
    }

    // ── 广播处理（更新 Model 数据 + notify View） ────────

    private _onGameStart(msg: unknown): void {
        const data = msg as GameStartBroadcast;
        this.updateRoomInfo({ roomStatus: ROOM_STATE.GAME });
        if (data.gameInfo) this.updateGameInfo(data.gameInfo);
        if (data.players) {
            this.updatePlayers(data.players);
            // 同步 self
            const self = data.players.find(p => p.playerInfo?.userId === this.myUserId);
            if (self) this.updateSelf(self);
        }
        this.notify(TongitsEvents.GAME_START, data);
    }

    private _onActionChange(msg: ActionChangeBroadcast): void {
        const data = msg as ActionChangeBroadcast;
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.actionPlayerId = data.actionPlayerId;
        this.updatePlayerById(data.actionPlayerId, {
            status: data.status,
            countdown: data.countdown,
            isFight: data.isFight,
        } as Partial<TongitsPlayerInfo>);

        // 计算吃牌候选和补牌提示（仅轮到自己且在 SELECT 阶段时）
        let takeCandidates: number[][] = [];
        let layoffHints: LayoffHints = this._emptyLayoffHints();
        if (data.actionPlayerId === this.myUserId && data.status === PLAYER_STATUS.SELECT) {
            const handCards = this.getHandCards();
            const pile = gi?.discardPile ?? [];
            const discardCard = pile.length > 0 ? pile[pile.length - 1] : 0;
            if (discardCard) {
                takeCandidates = MeldValidator.findTakeCandidates(handCards, discardCard);
            }
            layoffHints = this._computeLayoffHints(handCards);
        }

        const payload: ActionChangePayload = { ...data, takeCandidates, layoffHints };
        this.notify(TongitsEvents.ACTION_CHANGE, payload);
    }

    private _onDrawBroadcast(msg: unknown): void {
        const data = msg as DrawCardBroadcast;
        // 自己的抽牌已由 applyDrawRes 处理（状态+notify），避免重复
        if (data.playerId === this.myUserId) return;
        const player = this.getPlayerByUserId(data.playerId);
        if (player) {
            const updates: Partial<TongitsPlayerInfo> = { handCardCount: data.handCardCount };
            // drawnCard !== 0 时表示可见（自己或自动抽牌），0 表示其他玩家不可见
            if (data.drawnCard !== 0) {
                updates.handCards = [...(player.handCards ?? []), data.drawnCard];
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
        // 自己的出牌已由 applyMeldRes 处理（状态+notify），避免重复
        if (data.playerId === this.myUserId) return;
        const player = this.getPlayerByUserId(data.playerId);
        if (player && data.newMeld) {
            const updates: Partial<TongitsPlayerInfo> = {
                handCards: player.handCards?.filter(c => !data.newMeld!.cards.includes(c)) ?? [],
                displayedMelds: [...(player.displayedMelds ?? []), data.newMeld],
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.ACTION,
            };
            this.updatePlayerById(data.playerId, updates);
        }
        this.notify(TongitsEvents.MELD, data);
    }

    private _onLayOffBroadcast(msg: unknown): void {
        const data = msg as LayOffCardBroadcast;
        // 自己的补牌已由 applyLayOffRes 处理（状态+notify），避免重复
        if (data.actionPlayerId === this.myUserId) return;
        // 更新目标牌组
        const target = this.getPlayerByUserId(data.targetPlayerId);
        if (target) {
            const melds = target.displayedMelds?.map(m => {
                if (m.meldId === data.targetMeldId) {
                    return { ...m, cards: [...m.cards, data.cardAdded].sort((a, b) => a - b), highlightCards: data.cardAdded };
                }
                return m;
            }) ?? [];
            this.updatePlayerById(data.targetPlayerId, { displayedMelds: melds } as Partial<TongitsPlayerInfo>);
        }
        // 从操作者手牌移除
        const action = this.getPlayerByUserId(data.actionPlayerId);
        if (action) {
            this.updatePlayerById(data.actionPlayerId, {
                handCards: action.handCards?.filter(c => c !== data.cardAdded) ?? [],
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.SELECT,
            } as Partial<TongitsPlayerInfo>);
        }
        this.notify(TongitsEvents.LAY_OFF, data);
    }

    private _onDiscardBroadcast(msg: unknown): void {
        const data = msg as DiscardCardBroadcast;
        // 自己的弃牌已由 applyDiscardRes 处理（状态+notify），避免重复
        if (data.playerId === this.myUserId) return;
        const player = this.getPlayerByUserId(data.playerId);
        if (player) {
            const updates: Partial<TongitsPlayerInfo> = {
                handCards: data.discardedCard ? player.handCards?.filter(c => c !== data.discardedCard) ?? [] : player.handCards,
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
        // 自己的吃牌已由 applyTakeRes 处理（状态+notify），避免重复
        if (data.playerId === this.myUserId) return;
        const player = this.getPlayerByUserId(data.playerId);
        if (player && data.newMeld) {
            const updates: Partial<TongitsPlayerInfo> = {
                displayedMelds: [...(player.displayedMelds ?? []), data.newMeld],
                handCardCount: data.handCardCount,
                status: PLAYER_STATUS.ACTION,
            };
            // 吃牌时从手牌移除：newMeld.cards 中除了弃牌(discard)以外的牌来自手牌
            if (player.handCards && data.discard) {
                const usedFromHand = data.newMeld.cards.filter(c => c !== data.discard);
                updates.handCards = player.handCards.filter(c => !usedFromHand.includes(c));
            }
            this.updatePlayerById(data.playerId, updates);
        }
        const gi = this.gameInfo as GameInfo | null;
        if (gi && data.discard) {
            gi.discardPile = gi.discardPile?.filter(c => c !== data.discard) ?? [];
        }
        this.notify(TongitsEvents.TAKE, data);
    }

    private _onChallenge(msg: unknown): void {
        const data = msg as ChallengeBroadcast;
        // 自己发起的挑战已由 applyChallengeRes 处理（状态+notify），避免重复
        if (data.playerId === this.myUserId) return;
        if (data.basePlayers) {
            for (const bp of data.basePlayers) {
                this.updatePlayerById(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: bp.countdown,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        this.notify(TongitsEvents.CHALLENGE, data);
    }

    private _onPK(msg: unknown): void {
        const data = msg as PKBroadcast;
        this.updatePlayerById(data.playerId, { changeStatus: data.changeStatus } as Partial<TongitsPlayerInfo>);
        this.notify(TongitsEvents.PK, data);
    }

    private _onBeforeResult(msg: unknown): void {
        const data = msg as BeforeResultBroadcast;
        if (data.players) this.updatePlayers(data.players);
        // 更新 gameInfo 的 winType 和 pot
        const gi = this.gameInfo as GameInfo | null;
        if (gi) {
            if (data.winType) gi.winType = data.winType;
            if (data.pot) gi.pot = data.pot;
            gi.status = 4; // 结算前阶段
        }
        this.notify(TongitsEvents.BEFORE_RESULT, data);
    }

    private _onGameResult(msg: unknown): void {
        const data = msg as GameResultBroadcast;
        // 更新游戏状态为结算中
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.status = 5;
        this.notify(TongitsEvents.GAME_RESULT, data);
    }

    private _onRoomReset(msg: unknown): void {
        const data = msg as RoomResetBroadcast;
        if (data.gameInfo) this.updateGameInfo(data.gameInfo);
        if (data.players) this.updatePlayers(data.players);
        if (data.self) this.updateSelf(data.self);
        // 重置房间状态为等待
        this.updateRoomInfo({ roomStatus: ROOM_STATE.WAIT });
        this.notify(TongitsEvents.ROOM_RESET, data);
    }

    // ── 自己操作的响应（wsRequest 返回后调用，更新本地数据）──

    /** 抽牌响应 */
    applyDrawRes(res: DrawCardRes): void {
        const pid = this.myUserId;
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const newHandCards = [...(player.handCards ?? []), res.drawnCard];
        this.updatePlayerById(pid, {
            handCards: newHandCards,
            handCardCount: res.handCardCount,
            isFight: res.hasTongits,
            status: PLAYER_STATUS.ACTION,
        } as Partial<TongitsPlayerInfo>);
        const gi = this.gameInfo as GameInfo | null;
        if (gi) gi.deckCardCount = Math.max(0, (gi.deckCardCount ?? 0) - 1);
        const layoffHints = this._computeLayoffHints(newHandCards);
        this.notify<DrawResPayload>(TongitsEvents.DRAW_RES, { ...res, layoffHints });
    }

    /** 出牌组响应 */
    applyMeldRes(res: MeldCardRes): void {
        if (!res.newMeld) return;
        const pid = this.myUserId;
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const newHandCards = player.handCards?.filter(c => !res.newMeld!.cards.includes(c)) ?? [];
        this.updatePlayerById(pid, {
            handCards: newHandCards,
            displayedMelds: [...(player.displayedMelds ?? []), res.newMeld],
            handCardCount: res.handCardCount,
            isFight: res.hasTongits,
            status: PLAYER_STATUS.ACTION,
        } as Partial<TongitsPlayerInfo>);
        // updatePlayerById 已更新 displayedMelds，_computeLayoffHints 读最新 players 数据
        const layoffHints = this._computeLayoffHints(newHandCards);
        this.notify<MeldResPayload>(TongitsEvents.MELD_RES, { ...res, layoffHints });
    }

    /** 弃牌响应 */
    applyDiscardRes(res: DiscardCardRes): void {
        const pid = this.myUserId;
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const updates: Partial<TongitsPlayerInfo> = {
            handCards: res.discardedCard ? player.handCards?.filter(c => c !== res.discardedCard) ?? [] : player.handCards,
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
        const pid = this.myUserId;
        const player = this.getPlayerByUserId(pid);
        if (!player) return;
        const updates: Partial<TongitsPlayerInfo> = {
            displayedMelds: [...(player.displayedMelds ?? []), res.newMeld],
            handCardCount: res.handCardCount,
            isFight: res.hasTongits,
            status: PLAYER_STATUS.ACTION,
        };
        let newHandCards = player.handCards ?? [];
        if (res.discard) {
            const usedFromHand = res.newMeld.cards.filter(c => c !== res.discard);
            newHandCards = newHandCards.filter(c => !usedFromHand.includes(c));
            updates.handCards = newHandCards;
        }
        this.updatePlayerById(pid, updates);
        const gi = this.gameInfo as GameInfo | null;
        if (gi && res.discard) {
            gi.discardPile = gi.discardPile?.filter(c => c !== res.discard) ?? [];
        }
        const layoffHints = this._computeLayoffHints(newHandCards);
        this.notify<TakeResPayload>(TongitsEvents.TAKE_RES, { ...res, layoffHints, discardPile: gi?.discardPile ?? [] });
    }

    /** 补牌/压牌响应 */
    applyLayOffRes(res: LayOffCardRes): void {
        const pid = this.myUserId;
        // 更新目标牌组
        const target = this.getPlayerByUserId(res.targetPlayerId);
        if (target) {
            const melds = target.displayedMelds?.map(m => {
                if (m.meldId === res.targetMeldId) {
                    return { ...m, cards: [...m.cards, res.cardAdded].sort((a, b) => a - b), highlightCards: res.cardAdded };
                }
                return m;
            }) ?? [];
            this.updatePlayerById(res.targetPlayerId, { displayedMelds: melds } as Partial<TongitsPlayerInfo>);
        }
        // 从自己手牌移除
        const me = this.getPlayerByUserId(pid);
        let newHandCards: number[] = me?.handCards ?? [];
        if (me) {
            newHandCards = me.handCards?.filter(c => c !== res.cardAdded) ?? [];
            this.updatePlayerById(pid, {
                handCards: newHandCards,
                handCardCount: res.handCardCount,
                status: PLAYER_STATUS.SELECT,
            } as Partial<TongitsPlayerInfo>);
        }
        // 更新完 displayedMelds 和手牌后再计算（反映最新牌组状态）
        const layoffHints = this._computeLayoffHints(newHandCards);
        this.notify<LayOffResPayload>(TongitsEvents.LAY_OFF_RES, { ...res, layoffHints });
    }

    // ── 私有：提示数据计算 ────────────────────────────────

    /** 空提示数据（无候选时使用） */
    private _emptyLayoffHints(): LayoffHints {
        return { tippedCards: new Set(), meldTipsByOwner: new Map(), cardCandidates: new Map() };
    }

    /**
     * 计算手牌中哪些牌可以补入哪些玩家的牌组。
     * 逐玩家检测避免不同玩家 meldId 碰撞。
     */
    private _computeLayoffHints(handCards: number[]): LayoffHints {
        if (handCards.length === 0) return this._emptyLayoffHints();
        const tippedCards     = new Set<number>();
        const meldTipsByOwner = new Map<number, number[]>();
        const cardCandidates  = new Map<number, { playerId: number; meldId: number }[]>();
        for (const player of this.players) {
            const uid = player.playerInfo?.userId;
            if (!uid) continue;
            const meldData = (player.displayedMelds ?? []).map(m => ({ meldId: m.meldId, cards: m.cards }));
            if (meldData.length === 0) continue;
            const candidateMap = MeldValidator.findLayoffCandidates(handCards, meldData);
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
                this.updatePlayerById(bp.playerId, {
                    changeStatus: bp.changeStatus,
                    countdown: bp.countdown,
                } as Partial<TongitsPlayerInfo>);
            }
        }
        this.notify<ChallengeRes>(TongitsEvents.CHALLENGE_RES, res);
    }
}
