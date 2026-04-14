/**
 * HandDisplayPanel — 只读手牌展示组件
 *
 * 用途：
 *   - 结算时展示其他玩家手牌（含分组与散牌）
 *   - 视觉布局与 HandCardPanel 完全一致，无拖拽 / 选中 / 状态机
 *   - 可复用于结算弹窗、Tongits 面板等任意场景
 *
 * 使用方式：
 *   1. 将本组件挂到目标节点（如 PlayerMeldField.handCardsNode）
 *   2. Inspector 中绑定 cardPrefab / cardGroupPrefab / alignment
 *   3. 运行时调用 show(cards, groups?) 显示，clear() 清空
 *
 * 动画效果：
 *   所有牌从对齐锚点（LEFT=左边缘 / RIGHT=右边缘 / CENTER=中心）
 *   带错开延迟展开到最终布局位置。
 */

import { _decorator, Component, Enum, Node, Prefab, instantiate, Vec3, tween, Tween } from 'cc';
import { CardNode, DEFAULT_CARD_W, CARD_SPACING }                    from './CardNode';
import { CardGroupView }                                              from './CardGroupView';
import { autoGroup, GroupData }                                       from '../../utils/GroupAlgorithm';
import { SortMode }                                                   from '../../utils/CardDef';

const { ccclass, property } = _decorator;

// ── 对齐方式 ──────────────────────────────────────────────

export enum HandDisplayAlignment {
    LEFT   = 0,   // 左对齐（左玩家 p3）：内容从左边缘向右延伸
    RIGHT  = 1,   // 右对齐（右玩家 p2）：内容从右边缘向左延伸
    CENTER = 2,   // 居中（自己 / 结算）：内容以节点中心为对称轴
}

// ── 布局常量（与 HandCardPanel 保持一致） ──────────────────

/** 组与组之间的间距（px）——与 HandCardPanel.GROUP_GAP 相同 */
const GROUP_GAP      = 36;
/** 展开动画时长（秒） */
const EXPAND_DUR     = 0.30;
/** 每组 / 每张牌的错开延迟（秒） */
const EXPAND_STAGGER = 0.04;

// ── 组件 ──────────────────────────────────────────────────

@ccclass('HandDisplayPanel')
export class HandDisplayPanel extends Component {

