/**
 * MeldValidator — Tongits 牌型合法性检测 + 吃牌候选计算
 *
 * 牌值编码：suit*100 + rank
 *   黑(♠)=1, 红(♥)=2, 梅(♣)=3, 方(♦)=4
 *   rank: 1=A, 2-10, 11=J, 12=Q, 13=K
 */

import { getSuit, getRank, getPoint } from './CardDef';

export class MeldValidator {

    // ── 牌型判断 ──────────────────────────────────────────

    /**
     * 判断一组牌是否构成合法 Meld（3-4 张）。
     * 支持：刻子（同点数 3-4 张）/ 顺子（同花色 3-4 张连续）。
     */
    static isMeld(cards: number[]): boolean {
        const n = cards.length;
        if (n < 3 || n > 4) return false;
        return this._isSet(cards) || this._isSequence(cards);
    }

    /** 刻子：所有牌点数相同 */
    private static _isSet(cards: number[]): boolean {
        const r = getRank(cards[0]);
        return cards.every(c => getRank(c) === r);
    }

    /** 顺子：所有牌花色相同且点数连续（升序） */
    private static _isSequence(cards: number[]): boolean {
        const s = getSuit(cards[0]);
        if (!cards.every(c => getSuit(c) === s)) return false;
        const ranks = cards.map(getRank).sort((a, b) => a - b);
        for (let i = 1; i < ranks.length; i++) {
            if (ranks[i] !== ranks[i - 1] + 1) return false;
        }
        return true;
    }

    // ── 吃牌候选计算 ──────────────────────────────────────

    /**
     * 从手牌中找出能与 discardCard 组成合法 Meld 的所有子集。
     *
     * @param handCards   手牌（散牌区，不含 discardCard）
     * @param discardCard 弃牌堆顶部的牌
     * @returns 每个元素是"从手牌中取出"的子集（不含 discardCard），
     *          按总分值降序排列（点数最高的候选优先）
     */
    static findTakeCandidates(handCards: number[], discardCard: number): number[][] {
        const candidates: number[][] = [];
        const seen = new Set<string>();

        // 从手牌中取 2 或 3 张与 discardCard 组成 3~4 张 Meld
        for (let size = 2; size <= 3; size++) {
            if (handCards.length < size) continue;
            this._combinations(handCards, size, (combo) => {
                if (this.isMeld([...combo, discardCard])) {
                    const key = [...combo].sort((a, b) => a - b).join(',');
                    if (!seen.has(key)) {
                        seen.add(key);
                        candidates.push([...combo]);
                    }
                }
            });
        }

        // 按手牌总分值降序（优先展示点数高的组合，利于玩家减分）
        candidates.sort((a, b) =>
            b.reduce((s, c) => s + getPoint(c), 0) -
            a.reduce((s, c) => s + getPoint(c), 0),
        );

        return candidates;
    }

    // ── 内部工具 ──────────────────────────────────────────

    private static _combinations<T>(
        arr: T[],
        size: number,
        cb: (combo: T[]) => void,
    ): void {
        const combo: T[] = [];
        const pick = (start: number) => {
            if (combo.length === size) { cb(combo.slice()); return; }
            for (let i = start; i < arr.length; i++) {
                combo.push(arr[i]);
                pick(i + 1);
                combo.pop();
            }
        };
        pick(0);
    }
}
