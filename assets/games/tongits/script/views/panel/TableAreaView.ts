/**
 * TableAreaView — 牌桌中央区（牌堆 + 弃牌区）
 *
 * 统一管理：
 *   左：牌堆视觉叠牌 + 剩余数量 Label + 点击抽牌交互 + 呼吸引导动画
 *   右：弃牌区顶牌展示 + 查看历史记录按钮
 *
 * Inspector 节点绑定：
 *   tableArea (TableAreaView)
 *   ├── deck
 *   │   ├── deckNode        ← 叠牌视觉容器（TableAreaView.deckNode）
 *   │   └── deckCountLabel  ← 剩余张数 Label
 *   ├── discardArea
 *   │   ├── discardNode     ← 弃牌顶牌容器
 *   │   └── historyBtn      ← 历史记录按钮
 *   └── （其余装饰节点）
 */

import {
    _decorator, Component, Node, Prefab, Label,
    instantiate, Vec3, tween, Tween,sp
} from 'cc';
import { CardNode } from '../handcard/CardNode';

const { ccclass, property } = _decorator;

// ── 牌堆常量 ──────────────────────────────────────────────
const DECK_PILE_MAX_VISIBLE = 14;
const DECK_STACK_DY         = 0.8;

// ── 弃牌堆常量 ────────────────────────────────────────────
const DISCARD_MAX_VISIBLE   = 4;
const DISCARD_OFFSET        = new Vec3(3, -3, 0);
const DISCARD_FLY_DUR       = 0.18;

@ccclass('TableAreaView')
export class TableAreaView extends Component {

    // ── 牌堆区（左） ─────────────────────────────────────

    @property({ type: Node,  tooltip: '牌堆叠牌容器节点' })
    deckNode: Node = null!;

    @property({ type: Label, tooltip: '牌堆剩余张数 Label' })
    deckCountLabel: Label | null = null;

    @property({type:Node,tooltip:"摸牌堆 光效"})
    deckLight: Node = null!;

    @property({type:sp.Skeleton,tooltip:"摸牌堆 提示"})
    deckTip: sp.Skeleton = null!;

    @property({ type: Node,  tooltip: '牌堆叠牌容器节点（发牌动画起点）' })
    sendCardNode: Node = null!;

    @property({type:sp.Skeleton,tooltip:"丢牌堆 提示"})
    discardTip: sp.Skeleton = null!;



    // ── 弃牌区（右） ─────────────────────────────────────

    @property({ type: Node,  tooltip: '弃牌顶牌容器节点' })
    discardNode: Node = null!;

    @property({ type: Node,  tooltip: '查看弃牌历史记录按钮节点' })
    historyBtn: Node = null!;

    @property({ type: Prefab, tooltip: '牌面预制体（与 HandCardPanel 同一个 cardPrefab）' })
    cardPrefab: Prefab | null = null;

    // ── 对外回调 ──────────────────────────────────────────

    /** 点击牌堆且当前允许抽牌时触发（由 TongitsView 赋值） */
    onDeckDrawClick: (() => void) | null = null;
    /** 点击历史按钮时触发（由 TongitsView 赋值） */
    onHistoryClick:  (() => void) | null = null;

    // ── 私有：剩余牌堆（deckNode） ────────────────────────

    private _deckPileNodes:  Node[]         = [];
    private _deckRemaining   = 0;
    private _deckDrawEnabled = false;
    private _deckLightTween: Tween<Node> | null = null;

    // ── 私有：发牌堆（sendCardNode） ─────────────────────

    private _sendPileNodes: Node[] = [];

    // ── 私有：弃牌堆 ─────────────────────────────────────

    private _discardPile: number[] = [];

    // ── 生命周期 ──────────────────────────────────────────

    onLoad(): void {
        this.deckNode?.removeAllChildren();
        this.sendCardNode?.removeAllChildren();
        this._updateDeckCountLabel();
        this.deckNode?.on(Node.EventType.TOUCH_END, this._onDeckTouchEnd, this);
        this.historyBtn?.on(Node.EventType.TOUCH_END, this._onHistoryTap,  this);
        if (this.historyBtn)  this.historyBtn.active  = false;
        if (this.deckLight)   this.deckLight.active   = false;
        if (this.deckTip)     this.deckTip.node.active = false;
        if (this.discardTip) this.discardTip.node.active  = false;
    }

    onDestroy(): void {
        this.deckNode?.off(Node.EventType.TOUCH_END, this._onDeckTouchEnd, this);
        this.historyBtn?.off(Node.EventType.TOUCH_END, this._onHistoryTap,  this);
        this.setDeckDrawEnabled(false);
    }

