/**
 * GroupAlgorithm — Tongits 手牌自动分组算法
 *
 * 牌型定义：
 *   SPECIAL : 四条（4张同点数）| 5张以上同花顺
 *   VALID   : 三条（3张同点数）| 3~4张同花顺
 *   INVALID : 不满足任何牌型（手动创建时使用）
 *   UNGROUP : 未分组手牌
 *
 * autoGroup 优先级（贪心）：
 *   ① 四条  ② 5+同花顺  ③ 三条  ④ 4张同花顺  ⑤ 3张同花顺
 */

import { getSuit, getRank, sortCards, SortMode } from './CardDef';

// ── 类型定义 ──────────────────────────────────────────────

export const enum GroupType {
    SPECIAL = 'SPECIAL',   // 四条 / 5+同花顺
    VALID   = 'VALID',     // 三条 / 3~4张同花顺
    INVALID = 'INVALID',   // 无效组合
    UNGROUP = 'UNGROUP',   // 手牌区
}

export interface GroupData {
    id: string
    cards: number[]
    type: GroupType
    /** true = autoGroup 自动产生；false = 用户手动创建 */
    isAuto: boolean
}

export interface AutoGroupResult {
    groups: GroupData[]
    ungroup: number[]
}

// ── 内部工具 ──────────────────────────────────────────────

let _idCounter = 0;
function newId(): string {
    return `g_${++_idCounter}_${Date.now()}`;
}

/** 组内牌始终按 BY_RANK 排序（与玩家选择的 sortMode 无关） */
function makeGroup(cards: number[], type: GroupType, isAuto: boolean): GroupData {
    return { id: newId(), cards: sortCards(cards, SortMode.BY_RANK), type, isAuto };
}

/** 从 remaining 中移除指定牌（原地修改），返回被移除的牌 */
function extract(remaining: number[], cards: number[]): void {
    const set = new Set(cards);
    for (let i = remaining.length - 1; i >= 0; i--) {
        if (set.has(remaining[i])) remaining.splice(i, 1);
    }
}

// ── 单项匹配函数 ──────────────────────────────────────────

/**
 * 在 remaining 中找出所有四条（4张同点数），返回各组牌
 * 注意：同点数最多4张（一副牌），不会超过4张
 */
function findQuads(remaining: number[]): number[][] {
    const byRank = new Map<number, number[]>();
    for (const c of remaining) {
        const r = getRank(c);
        if (!byRank.has(r)) byRank.set(r, []);
        byRank.get(r)!.push(c);
    }
    const result: number[][] = [];
    for (const [, cards] of byRank) {
        if (cards.length >= 4) result.push(cards.slice(0, 4));
    }
    return result;
}

/**
 * 在 remaining 中按花色找出所有连续同花顺序列
 * minLen: 最小长度（5 = SPECIAL，3/4 = VALID）
 * maxLen: 最大长度（用于分阶段提取，Infinity = 不限）
 */
function findStraights(remaining: number[], minLen: number, maxLen = Infinity): number[][] {
    // 按花色分组
    const bySuit = new Map<number, number[]>();
    for (const c of remaining) {
        const s = getSuit(c);
        if (!bySuit.has(s)) bySuit.set(s, []);
        bySuit.get(s)!.push(c);
    }

    const result: number[][] = [];

    for (const [, cards] of bySuit) {
        // 按点数排序，找连续段
        const sorted = [...cards].sort((a, b) => getRank(a) - getRank(b));
        let i = 0;
        while (i < sorted.length) {
            // 找从 i 开始的最长连续段
            let j = i + 1;
            while (j < sorted.length && getRank(sorted[j]) === getRank(sorted[j - 1]) + 1) {
                j++;
            }
            const runLen = j - i;
            if (runLen >= minLen) {
                // 贪心：优先取最长段，但不超过 maxLen
                const takeLen = Math.min(runLen, maxLen === Infinity ? runLen : maxLen);
                // 从最长前缀开始取（greedy）
                let start = i;
                let remaining2 = takeLen;
                // 若 takeLen < runLen，从头部开始取连续 takeLen 张
                result.push(sorted.slice(start, start + remaining2));
                // 检查剩余部分是否还能形成新的有效段（递归处理剩余）
                // 这里简单处理：一次性取一个最长段
                // 若 runLen > takeLen，剩余的在下一个 minLen pass 里处理
            }
            i = j;
        }
    }

    return result;
}

