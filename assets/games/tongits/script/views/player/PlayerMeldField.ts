/**
 * PlayerMeldField — 玩家牌组展示区
 *
 * 将已打出的 Meld 按 First-Fit Shelf 算法排列在固定宽度区域内：
 *   - LTR（自己 / 左侧）：从左向右填充，满行换新行
 *   - RTL（右侧玩家）  ：从右向左填充，满行换新行
 *
 * Inspector 节点绑定：
 *   PlayerMeldField 节点独立放置（不要求是 PlayerSeat 子节点），
 *   在 PlayerSeat 的 meldField 属性槽中拖入对应节点即可完成关联。
 */

import { _decorator, Component, Node, Prefab, instantiate } from 'cc';
import { CardNode, DEFAULT_CARD_W, DEFAULT_CARD_H, CARD_SPACING } from '../handcard/CardNode';
import type { Meld } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/** 牌区内每张牌的缩放比例 */
const CARD_SCALE = 0.55;

@ccclass('PlayerMeldField')
export class PlayerMeldField extends Component {

    @property({ type: Prefab, tooltip: '牌面预制体（与 HandCardPanel 共用同一份）' })
    cardPrefab: Prefab | null = null;

    @property({ tooltip: '牌区可用总宽（px），含左右内边距' })
    availableWidth: number = 280;

    @property({ tooltip: '左右内边距（px）' })
    paddingH: number = 8;

    @property({ tooltip: '同行牌组块之间的间距（px）' })
    blockSpacing: number = 10;

    @property({ tooltip: '行与行之间的垂直间距（px）' })
    rowSpacing: number = 8;

    @property({ tooltip: '从右向左排列（右侧玩家设为 true）' })
    rtl: boolean = false;

    @property({ tooltip: '单行模式：全部牌组排在同一行不换行（自己/perspectiveId 用）' })
    singleRow: boolean = false;

    // ── 内部状态 ──────────────────────────────────────────

    /** 已添加的 meldId 集合（防重复） */
    private _placedIds  = new Set<number>();
    /** 行列表，每行记录已用宽度与行节点 */
    private _rows: Array<{ node: Node; usedWidth: number }> = [];

    // ── 计算属性 ──────────────────────────────────────────

    private get _innerW(): number { return this.availableWidth - this.paddingH * 2; }

    /** 缩放后单张牌宽 */
    private get _cw(): number { return DEFAULT_CARD_W * CARD_SCALE; }
    /** 缩放后相邻牌中心间距 */
    private get _step(): number { return CARD_SPACING  * CARD_SCALE; }
    /** 缩放后单张牌高 */
    private get _ch(): number { return DEFAULT_CARD_H * CARD_SCALE; }

    private _blockW(cardCount: number): number {
        return this._cw + this._step * (cardCount - 1);
    }

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 新增一个 Meld 展示块（First-Fit Shelf 定位）。
     * 已存在的 meldId 会被忽略（防止重复添加）。
     */
    addMeld(meld: Meld): void {
        if (!meld || meld.cards.length === 0) return;
        if (this._placedIds.has(meld.meldId)) return;
        this._placedIds.add(meld.meldId);

        const bw        = this._blockW(meld.cards.length);
        const blockNode = this._createBlock(meld);

        if (this.singleRow) {
            // 单行模式：始终放入第 0 行，不换行
            const row = this._rows[0] ?? this._newRow();
            this._placeInRow(row, blockNode, bw);
            return;
        }

        // First-Fit：扫描已有行，找第一个放得下的
        for (const row of this._rows) {
            const extra = row.usedWidth > 0 ? this.blockSpacing : 0;
            if (row.usedWidth + extra + bw <= this._innerW) {
                this._placeInRow(row, blockNode, bw);
                return;
            }
        }
        // 所有行都放不下 → 新开一行
        this._placeInRow(this._newRow(), blockNode, bw);
    }

    /** 全量重建（重连 / 游戏恢复时调用） */
    setMelds(melds: Meld[]): void {
        this.clear();
        for (const m of melds) this.addMeld(m);
    }

    /** 清空所有展示节点与状态 */
    clear(): void {
        for (const row of this._rows) {
            if (row.node?.isValid) row.node.destroy();
        }
        this._rows = [];
        this._placedIds.clear();
    }

    // ── 私有：布局 ────────────────────────────────────────

    private _newRow(): { node: Node; usedWidth: number } {
        const rowNode = new Node('MeldRow');
        const y       = -(this._rows.length * (this._ch + this.rowSpacing));
        rowNode.setPosition(0, y, 0);
        this.node.addChild(rowNode);
        const row = { node: rowNode, usedWidth: 0 };
        this._rows.push(row);
        return row;
    }

    private _placeInRow(
        row: { node: Node; usedWidth: number },
        blockNode: Node,
        bw: number,
    ): void {
        const extra  = row.usedWidth > 0 ? this.blockSpacing : 0;
        const offset = row.usedWidth + extra; // 从内边缘起始的偏移
        const half   = this._innerW / 2;

        // blockNode 的 x = 块的左边缘坐标（基于容器中心为原点）
        const x = this.rtl
            ? half - offset - bw   // 从右向左
            : -half + offset;      // 从左向右

        blockNode.setPosition(x, 0, 0);
        row.node.addChild(blockNode);
        row.usedWidth += extra + bw;
    }

    // ── 私有：牌块创建 ────────────────────────────────────

    private _createBlock(meld: Meld): Node {
        const blockNode = new Node(`Meld_${meld.meldId}`);
        const cw   = this._cw;
        const step = this._step;

        for (let i = 0; i < meld.cards.length; i++) {
            const n  = this.cardPrefab ? instantiate(this.cardPrefab) : new Node('MeldCard');
            const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);

            cn.setCard(meld.cards[i]);
            cn.setFaceDown(false);
            cn.onClick = null; // 牌区牌只展示，不响应点击

            n.setScale(CARD_SCALE, CARD_SCALE, 1);
            // 块内 x：左边缘(0) + 半个牌宽 + i * step
            n.setPosition(cw / 2 + i * step, 0, 0);
            n.setSiblingIndex(i);
            blockNode.addChild(n);
        }

        return blockNode;
    }
}
