/**
 * CardDef — Tongits 牌值基础定义
 *
 * 编码规则：
 *   黑桃(♠) 101-113  红心(♥) 201-213
 *   梅花(♣) 301-313  方块(♦) 401-413
 *
 * Rank: card % 100  → 1(A) ~ 13(K)
 * Suit: Math.floor(card / 100) → 1=♠ 2=♥ 3=♣ 4=♦
 */

// ── 花色枚举 ─────────────────────────────────────────────

export const enum Suit {
    SPADE   = 1,   // ♠ 黑桃
    HEART   = 2,   // ♥ 红心
    CLUB    = 3,   // ♣ 梅花
    DIAMOND = 4,   // ♦ 方块
}

/** 花色显示顺序：♦→♣→♥→♠（suit 值 4→3→2→1，数值越大越靠前） */
export const SUIT_DISPLAY_PRIORITY: Record<number, number> = {
    [Suit.DIAMOND]: 0,
    [Suit.CLUB]:    1,
    [Suit.HEART]:   2,
    [Suit.SPADE]:   3,
};

// ── 排序模式 ──────────────────────────────────────────────

export const enum SortMode {
    BY_RANK = 1,   // 顺序：点数 A→K，同点数按 ♦→♣→♥→♠
    BY_SUIT = 2,   // 花色：♦→♣→♥→♠，同花色按 A→K
}

// ── 基础工具函数 ──────────────────────────────────────────

/** 取花色 (1=♠ 2=♥ 3=♣ 4=♦) */
export function getSuit(card: number): Suit {
    return Math.floor(card / 100) as Suit;
}

/** 取点数 (1=A … 13=K) */
export function getRank(card: number): number {
    return card % 100;
}

/** 取分值 (A~10 = 1~10, J/Q/K = 10) */
export function getPoint(card: number): number {
    const rank = getRank(card);
    return rank > 10 ? 10 : rank;
}

/** 计算一组牌的总分值 */
export function calcPoint(cards: number[]): number {
    return cards.reduce((sum, c) => sum + getPoint(c), 0);
}

/**
 * 比较两张牌的排列顺序
 * 返回负数 = a 排在 b 前面
 */
export function compareCards(a: number, b: number, mode: SortMode): number {
    const ra = getRank(a), rb = getRank(b);
    const sa = getSuit(a), sb = getSuit(b);

    if (mode === SortMode.BY_RANK) {
        // 主键：点数升序 (A first)
        if (ra !== rb) return ra - rb;
        // 次键：花色 ♦(4)→♣(3)→♥(2)→♠(1)，suit 值大的排前面
        return sb - sa;
    } else {
        // 主键：花色 ♦(4)→♣(3)→♥(2)→♠(1)
        if (sa !== sb) return sb - sa;
        // 次键：点数升序
        return ra - rb;
    }
}

/** 对手牌数组按指定模式排序（返回新数组） */
export function sortCards(cards: number[], mode: SortMode): number[] {
    return [...cards].sort((a, b) => compareCards(a, b, mode));
}
