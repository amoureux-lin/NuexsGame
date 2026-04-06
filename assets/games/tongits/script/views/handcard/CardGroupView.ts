/**
 * CardGroupView — 单个牌组的视图（Component 版）
 *
 * 职责：
 *   - 作为 cardGroupView.prefab 的根组件
 *   - 持有一组 CardNode，横向叠牌排列
 *   - 顶部显示组类型标签（SPECIAL / VALID / INVALID）
 *   - 点击组内任意牌 → 通知父节点切换整组选中状态
 *   - 选中时显示高亮边框
 *
 * Prefab 节点结构（在编辑器中配置）：
 *   CardGroupView (Node + CardGroupView component + UITransform)
 *   ├── _bg        (Node + UITransform + Sprite 9-slice)   ← bgNode
 *   ├── _typeLabel (Node + UITransform + Label)             ← typeLabel
 *   └── _border    (Node + UITransform + Sprite/Graphics)   ← borderNode，默认隐藏
 *
 * 由 HandCardPanel 通过 instantiate(cardGroupPrefab) 创建，
 * 创建后调用 init() 完成初始化。
 */

import { _decorator, Component, Node, Label, UITransform, Color } from 'cc';
import { GroupData, GroupType } from '../../utils/GroupAlgorithm';
import { CardNode, CARD_W, CARD_H, CARD_SPACING } from './CardNode';

const { ccclass, property } = _decorator;

// ── 常量 ──────────────────────────────────────────────────

/** 组类型标签高度 */
const LABEL_H      = 22;
/** 重排动画时长 */
const RELAYOUT_DUR = 0.12;
/** Prefab 中固定子节点数（bg + typeLabel + border），card 从此下标开始 */
const FIXED_CHILD_COUNT = 3;
/** 背景水平内边距（两侧各留出的像素，让背景比牌区稍宽） */
const BG_PAD_H = 8;

/** 组类型显示文字 */
const TYPE_TEXT: Record<GroupType, string> = {
    [GroupType.SPECIAL]: 'Special',
    [GroupType.VALID]:   'Valid',
    [GroupType.INVALID]: 'Invalid',
    [GroupType.UNGROUP]: '',
};

/** 组类型标签颜色 */
const TYPE_COLOR: Record<GroupType, Color> = {
    [GroupType.SPECIAL]: new Color(255, 200, 0,   255),
    [GroupType.VALID]:   new Color(60,  200, 80,  255),
    [GroupType.INVALID]: new Color(180, 180, 180, 255),
    [GroupType.UNGROUP]: new Color(255, 255, 255, 255),
};

// ── CardGroupView ─────────────────────────────────────────

@ccclass('CardGroupView')
export class CardGroupView extends Component {

    // ── Inspector 属性（在 Prefab 中绑定子节点）────────────

    @property(Node)
    bgNode: Node = null!;

    @property(Label)
    typeLabel: Label = null!;

    @property(Node)
    borderNode: Node = null!;

    // ── 私有状态 ──────────────────────────────────────────

    private _groupData:  GroupData = null!;
    private _cardNodes:  CardNode[] = [];
    private _isSelected: boolean = false;

    /** 点击整组回调（由 HandCardPanel 赋值） */
    onGroupClick: ((groupId: string) => void) | null = null;

    // ── 初始化（instantiate 后、addChild 后调用）─────────

    init(groupData: GroupData, cardPrefabFactory: (value: number) => Node): void {
        this._groupData = groupData;
        this.node.name  = `Group_${groupData.id}`;

        this.node.getComponent(UITransform)?.setContentSize(
            this._groupWidth(), CARD_H + LABEL_H,
        );

        this._updateLabel();
        this._resizeBg();

        if (this.borderNode) this.borderNode.active = false;

        for (let i = 0; i < groupData.cards.length; i++) {
            const cn = this._makeCardNode(groupData.cards[i], i, cardPrefabFactory);
            this._cardNodes.push(cn);
            this.node.addChild(cn.node);
        }
    }

    // ── 公开 API ──────────────────────────────────────────

    get groupId():   string               { return this._groupData.id; }
    get groupData(): GroupData            { return this._groupData; }
    get width():     number               { return this._groupWidth(); }
    get cardNodes(): readonly CardNode[]  { return this._cardNodes; }
    get isSelected(): boolean             { return this._isSelected; }

    /** 更新组数据（牌变化时调用，保留已有节点复用） */
    refresh(groupData: GroupData, cardPrefabFactory: (value: number) => Node): void {
        this._groupData = groupData;
        this._updateLabel();

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

        // 更新牌值 + 确保 sibling 顺序（bg/typeLabel/border 占前 FIXED_CHILD_COUNT 个）
        for (let i = 0; i < groupData.cards.length; i++) {
            this._cardNodes[i].setCard(groupData.cards[i]);
            this._cardNodes[i].node.setSiblingIndex(i + FIXED_CHILD_COUNT);
        }
        this._relayout(false);

        // 更新根节点尺寸 + 背景尺寸
        this.node.getComponent(UITransform)?.setContentSize(
            this._groupWidth(), CARD_H + LABEL_H,
        );
        this._resizeBg();
    }

    /** 设置整组选中状态 */
    setSelected(selected: boolean): void {
        if (this._isSelected === selected) return;
        this._isSelected = selected;
        if (this.borderNode) this.borderNode.active = selected;
        for (const cn of this._cardNodes) cn.setSelected(selected);
    }

    /** 设置某张牌的 Meld 提示状态 */
    setCardHinted(cardValue: number, hinted: boolean): void {
        const cn = this._cardNodes.find(c => c.cardValue === cardValue);
        cn?.setHinted(hinted);
    }

    /** 重排牌位置（带动画） */
    relayout(): void { this._relayout(true); }

    /**
     * 拖拽开始时从组内移除一张牌（不销毁节点，由调用方管理）。
     */
    removeCard(cardValue: number): void {
        const idx = this._cardNodes.findIndex(cn => cn.cardValue === cardValue);
        if (idx < 0) return;
        this._cardNodes.splice(idx, 1);
    }

    // ── 私有 ──────────────────────────────────────────────

    private _groupWidth(): number {
        const n = Math.max(this._groupData.cards.length, 1);
        return CARD_W + (n - 1) * CARD_SPACING;
    }

    private _cardLocalX(index: number, total: number): number {
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

    private _updateLabel(): void {
        if (!this.typeLabel) return;
        this.typeLabel.string = TYPE_TEXT[this._groupData.type];
        this.typeLabel.color  = TYPE_COLOR[this._groupData.type];
    }

    /**
     * 根据容器宽度同步背景尺寸（拖拽期间由 HandCardPanel 每帧调用）。
     * 高度不变，由编辑器 Prefab 中设置。
     */
    syncBgWidth(containerW: number): void {
        if (!this.bgNode) return;
        const tf = this.bgNode.getComponent(UITransform);
        if (!tf) return;
        tf.setContentSize(containerW + BG_PAD_H * 2, tf.contentSize.height);
    }

    private _resizeBg(): void {
        this.syncBgWidth(this._groupWidth());
    }

    private _makeCardNode(
        cardValue: number,
        index: number,
        factory: (value: number) => Node,
    ): CardNode {
        const n  = factory(cardValue);
        const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);
        cn.setCard(cardValue);
        cn.setFaceDown(false);

        const total = this._groupData.cards.length;
        n.setPosition(this._cardLocalX(index, total), 0, 0);

        cn.onClick = () => { this.onGroupClick?.(this._groupData.id); };
        return cn;
    }
}
