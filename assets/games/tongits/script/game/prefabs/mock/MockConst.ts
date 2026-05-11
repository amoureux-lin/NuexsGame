/**
 * MockConst — Mock 模拟用常量、类型定义、工厂函数
 *
 * 纯数据层，零引擎依赖，可独立测试。
 */

import { PlayerInfo, PendingRoomAction } from 'db://assets/script/proto/game_common_room';
import type {
    TongitsPlayerInfo, GameInfo, PotInfo, Meld, Cards, RoomInfo,
} from '../../../proto/tongits';
import { autoGroup, GroupType } from '../../../utils/GroupAlgorithm';
import { SortMode } from '../../../utils/CardDef';

// ══════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════

/** 玩家操作状态（与 proto 注释一致） */
export const PLAYER_STATUS = {
    INIT:   1,   // 不可操作（非操作回合 / 弃牌后等待下一轮）
    SELECT: 2,   // 可操作：抽牌 / 吃牌 / 发起挑战 三选一
    ACTION: 3,   // 已抽/吃牌，必须弃牌或放牌
} as const;

/** Mock 玩家 ID */
export const SELF_ID = 1001;
export const P2_ID   = 1002;
export const P3_ID   = 1003;

/** 出牌顺序（逆时针：庄家 P3 先手） */
export const TURN_ORDER = [P3_ID, SELF_ID, P2_ID];

/** 房间配置 */
export const SCORES     = [500, 2000, 5000, 10000, 20000, 50000];
export const BET_AMOUNT = 10;

/** 吃牌测试用诱饵牌（P3 首回合弃出，SELF 可用手中 A 吃牌） */
export const TAKE_BAIT_CARD = 301;

/** 吃牌测试用固定手牌（12 张） */
export const SELF_FIXED_HAND = [101, 201, 401, 302, 303, 104, 105, 106, 204, 205, 206, 110];

/** 52 张标准牌（花色 * 100 + 点数：♠=1, ♥=2, ♣=3, ♦=4） */
export const FULL_DECK: number[] = [
    101,102,103,104,105,106,107,108,109,110,111,112,113,
    201,202,203,204,205,206,207,208,209,210,211,212,213,
    301,302,303,304,305,306,307,308,309,310,311,312,313,
    401,402,403,404,405,406,407,408,409,410,411,412,413,
];

// ══════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════

/** 洗牌（Fisher-Yates） */
export function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * number[] → Cards[]（模拟服务端分组）。
 * 使用 autoGroup 算法将手牌分为有效牌组 + 散牌，映射到 proto Cards 结构：
 *   groupId: 0=散牌, 1+=牌组编号
 *   cardType: 0=无效, 1=有效(VALID), 2=特殊(SPECIAL)
 */
export function toCards(cards: number[]): Cards[] {
    if (cards.length === 0) return [];

    const { groups, ungroup } = autoGroup(cards, SortMode.BY_RANK);
    const result: Cards[] = [];

    // 牌组：groupId 从 1 开始
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        let cardType = 0;
        if (g.type === GroupType.VALID)   cardType = 1;
        if (g.type === GroupType.SPECIAL) cardType = 2;
        result.push({
            groupId:   i + 1,
            handCards: [...g.cards],
            cardType,
            cardPoint: calcPoint(g.cards),
        });
    }

    // 散牌：groupId = 0
    if (ungroup.length > 0) {
        result.push({
            groupId:   0,
            handCards: [...ungroup],
            cardType:  0,
            cardPoint: calcPoint(ungroup),
        });
    }

    return result;
}

/** 计算手牌点数：A=1, 2-10=面值, J/Q/K=10 */
export function calcPoint(cards: number[]): number {
    return cards.reduce((sum, c) => sum + Math.min(c % 100, 10), 0);
}

// ══════════════════════════════════════════════════════════════
// MockPlayer — 内部玩家数据
// ══════════════════════════════════════════════════════════════

export interface MockPlayer {
    userId:         number;
    hand:           number[];         // 真实手牌（number[]）
    isDealer:       boolean;
    displayedMelds: Meld[];
    status:         number;           // PLAYER_STATUS
    changeStatus:   number;           // 挑战状态 1-5
    isFight:        boolean;
    isWin:          boolean;
    cardPoint:      number;
    isAuto:         boolean;
    post:           number;           // 0:普通 1:房主
    seat:           number;           // 座位号 1-3
}

export function createMockPlayer(
    userId: number, hand: number[],
    isDealer = false, post = 0, seat = 0,
): MockPlayer {
    return {
        userId, hand: [...hand], isDealer, displayedMelds: [],
        status: PLAYER_STATUS.INIT, changeStatus: 1,
        isFight: false, isWin: false, cardPoint: 0, isAuto: false,
        post, seat,
    };
}

// ══════════════════════════════════════════════════════════════
// Proto 构建工具
// ══════════════════════════════════════════════════════════════

/** 构建 proto PlayerInfo */
export function buildPlayerInfo(userId: number, post = 0, seat = 0): PlayerInfo {
    return {
        userId,
        nickname:               `Player_${userId}`,
        avatar:                 '',
        coin:                   100000,
        seat,
        role:                   2,
        post,
        state:                  1,
        micAllowStatus:         2,
        coinChanged:            0,
        micOn:                  false,
        nextMicRequestTime:     0,
        micRequestExpiredTime:  0,
        waitReadyExpiredTime:   0,
        activePendingAction:    PendingRoomAction.PENDING_ROOM_ACTION_NONE,
    };
}

/** MockPlayer → proto TongitsPlayerInfo（isSelf 时附带手牌） */
export function toProtoPlayer(mp: MockPlayer, isSelf: boolean): TongitsPlayerInfo {
    return {
        playerInfo:     buildPlayerInfo(mp.userId, mp.post, mp.seat),
        handCardCount:  mp.hand.length,
        handCards:      [],
        isDealer:       mp.isDealer,
        displayedMelds: mp.displayedMelds.map(m => ({ ...m, cards: [...m.cards] })),
        groupCards:      isSelf ? toCards(mp.hand) : [],
        isFight:        mp.isFight,
        countdown:      25,
        changeStatus:   mp.changeStatus,
        status:         mp.status,
        isWin:          mp.isWin,
        cardPoint:      mp.cardPoint,
        isAuto:         mp.isAuto,
    };
}

/** 构建底池 */
export function buildPot(winCount = 1): PotInfo {
    return { base: winCount, winCount, useId: 0 };
}

/** 等待中 GameInfo（游戏未开始） */
export function buildWaitingGameInfo(): GameInfo {
    return {
        actionPlayerId: 0,
        status:         1,
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

/** 游戏中 GameInfo */
export function buildPlayingGameInfo(actionPlayerId: number, deckCount = 15): GameInfo {
    return {
        actionPlayerId,
        status:        2,
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

/** 房间信息 */
export function buildRoomInfo(): RoomInfo {
    return { roomId: 9999, roomName: 'Mock Room', roomStatus: 1, maxSeat: 3 };
}
