/**
 * MockView — 服务端消息模拟面板（仅开发调试用）
 *
 * 通过 Nexus.net.simulateWsReceive() 注入 WS 消息，
 * 走完整的 dispatch → Model → TongitsEvents → View 链路。
 *
 * Inspector 中每个按钮绑定对应 click* 方法即可。
 */

import { _decorator } from 'cc';
import { UIPanel } from 'db://nexus-framework/base/UIPanel';
import { Nexus } from 'db://nexus-framework/core/Nexus';
import { MessageType } from '../proto/message_type';
import { PlayerInfo } from 'db://assets/script/proto/game_common_room';
import type {
    TongitsPlayerInfo, GameInfo, PotInfo, PlayerResult,
    JoinRoomRes, GameStartBroadcast, ActionChangeBroadcast,
    DrawCardBroadcast, MeldCardBroadcast, LayOffCardBroadcast,
    DiscardCardBroadcast, ChallengeBroadcast,
    PKBroadcast, BeforeResultBroadcast, GameResultBroadcast,
    RoomResetBroadcast, RoomInfo,
} from '../proto/tongits';

const { ccclass } = _decorator;

// ── Mock 玩家 ID ───────────────────────────────────────────

const SELF_ID = 1001;
const P2_ID   = 1002;
const P3_ID   = 1003;

/** 出牌顺序（逆时针：庄家先） */
const TURN_ORDER = [P3_ID, SELF_ID, P2_ID];

// ── 52 张牌完整牌库 ────────────────────────────────────────

const FULL_DECK: number[] = [
    101,102,103,104,105,106,107,108,109,110,111,112,113,
    201,202,203,204,205,206,207,208,209,210,211,212,213,
    301,302,303,304,305,306,307,308,309,310,311,312,313,
    401,402,403,404,405,406,407,408,409,410,411,412,413,
];

// ── 工具函数 ──────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function mockPlayerInfo(userId: number, post = 0, seat = 0): PlayerInfo {
    return {
        userId,
        nickname: `Player_${userId}`,
        avatar: '',
        coin: 100000,
        seat,
        role: 2,
        post,
        state: 1,
        coinChanged: 0,
        micAllowStatus: 0,
        micOn: false,
        nextMicRequestTime: 0,
        micRequestExpiredTime: 0,
        waitReadyExpiredTime: 0,
    };
}

function mockRoomInfo(): RoomInfo {
    return { roomId: 9999, roomName: 'Mock Room', roomStatus: 1, maxSeat: 3 };
}

function mockPot(): PotInfo {
    return { base: 3, winCount: 1, useId: 0 };
}

function mockGameInfo(actionPlayerId: number, status = 2, deckCount = 15): GameInfo {
    return {
        actionPlayerId,
        status,
        deckCardCount: deckCount,
        discardPile: [],
        pot: mockPot(),
        discardCard: 0,
        winType: 0,
        perspectiveId: SELF_ID,
        betAmount: 1,
        scores: [],
    };
}

function mockPlayer(
    userId: number,
    handCards: number[],
    isDealer = false,
    post = 0,
    seat = 0,
): TongitsPlayerInfo {
    return {
        playerInfo: mockPlayerInfo(userId, post, seat),
        handCardCount: handCards.length,
        isDealer,
        displayedMelds: [],
        // 只有自己才下发手牌明文
        handCards: userId === SELF_ID ? handCards : [],
        isFight: false,
        countdown: 25,
        changeStatus: 1,
        status: 1,
        isWin: false,
        cardPoint: 0,
    };
}

function mockPlayerResult(
    userId: number,
    selfHand: number[],
    bonus: number,
    isWin = false,
): PlayerResult {
    return {
        playerInfo: { ...mockPlayer(userId, selfHand), isWin },
        sumWinBonus: bonus,
        normalWinBonus: bonus,
        tongitsWinBonus: 0,
        cardTypeBonus: 0,
        bonusBonus: 0,
        burnedBonus: 0,
        winChallengeBonus: 0,
        potBonus: 0,
        cardPoint: 5,
    };
}

// ── MockView ──────────────────────────────────────────────
@ccclass('MockView')
export class MockView extends UIPanel {

    // ── Mock 运行时状态 ───────────────────────────────────

