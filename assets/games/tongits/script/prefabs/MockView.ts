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
    DiscardCardBroadcast, ChallengeBroadcast,
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
    } | null = null;

    /** 当前操作玩家在 TURN_ORDER 中的索引 */
    private _actionIdx: number = 0;

    // ── 内部工具 ──────────────────────────────────────────────

    private get _actionId(): number { return TURN_ORDER[this._actionIdx]; }

    private _nextTurn(): void {
        this._actionIdx = (this._actionIdx + 1) % TURN_ORDER.length;
    }

    private _getPlayer(userId: number): TongitsPlayerInfo | undefined {
        return this._gameData?.players.find(p => p.playerInfo?.userId === userId);
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
     * 庄家(P3) 13 张，Self 12 张，P2 12 张，牌堆 ~14 张
     *
     * 吃牌测试场景：
     *   SELF 手牌固定含 101(A♠)、201(A♥)，
     *   P3 庄家回合会弃出 301(A♣)，SELF 可用手牌中的两张 A 吃牌。
     */
    clickInitGame(): void {
        const selfHand = [...SELF_FIXED_HAND];

        // 从剩余牌库中去掉 SELF 手牌和 P3 要弃的牌，剩下的洗牌后分给 P2/P3 并留作牌堆
        const baseDeck = shuffle(FULL_DECK.filter(c => !selfHand.includes(c) && c !== TAKE_BAIT_CARD));

        // P2 消耗 12 张，P3 消耗 13 张（客户端不存明文手牌）
        baseDeck.splice(0, 12); // P2
        baseDeck.splice(0, 13); // P3

        // 剩余作为牌堆（TAKE_BAIT_CARD 概念上在 P3 手中，游戏开始后 P3 会弃出）
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
        };

        console.log('[Mock] 牌局已初始化', {
            selfHand,
            takeBaitCard: TAKE_BAIT_CARD,
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
    async roundMsg(): Promise<void> {
        const W = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
        const STEP = 1500;

        await W(5000);

        // ── Round 1: P3 ─────────────────────────────────────────
        console.log('[Round 1] P3 action');
        this._actionIdx = TURN_ORDER.indexOf(P3_ID);
        this._sendActionChange();
        await W(STEP);

        this._sendDrawBroadcast(P3_ID);
        await W(STEP);

        // P3 meld ♠7♠8♠9（meldId=1）
        this._sendMeldBroadcast(P3_ID, [107, 108, 109]);
        await W(STEP);

        this._sendDiscardBroadcast(P3_ID, TAKE_BAIT_CARD);
        await W(STEP);

        // ── Round 2: SELF ────────────────────────────────────────
        console.log('[Round 2] SELF action');
        this._actionIdx = TURN_ORDER.indexOf(SELF_ID);
        this._sendActionChange();
        await W(STEP);

        this._send(MessageType.TONGITS_DRAW_RES, this._mockDraw(null));
        await W(STEP);

        // SELF meld ♥4♥5♥6（meldId=1）
        this._send(MessageType.TONGITS_MELD_RES, this._mockMeld({ cards: [204, 205, 206] }));
        await W(STEP);

        // SELF 弃 302（2♣）
        this._send(MessageType.TONGITS_DISCARD_RES, this._mockDiscard({ card: 302 }));
        await W(STEP);

        // ── Round 3: P2 ──────────────────────────────────────────
        // P2 直接补到 SELF 的 meld[♥4♥5♥6] 头部 → [♥3♥4♥5♥6]，触发 SELF ban
        console.log('[Round 3] P2 action → layoff to SELF → BAN!');
        this._actionIdx = TURN_ORDER.indexOf(P2_ID);
        this._sendActionChange();
        await W(STEP);

        this._sendDrawBroadcast(P2_ID);
        await W(STEP);

        // P2 layoff ♥3(203) 补到 SELF meld → SELF 被 ban，挑战按钮禁用
        this._sendLayOffBroadcast(P2_ID, SELF_ID, 1, 203);
        await W(STEP);

        this._sendDiscardBroadcast(P2_ID, 202);
        await W(STEP);

        // ── Round 4: P3 ──────────────────────────────────────────
        console.log('[Round 4] P3 action（SELF 仍处于 ban 状态）');
        this._actionIdx = TURN_ORDER.indexOf(P3_ID);
        this._sendActionChange();
        await W(STEP);

        this._sendDrawBroadcast(P3_ID);
        await W(STEP);

        this._sendDiscardBroadcast(P3_ID, 308);
        await W(STEP);

        // ── Round 5: SELF ────────────────────────────────────────
        console.log('[Round 5] SELF action（ban 在此回合开始时清除，挑战按钮恢复）');
        this._actionIdx = TURN_ORDER.indexOf(SELF_ID);
        this._sendActionChange();
        await W(STEP);

        this._send(MessageType.TONGITS_DRAW_RES, this._mockDraw(null));
        await W(STEP);

        this._send(MessageType.TONGITS_DISCARD_RES, this._mockDiscard({ card: 303 }));
        console.log('[Round 5] 完成，ban 已清除，挑战按钮应已恢复');
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
        this._gameData!.deck.pop();
        p.handCardCount = (p.handCardCount ?? 0) + 1;
        p.status        = PLAYER_STATUS.ACTION;
        this._gameData!.gameInfo.deckCardCount = this._gameData!.deck.length;

        const data: DrawCardBroadcast = {
            playerId:      pid,
            userId:        SELF_ID,
            drawnCard:     0,
            handCardCount: p.handCardCount,
        };
        console.log(`[Mock→DRAW] player=${pid} handCardCount=${p.handCardCount}`);
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

    private _sendDiscardBroadcast(pid: number, card = 201): void {
        const p = this._getPlayer(pid);
        if (!p) return;
        p.handCardCount = Math.max(0, p.handCardCount - 1);
        p.status        = PLAYER_STATUS.INIT;
        this._gameData!.gameInfo.discardPile.push(card);
        this._gameData!.gameInfo.discardCard = card;
        this._nextTurn();
        const data: DiscardCardBroadcast = {
            playerId:      pid,
            discardedCard: card,
            unlockMelds:   [],
            handCardCount: p.handCardCount,
            discardPile:   [...this._gameData!.gameInfo.discardPile],
            userId:        SELF_ID,
        };
        console.log(`[Mock→DISCARD] player=${pid} handCardCount=${p.handCardCount}`);
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
        this._gameData  = null;
        this._actionIdx = 0;

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
            countdown:      25,
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