/**
 * 在 remaining 中找出所有三条（3张同点数）
 * 若某点数有4张，四条已在前一步处理，此处最多3张
 */
function findTriples(remaining: number[]): number[][] {
    const byRank = new Map<number, number[]>();
    for (const c of remaining) {
        const r = getRank(c);
        if (!byRank.has(r)) byRank.set(r, []);
        byRank.get(r)!.push(c);
    }
    const result: number[][] = [];
    for (const [, cards] of byRank) {
        if (cards.length >= 3) result.push(cards.slice(0, 3));
    }
    return result;
}

// ── 核心：自动分组 ────────────────────────────────────────

/**
 * 对给定手牌执行自动分组
 * @param cards    手牌数组
 * @param mode     当前排序模式
 * @returns        groups（自动创建的组）+ ungroup（未能分组的牌）
 */
export function autoGroup(cards: number[], mode: SortMode): AutoGroupResult {
    const remaining = [...cards];
    const groups: GroupData[] = [];

    // ① 四条 (SPECIAL)
    for (const g of findQuads(remaining)) {
        groups.push(makeGroup(g, GroupType.SPECIAL, true));
        extract(remaining, g);
    }

    // ② 5+张同花顺 (SPECIAL)
    for (const g of findStraights(remaining, 5)) {
        groups.push(makeGroup(g, GroupType.SPECIAL, true));
        extract(remaining, g);
    }

    // ③ 三条 (VALID)
    for (const g of findTriples(remaining)) {
        groups.push(makeGroup(g, GroupType.VALID, true));
        extract(remaining, g);
    }

    // ④ 4张同花顺 (VALID)：此时 remaining 中同花连续段最长为 4
    for (const g of findStraights(remaining, 4, 4)) {
        groups.push(makeGroup(g, GroupType.VALID, true));
        extract(remaining, g);
    }

    // ⑤ 3张同花顺 (VALID)：此时 remaining 中同花连续段最长为 3
    for (const g of findStraights(remaining, 3, 3)) {
        groups.push(makeGroup(g, GroupType.VALID, true));
        extract(remaining, g);
    }

    // 剩余 → ungroup（按当前模式排序）
    const ungroup = sortCards(remaining, mode);

    // 组间排序：SPECIAL 在前，VALID 在后，同类型按首张牌排序
    groups.sort((a, b) => {
        const typeOrder = { [GroupType.SPECIAL]: 0, [GroupType.VALID]: 1, [GroupType.INVALID]: 2, [GroupType.UNGROUP]: 3 };
        const td = typeOrder[a.type] - typeOrder[b.type];
        if (td !== 0) return td;
        return 0; // 同类型保持发现顺序
    });

    return { groups, ungroup };
}

// ── 牌型校验（用于手动 Group 后判断类型） ─────────────────

/** 判断一组牌是否为同花顺（同花色连续） */
function isStraightFlush(cards: number[]): boolean {
    if (cards.length < 3) return false;
    const suit = getSuit(cards[0]);
    if (cards.some(c => getSuit(c) !== suit)) return false;
    const ranks = cards.map(c => getRank(c)).sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] !== ranks[i - 1] + 1) return false;
    }
    return true;
}

/** 判断一组牌是否为刻子（三条/四条：3~4张同点数） */
function isSet(cards: number[]): boolean {
    if (cards.length < 3 || cards.length > 4) return false;
    const rank = getRank(cards[0]);
    return cards.every(c => getRank(c) === rank);
}

/**
 * 根据牌组内容判断 GroupType
 * 供手动 Group 操作后调用
 */
export function judgeGroupType(cards: number[]): GroupType {
    if (cards.length < 2) return GroupType.INVALID;

    const isFlush = isStraightFlush(cards);
    const isSetGroup = isSet(cards);

    if (isSetGroup && cards.length === 4) return GroupType.SPECIAL;   // 四条
    if (isFlush && cards.length >= 5)     return GroupType.SPECIAL;   // 5+同花顺
    if (isSetGroup && cards.length === 3) return GroupType.VALID;     // 三条
    if (isFlush && cards.length >= 3)     return GroupType.VALID;     // 3~4同花顺

    return GroupType.INVALID;
}

/**
 * 判断牌组是否可以 Drop（放牌区）
 * 三条 / 四条 / 三张以上同花顺
 */
export function canDrop(cards: number[]): boolean {
    return judgeGroupType(cards) === GroupType.VALID || judgeGroupType(cards) === GroupType.SPECIAL;
}