    @property({ type: Prefab, tooltip: '牌面预制体（与 HandCardPanel 共用同一份）' })
    cardPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '牌组预制体（CardGroupView Prefab，与 HandCardPanel 共用）' })
    cardGroupPrefab: Prefab | null = null;

    @property({ type: Enum(HandDisplayAlignment), tooltip: '对齐方式：LEFT=左对齐 / RIGHT=右对齐 / CENTER=居中' })
    alignment: HandDisplayAlignment = HandDisplayAlignment.LEFT;

    // ── 私有状态 ──────────────────────────────────────────

    /** 所有牌/组的统一根容器，根据 alignment 偏移 */
    private _root: Node = null!;
    /** 已创建的 CardGroupView 实例列表 */
    private _groupViews: CardGroupView[] = [];
    /** 已创建的散牌 CardNode 列表 */
    private _ungroupNodes: CardNode[] = [];

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        this._root = new Node('_displayRoot');
        this.node.addChild(this._root);
    }

    protected onDestroy(): void {
        this._doClean();
    }

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 展示手牌（带展开动画，重复调用时自动清空旧内容）。
     *
     * @param cards  手牌值列表（全量）
     * @param groups 外部传入的分组信息；不传则由 autoGroup 自动计算
     */
    show(cards: number[], groups?: GroupData[]): void {
        this.clear();
        if (cards.length === 0) return;

        // ── 1. 计算分组与散牌 ──────────────────────────────
        let groupList: GroupData[];
        let ungroupList: number[];

        if (groups && groups.length > 0) {
            const groupedCards: number[] = [];
            for (const g of groups) groupedCards.push(...g.cards);
            const grouped = new Set(groupedCards);
            groupList   = groups;
            ungroupList = cards.filter(c => !grouped.has(c));
        } else {
            const result = autoGroup(cards, SortMode.BY_RANK);
            groupList    = result.groups;
            ungroupList  = result.ungroup;
        }

        // ── 2. 预算所有目标位置（在 [0, totalW] 局部空间中）──
        const cardW        = DEFAULT_CARD_W;
        const groupWidths  = groupList.map(g => cardW + (g.cards.length - 1) * CARD_SPACING);
        const groupTargets: number[] = [];

        let curX = 0;
        for (let i = 0; i < groupList.length; i++) {
            groupTargets.push(curX + groupWidths[i] / 2);  // 组中心 X
            curX += groupWidths[i] + GROUP_GAP;
        }
        if (groupList.length > 0) curX -= GROUP_GAP;       // 去掉最后一组尾部间距

        const ungroupTargets: number[] = [];
        if (ungroupList.length > 0) {
            if (groupList.length > 0) curX += GROUP_GAP;   // 组区与散牌之间的间距
            const ungroupStartX = curX + cardW / 2;         // 首张散牌中心
            for (let i = 0; i < ungroupList.length; i++) {
                ungroupTargets.push(ungroupStartX + i * CARD_SPACING);
            }
            curX += (ungroupList.length - 1) * CARD_SPACING + cardW;
        }
        const totalW = Math.max(curX, 0);

        // ── 3. 根节点偏移（对齐方式决定） ────────────────────
        const rootX = this.alignment === HandDisplayAlignment.CENTER ? -totalW / 2
                    : this.alignment === HandDisplayAlignment.RIGHT   ? -totalW
                    : 0;  // LEFT
        this._root.setPosition(rootX, 0, 0);

        // ── 4. 展开动画起始点（根局部坐标系）────────────────
        //   LEFT  → 从左边缘 (0) 向右展开
        //   RIGHT → 从右边缘 (totalW) 向左展开
        //   CENTER→ 从中心  (totalW/2) 向两侧展开
        const startX = this.alignment === HandDisplayAlignment.CENTER ? totalW / 2
                     : this.alignment === HandDisplayAlignment.RIGHT   ? totalW
                     : 0;

        // ── 5. 牌面工厂（无交互） ─────────────────────────
        const factory = (v: number): Node => {
            const n  = this.cardPrefab ? instantiate(this.cardPrefab) : new Node('Card');
            const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);
            cn.setCard(v);
            cn.setFaceDown(false);
            cn.onClick = null;
            return n;
        };

        // ── 6. 创建牌组节点并动画 ────────────────────────────
        for (let i = 0; i < groupList.length; i++) {
            const g     = groupList[i];
            const gNode = this.cardGroupPrefab
                ? instantiate(this.cardGroupPrefab)
                : new Node(`Group_${g.id}`);
            this._root.addChild(gNode);

            const gv = gNode.getComponent(CardGroupView) ?? gNode.addComponent(CardGroupView);
            gv.init(g, factory);
            this._groupViews.push(gv);

            // 从锚点出发展开到目标
            gNode.setPosition(startX, 0, 0);
            const targetX = groupTargets[i];
            tween(gNode)
                .delay(i * EXPAND_STAGGER)
                .to(EXPAND_DUR, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' })
                .call(() => { if (gNode.isValid) gv.syncMarkerLayout(); })
                .start();
        }

        // ── 7. 创建散牌节点并动画 ────────────────────────────
        for (let i = 0; i < ungroupList.length; i++) {
            const n  = factory(ungroupList[i]);
            this._root.addChild(n);
            const cn = n.getComponent(CardNode)!;
            this._ungroupNodes.push(cn);

            n.setPosition(startX, 0, 0);
            const targetX = ungroupTargets[i];
            tween(n)
                .delay((groupList.length + i) * EXPAND_STAGGER)
                .to(EXPAND_DUR, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' })
                .start();
        }
    }

    /** 清空所有展示内容（立即停止动画并销毁节点） */
    clear(): void {
        this._doClean();
    }

    // ── 私有 ──────────────────────────────────────────────

    private _doClean(): void {
        if (this._root) Tween.stopAllByTarget(this._root);

        for (const gv of this._groupViews) {
            if (gv?.node?.isValid) {
                Tween.stopAllByTarget(gv.node);
                gv.node.destroy();
            }
        }
        for (const cn of this._ungroupNodes) {
            if (cn?.node?.isValid) {
                Tween.stopAllByTarget(cn.node);
                cn.node.destroy();
            }
        }
        this._groupViews   = [];
        this._ungroupNodes = [];
    }
}