    // ── 公开 API：牌堆 ────────────────────────────────────

    /**
     * 游戏开始时初始化牌堆（发完手牌后、剩余牌建堆时调用）。
     * @param totalCount 牌堆剩余总张数
     */
    setupDeck(totalCount: number): void {
        this._deckRemaining = totalCount;
        this._buildDeckPile();
    }

    /**
     * 发牌开始时建发牌堆（sendCardNode），节点供 HandCardPanel 直接取用。
     * @param count 本次发出的手牌数量
     */
    setupSendDeck(count: number): void {
        this._clearSendPile();
        if (!this.sendCardNode || count <= 0) return;
        // 视觉层叠上限，超出部分叠在顶部同一位置
        const visible = Math.min(count, DECK_PILE_MAX_VISIBLE);
        const startY  = -(visible - 1) * DECK_STACK_DY / 2;
        for (let i = 0; i < count; i++) {
            const n = this.makeDeckCard();
            const pileIdx = Math.min(i, visible - 1);
            n.setPosition(0, startY + pileIdx * DECK_STACK_DY, 0);
            n.setScale(0.68, 0.68);
            this.sendCardNode.addChild(n);
            this._sendPileNodes.push(n);
        }
    }

    /** 发牌堆节点（从底到顶），顶部 = 最后一个，供 HandCardPanel 倒序取用 */
    get sendPileNodes(): readonly Node[] { return this._sendPileNodes; }

    /** 返回 sendCardNode 世界坐标（供发牌动画起点使用） */
    getSendCardWorldPos(): Vec3 {
        return this.sendCardNode
            ? this.sendCardNode.getWorldPosition().clone()
            : this.getDeckWorldPos();
    }

    /**
     * 从牌堆顶部弹出一张视觉节点（每张发牌 / 摸牌时调用）。
     * 返回弹出的节点供调用方做飞出动画；视觉节点耗尽时返回 null。
     */
    popDeckCard(): Node | null {
        this._deckRemaining = Math.max(0, this._deckRemaining - 1);
        this._updateDeckCountLabel();
        if (this._deckPileNodes.length > 0) {
            return this._deckPileNodes.pop()!;
        }
        return null;
    }

    /** 返回牌堆节点的世界坐标（供 HandCardPanel 发牌/摸牌动画用） */
    getDeckWorldPos(): Vec3 {
        return this.deckNode
            ? this.deckNode.getWorldPosition().clone()
            : this.node.getWorldPosition().clone();
    }

    /** 剩余牌数 */
    get deckRemaining(): number { return this._deckRemaining; }

    /** 当前牌堆视觉节点（从底到顶），供发牌动画直接取用 */
    get deckPileNodes(): readonly Node[] { return this._deckPileNodes; }

    /**
     * 是否允许点击牌堆抽牌（引导动画 + 交互一起控制）。
     * 由 TongitsView 按回合阶段调用，不在组件内部判断。
     */
    setDeckDrawEnabled(enabled: boolean): void {
        if (this._deckDrawEnabled === enabled) return;
        this._deckDrawEnabled = enabled;
        if (enabled) {
            this._startDeckGuide();
        } else {
            this._stopDeckGuide();
        }
    }

    // ── 公开 API：弃牌堆 ──────────────────────────────────

    /**
     * 同步弃牌堆展示（收到 DiscardCardBroadcast 时调用）。
     * @param cards        从底到顶的完整弃牌堆
     * @param flyFromWorld 最新弃牌飞入起点（世界坐标，可选）
     */
    syncDiscard(cards: number[], flyFromWorld?: Vec3): void {
        this._discardPile = cards;
        this._rebuildDiscard(flyFromWorld);
        if (this.historyBtn) this.historyBtn.active = cards.length > 0;
    }

    // ── 公开 API：重置 ────────────────────────────────────

    /** 游戏重置：清空所有显示 */
    clear(): void {
        this._clearDeckPile();
        this._deckRemaining   = 0;
        this._deckDrawEnabled = false;
        this._stopDeckGuide();
        this.deckNode?.removeAllChildren();
        this._updateDeckCountLabel();

        this._clearSendPile();
        this.sendCardNode?.removeAllChildren();

        this._discardPile = [];
        this.discardNode?.removeAllChildren();
        if (this.historyBtn) this.historyBtn.active = false;
    }

    // ── 私有：牌堆视觉 ────────────────────────────────────

    private _buildDeckPile(): void {
        this._clearDeckPile();
        this.createDeckCard();
        this._updateDeckCountLabel();
    }

