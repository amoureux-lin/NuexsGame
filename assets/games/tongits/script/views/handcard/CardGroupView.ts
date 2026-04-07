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
 *   ├── _bg            ← bgNode
 *   ├── _typeLabel     ← typeLabel
 *   ├── groupMarker    ← 组类型角标（脚本会摆到容器底部居中）
 *   ├── cardContainer  ← cardContainer（可选；牌节点父级，不填则牌直接挂在根下）
 *   └── _border        ← borderNode
 *
 * 由 HandCardPanel 通过 instantiate(cardGroupPrefab) 创建，
 * 创建后调用 init() 完成初始化。
 */

import { _decorator, Component, Node, Label, UITransform, Color, SpriteFrame, Sprite, Vec3 } from 'cc';
import { GroupData, GroupType } from '../../utils/GroupAlgorithm';
import { CardNode, CARD_SPACING, DEFAULT_CARD_H, DEFAULT_CARD_W, getCardContentSize } from './CardNode';

const { ccclass, property } = _decorator;

// ── 常量 ──────────────────────────────────────────────────

/** 组类型标签高度 */
const LABEL_H      = 22;
/** 重排动画时长 */
const RELAYOUT_DUR = 0.12;
/**
 * 牌直接挂在根节点时，排在 prefab 固定 UI（bg + typeLabel + border）之后。
 * 若使用 cardContainer，牌挂在容器内，不用此常量。
 */
const FIXED_CHILD_COUNT = 3;

/** groupMarkerSpriteFrames 下标与 GroupType 对应：[SPECIAL, VALID, INVALID]，第 4 张可选为 UNGROUP */
const MARKER_INDEX: Record<GroupType, number> = {
    [GroupType.SPECIAL]: 0,
    [GroupType.VALID]:   1,
    [GroupType.INVALID]: 2,
    [GroupType.UNGROUP]: 3,
};
/** 背景水平内边距（两侧各留出的像素，让背景比牌区稍宽） */
const BG_PAD_H = 8;

/** 组标记（groupMarker）底边与组容器底边的间距（根节点锚点为中心时有效） */
const GROUP_MARKER_BOTTOM_PAD = 4;

/** 组类型显示文字 */
const TYPE_TEXT: Record<GroupType, string> = {
    [GroupType.SPECIAL]: 'Special',
    [GroupType.VALID]:   'Valid',
    [GroupType.INVALID]: 'Invalid',
    [GroupType.UNGROUP]: '',
};

