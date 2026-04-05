/**
 * HandCardPanel — 本地玩家手牌区顶层容器（完整版）
 *
 * 职责：
 *   - 持有 HandCardState，订阅状态变化后驱动视图更新
 *   - 管理所有 CardGroupView（分组）和散牌 CardNode（UNGROUP 区）
 *   - 实现发牌动画、重排动画
 *   - 对外暴露 onButtonStates 回调供 ActionPanel 订阅
 *
 * Inspector 配置：
 *   deckNode    — 牌堆节点（发牌动画起点）
 *   cardPrefab  — 牌面预制体（可选，不填用程序化默认样式）
 *
 * 节点结构（运行时动态）：
 *   HandCardPanel
 *   ├── _groupRoot      ← 所有 CardGroupView 挂在此节点
 *   └── _ungroupRoot    ← 所有 UNGROUP 区 CardNode 挂在此节点
 */

import {
    _decorator, Component, Node, Prefab, instantiate,
    UITransform, Vec3, tween,
} from 'cc';
import { HandCardState, ButtonStates, HandCardSnapshot } from '../../utils/HandCardState';
import { autoGroup, GroupData }                           from '../../utils/GroupAlgorithm';
import { SortMode }                                      from '../../utils/CardDef';
import { CardGroupView }                                 from './CardGroupView';
import { CardNode, CARD_W, CARD_H, CARD_SPACING }         from './CardNode';

const { ccclass, property } = _decorator;

// ── 布局常量 ──────────────────────────────────────────────

/** 组与组之间的间距 */
const GROUP_GAP          = 48;
/** 布局重排动画时长（正常交互） */
const LAYOUT_DUR         = 0.14;
/** 发牌后"按组重排"动画时长（更长，有仪式感） */
const DEAL_REORDER_DUR   = 0.30;
/** 发牌每张飞行时长 */
const FLY_DUR            = 0.22;
/** 发牌每张间隔（ms） */
const DEAL_INTERVAL      = 55;
/** 弹跳单步时长 */
const BOUNCE_STEP        = 0.16;
/** 全部落牌后暂停时长（让玩家看清手牌） */
const DEAL_PAUSE_MS      = 240;
/** 组内牌收缩时长（Phase 4 消失动画） */
const SHRINK_DUR         = 0.12;

// ── 模块级辅助函数 ─────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
    new Promise(r => setTimeout(r, ms));

function tweenTo(node: Node, dur: number, props: object, easing = 'quadOut'): Promise<void> {
    return new Promise(r =>
        tween(node)
            .to(dur, props as any, { easing: easing as any })
            .call(() => r())
            .start()
    );
}

// ── 组件 ──────────────────────────────────────────────────

@ccclass('HandCardPanel')
export class HandCardPanel extends Component {

    @property({ type: Node,   tooltip: '牌堆节点（发牌动画起点）' })
    deckNode: Node = null!;

    @property({ type: Prefab, tooltip: '牌面预制体（可选）' })
    cardPrefab: Prefab | null = null;

    // ── 对外回调 ──────────────────────────────────────────

    /** 每次按钮状态变化时通知 ActionPanel */
    onButtonStates: ((states: ButtonStates) => void) | null = null;

    // ── 私有状态 ──────────────────────────────────────────

    private _state       = new HandCardState();
    private _groupRoot:   Node = null!;
    private _ungroupRoot: Node = null!;

    /** groupId → CardGroupView */
    private _groupViews  = new Map<string, CardGroupView>();
    /** cardValue → CardNode（UNGROUP 散牌） */
    private _ungroupNodes = new Map<number, CardNode>();

    private _unsubscribe: (() => void) | null = null;
    /** 发牌后第一次 _doLayout 使用更长的重排时长，之后自动还原 */
    private _dealReorderDur: number = LAYOUT_DUR;

    // ── 生命周期 ──────────────────────────────────────────

    onLoad(): void {
        this._groupRoot   = this._makeContainerNode('_groupRoot');
        this._ungroupRoot = this._makeContainerNode('_ungroupRoot');
        this.node.addChild(this._groupRoot);
        this.node.addChild(this._ungroupRoot);

        this._unsubscribe = this._state.onChange((snap) => this._onStateChange(snap));
    }

    onDestroy(): void {
        this._unsubscribe?.();
        this.clear();
    }

    // ── 公开 API（TongitsView 调用） ──────────────────────