    public  createDeckCard() {
        if (!this.deckNode || this._deckRemaining <= 0) return;
        const visible = Math.min(this._deckRemaining, DECK_PILE_MAX_VISIBLE);
        const startY  = -(visible - 1) * DECK_STACK_DY / 2;
        for (let i = 0; i < visible; i++) {
            const n = this.makeDeckCard();
            n.setPosition(0, startY + i * DECK_STACK_DY, 0);
            // n.setScale(0.68,0.68)
            this.deckNode.addChild(n);
            this._deckPileNodes.push(n);
        }
    }

    private _clearDeckPile(): void {
        for (const n of this._deckPileNodes) { if (n.isValid) n.destroy(); }
        this._deckPileNodes = [];
    }

    private _clearSendPile(): void {
        for (const n of this._sendPileNodes) { if (n.isValid) n.destroy(); }
        this._sendPileNodes = [];
    }

    private _updateDeckCountLabel(): void {
        if (this.deckCountLabel) {
            this.deckCountLabel.string = this._deckRemaining > 0 ? `${this._deckRemaining}` : '';
        }
    }

    makeDeckCard(): Node {
        const n = this.cardPrefab ? instantiate(this.cardPrefab) : new Node('DeckCard');
        n.name = 'DeckCard';
        let cn = n.getComponent(CardNode);
        if (!cn) cn = n.addComponent(CardNode);
        cn.setFaceDown(true);
        return n;
    }

    private _onDeckTouchEnd(): void {
        if (!this._deckDrawEnabled) return;
        this.onDeckDrawClick?.();
    }

    private _startDeckGuide(): void {
        this.startDeckLight();
        this.startDeckTip();
    }

    private _stopDeckGuide(): void {
        this.stopDeckLight();
        this.stopDeckTip();
    }

    /**
     * 开始 摸牌堆光效
     */
    public startDeckLight(): void {
        if (!this.deckLight?.isValid) return;
        this.stopDeckLight();
        this.deckLight.active = true;
        this.deckLight.setScale(1, 1, 1);
        this._deckLightTween = tween(this.deckLight)
            .repeatForever(
                tween()
                    .to(0.5, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'sineOut' })
                    .to(0.5, { scale: new Vec3(1.00, 1.00, 1) }, { easing: 'sineIn'  })
            )
            .start();
    }

    /**
     * 停止 摸牌堆光效
     */
    public stopDeckLight(): void {
        if (this._deckLightTween) {
            this._deckLightTween.stop();
            this._deckLightTween = null;
        }
        if (this.deckLight?.isValid) {
            this.deckLight.setScale(1, 1, 1);
            this.deckLight.active = false;
        }
    }

    /**
     * 开始 摸牌堆提示
     */
    public startDeckTip(): void {
        if (this.deckTip) this.deckTip.node.active = true;
    }

    /**
     * 停止 摸牌堆提示
     */
    public stopDeckTip(): void {
        if (this.deckTip) this.deckTip.node.active = false;
    }

    /**
     * 开始 弃牌堆提示
     */
    public startDiscardTip(){
        if (this.discardTip) this.discardTip.node.active = true;
    }

    /**
     * 停止 弃牌堆提示
     */
    public stopDiscardTip(){
        if (this.discardTip) this.discardTip.node.active = false;
    }

    // ── 私有：弃牌堆视觉 ──────────────────────────────────

    private _rebuildDiscard(flyFromWorld?: Vec3): void {
        this.discardNode.removeAllChildren();
        const visible = this._discardPile.slice(-DISCARD_MAX_VISIBLE);
        for (let i = 0; i < visible.length; i++) {
            const isTop = i === visible.length - 1;
            const depth = visible.length - 1 - i;
            const n  = this._makeDiscardCard(visible[i], !isTop);
            const tx = depth * DISCARD_OFFSET.x;
            const ty = depth * DISCARD_OFFSET.y;
            this.discardNode.addChild(n);
            n.setSiblingIndex(i);
            if (isTop && flyFromWorld) {
                n.setWorldPosition(flyFromWorld);
                tween(n)
                    .to(DISCARD_FLY_DUR, { position: new Vec3(tx, ty, 0) }, { easing: 'quadOut' })
                    .start();
            } else {
                n.setPosition(tx, ty, 0);
            }
        }
    }

    private _makeDiscardCard(value: number, faceDown: boolean): Node {
        const n = this.cardPrefab ? instantiate(this.cardPrefab) : new Node(`DC_${value}`);
        n.name = `DC_${value}`;
        if (!n.getComponent(CardNode)) n.addComponent(CardNode);
        const cn = n.getComponent(CardNode)!;
        cn.setCard(value);
        cn.setFaceDown(faceDown);
        return n;
    }

    private _onHistoryTap(): void {
        this.onHistoryClick?.();
    }
}
