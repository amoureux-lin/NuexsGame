/**
 * DiscardHistoryPanel — 弃牌历史记录面板
 *
 * 只展示本局已被打出的牌，按花色分为四行。
 * contentRoot 的子节点顺序固定为：
 *   [0] ♠ 黑桃行
 *   [1] ♥ 红心行
 *   [2] ♣ 梅花行
 *   [3] ♦ 方块行
 *
 * 每次调用 show() 时按弃牌列表动态重建，行内按点数 A→K 排序，
 * 排列间距由各行节点上的 Layout 组件负责。
 *
 * 节点结构（编辑器中搭建）：
 *   DiscardHistoryPanel（DiscardHistoryPanel 组件，默认 active=false）
 *   ├── bg          半透明遮罩背景（可点击关闭）
 *   ├── closeBtn    关闭按钮
 *   └── contentRoot
 *       ├── [0] ♠行（含 Layout）
 *       ├── [1] ♥行
 *       ├── [2] ♣行
 *       └── [3] ♦行
 */

import { _decorator, Component, Node, Prefab, instantiate } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../../../config/TongitsEvents';
import type { DiscardCardBroadcast, TakeCardBroadcast } from '../../../proto/tongits';
import { CardNode } from '../handcard/CardNode';
import { getSuit, Suit } from '../../../utils/CardDef';

const { ccclass, property } = _decorator;

/** contentRoot 子节点顺序对应的花色 */
const ROW_SUITS = [Suit.SPADE, Suit.HEART, Suit.CLUB, Suit.DIAMOND];

@ccclass('DiscardHistoryPanel')
export class DiscardHistoryPanel extends Component {

    @property({ type: Node, tooltip: '点击可关闭面板的背景遮罩节点' })
    bg: Node = null!;

    @property({ type: Node, tooltip: '关闭按钮节点' })
    closeBtn: Node = null!;

    @property({ type: Node, tooltip: '四行牌容器，子节点顺序：♠ ♥ ♣ ♦' })
    contentRoot: Node = null!;

    @property({ type: Prefab, tooltip: '牌面预制体（与 TableAreaView 相同的 cardPrefab）' })
    cardPrefab: Prefab | null = null;

    @property({ tooltip: '每张牌的缩放比例' })
    cardScale: number = 0.55;

    // ── 私有状态 ──────────────────────────────────────────────

    /** 内部维护的弃牌堆（与 TableAreaView 同步） */
    private _discardPile: number[] = [];

    // ── 生命周期 ──────────────────────────────────────────────

    protected onLoad(): void {
        this.bg?.on(Node.EventType.TOUCH_END,       this._onClose, this);
        this.closeBtn?.on(Node.EventType.TOUCH_END, this._onClose, this);

        Nexus.on<DiscardCardBroadcast>(TongitsEvents.DISCARD,     this._onDiscard,    this);
        Nexus.on<TakeCardBroadcast>   (TongitsEvents.TAKE,        this._onTake,       this);
        Nexus.on                      (TongitsEvents.GAME_START,  this._onGameReset,  this);
        Nexus.on                      (TongitsEvents.ROOM_RESET,  this._onGameReset,  this);
        Nexus.on                      (TongitsEvents.GAME_RESULT, this._onGameReset,  this);
        // 不在此处 active=false：onLoad 仅首次 active=true 时触发，会吃掉第一次 show()。
        // 初始可见性由 TongitsView.init() 负责。
    }

    protected onDestroy(): void {
        this.bg?.off(Node.EventType.TOUCH_END,       this._onClose, this);
        this.closeBtn?.off(Node.EventType.TOUCH_END, this._onClose, this);

        Nexus.off(TongitsEvents.DISCARD,     this._onDiscard,   this);
        Nexus.off(TongitsEvents.TAKE,        this._onTake,      this);
        Nexus.off(TongitsEvents.GAME_START,  this._onGameReset, this);
        Nexus.off(TongitsEvents.ROOM_RESET,  this._onGameReset, this);
        Nexus.off(TongitsEvents.GAME_RESULT, this._onGameReset, this);
    }

    // ── 公开接口 ──────────────────────────────────────────────

    /**
     * 显示历史面板（由 TongitsView 在 historyBtn 点击时调用）。
     * @param discardPile 当前完整弃牌堆，用于初始化内部状态
     */
    show(discardPile: number[]): void {
        this._discardPile = [...discardPile];
        this._buildGrid(this._discardPile);
        this.node.active = true;
    }

    /** 隐藏面板 */
    hide(): void {
        this.node.active = false;
    }

    // ── 私有：动态构建 ────────────────────────────────────────

    /**
     * 清空四行后，按花色将弃牌分组、点数升序排列，逐行实例化牌节点。
     */
    private _buildGrid(discardedCards: number[]): void {
        if (!this.contentRoot) return;

        // 按花色分组，点数升序
        const groups = new Map<Suit, number[]>();
        for (const suit of ROW_SUITS) groups.set(suit, []);
        for (const card of discardedCards) {
            groups.get(getSuit(card))?.push(card);
        }
        for (const cards of groups.values()) {
            cards.sort((a, b) => (a % 100) - (b % 100));
        }

        // 填入各行
        const rows = this.contentRoot.children;
        for (let i = 0; i < ROW_SUITS.length; i++) {
            const rowNode = rows[i];
            if (!rowNode) continue;
            rowNode.removeAllChildren();

            const cards = groups.get(ROW_SUITS[i]) ?? [];
            for (const value of cards) {
                const n = this.cardPrefab
                    ? instantiate(this.cardPrefab)
                    : new Node(`h_${value}`);
                n.setScale(this.cardScale, this.cardScale, 1);
                rowNode.addChild(n);

                let cn = n.getComponent(CardNode);
                if (!cn) cn = n.addComponent(CardNode);
                cn.setCard(value);
                cn.setFaceDown(false);
                cn.onClick = null;
            }
        }
    }

    // ── 私有事件：网络消息 ────────────────────────────────────

    /** 弃牌广播：服务端返回完整弃牌堆，直接替换 */
    private _onDiscard(data: DiscardCardBroadcast): void {
        this._discardPile = [...(data.discardPile ?? [])];
        if (this.node.active) this._buildGrid(this._discardPile);
    }

    /** 吃牌广播：将被吃的那张牌从堆顶移除 */
    private _onTake(data: TakeCardBroadcast): void {
        if (data.discard) {
            const idx = this._discardPile.lastIndexOf(data.discard);
            if (idx >= 0) this._discardPile.splice(idx, 1);
        }
        if (this.node.active) this._buildGrid(this._discardPile);
    }

    /** 新局开始 / 房间重置 / 结算：清空弃牌堆并关闭面板 */
    private _onGameReset(): void {
        this._discardPile = [];
        this.hide();
    }

    // ── 私有事件：UI ──────────────────────────────────────────

    private _onClose(): void {
        this.hide();
    }
}