/** 组类型标签颜色 */
const TYPE_COLOR: Record<GroupType, Color> = {
    [GroupType.SPECIAL]: new Color(119, 56, 19,   255),
    [GroupType.VALID]:   new Color(26,  89, 85,  255),
    [GroupType.INVALID]: new Color(143, 21, 23, 255),
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

    /** 牌的父节点；不绑则牌挂在 CardGroupView 根节点下（兼容旧 Prefab） */
    @property(Node)
    cardContainer: Node | null = null;

    /** 组类型角标/图标；不绑则跳过 */
    @property(Sprite)
    groupMarker: Sprite | null = null;

    /**
     * 与 GroupType 对应：建议顺序 SPECIAL → VALID → INVALID；
     * 若需显示 UNGROUP 再追加第 4 帧，否则 UNGROUP 会隐藏角标。
     */
    @property(SpriteFrame)
    groupMarkerSpriteFrames: SpriteFrame[] = []; //0: SPECIAL, 1: VALID, 2: INVALID, 3: UNGROUP

    /**
     * 组标记条高度（px），全组统一。
     */
    groupMarkerHeight = 52;

    // ── 私有状态 ──────────────────────────────────────────

    private _groupData:  GroupData = null!;
    private _cardNodes:  CardNode[] = [];
    private _isSelected: boolean = false;

    /**
     * 若设置：groupMarker 挂到此节点（通常为 HandCardPanel 最顶层），
     * 拖拽牌在拖拽层时仍显示在标记下方。
     */
    private _markerOverlayParent: Node | null = null;

    /** 点击整组回调（由 HandCardPanel 赋值） */
    onGroupClick: ((groupId: string) => void) | null = null;

    /**
     * 将组标记挂到顶层 overlay（与 HandCardPanel._markerOverlayRoot），或 null 还原到组节点下。
     * 应在销毁组节点前对 overlay 调用 null，避免标记残留。
     */
    setMarkerOverlayParent(overlay: Node | null): void {
        this._markerOverlayParent = overlay;
        if (!this.groupMarker) return;
        if (overlay) {
            overlay.addChild(this.groupMarker.node);
        } else if (this.groupMarker.node.parent !== this.node) {
            this.node.addChild(this.groupMarker.node);
        }
        this._layoutGroupMarkerAtBottom();
    }

    /**
     * 在 HandCardPanel._doLayout 将组节点 tween 到目标 X 之后调用，刷新挂到 overlay 时的世界坐标。
     * （sync 阶段若先 reparent 标记再布局，组节点仍在 0 处，会导致标记与牌组错位。）
     */
    syncMarkerLayout(): void {
        this._layoutGroupMarkerAtBottom();
    }

    // ── 初始化（instantiate 后、addChild 后调用）─────────

    init(groupData: GroupData, cardPrefabFactory: (value: number) => Node): void {
        this._groupData = groupData;
        this.node.name  = `Group_${groupData.id}`;

        this._updateLabel();
        this._updateGroupMarker(this._groupData.type);
        this._resizeBg();

        if (this.borderNode) this.borderNode.active = false;

        const parent = this._cardParent();
        for (let i = 0; i < groupData.cards.length; i++) {
            const cn = this._makeCardNode(groupData.cards[i], i, cardPrefabFactory);
            this._cardNodes.push(cn);
            parent.addChild(cn.node);
        }

        this.node.getComponent(UITransform)?.setContentSize(
            this._groupWidth(), this._cardH() + LABEL_H,
        );
        this._resizeBg();
        this._layoutGroupMarkerAtBottom();
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
        this._updateGroupMarker(this._groupData.type);

        const parent = this._cardParent();

        // 调整 CardNode 数量
        while (this._cardNodes.length > groupData.cards.length) {
            const cn = this._cardNodes.pop()!;
            cn.node.destroy();
        }
        while (this._cardNodes.length < groupData.cards.length) {
            const i  = this._cardNodes.length;
            const cn = this._makeCardNode(groupData.cards[i], i, cardPrefabFactory);
            this._cardNodes.push(cn);
            parent.addChild(cn.node);
        }

        // 更新牌值 + sibling 顺序（在 cardContainer 内仅排牌序；否则排在根上固定 UI 之后）
        for (let i = 0; i < groupData.cards.length; i++) {
            this._cardNodes[i].setCard(groupData.cards[i]);
            if (this.cardContainer) {
                this._cardNodes[i].node.setSiblingIndex(i);
            } else {
                this._cardNodes[i].node.setSiblingIndex(i + FIXED_CHILD_COUNT);
            }
        }
        this._relayout(false);

        // 更新根节点尺寸 + 背景尺寸
        this.node.getComponent(UITransform)?.setContentSize(
            this._groupWidth(), this._cardH() + LABEL_H,
        );
        this._resizeBg();
        this._layoutGroupMarkerAtBottom();
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

    /** 牌的父节点：优先 cardContainer，否则根节点 */
    private _cardParent(): Node {
        return this.cardContainer ?? this.node;
    }

    private _cardW(): number {
        if (this._cardNodes.length > 0) {
            return getCardContentSize(this._cardNodes[0].node).w;
        }
        if (this.cardContainer) {
            const tf = this.cardContainer.getComponent(UITransform);
            if (tf && tf.contentSize.width > 0) return tf.contentSize.width;
        }
        return DEFAULT_CARD_W;
    }

    private _cardH(): number {
        if (this._cardNodes.length > 0) {
            return getCardContentSize(this._cardNodes[0].node).h;
        }
        if (this.cardContainer) {
            const tf = this.cardContainer.getComponent(UITransform);
            if (tf && tf.contentSize.height > 0) return tf.contentSize.height;
        }
        return DEFAULT_CARD_H;
    }

    private _groupWidth(): number {
        const n = Math.max(this._groupData.cards.length, 1);
        return this._cardW() + (n - 1) * CARD_SPACING;
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

    /** 按组类型切换角标图；frames 不足或 UNGROUP 无第 4 帧时隐藏 */
    private _updateGroupMarker(type: GroupType): void {
        if (!this.groupMarker) return;
        const frames = this.groupMarkerSpriteFrames;
        if (!frames.length) {
            this.groupMarker.node.active = false;
            return;
        }
        const idx = MARKER_INDEX[type];
        const sf  = idx < frames.length ? frames[idx] : null;
        if (!sf) {
            this.groupMarker.node.active = false;
            return;
        }
        this.groupMarker.node.active = true;
        this.groupMarker.spriteFrame = sf;
        this._layoutGroupMarkerAtBottom();
    }

    /**
     * 将 groupMarker 置于组容器底部居中（根节点锚点默认中心），宽度与牌组一致。
     * @param groupW 不传则用 `_groupWidth()`；拖拽预览时传入 HandCardPanel 给出的宽度。
     */
    private _layoutGroupMarkerAtBottom(groupW?: number): void {
        if (!this.groupMarker?.node?.active) return;

        const w = groupW ?? this._groupWidth();
        this._applyGroupMarkerSize(w);

        const rootTf = this.node.getComponent(UITransform);
        const H = rootTf && rootTf.contentSize.height > 0
            ? rootTf.contentSize.height
            : this._cardH() + LABEL_H;
        const halfRootH = H / 2;

        const markerTf = this.groupMarker.node.getComponent(UITransform);
        const markH = markerTf?.contentSize.height ?? 0;
        const halfMarkH = markH > 0 ? markH / 2 : 0;

        const y = -halfRootH + halfMarkH + GROUP_MARKER_BOTTOM_PAD;
        const local = new Vec3(0, y, 0);

        if (this._markerOverlayParent && this.groupMarker.node.parent === this._markerOverlayParent) {
            const tf = this.node.getComponent(UITransform);
            if (tf) {
                const world = tf.convertToWorldSpaceAR(local);
                this.groupMarker.node.setWorldPosition(world);
            } else {
                this.groupMarker.node.setPosition(local);
            }
        } else {
            this.groupMarker.node.setPosition(local);
        }
    }

    /** 组标记统一高度（SPECIAL/VALID/INVALID 等共用同一高度） */
    private _resolveGroupMarkerHeight(): number {
        return this.groupMarkerHeight;
    }

    /**
     * 宽度随牌组宽度 groupW；高度全组统一（不随组宽、类型变化）。
     */
    private _applyGroupMarkerSize(groupW: number): void {
        if (!this.groupMarker) return;
        let ut = this.groupMarker.node.getComponent(UITransform);
        if (!ut) ut = this.groupMarker.node.addComponent(UITransform);

        const h = this._resolveGroupMarkerHeight();
        ut.setContentSize(groupW + BG_PAD_H * 2, h);
        this.groupMarker.sizeMode = Sprite.SizeMode.CUSTOM;
    }

    /**
     * 拖拽预览期间临时覆盖类型标签。
     * 传 null 还原为实际 groupData.type（拖拽结束后由 refresh 自动调用 _updateLabel 还原）。
     */
    setPreviewType(type: GroupType | null): void {
        const resolved = type ?? this._groupData.type;
        if (this.typeLabel) {
            this.typeLabel.string = TYPE_TEXT[resolved];
            this.typeLabel.color  = TYPE_COLOR[resolved];
        }
        this._updateGroupMarker(resolved);
    }

    /**
     * 根据容器宽度同步背景尺寸（拖拽期间由 HandCardPanel 每帧调用）。
     * 高度不变，由编辑器 Prefab 中设置。
     * 同时让 groupMarker 宽度与牌组宽度 containerW 一致。
     */
    syncBgWidth(containerW: number): void {
        if (this.bgNode) {
            const tf = this.bgNode.getComponent(UITransform);
            if (tf) tf.setContentSize(containerW + BG_PAD_H * 2, tf.contentSize.height);
        }
        if (this.groupMarker?.node?.active) {
            this._layoutGroupMarkerAtBottom(containerW);
        }
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
