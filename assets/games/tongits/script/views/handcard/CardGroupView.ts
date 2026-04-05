/**
 * CardGroupView — 单个牌组的视图
 *
 * 职责：
 *   - 持有一组 CardNode，横向叠牌排列
 *   - 顶部显示组类型标签（SPECIAL / VALID / INVALID）
 *   - 点击组内任意牌 → 通知父节点切换整组选中状态
 *   - 选中时显示高亮边框
 *
 * 由 HandCardPanel 动态创建，不挂预制体。
 */

import { Node, Label, Graphics, UITransform, Color } from 'cc';
import { GroupData, GroupType } from '../../utils/GroupAlgorithm';
import { CardNode, CARD_W, CARD_H, CARD_SPACING } from './CardNode';

// ── 常量 ──────────────────────────────────────────────────

/** 组类型标签高度 */
const LABEL_H        = 22;
/** 重排动画时长 */
const RELAYOUT_DUR   = 0.12;

/** 组类型显示文字 */
const TYPE_TEXT: Record<GroupType, string> = {
    [GroupType.SPECIAL]: 'Special',
    [GroupType.VALID]:   'Valid',
    [GroupType.INVALID]: 'Invalid',
    [GroupType.UNGROUP]: '',
};

/** 组类型标签颜色 */
const TYPE_COLOR: Record<GroupType, Color> = {
    [GroupType.SPECIAL]: new Color(255, 200, 0,   255),   // 金色
    [GroupType.VALID]:   new Color(60,  200, 80,  255),   // 绿色
    [GroupType.INVALID]: new Color(180, 180, 180, 255),   // 灰色
    [GroupType.UNGROUP]: new Color(255, 255, 255, 255),
};

/** 组类型边框颜色（选中时） */
const BORDER_COLOR: Record<GroupType, Color> = {
    [GroupType.SPECIAL]: new Color(255, 200, 0,   255),
    [GroupType.VALID]:   new Color(60,  200, 80,  255),
    [GroupType.INVALID]: new Color(180, 180, 180, 255),
    [GroupType.UNGROUP]: new Color(255, 255, 255, 128),
};

// ── CardGroupView ─────────────────────────────────────────

export class CardGroupView {

    readonly node: Node;

    private _groupData:   GroupData;
    private _cardNodes:   CardNode[] = [];
    private _labelNode:   Node;
    private _borderNode:  Node;
    private _isSelected:  boolean = false;

    /** 点击整组回调（由 HandCardPanel 赋值） */
    onGroupClick: ((groupId: string) => void) | null = null;

    // ── 构造 ──────────────────────────────────────────────

    constructor(groupData: GroupData, cardPrefabFactory: (value: number) => Node) {
        this._groupData = groupData;

        // 根节点
        this.node = new Node(`Group_${groupData.id}`);
        const tf = this.node.addComponent(UITransform);
        tf.setContentSize(this._groupWidth(), CARD_H + LABEL_H);

        // 标签节点
        this._labelNode = this._createLabel(groupData.type);
        this.node.addChild(this._labelNode);

        // 选中边框
        this._borderNode = this._createBorder(groupData.type);
        this.node.addChild(this._borderNode);

        // 牌节点
        for (let i = 0; i < groupData.cards.length; i++) {
            const cardNode = this._makeCardNode(groupData.cards[i], i, cardPrefabFactory);
            this._cardNodes.push(cardNode);
            this.node.addChild(cardNode.node);
        }
    }

    // ── 公开 API ──────────────────────────────────────────

    get groupId(): string               { return this._groupData.id; }
    get groupData(): GroupData          { return this._groupData; }
    get width(): number                 { return this._groupWidth(); }
    get cardNodes(): readonly CardNode[] { return this._cardNodes; }

    /** 更新组数据（牌变化时调用，保留已有节点复用） */
    update(groupData: GroupData, cardPrefabFactory: (value: number) => Node): void {
        this._groupData = groupData;

        // 更新标签
        const lbl = this._labelNode.getComponent(Label);
        if (lbl) {
            lbl.string = TYPE_TEXT[groupData.type];
            lbl.color  = TYPE_COLOR[groupData.type];
        }

        // 调整 CardNode 数量
        while (this._cardNodes.length > groupData.cards.length) {
            const cn = this._cardNodes.pop()!;
            cn.node.destroy();
        }
        while (this._cardNodes.length < groupData.cards.length) {
            const i  = this._cardNodes.length;
            const cn = this._makeCardNode(groupData.cards[i], i, cardPrefabFactory);
            this._cardNodes.push(cn);
            this.node.addChild(cn.node);
        }

        // 更新牌值 + 位置
        for (let i = 0; i < groupData.cards.length; i++) {
            this._cardNodes[i].setCard(groupData.cards[i]);
            this._cardNodes[i].node.setSiblingIndex(i + 2); // label + border 在前
        }
        this._relayout(false);

        // 更新根节点尺寸
        const tf = this.node.getComponent(UITransform);
        tf?.setContentSize(this._groupWidth(), CARD_H + LABEL_H);
    }