    /** 剩余牌堆 */
    private _deck:        number[] = [];
    /** 自己的手牌 */
    private _selfHand:    number[] = [408, 201, 102, 204, 412, 312, 202, 413, 411, 404, 104, 304];
    /** 各玩家手牌数量 */
    private _handCounts:  Record<number, number> = {};
    /** 弃牌堆 */
    private _discardPile: number[] = [];
    /** 当前操作玩家 */
    private _actionIdx:   number = 0;

    private get _actionId(): number { return TURN_ORDER[this._actionIdx]; }

    private _nextTurn(): void {
        this._actionIdx = (this._actionIdx + 1) % TURN_ORDER.length;
    }

    // ── UIPanel ───────────────────────────────────────────

    onShow(): void { /* 面板打开时不自动触发，手动点按钮 */ }

    onClickClose(): void { this.close(); }

    // ── 按钮：进房 ────────────────────────────────────────

    /** 模拟进入房间（游戏未开始，等待状态） */
    clickJoinRoom(): void {
        const data: JoinRoomRes = {
            roomInfo: mockRoomInfo(),
            players: [
                mockPlayer(SELF_ID,  [], false, 0, 1),
                mockPlayer(P2_ID,    [], false, 0, 2),
                mockPlayer(P3_ID,    [], false, 0, 3),
            ],
            watchers: [],
            playersCount: 3,
            speakers: [],
            self: mockPlayer(SELF_ID, [], false, 1, 1),  // self = 房主
            gameInfo: undefined,
        };
        this._send(MessageType.TONGITS_JOIN_ROOM_RES, data);
    }

    /** 模拟重连进入（游戏已在进行中，需先调用 clickInitGame） */
    clickRejoin(): void {
        const data: JoinRoomRes = {
            roomInfo: mockRoomInfo(),
            players: [
                mockPlayer(SELF_ID, this._selfHand, false, 1, 1),
                mockPlayer(P2_ID,   [],             false, 0, 2),
                mockPlayer(P3_ID,   [],             true,  0, 3),
            ],
            watchers: [],
            playersCount: 3,
            speakers: [],
            self: mockPlayer(SELF_ID, this._selfHand, false, 1, 1),
            gameInfo: mockGameInfo(this._actionId),
        };
        this._send(MessageType.TONGITS_JOIN_ROOM_RES, data);
    }

    // ── 按钮：初始化牌局 ──────────────────────────────────

    /**
     * 初始化牌局数据（洗牌发牌）
     * 庄家(P3) 13 张，Self 12 张，P2 12 张，牌堆 15 张
     * 调用后后续所有操作（GameStart / Draw / Discard 等）均基于此数据
     */
    clickInitGame(): void {
        this._resetDeck();
        console.log('[Mock] 牌局已初始化', {
            selfHand: this._selfHand,
            deckCount: this._deck.length,
        });
    }

    // ── 按钮：游戏开始 ────────────────────────────────────

    /**
     * 模拟游戏开始广播（使用已初始化的数据，需先调用 clickInitGame）
     */
    clickGameStart(): void {
        const data: GameStartBroadcast = {
            gameInfo: mockGameInfo(SELF_ID),
            players: [
                mockPlayer(SELF_ID, this._selfHand, false, 1, 1),
                mockPlayer(P2_ID,   [],             false, 0, 2),
                mockPlayer(P3_ID,   [],             true,  0, 3),
            ],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_START_GAME_BROADCAST, data);
    }

    // ── 按钮：操作变动 ────────────────────────────────────

    /** 模拟 ActionChange（当前操作玩家轮到自己） */
    clickActionChangeSelf(): void {
        this._actionIdx = TURN_ORDER.indexOf(SELF_ID);
        this._sendActionChange();
    }

    /** 模拟 ActionChange（当前操作玩家是其他人） */
    clickActionChangeOther(): void {
        this._actionIdx = TURN_ORDER.indexOf(P2_ID);
        this._sendActionChange();
    }

    // ── 按钮：摸牌 ───────────────────────────────────────

    /** 模拟自己摸牌（drawnCard 有值） */
    clickDrawSelf(): void {
        const card = this._deck.pop() ?? 0;
        if (card) this._selfHand.push(card);
        this._handCounts[SELF_ID] = this._selfHand.length;

        const data: DrawCardBroadcast = {
            playerId: SELF_ID,
            userId:   SELF_ID,
            drawnCard: card,
            handCardCount: this._handCounts[SELF_ID],
        };
        this._send(MessageType.TONGITS_DRAW_BROADCAST, data);
    }