    /**
     * 发牌动画：游戏开始时调用
     *
     * Phase 1 — 所有牌叠放在牌堆（背面朝上）
     * Phase 2 — 错时飞入展开到散牌位置
     * Phase 3 — 到位后翻正面（scaleX 压扁→恢复）+ Y 弹跳
     * Phase 4 — 预判 autoGroup：组内牌收缩消失，然后 setCards 触发
     *           重排动画（散牌从展开位滑到最终位置）
     */
    async dealCards(cards: number[]): Promise<void> {
        this.clear();
        if (!cards.length) return;

        const deckLocal  = this._deckLocalPos();
        const spreadXs   = this._spreadPositions(cards.length);
        console.log("cards: ", cards);
        console.log("spreadXs:",spreadXs)

        // ── Phase 1: 在牌堆叠放，背面朝上 ──────────────────────
        const nodes: Node[] = [];
        const cns:   CardNode[] = [];

        for (let i = 0; i < cards.length; i++) {
            const n  = this._createCardNode(cards[i]);
            const cn = n.getComponent(CardNode)!;
            cn.setFaceDown(true);            // 背面朝上
            cns.push(cn);
            n.setPosition(deckLocal.x - i * 0.8, deckLocal.y - i * 0.5, 0);
            this._ungroupRoot.addChild(n);   // 正序：children[i] = nodes[i]
            nodes.push(n);
        }

        // ── Phase 2 & 3: 错时飞入（parallel：位移 + 缩放旋转同步）→ 落地弹跳 ──
        await Promise.all(cards.map((_, i) =>
            delay(i * DEAL_INTERVAL).then(() => new Promise<void>(resolve => {
                const n   = nodes[i];
                const cn  = cns[i];
                // 按牌序偏转：中间牌垂直，两侧逐渐倾斜，形成扇形叠牌感
                const rotZ = (i - (cards.length - 1) / 2) * 2;

                n.setSiblingIndex(nodes.length - 1); // 飞行期间置顶

                tween(n)
                    // 初始：微缩 + 扇形旋转（从牌堆起飞姿态）
                    .set({ scale: new Vec3(0.65, 0.8, 1), eulerAngles: new Vec3(0, 0, rotZ) })
                    // 飞行阶段：位移与缩放/旋转并行
                    .parallel(
                        // 位移：飞到展开位，到位后立刻翻正面
                        tween(n)
                            .to(FLY_DUR, { position: new Vec3(spreadXs[i], 0, 0) }, { easing: 'sineOut' })
                            .call(() => cn.setFaceDown(false)),
                        // 缩放+旋转：先压缩（飞行感）→ 还原旋转 → 轻微收缩（落地前）
                        tween(n)
                            .to(FLY_DUR * 0.2, { scale: new Vec3(0.6, 0.6, 1) },                                          { easing: 'quadIn'  })
                            .to(FLY_DUR * 0.6, { scale: new Vec3(0.9, 0.9, 1), eulerAngles: new Vec3(0, 0, 0) }, { easing: 'sineOut' })
                            .to(FLY_DUR * 0.2, { scale: new Vec3(0.82, 0.82, 1) },                                        { easing: 'sineOut' })
                    )
                    // 落地弹跳：放大过冲 → 回弹还原
                    .to(BOUNCE_STEP, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
                    .to(BOUNCE_STEP, { scale: new Vec3(1, 1, 1) },       { easing: 'backOut' })
                    .call(() => {
                        n.setSiblingIndex(i); // 还原自然 sibling：左低右高
                        resolve();
                    })
                    .start();
            }))
        ));

        // 让玩家短暂看清手牌
        await delay(DEAL_PAUSE_MS);

        // ── Phase 4: 合并 → 按组重排展开 ────────────────────────
        await this._animateMergeExpand(cards);
    }

    /**
     * 立即显示手牌（无动画），重连 / 中途加入时调用
     */
    showCards(cards: number[]): void {
        this.clear();
        this._state.setCards(cards);
    }

    /**
     * 摸牌：加入一张牌
     * - autoGroupEnabled：合并动画 → 重新分组展开
     * - 否则：直接插入，走普通 _doLayout
     */
    addCard(card: number): void {
        if (this._state.autoGroupEnabled) {
            const snap = this._state.snapshot();
            const allCards = [
                ...snap.groups.reduce<number[]>((acc, g) => acc.concat(g.cards), []),
                ...snap.ungroup,
                card,
            ];
            void this._animateMergeExpand(allCards);
        } else {
            this._state.addCard(card);
        }
    }

    /**
     * 弃牌 / 出牌：从 UNGROUP 区移除一张牌
     */
    removeCard(card: number): void {
        this._state.removeCard(card);
    }

    /**
     * 清空所有手牌（游戏结束 / 房间重置）
     */
    clear(): void {
        this._groupRoot.setPosition(0, 0, 0);
        this._ungroupRoot.setPosition(0, 0, 0);
        this._ungroupRoot.removeAllChildren();
        for (const gv of this._groupViews.values()) gv.destroy();
        this._groupViews.clear();
        for (const cn of this._ungroupNodes.values()) cn.node.destroy();
        this._ungroupNodes.clear();
    }

    // ── 按钮操作入口（ActionPanel 调用） ─────────────────

    onGroupBtn():   void { this._state.createGroup();   }
    onUngroupBtn(): void { this._state.dissolveGroup(); }

    /**
     * Drop 按钮：返回被 Drop 的 GroupData（供 TongitsView 发送服务端请求）
     */
    onDropBtn(): GroupData | null {
        return this._state.dropGroup();
    }

    /**
     * Dump 按钮：返回被弃的牌值
     */
    onDumpBtn(): number | null {
        const card = this._state.snapshot().buttonStates.selectedSingleCard;
        if (card == null) return null;
        this._state.removeCard(card);
        return card;
    }

    onToggleAutoGroup(): void  { this._state.toggleAutoGroup(); }
    onToggleSortMode():  void  { this._state.toggleSortMode();  }

    get autoGroupEnabled(): boolean { return this._state.autoGroupEnabled; }
    get sortMode():         SortMode { return this._state.sortMode; }
    get point():            number  { return this._state.point; }

    // ── 状态变化响应 ──────────────────────────────────────

    private _onStateChange(snap: HandCardSnapshot): void {
        this._syncGroupViews(snap.groups, snap.selectedGroupIds);
        this._syncUngroupNodes(snap.ungroup, snap.selectedUngroupCards);
        this._doLayout(snap.groups, snap.ungroup);
        this.onButtonStates?.(snap.buttonStates);
    }

    // ── 视图同步 ──────────────────────────────────────────

    /** 同步 CardGroupView 列表（新增 / 更新 / 删除） */
    private _syncGroupViews(
        groups: readonly GroupData[],
        selectedIds: ReadonlySet<string>,
    ): void {
        const newIds = new Set(groups.map(g => g.id));

        // 删除已消失的组
        for (const [id, gv] of this._groupViews) {
            if (!newIds.has(id)) {
                gv.destroy();
                this._groupViews.delete(id);
            }
        }

        // 新增 / 更新
        for (const g of groups) {
            let gv = this._groupViews.get(g.id);
            if (!gv) {
                gv = new CardGroupView(g, (v) => this._createCardNode(v));
                gv.onGroupClick = (id) => this._state.toggleGroup(id);
                this._groupRoot.addChild(gv.node);
                this._groupViews.set(g.id, gv);
            } else {
                gv.update(g, (v) => this._createCardNode(v));
            }
            gv.setSelected(selectedIds.has(g.id));
        }
    }

    /** 同步 UNGROUP 区散牌节点 */
    private _syncUngroupNodes(
        ungroup: readonly number[],
        selectedCards: ReadonlySet<number>,
    ): void {
        const newSet = new Set(ungroup);

        // 删除已消失的牌
        for (const [val, cn] of this._ungroupNodes) {
            if (!newSet.has(val)) {
                cn.node.destroy();
                this._ungroupNodes.delete(val);
            }
        }

        // 新增牌
        for (const val of ungroup) {
            if (!this._ungroupNodes.has(val)) {
                const n  = this._createCardNode(val);
                const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);
                cn.onClick = (v) => this._state.toggleUngroupCard(v);
                this._ungroupRoot.addChild(n);
                cn.setFaceDown(false);       // 正常显示时翻到正面
                this._ungroupNodes.set(val, cn);
            }
            // 更新选中状态
            this._ungroupNodes.get(val)?.setSelected(selectedCards.has(val));
        }
    }