    /** 设置整组选中状态 */
    setSelected(selected: boolean): void {
        if (this._isSelected === selected) return;
        this._isSelected = selected;
        this._borderNode.active = selected;
        for (const cn of this._cardNodes) {
            cn.setSelected(selected);
        }
    }

    get isSelected(): boolean { return this._isSelected; }

    /** 设置某张牌的 Meld 提示状态 */
    setCardHinted(cardValue: number, hinted: boolean): void {
        const cn = this._cardNodes.find(c => c.cardValue === cardValue);
        cn?.setHinted(hinted);
    }

    /** 重排牌位置（带动画） */
    relayout(): void { this._relayout(true); }

    /**
     * 拖拽开始时从组内移除一张牌（不销毁节点，由调用方管理）。
     * 移除后立即重排剩余牌的显示位置（不含动画，由预览逻辑接管）。
     */
    removeCard(cardValue: number): void {
        const idx = this._cardNodes.findIndex(cn => cn.cardValue === cardValue);
        if (idx < 0) return;
        this._cardNodes.splice(idx, 1);
        // 不调 _relayout，让 HandCardPanel._applyPreviewLayout 统一处理位置
    }

    destroy(): void { this.node.destroy(); }

    // ── 私有 ──────────────────────────────────────────────

    private _groupWidth(): number {
        const n = Math.max(this._groupData.cards.length, 1);
        return CARD_W + (n - 1) * CARD_SPACING;
    }

    private _cardLocalX(index: number, total: number): number {
        // 从左对齐排列（组容器以左边缘为锚点处理不方便，改为中心对齐）
        return (index - (total - 1) / 2) * CARD_SPACING;
    }

    private _relayout(animated: boolean): void {
        const total = this._cardNodes.length;
        for (let i = 0; i < total; i++) {
            const targetX = this._cardLocalX(i, total);
            const cn = this._cardNodes[i];
            if (animated) {
                cn.tweenToX(targetX, RELAYOUT_DUR);
            } else {
                const pos = cn.node.position;
                cn.node.setPosition(targetX, pos.y, pos.z);
            }
        }
    }

    private _makeCardNode(
        cardValue: number,
        index: number,
        factory: (value: number) => Node,
    ): CardNode {
        const n  = factory(cardValue);
        const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);
        cn.setCard(cardValue);
        cn.setFaceDown(false);   // 组内牌始终正面朝上

        const total = this._groupData.cards.length;
        const x = this._cardLocalX(index, total);
        n.setPosition(x, 0, 0);

        // 点击整个组 → 通知父层
        cn.onClick = () => { this.onGroupClick?.(this._groupData.id); };
        return cn;
    }

    private _createLabel(type: GroupType): Node {
        const labelNode = new Node('_typeLabel');
        const tf = labelNode.addComponent(UITransform);
        tf.setContentSize(120, LABEL_H);
        labelNode.setPosition(0, CARD_H / 2 + LABEL_H / 2, 0);

        const lbl    = labelNode.addComponent(Label);
        lbl.string   = TYPE_TEXT[type];
        lbl.color    = TYPE_COLOR[type];
        lbl.fontSize = 16;
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.verticalAlign   = Label.VerticalAlign.CENTER;
        return labelNode;
    }

    private _createBorder(type: GroupType): Node {
        const borderNode = new Node('_border');
        const btf = borderNode.addComponent(UITransform);
        btf.setContentSize(this._groupWidth() + 8, CARD_H + 8);
        borderNode.setPosition(0, 0, 0);

        const g = borderNode.addComponent(Graphics);
        g.lineWidth   = 2;
        g.strokeColor = BORDER_COLOR[type];
        const w = this._groupWidth() + 8;
        const h = CARD_H + 8;
        g.roundRect(-w / 2, -h / 2, w, h, 8);
        g.stroke();

        borderNode.active = false; // 默认隐藏，选中时显示
        return borderNode;
    }
}
