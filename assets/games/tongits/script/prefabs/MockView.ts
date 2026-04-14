/**
 * MockView — 服务端消息模拟面板（仅开发调试用）
 *
 * 通过 Nexus.net.simulateWsReceive() 注入 WS 消息，
 * 走完整的 dispatch → Model → TongitsEvents → View 链路。
 *
 * 所有操作状态统一维护在 _gameData 中，
 * 发送广播时直接从 _gameData 读取最新数据构建消息。
 */

import { _decorator } from 'cc';
import { UIPanel } from 'db://nexus-framework/base/UIPanel';
import { Nexus } from 'db://nexus-framework/core/Nexus';
import { MessageType } from '../proto/message_type';
import { PlayerInfo } from 'db://assets/script/proto/game_common_room';
import {
    TongitsPlayerInfo, GameInfo, PotInfo, Meld, PlayerResult,
    JoinRoomRes, GameStartBroadcast, ActionChangeBroadcast,
    DrawCardBroadcast, MeldCardBroadcast, LayOffCardBroadcast,
    DiscardCardBroadcast, TakeCardBroadcast, ChallengeBroadcast,
    PKBroadcast, BeforeResultBroadcast, GameResultBroadcast,
    RoomResetBroadcast, RoomInfo,
    DrawCardRes, MeldCardRes, DiscardCardRes, TakeCardRes, LayOffCardRes, ChallengeRes,
    MeldCardReq, DiscardCardReq, TakeCardReq, LayOffCardReq, ChallengeReq, DrawCardReq,
} from '../proto/tongits';

const { ccclass } = _decorator;

// ── 玩家 status 枚举（与 proto 注释一致） ─────────────────────
const PLAYER_STATUS = {
    INIT:   1,  // 不可操作（非操作回合 / 弃牌后等待下一轮）
    SELECT: 2,  // 可操作：抽牌 / 吃牌 / 发起挑战 三选一
    ACTION: 3,  // 已抽/吃牌，必须弃牌或放牌
} as const;

// ── Mock 玩家 ID ───────────────────────────────────────────────
const SELF_ID = 1001;
const P2_ID   = 1002;
const P3_ID   = 1003;

/** 出牌顺序（逆时针：庄家先） */
const TURN_ORDER = [P3_ID, SELF_ID, P2_ID];

/**
 * 吃牌测试场景（多种组合）：
 *   P3 弃出 TAKE_BAIT_CARD（301 = A♣）
 *
 * 固定手牌 SELF_FIXED_HAND（12张）及可形成的组合：
 *   ① [101, 201]       + 301 → A♠ A♥ A♣  set（3张）
 *   ② [101, 401]       + 301 → A♠ A♦ A♣  set（3张）
 *   ③ [201, 401]       + 301 → A♥ A♦ A♣  set（3张）
 *   ④ [302, 303]       + 301 → A♣ 2♣ 3♣  顺子（3张）
 *   ⑤ [101, 201, 401]  + 301 → 四张 A    set（4张）
 *
 *   其余：[104,105,106] 黑桃顺子可放牌；[204,205,206] 红心顺子可放牌；110 散牌
 */
const TAKE_BAIT_CARD   = 301;
const SELF_FIXED_HAND  = [101, 201, 401, 302, 303, 104, 105, 106, 204, 205, 206, 110];

// ── 52 张牌完整牌库 ────────────────────────────────────────────
const FULL_DECK: number[] = [
    101,102,103,104,105,106,107,108,109,110,111,112,113,
    201,202,203,204,205,206,207,208,209,210,211,212,213,
    301,302,303,304,305,306,307,308,309,310,311,312,313,
    401,402,403,404,405,406,407,408,409,410,411,412,413,
];

// ── 工具函数 ───────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const SCORES = [500, 2000, 5000, 10000, 20000, 50000];
const BET_AMOUNT = 10;

function buildPlayerInfo(userId: number, post = 0, seat = 0): PlayerInfo {
    return {
        userId,
        nickname:      `Player_${userId}`,
        avatar:        '',
        coin:          100000,
        seat,
        role:          2,
        post,
        state:         1,
        micAllowStatus: 2,
        coinChanged:            0,
        micOn:                  false,
        nextMicRequestTime:     0,
        micRequestExpiredTime:  0,
        waitReadyExpiredTime:   0,
    };
}

function buildPot(): PotInfo {
    return { base: 3, winCount: 1, useId: 0 };
}

/** 等待中（游戏未开始）的 gameInfo */
function buildWaitingGameInfo(): GameInfo {
    return {
        actionPlayerId: 0,
        status:         1,    // 初始/等待中
        deckCardCount:  0,
        discardPile:    [],
        pot:            {} as PotInfo,
        discardCard:    0,
        winType:        0,
        perspectiveId:  SELF_ID,
        betAmount:      BET_AMOUNT,
        scores:         [...SCORES],
    };
}

/** 游戏进行中的 gameInfo */
function buildGameInfo(actionPlayerId: number, deckCount = 15): GameInfo {
    return {
        actionPlayerId,
        status:        2,   // 游戏中
        deckCardCount: deckCount,
        discardPile:   [],
        pot:           buildPot(),
        discardCard:   0,
        winType:       0,
        perspectiveId: SELF_ID,
        betAmount:     BET_AMOUNT,
        scores:        [...SCORES],
    };
}

function buildPlayer(
    userId:    number,
    handCards: number[],
    isDealer = false,
    post = 0,
    seat = 0,
): TongitsPlayerInfo {
    return {
        playerInfo:     buildPlayerInfo(userId, post, seat),
        handCardCount:  handCards.length,
        isDealer,
        displayedMelds: [],
        handCards:      [...handCards],
        isFight:        false,
        countdown:      25,
        changeStatus:   1,
        status:         PLAYER_STATUS.INIT,
        isWin:          false,
        cardPoint:      0,
    };
}

// ── MockView ───────────────────────────────────────────────────
@ccclass('MockView')
export class MockView extends UIPanel {

    // ── 中央游戏状态 ──────────────────────────────────────────

    private _gameData: {
        players:  TongitsPlayerInfo[];
        gameInfo: GameInfo;
        deck:     number[];
        /** AI 玩家真实手牌（P2 / P3），用于防止牌重复 */
        aiHands:  Map<number, number[]>;
    } | null = null;