    /** 模拟其他玩家摸牌（drawnCard = 0，只更新数量） */
    clickDrawOther(): void {
        const pid = this._actionId !== SELF_ID ? this._actionId : P2_ID;
        this._deck.pop();
        this._handCounts[pid] = (this._handCounts[pid] ?? 0) + 1;

        const data: DrawCardBroadcast = {
            playerId: pid,
            userId:   SELF_ID,
            drawnCard: 0,
            handCardCount: this._handCounts[pid],
        };
        this._send(MessageType.TONGITS_DRAW_BROADCAST, data);
    }

    // ── 按钮：弃牌 ───────────────────────────────────────

    /** 模拟自己弃牌（取手牌第一张） */
    clickDiscardSelf(): void {
        const card = this._selfHand.shift() ?? 0;
        this._handCounts[SELF_ID] = this._selfHand.length;
        if (card) this._discardPile.push(card);
        this._nextTurn();

        const data: DiscardCardBroadcast = {
            playerId:     SELF_ID,
            discardedCard: card,
            unlockMelds:  [],
            handCardCount: this._handCounts[SELF_ID],
            discardPile:  [...this._discardPile],
            userId:       SELF_ID,
        };
        this._send(MessageType.TONGITS_DISCARD_BROADCAST, data);
    }

    /** 模拟其他玩家弃牌 */
    clickDiscardOther(): void {
        const pid = this._actionId !== SELF_ID ? this._actionId : P2_ID;
        this._handCounts[pid] = Math.max(0, (this._handCounts[pid] ?? 0) - 1);
        const card = 201; // mock 弃牌
        this._discardPile.push(card);
        this._nextTurn();

        const data: DiscardCardBroadcast = {
            playerId:      pid,
            discardedCard: card,
            unlockMelds:   [],
            handCardCount: this._handCounts[pid],
            discardPile:   [...this._discardPile],
            userId:        SELF_ID,
        };
        this._send(MessageType.TONGITS_DISCARD_BROADCAST, data);
    }

    // ── 按钮：放牌（Drop） ────────────────────────────────

    /** 模拟自己 Drop 3张牌到放牌区（取手牌前3张） */
    clickMeldSelf(): void {
        const meldCards = this._selfHand.splice(0, 3);
        this._handCounts[SELF_ID] = this._selfHand.length;

        const data: MeldCardBroadcast = {
            playerId: SELF_ID,
            newMeld: { meldId: 1, cards: meldCards, ownerId: SELF_ID, highlightCards: 0, locked: false },
            handCardCount: this._handCounts[SELF_ID],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_MELD_BROADCAST, data);
    }

    /** 模拟其他玩家 Drop */
    clickMeldOther(): void {
        const pid = P2_ID;
        this._handCounts[pid] = Math.max(0, (this._handCounts[pid] ?? 12) - 3);

        const data: MeldCardBroadcast = {
            playerId: pid,
            newMeld: { meldId: 2, cards: [301, 302, 303], ownerId: pid, highlightCards: 0, locked: false },
            handCardCount: this._handCounts[pid],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_MELD_BROADCAST, data);
    }

    // ── 按钮：压牌（Sapaw） ───────────────────────────────

    /** 模拟自己压牌到 P3 的放牌区 */
    clickLayOffSelf(): void {
        const card = this._selfHand.shift() ?? 104;
        this._handCounts[SELF_ID] = this._selfHand.length;

        const data: LayOffCardBroadcast = {
            actionPlayerId: SELF_ID,
            targetPlayerId: P3_ID,
            targetMeldId:   1,
            cardAdded:      card,
            handCardCount:  this._handCounts[SELF_ID],
            userId:         SELF_ID,
        };
        this._send(MessageType.TONGITS_LAYOFF_BROADCAST, data);
    }

    // ── 按钮：挑战（Fight） ───────────────────────────────

    /** 模拟自己发起 Fight */
    clickChallengeSelf(): void {
        const data: ChallengeBroadcast = {
            playerId: SELF_ID,
            basePlayers: [
                { playerId: SELF_ID, changeStatus: 2, countdown: 0 },
                { playerId: P2_ID,   changeStatus: 1, countdown: 10 },
                { playerId: P3_ID,   changeStatus: 1, countdown: 10 },
            ],
            userId: SELF_ID,
        };
        this._send(MessageType.TONGITS_CHALLENGE_BROADCAST, data);
    }