    // ── 布局 ──────────────────────────────────────────────

    /**
     * 计算并应用所有组 + UNGROUP 散牌的目标位置，使用 tween 平滑过渡。
     * 发牌后首次调用会使用 _dealReorderDur（更长），之后自动还原为 LAYOUT_DUR。
     */
    private _doLayout(groups: readonly GroupData[], ungroup: readonly number[]): void {
        const dur = this._dealReorderDur;
        this._dealReorderDur = LAYOUT_DUR; // 一次性消费，之后还原

        let curX = 0;

        // 各组从左到右排列
        for (const g of groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            const halfW = gv.width / 2;
            curX += halfW;
            tween(gv.node)
                .to(dur, { position: new Vec3(curX, 0, 0) }, { easing: 'quadOut' })
                .start();
            curX += halfW + GROUP_GAP;
        }

        // UNGROUP 散牌
        if (ungroup.length > 0) {
            if (groups.length > 0) curX += GROUP_GAP;
            const startX = curX;

            for (let i = 0; i < ungroup.length; i++) {
                const val = ungroup[i];
                const cn  = this._ungroupNodes.get(val);
                if (!cn) continue;
                cn.tweenToX(startX + i * CARD_SPACING, dur);
            }

            // 更新 curX 到 UNGROUP 区末尾（最后一张牌右边缘）
            curX = startX + (ungroup.length - 1) * CARD_SPACING + CARD_W;
        }

        // 整体以 panel 中心对齐
        // 展开模式（dur > LAYOUT_DUR）：容器也做 tween，
        // 配合节点从 (0,0) 出发，实现视觉上"从中心向两侧展开"的效果
        const totalContentW = curX;
        const targetX = -totalContentW / 2;
        if (dur > LAYOUT_DUR) {
            tween(this._groupRoot)  .to(dur, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' }).start();
            tween(this._ungroupRoot).to(dur, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' }).start();
        } else {
            this._groupRoot.setPosition(targetX, 0, 0);
            this._ungroupRoot.setPosition(targetX, 0, 0);
        }
    }

    // ── 工具 ──────────────────────────────────────────────

    private _createCardNode(value: number): Node {
        const n = this.cardPrefab
            ? instantiate(this.cardPrefab)
            : new Node(`Card_${value}`);
        n.name = `Card_${value}`;
        // 确保有 CardNode 组件
        if (!n.getComponent(CardNode)) n.addComponent(CardNode);
        const cn = n.getComponent(CardNode)!;
        cn.setCard(value);
        return n;
    }

    private _makeContainerNode(name: string): Node {
        const n  = new Node(name);
        const tf = n.addComponent(UITransform);
        tf.setContentSize(0, CARD_H);
        return n;
    }

    /** 牌堆节点在本 panel 坐标系中的位置（发牌起点） */
    private _deckLocalPos(): Vec3 {
        const world = this.deckNode
            ? this.deckNode.getWorldPosition()
            : this.node.getWorldPosition();
        const local = this._worldToLocal(world);
        // 若牌堆与 panel 重叠，强制偏移到上方作为起点
        if (Math.abs(local.y) < CARD_H) local.y = CARD_H * 3;
        return local;
    }

    /**
     * 计算 count 张牌的展开 X 位置（相对于 _ungroupRoot，以 0 为中心）。
     * _ungroupRoot 在发牌期间位于 panel 原点，所以这里要自行居中偏移。
     */
    private _spreadPositions(count: number): number[] {
        const totalW = (count - 1) * CARD_SPACING;
        return Array.from({ length: count }, (_, i) => -totalW / 2 + i * CARD_SPACING);
    }

    /**
     * 合并 + 展开动画（发牌 Phase 4 / 摸牌 autoSort 共用）
     *
     * 1. 收集当前所有可见牌节点
     * 2. 全部 tween 飞向容器中心并缩小消失
     * 3. 清理旧节点和状态映射
     * 4. _state.setCards(newCards) → _onStateChange → _doLayout 展开动画
     */
    private async _animateMergeExpand(newCards: number[]): Promise<void> {
        const MERGE_DUR = 0.18;

        // 收集：_ungroupRoot 的直接子节点 + 所有 GroupView 根节点
        const allNodes: Node[] = [
            ...[...this._ungroupRoot.children],
            ...[...this._groupViews.values()].map(gv => gv.node),
        ];

        if (allNodes.length > 0) {
            await Promise.all(allNodes.map(n =>
                new Promise<void>(resolve =>
                    tween(n)
                        .to(MERGE_DUR,
                            { position: new Vec3(0, 0, 0) },
                            { easing: 'quadIn' })
                        .call(() => resolve())
                        .start()
                )
            ));
        }

        // 合并完成后短暂停顿，再展开
        await delay(120);

        // 清理状态映射（节点稍后统一销毁）
        this._ungroupNodes.clear();
        this._groupViews.clear();

        // 销毁动画节点
        for (const n of allNodes) { if (n.isValid) n.destroy(); }
        // 保险：清除容器残余
        this._ungroupRoot.removeAllChildren();
        this._groupRoot.removeAllChildren();
        this._ungroupRoot.setPosition(0, 0, 0);
        this._groupRoot.setPosition(0, 0, 0);

        // 触发展开（_doLayout 使用较长时长产生仪式感）
        this._dealReorderDur = DEAL_REORDER_DUR;
        this._state.setCards(newCards);
    }

    private _worldToLocal(worldPos: Vec3): Vec3 {
        const tf = this.node.getComponent(UITransform);
        if (tf) return tf.convertToNodeSpaceAR(worldPos);
        const self = this.node.getWorldPosition();
        return new Vec3(worldPos.x - self.x, worldPos.y - self.y, 0);
    }
}