    /** roundMsg 等待自己弃牌时设置；_mockDiscard 调用后触发 */
    private _selfDiscardResolver: (() => void) | null = null;

    /** 当前操作玩家在 TURN_ORDER 中的索引 */
    private _actionIdx: number = 0;

    /** 防止多次点击 roundMsg 造成并发 */
    private _roundRunning: boolean = false;

    // ── 内部工具 ──────────────────────────────────────────────

    private get _actionId(): number { return TURN_ORDER[this._actionIdx]; }

    private _nextTurn(): void {
        this._actionIdx = (this._actionIdx + 1) % TURN_ORDER.length;
    }

    private _getPlayer(userId: number): TongitsPlayerInfo | undefined {
        return this._gameData?.players.find(p => p.playerInfo?.userId === userId);
    }

    /** 获取 AI 玩家真实手牌（只读引用） */
    private _aiHand(pid: number): number[] {
        return this._gameData?.aiHands.get(pid) ?? [];
    }

    /** 从 AI 手牌中移除指定牌（原地修改） */
    private _aiRemove(pid: number, ...cards: number[]): void {
        const hand = this._gameData?.aiHands.get(pid);
        if (!hand) return;
        for (const c of cards) {
            const idx = hand.indexOf(c);
            if (idx >= 0) hand.splice(idx, 1);
        }
    }

    /**
     * 从 AI 手牌中挑选一张可弃的牌并移除返回。
     * 优先弃散牌（不在任何 meld 中的牌），否则返回第一张。
     */
    private _aiPickAndRemoveDiscard(pid: number): number {
        const hand = this._aiHand(pid);
        if (!hand.length) return 0;
        const p = this._getPlayer(pid);
        const meldCards = new Set((p?.displayedMelds ?? []).reduce<number[]>((acc, m) => acc.concat(m.cards), []));
        const loose = hand.find(c => !meldCards.has(c)) ?? hand[0];
        this._aiRemove(pid, loose);
        return loose;
    }

    /**
     * 查找 AI 手牌中是否能吃 discardCard（同点数），
     * 返回完整吃牌牌组（含 discardCard），找不到则返回 null。
     */
    private _aiPickTakeMeld(pid: number, discardCard: number): number[] | null {
        const rank     = discardCard % 100;
        const sameRank = this._aiHand(pid).filter(c => c % 100 === rank);
        if (sameRank.length < 2) return null;
        // 取前 2 张（最多 3 张一组）
        return [...sameRank.slice(0, 2), discardCard];
    }

    /**
     * 计算手牌点数：手牌中未出现在任何 meld 的牌的点值之和。
     * 点值规则：A=1，2-10=面值，J/Q/K=10。
     */
    private _calcCardPoint(handCards: number[], melds: { cards: number[] }[]): number {
        const meldCards: number[] = [];
        for (const m of melds) meldCards.push(...m.cards);
        const meldSet = new Set(meldCards);
        return handCards
            .filter(c => !meldSet.has(c))
            .reduce((sum, c) => sum + Math.min(c % 100, 10), 0);
    }

    /**
     * 构建广播用的玩家快照：
     * - 只有 SELF_ID 保留明文 handCards（服务端只对自己下发手牌）
     * - displayedMelds 深拷贝避免引用污染
     */
    private _snapPlayers(): TongitsPlayerInfo[] {
        return this._gameData!.players.map(p => ({
            ...p,
            handCards:     p.playerInfo?.userId === SELF_ID ? [...p.handCards] : [],
            displayedMelds: p.displayedMelds.map(m => ({ ...m, cards: [...m.cards] })),
        }));
    }

    // ── UIPanel ───────────────────────────────────────────────

    onShow(): void {
        this._registerMockHandlers();
    }

    onClickClose(): void {
        this._unregisterMockHandlers();
        this.close();
    }

    // ── Mock 请求拦截器 ────────────────────────────────────────