    /** 模拟 P2 接受挑战 */
    clickChallengeAccept(): void {
        const data: PKBroadcast = {
            playerId:     P2_ID,
            changeStatus: 3,  // 3=接受
            userId:       SELF_ID,
        };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    /** 模拟 P3 拒绝（认输）挑战 */
    clickChallengeSurrender(): void {
        const data: PKBroadcast = {
            playerId:     P3_ID,
            changeStatus: 4,  // 4=拒绝/认输
            userId:       SELF_ID,
        };
        this._send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    // ── 按钮：结算前 ──────────────────────────────────────

    /** 模拟结算前比牌广播（自己获胜） */
    clickBeforeResult(): void {
        const data: BeforeResultBroadcast = {
            winnerId: SELF_ID,
            winType:  1,
            players: [
                mockPlayer(SELF_ID, this._selfHand, false, 1, 1),
                mockPlayer(P2_ID,   [],             false, 0, 2),
                mockPlayer(P3_ID,   [],             true,  0, 3),
            ],
            countdown: 5,
            pot:      mockPot(),
            userId:   SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_WIN_BROADCAST, data);
    }

    // ── 按钮：游戏结算 ────────────────────────────────────

    /** 模拟自己获胜结算 */
    clickGameResultWin(): void {
        const data: GameResultBroadcast = {
            winnerId: SELF_ID,
            playerResults: [
                mockPlayerResult(SELF_ID, this._selfHand, 20, true),
                mockPlayerResult(P2_ID,   [],             -10),
                mockPlayerResult(P3_ID,   [],             -10),
            ],
            countdown: 5,
            userId:    SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_RESULT_BROADCAST, data);
    }

    /** 模拟自己失败结算 */
    clickGameResultLose(): void {
        const data: GameResultBroadcast = {
            winnerId: P2_ID,
            playerResults: [
                mockPlayerResult(SELF_ID, this._selfHand, -10),
                mockPlayerResult(P2_ID,   [],              20, true),
                mockPlayerResult(P3_ID,   [],             -10),
            ],
            countdown: 5,
            userId:    SELF_ID,
        };
        this._send(MessageType.TONGITS_GAME_RESULT_BROADCAST, data);
    }

    // ── 按钮：房间重置 ────────────────────────────────────

    clickRoomReset(): void {
        const data: RoomResetBroadcast = {
            players: [
                mockPlayer(SELF_ID, [], false, 1, 1),
                mockPlayer(P2_ID,   [], false, 0, 2),
                mockPlayer(P3_ID,   [], false, 0, 3),
            ],
            self:     mockPlayer(SELF_ID, [], false, 1, 1),
            gameInfo: undefined,
            userId:   SELF_ID,
        };
        this._send(MessageType.TONGITS_ROOM_RESET_BROADCAST, data);
    }

    // ── 私有工具 ──────────────────────────────────────────

    /** 重置牌局状态并发牌 */
    private _resetDeck(): void {
        const deck = shuffle(FULL_DECK);
        // Self:12, P2:12, P3(庄):13, 牌堆:15
        this._selfHand    = deck.slice(0, 12);
        const _p2Hand     = deck.slice(12, 24);  // 客户端不存，仅计数
        const _p3Hand     = deck.slice(24, 37);  // 庄家13张
        this._deck        = deck.slice(37);      // 15张
        this._discardPile = [];
        this._actionIdx   = TURN_ORDER.indexOf(P3_ID); // 庄家先手
        this._handCounts  = {
            [SELF_ID]: 12,
            [P2_ID]:   12,
            [P3_ID]:   13,
        };
    }

    private _sendActionChange(): void {
        const data: ActionChangeBroadcast = {
            actionPlayerId: this._actionId,
            countdown:      25,
            isFight:        false,
            status:         2,
            userId:         SELF_ID,
        };
        this._send(MessageType.TONGITS_ACTION_CHANGE_BROADCAST, data);
    }

    private _send(msgType: number, data: unknown): void {
        console.log(`[Mock] → msgType:${msgType}`, data);
        Nexus.net.simulateWsReceive?.(msgType, data);
    }
}
