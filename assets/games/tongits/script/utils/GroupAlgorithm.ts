/**
 * GroupAlgorithm — Tongits 手牌自动分组算法（最优版本）
 *
 * 使用 DFS 回溯枚举所有合法分组方案，选取使未分组手牌总点数最小的组合。
 *
 * 牌型定义：
 *   SPECIAL : 四条（4张同点数）| 5张以上同花顺
 *   VALID   : 三条（3张同点数）| 3~4张同花顺
 *   INVALID : 不满足任何牌型（手动创建时使用）
 *   UNGROUP : 未分组手牌
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

/** 单张牌的点数（J/Q/K 均为 10） */
function _cardPoint(card: number): number {
    const r = getRank(card);
    return r > 10 ? 10 : r;
}

/** 一组牌的点数之和 */
function _sumPoint(cards: Iterable<number>): number {
    let sum = 0;
    for (const c of cards) sum += _cardPoint(c);
    return sum;
}

// ── 枚举所有合法分组 ──────────────────────────────────────

/**
 * 枚举手牌中所有合法的基础分组：
 *   - 刻子 / 四条：同点数 3 或 4 张的全部 C(n,3) + C(n,4) 组合
 *   - 同花顺：同花色连续段中所有长度 ≥ 3 的连续子段
 */
function _generateAllValidGroups(cards: number[]): number[][] {
    const groups: number[][] = [];

    // 1. 刻子 / 四条
    const byRank = new Map<number, number[]>();
    for (const c of cards) {
        const r = getRank(c);
        if (!byRank.has(r)) byRank.set(r, []);
        byRank.get(r)!.push(c);
    }
    for (const [, rc] of byRank) {
        const n = rc.length;
        if (n >= 3) {
            // C(n,3)
            for (let i = 0; i < n - 2; i++)
                for (let j = i + 1; j < n - 1; j++)
                    for (let k = j + 1; k < n; k++)
                        groups.push([rc[i], rc[j], rc[k]]);
        }
        if (n >= 4) {
            // C(n,4)
            for (let i = 0; i < n - 3; i++)
                for (let j = i + 1; j < n - 2; j++)
                    for (let k = j + 1; k < n - 1; k++)
                        for (let l = k + 1; l < n; l++)
                            groups.push([rc[i], rc[j], rc[k], rc[l]]);
        }
    }

    // 2. 同花顺
    const bySuit = new Map<number, number[]>();
    for (const c of cards) {
        const s = getSuit(c);
        if (!bySuit.has(s)) bySuit.set(s, []);
        bySuit.get(s)!.push(c);
    }
    for (const [, sc] of bySuit) {
        const sorted = [...sc].sort((a, b) => getRank(a) - getRank(b));
        let i = 0;
        while (i < sorted.length) {
            // 找从 i 开始的最长连续段
            let j = i + 1;
            while (j < sorted.length && getRank(sorted[j]) === getRank(sorted[j - 1]) + 1) j++;
            const run = sorted.slice(i, j);
            const runLen = run.length;
            // 枚举该连续段内所有长度 ≥ 3 的子串
            for (let len = 3; len <= runLen; len++) {
                for (let start = 0; start + len <= runLen; start++) {
                    groups.push(run.slice(start, start + len));
                }
            }
            i = j;
        }
    }

    return groups;
}

// ── DFS 回溯 ──────────────────────────────────────────────

interface _Best {
    point:   number;
    groups:  number[][];
    ungroup: number[];
}

/**
 * DFS 回溯：枚举 allGroups 的所有不冲突子集，寻找使 remaining 点数最小的方案。
 * 用 startIdx 保证每种无序组合只被枚举一次（canonical 顺序）。
 */
function _dfs(
    remaining: Set<number>,
    allGroups:  number[][],
    startIdx:   number,
    chosen:     number[][],
    best:       _Best,
): void {
    const curPoint = _sumPoint(remaining);
    if (curPoint < best.point) {
        best.point  = curPoint;
        best.groups = chosen.slice();
        best.ungroup = Array.from(remaining);
    }
    if (curPoint === 0) return; // Tongits，无需继续

    for (let i = startIdx; i < allGroups.length; i++) {
        const g = allGroups[i];
        // 检查该组所有牌仍在剩余手牌中
        if (!g.every(c => remaining.has(c))) continue;
        // 取走该组
        for (const c of g) remaining.delete(c);
        chosen.push(g);
        _dfs(remaining, allGroups, i + 1, chosen, best);
        // 回溯
        chosen.pop();
        for (const c of g) remaining.add(c);
    }
}

// ── 核心：自动分组 ────────────────────────────────────────

/**
 * 对给定手牌执行自动分组，选取使未分组手牌总点数最小的方案。
 * @param cards  手牌数组
 * @param mode   当前排序模式（仅影响 ungroup 顺序）
 * @returns      groups（自动创建的组）+ ungroup（未能分组的牌）
 */
export function autoGroup(cards: number[], mode: SortMode): AutoGroupResult {
    const allGroups = _generateAllValidGroups(cards);

    const best: _Best = {
        point:   _sumPoint(cards),
        groups:  [],
        ungroup: [...cards],
    };
    _dfs(new Set(cards), allGroups, 0, [], best);

    // 将原始卡牌数组转为 GroupData，按 SPECIAL → VALID 排序
    const typeOrder = {
        [GroupType.SPECIAL]: 0,
        [GroupType.VALID]:   1,
        [GroupType.INVALID]: 2,
        [GroupType.UNGROUP]: 3,
    };
    const groupData: GroupData[] = best.groups.map(g => makeGroup(g, judgeGroupType(g), true));
    groupData.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

    return {
        groups:  groupData,
        ungroup: sortCards(best.ungroup, mode),
    };
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

    const isFlush    = isStraightFlush(cards);
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