    private _registerMockHandlers(): void {
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_DRAW_REQ,              (b) => this._mockDraw(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_MELD_REQ,              (b) => this._mockMeld(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_LAYOFF_REQ,            (b) => this._mockLayOff(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_DISCARD_REQ,           (b) => this._mockDiscard(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_TAKE_REQ,              (b) => this._mockTake(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_CHALLENGE_ACTION_REQ,  (b) => this._mockChallenge(b));
    }

    private _unregisterMockHandlers(): void {
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_DRAW_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_MELD_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_LAYOFF_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_DISCARD_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_TAKE_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_CHALLENGE_ACTION_REQ);
    }

    /** 拦截 DRAW_REQ：摸一张牌，返回 DrawCardRes */
    private _mockDraw(_body: unknown): DrawCardRes {
        const p    = this._getPlayer(SELF_ID)!;
        const card = this._gameData?.deck.pop() ?? 0;
        if (card) p.handCards = [...p.handCards, card];
        p.handCardCount = p.handCards.length;
        p.status        = PLAYER_STATUS.ACTION;
        if (this._gameData) this._gameData.gameInfo.deckCardCount = this._gameData.deck.length;
        console.log(`[Mock←RES] DRAW  card=${card}`);
        console.log("this._gameData?.deck.length:",this._gameData?.deck.length);
        return { drawnCard: card, hasTongits: false, handCardCount: p.handCardCount };
    }

    /** 拦截 MELD_REQ：从手牌移除这些牌，生成新牌组，返回 MeldCardRes */
    private _mockMeld(body: unknown): MeldCardRes {
        const req = body as MeldCardReq;
        const p   = this._getPlayer(SELF_ID)!;
        p.handCards     = p.handCards.filter(c => !req.cards.includes(c));
        p.handCardCount = p.handCards.length;
        const newMeld: Meld = {
            meldId:         p.displayedMelds.length + 1,
            cards:          [...req.cards],
            ownerId:        SELF_ID,
            highlightCards: 0,
            locked:         false,
        };
        p.displayedMelds = [...p.displayedMelds, newMeld];
        console.log(`[Mock←RES] MELD  cards=${req.cards}`);
        return { newMeld, hasTongits: false, handCardCount: p.handCardCount };
    }

    /** 拦截 LAYOFF_REQ：从手牌移除该牌，追加到目标牌组，返回 LayOffCardRes */
    private _mockLayOff(body: unknown): LayOffCardRes {
        const req    = body as LayOffCardReq;
        const p      = this._getPlayer(SELF_ID)!;
        p.handCards  = p.handCards.filter(c => c !== req.card);
        p.handCardCount = p.handCards.length;
        const target = this._getPlayer(req.targetPlayerId);
        const meld   = target?.displayedMelds.find(m => m.meldId === req.targetMeldId);
        if (meld) meld.cards = [...meld.cards, req.card];
        console.log(`[Mock←RES] LAYOFF  card=${req.card} → player=${req.targetPlayerId} meld=${req.targetMeldId}`);
        return {
            cardAdded:      req.card,
            targetPlayerId: req.targetPlayerId,
            targetMeldId:   req.targetMeldId,
            hasTongits:     false,
            handCardCount:  p.handCardCount,
        };
    }

    /** 拦截 DISCARD_REQ：从手牌移除该牌，推入弃牌堆，返回 DiscardCardRes */
    private _mockDiscard(body: unknown): DiscardCardRes {
        const req = body as DiscardCardReq;
        const p   = this._getPlayer(SELF_ID)!;
        p.handCards     = p.handCards.filter(c => c !== req.card);
        p.handCardCount = p.handCards.length;
        p.status        = PLAYER_STATUS.INIT;   // 弃牌后回合结束，等待下一轮
        if (this._gameData) {
            this._gameData.gameInfo.discardPile.push(req.card);
            this._gameData.gameInfo.discardCard = req.card;
        }
        console.log(`[Mock←RES] DISCARD  card=${req.card}`);
        // 若 roundMsg 正在等待自己弃牌，通知它继续
        if (this._selfDiscardResolver) {
            const resolve = this._selfDiscardResolver;
            this._selfDiscardResolver = null;
            resolve();
        }
        return {
            discardedCard:  req.card,
            unlockMelds:    [],
            handCardCount:  p.handCardCount,
            discardPile:    [...(this._gameData?.gameInfo.discardPile ?? [])],
        };
    }

    /** 拦截 TAKE_REQ：用手牌 + 弃牌组成新牌组，返回 TakeCardRes */
    private _mockTake(body: unknown): TakeCardRes {
        const req         = body as TakeCardReq;
        const p           = this._getPlayer(SELF_ID)!;
        const discardCard = this._gameData?.gameInfo.discardCard ?? 0;
        p.handCards       = p.handCards.filter(c => !req.cardsFromHand.includes(c));
        p.handCardCount   = p.handCards.length;
        const allCards    = [...req.cardsFromHand, discardCard].filter(Boolean);
        const newMeld: Meld = {
            meldId:         p.displayedMelds.length + 1,
            cards:          allCards,
            ownerId:        SELF_ID,
            highlightCards: discardCard,
            locked:         false,
        };
        p.displayedMelds = [...p.displayedMelds, newMeld];
        if (this._gameData) this._gameData.gameInfo.discardCard = 0;
        console.log(`[Mock←RES] TAKE  fromHand=${req.cardsFromHand} discard=${discardCard}`);
        return { newMeld, hasTongits: false, handCardCount: p.handCardCount, discard: discardCard };
    }

    /** 拦截 CHALLENGE_ACTION_REQ：更新自身 changeStatus，返回 ChallengeRes */
    private _mockChallenge(body: unknown): ChallengeRes {
        const req = body as ChallengeReq;
        const p   = this._getPlayer(SELF_ID)!;
        p.changeStatus = req.changeStatus;
        console.log(`[Mock←RES] CHALLENGE  changeStatus=${req.changeStatus}`);
        return {
            basePlayers: (this._gameData?.players ?? []).map(pl => ({
                playerId:     pl.playerInfo!.userId,
                changeStatus: pl.changeStatus,
                countdown:    10,
            })),
        };
    }

    // ── 按钮：进房 ────────────────────────────────────────────

    /** 模拟进入房间（游戏未开始，等待状态） */
    clickJoinRoom(): void {
        const players = [
            buildPlayer(SELF_ID, [], false, 1, 1),
            buildPlayer(P2_ID,   [], false, 0, 2),
            buildPlayer(P3_ID,   [], false, 0, 3),
        ];
        const data: JoinRoomRes = {
            roomInfo:     this._buildRoomInfo(),
            players,
            watchers:     [],
            playersCount: 3,
            speakers:     players.map(p => ({ ...p.playerInfo! })),
            self:         { ...players[0] },
            gameInfo:     buildWaitingGameInfo(),
        };
        this._send(MessageType.TONGITS_JOIN_ROOM_RES, data);
    }

    /** 模拟重连进入（游戏已在进行中，需先调用 clickInitGame） */
    clickRejoin(): void {
        const gi = this._gameData?.gameInfo
            ? { ...this._gameData.gameInfo }
            : buildGameInfo(this._actionId);
        const data: JoinRoomRes = {
            roomInfo:     this._buildRoomInfo(),
            players:      this._snapPlayers(),
            watchers:     [],
            playersCount: 3,
            speakers:     [],
            self:         { ...this._getPlayer(SELF_ID)! },
            gameInfo:     gi,
        };
        this._send(MessageType.TONGITS_JOIN_ROOM_RES, data);
    }

    // ── 按钮：初始化牌局 ──────────────────────────────────────

    /**
     * 初始化牌局数据（洗牌发牌）
     * 庄家(P3) 13 张，Self 12 张，P2 12 张，牌堆 15 张（共 52 张）
     *
     * 吃牌测试场景：
     *   SELF 手牌固定含 101(A♠)、201(A♥)，
     *   P3 庄家回合会弃出 301(A♣)，SELF 可用手牌中的两张 A 吃牌。
     */
    clickInitGame(): void {
        const selfHand = [...SELF_FIXED_HAND];

        // 从剩余牌库中去掉 SELF 手牌和 P3 要弃的牌（TAKE_BAIT_CARD 概念上算作 P3 的第 13 张）
        const baseDeck = shuffle(FULL_DECK.filter(c => !selfHand.includes(c) && c !== TAKE_BAIT_CARD));

        // P2 / P3 各取 12 张（P3 另有 TAKE_BAIT_CARD = 13 张）
        const p2Hand = baseDeck.splice(0, 12);
        const p3Hand = [TAKE_BAIT_CARD, ...baseDeck.splice(0, 12)];

        // 剩余 15 张作为牌堆（52 - 12自己 - 1诱饵 - 12P2 - 12P3 = 15）
        const remaining = [...baseDeck];

        this._actionIdx = TURN_ORDER.indexOf(P3_ID); // 庄家先手

        this._gameData = {
            players: [
                buildPlayer(SELF_ID, selfHand, false, 1, 1),
                { ...buildPlayer(P2_ID, [], false, 0, 2), handCardCount: 12 },
                { ...buildPlayer(P3_ID, [], true, 0, 3), handCardCount: 13 },
            ],
            gameInfo: buildGameInfo(P3_ID, remaining.length),
            deck:     remaining,
            aiHands:  new Map<number, number[]>([
                [P2_ID, p2Hand],
                [P3_ID, p3Hand],
            ]),
        };

        console.log('[Mock] 牌局已初始化', {
            selfHand,
            p2Hand,
            p3Hand,
            deckCount: remaining.length,
        });
    }

    // ── 按钮：游戏开始 ────────────────────────────────────────

    /**
     * 多圈自动模拟流程（async 链式）：
     *
     * Round 1 · P3  : 摸牌 → meld[♠7♠8♠9] → 弃301
     * Round 2 · SELF: 摸牌 → meld[♠4♠5♠6] → 弃302
     * Round 3 · P2  : 摸牌 → layoff ♠3→SELF牌组(ban!) → 弃202   ← 测试禁用
     * Round 4 · P3  : 摸牌 → 弃308（SELF 仍处于 ban）
     * Round 5 · SELF: 回合开始(ban清除!) → 摸牌 → 弃303
     */
    /** 等待自己弃牌（由 _mockDiscard 触发） */
    private _waitForSelfDiscard(): Promise<void> {
        return new Promise<void>(resolve => {
            this._selfDiscardResolver = resolve;
        });
    }

    async roundMsg(): Promise<void> {
        if (this._roundRunning) {
            console.warn('[roundMsg] 已在运行中，忽略重复调用');
            return;
        }
        this._roundRunning = true;

        const W     = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
        const STEP  = 1200;  // AI 操作间隔（ms）
        const LOOPS = 5;     // 最多循环圈数

        await W(3000);

        const startIdx = TURN_ORDER.indexOf(P3_ID); // P3 为庄先手

        for (let loop = 0; loop < LOOPS; loop++) {
            for (let t = 0; t < TURN_ORDER.length; t++) {
                const tIdx = (startIdx + t) % TURN_ORDER.length;
                const pid  = TURN_ORDER[tIdx];
                console.log("this._gameData?.deck.length:",this._gameData?.deck.length)
                if ((this._gameData?.deck.length ?? 0) === 0) {
                    console.log('[roundMsg] 牌堆耗尽，触发结算');
                    this._roundRunning = false;
                    this.clickBeforeResult();
                    return;
                }

                console.log(`[Loop ${loop + 1} | ${t + 1}/3] Player ${pid}`);
                this._actionIdx = tIdx;
                this._sendActionChange();
                await W(STEP);

                if (pid === SELF_ID) {
                    // ── 自己回合：由玩家真实操作 DRAW_REQ → mock handler → DRAW_RES ──────────
                    // 不在此处预摸牌，避免与玩家点击摸牌重复消耗牌堆
                    console.log('[roundMsg] 等待自己摸牌并弃牌...');
                    await this._waitForSelfDiscard();
                    await W(500);

                } else if (pid === P3_ID) {
                    // ── P3 回合 ───────────────────────────────────────
                    const topDiscard = this._gameData?.gameInfo.discardCard ?? 0;
                    const takeMeld   = loop % 2 === 1 ? this._aiPickTakeMeld(P3_ID, topDiscard) : null;

                    if (loop === 0 && t === 0) {
                        // 第一圈首回合：meld 3 张实际手牌 + 弃出吃牌诱饵
                        this._sendDrawBroadcast(P3_ID);
                        await W(STEP);
                        // 从 P3 手牌中取 3 张非 TAKE_BAIT_CARD 的牌组成 meld
                        const meld3 = this._aiHand(P3_ID).filter(c => c !== TAKE_BAIT_CARD).slice(0, 3);
                        if (meld3.length === 3) {
                            this._sendMeldBroadcast(P3_ID, meld3);
                            await W(STEP);
                        }
                        this._sendDiscardBroadcast(P3_ID, TAKE_BAIT_CARD);
                    } else if (takeMeld) {
                        // P3 吃 P2 刚弃的牌（手牌中有同点数牌）
                        this._sendTakeBroadcast(P3_ID, topDiscard, takeMeld);
                        await W(STEP);
                        // 吃牌后状态变 ACTION，仍需弃牌
                        this._sendDiscardBroadcast(P3_ID);
                    } else {
                        // 普通摸牌 → 弃牌
                        this._sendDrawBroadcast(P3_ID);
                        await W(STEP);
                        this._sendDiscardBroadcast(P3_ID);
                    }
                    await W(STEP);

                } else {
                    // ── P2 回合：普通摸牌 → 弃牌 ─────────────────────
                    this._sendDrawBroadcast(P2_ID);
                    await W(STEP);
                    this._sendDiscardBroadcast(P2_ID);
                    await W(STEP);
                }
            }
        }
        this._roundRunning = false;
        console.log('[roundMsg] 模拟完成');
    }

    /**
     * 模拟游戏开始广播，并自动串联庄家（P3）的第一个回合：
     *   1. 游戏开始广播
     *   2. ActionChange → P3（庄家先手，status=SELECT）
     *   3. P3 摸牌广播
     *   4. P3 弃出 301（A♣），SELF 手中有 101+201 可吃
     *   5. ActionChange → SELF（status=SELECT，进入吃牌检测）
     */
    clickGameStart(): void {
        if (!this._gameData) this.clickInitGame();
        const data: GameStartBroadcast = {
            gameInfo: { ...this._gameData!.gameInfo },
            players:  this._snapPlayers(),
            userId:   SELF_ID,
        };
        this._send(MessageType.TONGITS_START_GAME_BROADCAST, data);
        this.roundMsg()
    }

    // ── 按钮：操作变动 ────────────────────────────────────────

    /** 模拟 ActionChange（轮到自己） */
    clickActionChangeSelf(): void {
        if (!this._gameData) this.clickInitGame();
        this._actionIdx = TURN_ORDER.indexOf(SELF_ID);
        this._sendActionChange();
    }

    /** 模拟 ActionChange（轮到其他人 P2） */
    clickActionChangeOther(): void {
        if (!this._gameData) this.clickInitGame();
        this._actionIdx = TURN_ORDER.indexOf(P2_ID);
        this._sendActionChange();
    }

    // ── 按钮：摸牌 ───────────────────────────────────────────

    /** 模拟自己摸牌 res返回*/
    clickDrawSelfRes(): void {
        const p    = this._getPlayer(SELF_ID)!;
        const card = this._gameData!.deck.pop() ?? 0;
        if (card) p.handCards = [...p.handCards, card];
        p.handCardCount = p.handCards.length;
        p.status        = PLAYER_STATUS.ACTION;
        this._gameData!.gameInfo.deckCardCount = this._gameData!.deck.length;

        const data: DrawCardRes = {
            hasTongits: false,
            drawnCard:     card,
            handCardCount: p.handCardCount
        };
        this._send(MessageType.TONGITS_DRAW_RES, data);
    }


    /** 模拟自己摸牌 */
    clickDrawSelf(): void {
        const p    = this._getPlayer(SELF_ID)!;
        const card = this._gameData!.deck.pop() ?? 0;
        if (card) p.handCards = [...p.handCards, card];
        p.handCardCount = p.handCards.length;
        p.status        = PLAYER_STATUS.ACTION;
        this._gameData!.gameInfo.deckCardCount = this._gameData!.deck.length;

        const data: DrawCardBroadcast = {
            playerId:      SELF_ID,
            userId:        SELF_ID,
            drawnCard:     card,
            handCardCount: p.handCardCount,
        };
        this._send(MessageType.TONGITS_DRAW_BROADCAST, data);
    }

    /** 模拟其他玩家摸牌（drawnCard = 0，只更新数量） */
    clickDrawOther(): void {
        const pid = this._actionId !== SELF_ID ? this._actionId : P2_ID;
        this._sendDrawBroadcast(pid);
    }

    /** 模拟 P2 摸牌 */
    clickDrawP2(): void {
        this._sendDrawBroadcast(P2_ID);
    }

    /** 模拟 P3 摸牌 */
    clickDrawP3(): void {
        this._sendDrawBroadcast(P3_ID);
    }

    private _sendDrawBroadcast(pid: number): void {
        const p = this._getPlayer(pid);
        if (!p) return;
        const card = this._gameData!.deck.pop() ?? 0;
        // 将摸到的牌加入 AI 真实手牌，防止后续重复使用
        if (card) this._gameData!.aiHands.get(pid)?.push(card);
        p.handCardCount = (p.handCardCount ?? 0) + 1;
        p.status        = PLAYER_STATUS.ACTION;
        this._gameData!.gameInfo.deckCardCount = this._gameData!.deck.length;

        const data: DrawCardBroadcast = {
            playerId:      pid,
            userId:        SELF_ID,
            drawnCard:     0,
            handCardCount: p.handCardCount,
        };
        console.log(`[Mock→DRAW] player=${pid} card=${card} handCardCount=${p.handCardCount}`);
        this._send(MessageType.TONGITS_DRAW_BROADCAST, data);
    }

    // ── 按钮：弃牌 ───────────────────────────────────────────

    /** 模拟自己弃牌（取手牌第一张） */
    clickDiscardSelf(): void {
        const p    = this._getPlayer(SELF_ID)!;
        const card = p.handCards.shift() ?? 0;
        p.handCardCount = p.handCards.length;
        p.status        = PLAYER_STATUS.INIT;   // 弃牌后回合结束
        if (card) {
            this._gameData!.gameInfo.discardPile.push(card);
            this._gameData!.gameInfo.discardCard = card;
        }
        this._nextTurn();

        const data: DiscardCardBroadcast = {
            playerId:      SELF_ID,
            discardedCard: card,
            unlockMelds:   [],
            handCardCount: p.handCardCount,
            discardPile:   [...this._gameData!.gameInfo.discardPile],
            userId:        SELF_ID,
        };
        this._send(MessageType.TONGITS_DISCARD_BROADCAST, data);
    }

    /** 模拟其他玩家弃牌（当前行动玩家，或默认 P2） */
    clickDiscardOther(): void {
        const pid = this._actionId !== SELF_ID ? this._actionId : P2_ID;
        this._sendDiscardBroadcast(pid);
    }

    clickDiscardP2(): void { this._sendDiscardBroadcast(P2_ID); }
    clickDiscardP3(): void { this._sendDiscardBroadcast(P3_ID); }

    private _sendDiscardBroadcast(pid: number, card?: number): void {
        const p = this._getPlayer(pid);
        if (!p) return;
        // 若未指定牌，从 AI 真实手牌中挑一张；若指定了则从手牌中移除
        const discardCard = card !== undefined
            ? (this._aiRemove(pid, card), card)
            : this._aiPickAndRemoveDiscard(pid);
        if (!discardCard) return;
        p.handCardCount = Math.max(0, p.handCardCount - 1);
        p.status        = PLAYER_STATUS.INIT;
        this._gameData!.gameInfo.discardPile.push(discardCard);
        this._gameData!.gameInfo.discardCard = discardCard;
        this._nextTurn();
        const data: DiscardCardBroadcast = {
            playerId:      pid,
            discardedCard: discardCard,
            unlockMelds:   [],
            handCardCount: p.handCardCount,
            discardPile:   [...this._gameData!.gameInfo.discardPile],
            userId:        SELF_ID,
        };
        console.log(`[Mock→DISCARD] player=${pid} card=${discardCard} handCardCount=${p.handCardCount}`);
        this._send(MessageType.TONGITS_DISCARD_BROADCAST, data);
    }

    // ── 按钮：放牌（Meld） ────────────────────────────────────

    /** 模拟自己 Meld（取手牌前 3 张） */
    clickMeldSelf(): void {
        const p         = this._getPlayer(SELF_ID)!;
        const meldCards = p.handCards.splice(0, 3);
        p.handCardCount = p.handCards.length;
        p.status        = PLAYER_STATUS.ACTION;
        const newMeld: Meld = {
            meldId:         p.displayedMelds.length + 1,
            cards:          meldCards,
            ownerId:        SELF_ID,
            highlightCards: 0,
            locked:         false,
        };
        p.displayedMelds = [...p.displayedMelds, newMeld];

        const data: MeldCardBroadcast = {
            playerId:      SELF_ID,
            newMeld:       { ...newMeld, cards: [...newMeld.cards] },
            handCardCount: p.handCardCount,
            userId:        SELF_ID,
        };
        this._send(MessageType.TONGITS_MELD_BROADCAST, data);
    }

    /** 模拟 P2 Meld */
    clickMeldP2(): void {
        this._sendMeldBroadcast(P2_ID, [301, 302, 303]);
    }

    /** 模拟 P3 Meld */
    clickMeldP3(): void {
        this._sendMeldBroadcast(P3_ID, [401, 402, 403]);
    }

    private _sendMeldBroadcast(pid: number, meldCards: number[]): void {
        const p = this._getPlayer(pid)!;
        this._aiRemove(pid, ...meldCards);
        p.handCardCount = Math.max(0, p.handCardCount - meldCards.length);
        p.status        = PLAYER_STATUS.ACTION;
        const newMeld: Meld = {
            meldId:         p.displayedMelds.length + 1,
            cards:          meldCards,
            ownerId:        pid,
            highlightCards: 0,
            locked:         false,
        };
        p.displayedMelds = [...p.displayedMelds, newMeld];

        const data: MeldCardBroadcast = {
            playerId:      pid,
            newMeld:       { ...newMeld, cards: [...newMeld.cards] },
            handCardCount: p.handCardCount,
            userId:        SELF_ID,
        };
        console.log(`[Mock→MELD] player=${pid} cards=${meldCards}`);
        this._send(MessageType.TONGITS_MELD_BROADCAST, data);
    }

    // ── 按钮：补牌（LayOff / Sapaw） ─────────────────────────

    /** 模拟自己补牌到 P3 的第一个 meld */
    clickLayOffSelf(): void {
        const p      = this._getPlayer(SELF_ID)!;
        const target = this._getPlayer(P3_ID)!;
        const card   = p.handCards.shift() ?? 104;
        p.handCards      = p.handCards.filter(c => c !== card);
        p.handCardCount  = p.handCards.length;
        p.status         = PLAYER_STATUS.SELECT;

        const targetMeld = target.displayedMelds[0];
        if (targetMeld) {
            targetMeld.cards          = [...targetMeld.cards, card].sort((a, b) => a - b);
            targetMeld.highlightCards = card;
        }

        const data: LayOffCardBroadcast = {
            actionPlayerId: SELF_ID,
            targetPlayerId: P3_ID,
            targetMeldId:   targetMeld?.meldId ?? 1,
            cardAdded:      card,
            handCardCount:  p.handCardCount,
            userId:         SELF_ID,
        };
        this._send(MessageType.TONGITS_LAYOFF_BROADCAST, data);
    }

    /** 模拟 P2 补牌到 P3 的第一个 meld（追加 304） */
    clickLayOffP2(): void {
        this._sendLayOffBroadcast(P2_ID, P3_ID, 1, 304);
    }

    /** 模拟 P3 补牌到 P2 的第一个 meld（追加 404） */
    clickLayOffP3(): void {
        this._sendLayOffBroadcast(P3_ID, P2_ID, 1, 404);
    }

    /** 模拟 P2 补牌到 SELF 的第一个 meld（触发 SELF ban）
     *  自动根据 meld 类型推断合法补牌；若 SELF 尚无牌组，先发 MELD_RES 创建 [♥4♥5♥6] */
    clickLayOffToSelf(): void {
        if (!this._gameData) this.clickInitGame();
        const self = this._getPlayer(SELF_ID)!;

        const doLayoff = () => {
            const meld = self.displayedMelds[0];
            if (!meld) { console.warn('[Mock] SELF 仍没有牌组，无法补牌'); return; }
            const card = this._pickLayoffCard(meld.cards);
            if (!card) { console.warn('[Mock] 找不到合法补牌（牌组已满）'); return; }
            console.log(`[Mock] clickLayOffToSelf: meld=${meld.cards} → layoff card=${card}`);
            this._sendLayOffBroadcast(P2_ID, SELF_ID, meld.meldId, card);
        };

        if (self.displayedMelds.length === 0) {
            this._send(MessageType.TONGITS_MELD_RES, this._mockMeld({ cards: [204, 205, 206] }));
            setTimeout(doLayoff, 600);
        } else {
            doLayoff();
        }
    }

    /** 根据现有牌组自动选一张合法补牌（0 = 无可用） */
    private _pickLayoffCard(cards: number[]): number {
        if (cards.length === 0) return 0;
        const ranks = cards.map(c => c % 100);
        const firstRank = ranks[0];
        const isSet = ranks.every(r => r === firstRank);

        if (isSet) {
            // 同点不同花：找一张同点位但花色不在牌组中的牌
            const usedSuits = new Set(cards.map(c => Math.floor(c / 100)));
            for (const suit of [1, 2, 3, 4]) {
                if (!usedSuits.has(suit)) return suit * 100 + firstRank;
            }
            return 0; // 4 张已满
        } else {
            // 顺子：延伸头部（minRank-1）或尾部（maxRank+1），同花色
            const sorted = [...cards].sort((a, b) => (a % 100) - (b % 100));
            const suit    = sorted[0] - (sorted[0] % 100);
            const minRank = sorted[0] % 100;
            const maxRank = sorted[sorted.length - 1] % 100;
            if (minRank > 1)  return suit + (minRank - 1);
            if (maxRank < 13) return suit + (maxRank + 1);
            return 0; // K 到 A 全连了
        }
    }

    private _sendLayOffBroadcast(
        actionPid:    number,
        targetPid:    number,
        targetMeldId: number,
        card:         number,
    ): void {
        const actor  = this._getPlayer(actionPid);
        const target = this._getPlayer(targetPid);
        if (!actor || !target) return;

        actor.handCardCount = Math.max(0, actor.handCardCount - 1);
        actor.status        = PLAYER_STATUS.INIT;

        const targetMeld = target.displayedMelds.find(m => m.meldId === targetMeldId);
        if (targetMeld) {
            targetMeld.cards          = [...targetMeld.cards, card];
            targetMeld.highlightCards = card;
        }

        const data: LayOffCardBroadcast = {
            actionPlayerId: actionPid,
            targetPlayerId: targetPid,
            targetMeldId,
            cardAdded:      card,
            handCardCount:  actor.handCardCount,
            userId:         SELF_ID,
        };
        console.log(`[Mock→LAYOFF] player=${actionPid} card=${card} → player=${targetPid} meld=${targetMeldId}`);
        this._send(MessageType.TONGITS_LAYOFF_BROADCAST, data);
    }

    /**
     * 模拟某玩家吃弃牌区顶牌。
     * @param pid         吃牌玩家
     * @param discardCard 被吃的弃牌（必须是当前弃牌区顶牌）
     * @param meldCards   吃牌后形成的完整牌组（含 discardCard）
     */
    private _sendTakeBroadcast(pid: number, discardCard: number, meldCards: number[]): void {
        const p = this._getPlayer(pid);
        if (!p) return;

        // 手牌数减少（meldCards 中除弃牌外，其余来自手牌）
        const fromHandCards = meldCards.filter(c => c !== discardCard);
        this._aiRemove(pid, ...fromHandCards);
        p.handCardCount = Math.max(0, p.handCardCount - fromHandCards.length);
        p.status        = PLAYER_STATUS.ACTION;

        const newMeld: Meld = {
            meldId:         p.displayedMelds.length + 1,
            cards:          meldCards,
            ownerId:        pid,
            highlightCards: discardCard,
            locked:         false,
        };
        p.displayedMelds = [...p.displayedMelds, newMeld];

        // 从弃牌堆移除该牌
        if (this._gameData) {
            this._gameData.gameInfo.discardPile =
                this._gameData.gameInfo.discardPile.filter(c => c !== discardCard);
            this._gameData.gameInfo.discardCard = 0;
        }

        const data: TakeCardBroadcast = {
            playerId:      pid,
            newMeld:       { ...newMeld, cards: [...newMeld.cards] },
            handCardCount: p.handCardCount,
            discard:       discardCard,
            userId:        SELF_ID,
        };
        console.log(`[Mock→TAKE] player=${pid} discard=${discardCard} meld=${meldCards}`);
        this._send(MessageType.TONGITS_TAKE_BROADCAST, data);
    }

    // ── 按钮：挑战（Fight） ───────────────────────────────────

    /** 模拟自己发起 Fight */
    clickChallengeSelf(): void {
        const p  = this._getPlayer(SELF_ID)!;
        const p2 = this._getPlayer(P2_ID)!;
        const p3 = this._getPlayer(P3_ID)!;
        p.changeStatus  = 2;
        p2.changeStatus = 1;
        p3.changeStatus = 1;

        const data: ChallengeBroadcast = {
            playerId:    SELF_ID,
            basePlayers: [
                { playerId: SELF_ID, changeStatus: p.changeStatus,  countdown: 0  },
                { playerId: P2_ID,   changeStatus: p2.changeStatus, countdown: 10 },
                { playerId: P3_ID,   changeStatus: p3.changeStatus, countdown: 10 },
            ],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_CHALLENGE_BROADCAST, data);
    }

    /** 模拟 P2 接受挑战 */
    clickChallengeAccept(): void {
        const p2 = this._getPlayer(P2_ID)!;
        p2.changeStatus = 3;

        const data: PKBroadcast = {
            playerId:     P2_ID,
            changeStatus: p2.changeStatus,
            userId:       SELF_ID,
        };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    /** 模拟 P3 拒绝挑战 */
    clickChallengeSurrender(): void {
        const p3 = this._getPlayer(P3_ID)!;
        p3.changeStatus = 4;

        const data: PKBroadcast = {
            playerId:     P3_ID,
            changeStatus: p3.changeStatus,
            userId:       SELF_ID,
        };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    /** 模拟 P2 发起挑战（自己与 P3 需要响应） */
    clickChallengeP2(): void {
        if (!this._gameData) this.clickInitGame();
        const p  = this._getPlayer(SELF_ID)!;
        const p2 = this._getPlayer(P2_ID)!;
        const p3 = this._getPlayer(P3_ID)!;
        p2.changeStatus = 2;
        p.changeStatus  = 1;
        p3.changeStatus = 1;

        const data: ChallengeBroadcast = {
            playerId:    P2_ID,
            basePlayers: [
                { playerId: SELF_ID, changeStatus: p.changeStatus,  countdown: Date.now() + 10000 },
                { playerId: P2_ID,   changeStatus: p2.changeStatus, countdown: 0                  },
                { playerId: P3_ID,   changeStatus: p3.changeStatus, countdown: Date.now() + 10000 },
            ],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_CHALLENGE_BROADCAST, data);
    }

    /** 模拟 P3 发起挑战（自己与 P2 需要响应） */
    clickChallengeP3(): void {
        if (!this._gameData) this.clickInitGame();
        const p  = this._getPlayer(SELF_ID)!;
        const p2 = this._getPlayer(P2_ID)!;
        const p3 = this._getPlayer(P3_ID)!;
        p3.changeStatus = 2;
        p.changeStatus  = 1;
        p2.changeStatus = 1;

        const data: ChallengeBroadcast = {
            playerId:    P3_ID,
            basePlayers: [
                { playerId: SELF_ID, changeStatus: p.changeStatus,  countdown: Date.now() + 10000 },
                { playerId: P2_ID,   changeStatus: p2.changeStatus, countdown: Date.now() + 10000 },
                { playerId: P3_ID,   changeStatus: p3.changeStatus, countdown: 0                  },
            ],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_CHALLENGE_BROADCAST, data);
    }

    /** 模拟自己被烧死（changeStatus=5） */
    clickBurnSelf(): void {
        if (!this._gameData) this.clickInitGame();
        const p = this._getPlayer(SELF_ID)!;
        p.changeStatus = 5;
        const data: PKBroadcast = { playerId: SELF_ID, changeStatus: 5, userId: SELF_ID };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    /** 模拟 P2 被烧死 */
    clickBurnP2(): void {
        if (!this._gameData) this.clickInitGame();
        const p2 = this._getPlayer(P2_ID)!;
        p2.changeStatus = 5;
        const data: PKBroadcast = { playerId: P2_ID, changeStatus: 5, userId: SELF_ID };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    /** 模拟 P3 被烧死 */
    clickBurnP3(): void {
        if (!this._gameData) this.clickInitGame();
        const p3 = this._getPlayer(P3_ID)!;
        p3.changeStatus = 5;
        const data: PKBroadcast = { playerId: P3_ID, changeStatus: 5, userId: SELF_ID };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    // ── 按钮：结算前 ──────────────────────────────────────────

    /** 模拟结算前比牌广播（自己获胜） */
    clickBeforeResult(): void {
        const p = this._getPlayer(SELF_ID)!;
        p.isWin = true;
        this._gameData!.gameInfo.status = 4;

        const data: BeforeResultBroadcast = {
            winnerId:  SELF_ID,
            winType:   1,
            players:   this._snapPlayers(),
            countdown: 5,
            pot:       { ...this._gameData!.gameInfo.pot! },
            userId:    SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_WIN_BROADCAST, data);
    }

    /**
     * 模拟结算前比牌广播（含所有玩家真实手牌 + 点数，用于测试 Showdown 展示）。
     * 与 clickBeforeResult 的区别：players 里包含 P2/P3 的 handCards 和计算后的 cardPoint。
     * @param winnerId 获胜方 userId（默认 SELF_ID）
     */
    clickShowdownFull(winnerId: number = SELF_ID): void {
        if (!this._gameData) return;
        this._gameData.gameInfo.status = 4;

        const players = this._gameData.players.map(p => {
            const uid = p.playerInfo!.userId;
            // 自己用 _gameData 里的手牌，AI 用 aiHands 里的真实手牌
            const hand = uid === SELF_ID ? [...p.handCards] : [...this._aiHand(uid)];
            return {
                ...p,
                handCards:      hand,
                cardPoint:      this._calcCardPoint(hand, p.displayedMelds),
                displayedMelds: p.displayedMelds.map(m => ({ ...m, cards: [...m.cards] })),
            };
        });

        const data: BeforeResultBroadcast = {
            winnerId,
            winType:   2,   // 2 = 挑战获胜
            players,
            countdown: 5,
            pot:       { ...this._gameData.gameInfo.pot! },
            userId:    SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_WIN_BROADCAST, data);
    }

    // ── 按钮：游戏结算 ────────────────────────────────────────

    /** 模拟自己获胜结算 */
    clickGameResultWin(): void {
        this._gameData!.gameInfo.status = 5;
        const data: GameResultBroadcast = {
            winnerId:      SELF_ID,
            playerResults: this._buildPlayerResults(SELF_ID),
            countdown:     5,
            userId:        SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_RESULT_BROADCAST, data);
    }

    /** 模拟自己失败结算 */
    clickGameResultLose(): void {
        this._gameData!.gameInfo.status = 5;
        const data: GameResultBroadcast = {
            winnerId:      P2_ID,
            playerResults: this._buildPlayerResults(P2_ID),
            countdown:     5,
            userId:        SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_RESULT_BROADCAST, data);
    }

    // ── 按钮：房间重置 ────────────────────────────────────────

    clickRoomReset(): void {
        const resetPlayers = [
            buildPlayer(SELF_ID, [], false, 1, 1),
            buildPlayer(P2_ID,   [], false, 0, 2),
            buildPlayer(P3_ID,   [], false, 0, 3),
        ];
        this._gameData      = null;
        this._actionIdx     = 0;
        this._roundRunning  = false;
        this._selfDiscardResolver = null;

        const data: RoomResetBroadcast = {
            players:  resetPlayers,
            self:     { ...resetPlayers[0] },
            gameInfo: buildWaitingGameInfo(),
            userId:   SELF_ID,
        };
        this._send(MessageType.TONGITS_ROOM_RESET_BROADCAST, data);
    }

    // ── 私有：广播构建 ────────────────────────────────────────

    /** 回合切换：将操作玩家状态设为 SELECT 并发送广播 */
    private _sendActionChange(): void {
        const pid = this._actionId;
        const p   = this._getPlayer(pid)!;
        // 轮到该玩家：进入 SELECT 阶段（可抽牌/吃牌/挑战）
        p.status  = PLAYER_STATUS.SELECT;
        this._gameData!.gameInfo.actionPlayerId = pid;

        const data: ActionChangeBroadcast = {
            actionPlayerId: pid,
            countdown:      Date.now() + 25 * 1000,
            isFight:        p.isFight,
            status:         p.status,
            userId:         SELF_ID,
        };
        this._send(MessageType.TONGITS_ACTION_CHANGE_BROADCAST, data);
    }

    private _buildRoomInfo(): RoomInfo {
        return { roomId: 9999, roomName: 'Mock Room', roomStatus: 1, maxSeat: 3 };
    }

    private _buildPlayerResults(winnerId: number): PlayerResult[] {
        return this._gameData!.players.map(p => {
            const uid    = p.playerInfo!.userId;
            const isWin  = uid === winnerId;
            const bonus  = isWin ? 20 : -10;
            return {
                playerInfo:         { ...p, isWin },
                sumWinBonus:        bonus,
                normalWinBonus:     bonus,
                tongitsWinBonus:    0,
                cardTypeBonus:      0,
                bonusBonus:         0,
                burnedBonus:        0,
                winChallengeBonus:  0,
                potBonus:           0,
                cardPoint:          p.cardPoint,
            } as PlayerResult;
        });
    }

    private _send(msgType: number, data: unknown): void {
        console.log(`[Mock] → msgType:${msgType}`, data);
        Nexus.net.simulateWsReceive?.(msgType, data);
    }
}
