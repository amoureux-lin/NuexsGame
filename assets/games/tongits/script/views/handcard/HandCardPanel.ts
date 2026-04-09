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
 *   tableAreaView — 牌桌区组件（牌堆位置 / 视觉 / 交互全部在此）
 *   cardPrefab    — 牌面预制体（可选，不填用程序化默认样式）
 *
 * 节点结构（运行时动态）：
 *   HandCardPanel
 *   ├── _groupRoot         ← 所有 CardGroupView
 *   ├── _ungroupRoot       ← UNGROUP 散牌
 *   ├── _dragLayer         ← 拖拽中的牌（在组与标记之下）
 *   └── _markerOverlayRoot ← 各组 groupMarker 挂此（最上层，盖住拖拽牌）
 */

import {
    _decorator, Component, Node, Prefab, instantiate,
    UITransform, Vec2, Vec3, tween, Tween,
} from 'cc';
import { TableAreaView } from '../panel/TableAreaView';
import { HandCardState, ButtonStates, HandCardSnapshot } from '../../utils/HandCardState';

// ── 选中信息（对外统一出口） ───────────────────────────────

export interface SelectionInfo {
    /** 当前选中的散牌值列表 */
    selectedCards:  readonly number[];
    /** 当前选中的牌组数据列表 */
    selectedGroups: readonly GroupData[];
    /** 按钮可用状态（canDrop / canDump / canSapaw 等） */
    buttons:        ButtonStates;
}

// 预留：上一家弃牌 → 可压牌候选组合切换
// export type MeldCandidateInfo = { candidates: GroupData[][] };
// onMeldCandidateChange: ((info: MeldCandidateInfo) => void) | null = null;
import { autoGroup, GroupData, judgeGroupType, GroupType } from '../../utils/GroupAlgorithm';
import { SortMode }                                      from '../../utils/CardDef';
import { CardGroupView }                                 from './CardGroupView';
import { CardNode, DEFAULT_CARD_W, DEFAULT_CARD_H, CARD_SPACING, getCardContentSize } from './CardNode';

const { ccclass, property } = _decorator;

// ── 拖拽状态 ──────────────────────────────────────────────

interface DragState {
    cardValue:      number;
    floatNode:      Node;
    sourceKind:     'ungroup' | 'group';
    sourceGroupId?: string;
    /** 拖拽牌在来源组（或散牌区）中的原始下标 */
    sourceIndex:    number;
    hoverKind:      'ungroup' | 'group' | null;
    hoverGroupId?:  string;
    hoverIndex:     number;
}

// ── 布局常量 ──────────────────────────────────────────────

/** 组与组之间的间距 */
const GROUP_GAP          = 36;
/** 布局重排动画时长（正常交互） */
const LAYOUT_DUR         = 0.14;
/**
 * 拖拽预览线性 Lerp 速度因子（与原版 ContainerComponent 保持一致）
 * factor = min(1, LERP_SPEED * dt)
 * 60fps 下约 0.33/帧，~10 帧（0.17s）基本到位
 */
const LERP_SPEED = 20;
/** 发牌后"按组重排"动画时长（更长，有仪式感） */
const DEAL_REORDER_DUR   = 0.30;
/** 发牌每张飞行时长 */
const FLY_DUR            = 0.22;
/** 发牌每张间隔（ms） */
const DEAL_INTERVAL      = 55;
/** 弹跳单步时长 */
const BOUNCE_STEP        = 0.16;
/** 全部落牌后暂停时长（让玩家看清手牌） */
const DEAL_PAUSE_MS      = 100;

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

    @property({ type: TableAreaView, tooltip: '牌桌区组件（牌堆位置/视觉/交互）' })
    tableAreaView: TableAreaView | null = null;

    @property({ type: Prefab, tooltip: '牌面预制体（可选）' })
    cardPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '牌组预制体（CardGroupView Prefab）' })
    cardGroupPrefab: Prefab | null = null;

    // ── 对外回调 ──────────────────────────────────────────

    /**
     * 选中状态变化时的统一出口（每次状态变化都触发）
     * ActionPanel / TongitsView 通过此回调决定按钮显示
     */
    onSelectionChange: ((info: SelectionInfo) => void) | null = null;

    /**
     * 发牌合并动画完成、展开动画开始前触发。
     * TongitsView 在此回调中显示 ActionPanel 按钮。
     */
    onDealMergeComplete: (() => void) | null = null;

    /**
     * 牌堆被点击且当前允许抽牌时触发（由 TongitsView 赋值）。
     */
    onDeckDrawClick: (() => void) | null = null;

    // ── 私有状态 ──────────────────────────────────────────

    private _state       = new HandCardState();
    private _groupRoot:   Node = null!;
    private _ungroupRoot: Node = null!;
    /** 拖拽中浮层牌的父节点（sibling 在 _markerOverlayRoot 之下，保证组标记盖在牌上） */
    private _dragLayer:   Node = null!;
    /** 组类型条（groupMarker）统一挂此节点，始终在手牌区最顶层 */
    private _markerOverlayRoot: Node = null!;

    /** groupId → CardGroupView */
    private _groupViews  = new Map<string, CardGroupView>();
    /** cardValue → CardNode（UNGROUP 散牌） */
    private _ungroupNodes = new Map<number, CardNode>();

    private _unsubscribe: (() => void) | null = null;
    /** 发牌后第一次 _doLayout 使用更长的重排时长，之后自动还原 */
    private _dealReorderDur: number = LAYOUT_DUR;
    /**
     * 已启动动画但尚未写入 state 的散牌数。
     * _computeNewCardLocalX / _preShiftRootsForNewCard 用此修正 n，
     * 确保连续摸牌时每张新牌都按真实张数计算位置。
     */
    private _pendingUngroupCount = 0;

    /** 拖拽状态（null = 无拖拽） */
    private _drag: DragState | null = null;
    /** Lerp 预览目标：CardNode → 目标 X（在各自父容器坐标系中） */
    private _previewTargets = new Map<CardNode, number>();
    /** Lerp 容器目标：gv.node → 目标 local X（在 _groupRoot 坐标系中） */
    private _containerTargets = new Map<Node, number>();
    /** 拖拽开始时各组容器的 local X（_groupRoot 坐标系），用于计算 delta */
    private _origGroupLocalX  = new Map<string, number>();
    /** 各组容器的目标 local X（由 _applyPreviewLayout 同步，供 _findDropTarget 使用） */
    private _groupContainerTargetX = new Map<string, number>();
    /** 散牌区第一张牌在 _ungroupRoot 坐标系中的 X（_doLayout 中缓存） */
    private _ungroupStartX = 0;
    /** 拖拽预览期间的有效散牌起始 X（由 _applyPreviewLayout 实时计算，供检测使用） */
    private _previewUngroupStartX = 0;
    /** 拖拽预览：组容器目标宽度（gv.node → 目标宽度，驱动组的视觉展宽/收缩） */
    private _slotTargetWidths = new Map<Node, number>();
    /** 拖拽释放时 floatNode 的世界坐标（新节点起飞点），-1 表示无待处理 */
    private _spawnCardValue  = -1;
    private _spawnWorldPos3  = new Vec3();
    /** createGroup 时选中牌的世界坐标中心（供新组起始位置使用） */
    private _spawnGroupWorldPos: Vec3 | null = null;
    /** dissolveGroup 时被解散组的世界坐标（供散牌起始位置使用） */
    private _spawnUngroupWorldPos: Vec3 | null = null;

    // ── 生命周期 ──────────────────────────────────────────

    onLoad(): void {
        this._groupRoot   = this._makeContainerNode('_groupRoot');
        this._ungroupRoot = this._makeContainerNode('_ungroupRoot');
        this._dragLayer   = this._makeContainerNode('_dragLayer');
        this._markerOverlayRoot = this._makeContainerNode('_markerOverlayRoot');
        this.node.addChild(this._groupRoot);
        this.node.addChild(this._ungroupRoot);
        this.node.addChild(this._dragLayer);
        this.node.addChild(this._markerOverlayRoot);
        this._unsubscribe = this._state.onChange((snap) => this._onStateChange(snap));
    }

    onDestroy(): void {
        this._unsubscribe?.();
        this.clear();
    }

    /**
     * 拖拽预览 Lerp 驱动：每帧将各牌的当前 X 差值趋近目标 X。
     * 仅在拖拽进行时运行，无拖拽时零开销。
     */
    update(dt: number): void {
        if (!this._drag) return;
        // 线性 lerp，帧率无关
        const factor = Math.min(1, LERP_SPEED * dt);
        // 驱动各牌的 local X
        for (const [cn, targetX] of this._previewTargets) {
            if (!cn.node.isValid) continue;
            const pos  = cn.node.position;
            const newX = pos.x + (targetX - pos.x) * factor;
            cn.node.setPosition(newX, pos.y, 0);
        }
        // 驱动组容器的 local X
        for (const [node, targetX] of this._containerTargets) {
            if (!node.isValid) continue;
            const pos  = node.position;
            const newX = pos.x + (targetX - pos.x) * factor;
            node.setPosition(newX, pos.y, 0);
        }
        // 驱动组容器宽度（来源组收缩，目标组展宽），同步背景宽度
        for (const [node, targetW] of this._slotTargetWidths) {
            if (!node.isValid) continue;
            const tf = node.getComponent(UITransform);
            if (!tf) continue;
            const curW = tf.contentSize.width;
            const newW = Math.abs(curW - targetW) < 0.5 ? targetW : curW + (targetW - curW) * factor;
            tf.setContentSize(newW, tf.contentSize.height);
            node.getComponent(CardGroupView)?.syncBgWidth(newW);
        }
    }

    // ── 公开 API（TongitsView 调用） ──────────────────────

    /**
     * 发牌动画：游戏开始时调用
     *
     * Phase 1 — 建发牌用牌堆（cards.length 张），背面朝上；同时预创建飞行节点
     * Phase 2 — 错时飞入展开位置，每张起飞时 pop 牌堆视觉；
     *           最后一张起飞时立即用 deckCardCount 重建剩余牌堆
     * Phase 3 — 到位后翻正面（scaleX 压扁→恢复）+ Y 弹跳
     * Phase 4 — 预判 autoGroup：组内牌收缩消失，然后 setCards 触发
     *           重排动画（散牌从展开位滑到最终位置）
     */
    async dealCards(cards: number[], deckCardCount = 0,oneCallback?:Function): Promise<void> {
        this.clear();
        if (!cards.length) return;

        const spreadXs = this._spreadPositions(cards.length);

        // ── Phase 1: 在 sendCardNode 下建发牌堆，一次性 re-parent 到 _ungroupRoot ──
        this.tableAreaView?.setupSendDeck(cards.length);
        const rawNodes = this.tableAreaView
            ? [...this.tableAreaView.sendPileNodes].reverse()
            : [];
        // re-parent 后节点世界坐标不变（起飞点 = sendCardNode 位置），z-order 正确
        const nodes = rawNodes.map(n => {
            const worldPos = n.getWorldPosition();
            this._ungroupRoot.addChild(n);
            n.setWorldPosition(worldPos);
            return n;
        });
        const cns = nodes.map(n => n.getComponent(CardNode)!);

        const lastIdx = cards.length - 1;

        // ── Phase 2 & 3: 错时飞入（parallel：位移 + 缩放旋转同步）→ 落地弹跳 ──
        await Promise.all(cards.map((_, i) =>
            delay(i * DEAL_INTERVAL).then(() => new Promise<void>(resolve => {
                // 最后一张起飞时重建剩余牌堆
                if (i === lastIdx) this.tableAreaView?.setupDeck(deckCardCount);

                const n  = nodes[i];
                const cn = cns[i];

                // 按牌序偏转：中间牌垂直，两侧逐渐倾斜，形成扇形叠牌感
                const rotZ = (i - (cards.length - 1) / 2) * 2;

                n.setSiblingIndex(cards.length - 1); // 飞行期间置顶
                if (oneCallback) oneCallback();
                tween(n)
                    // 初始：微缩 + 扇形旋转（从牌堆起飞姿态）
                    .set({ scale: new Vec3(0.68, 0.68, 1), eulerAngles: new Vec3(0, 0, rotZ) })
                    // 飞行阶段：位移与缩放/旋转并行
                    .parallel(
                        // 位移：飞到展开位，到位后立刻翻正面
                        tween(n)
                            .to(FLY_DUR, { position: new Vec3(spreadXs[i], 0, 0) }, { easing: 'sineOut' })
                            .call(() => {
                                cn.setCard(cards[i]); // 翻面前设牌值
                                cn.setFaceDown(false);

                            }),
                        // 缩放+旋转：先压缩（飞行感）→ 还原旋转 → 轻微收缩（落地前）
                        tween(n)
                            .to(FLY_DUR * 0.2, { scale: new Vec3(0.68, 0.68, 1) },                                          { easing: 'quadIn'  })
                            .to(FLY_DUR * 0.68, { scale: new Vec3(0.9, 0.9, 1), eulerAngles: new Vec3(0, 0, 0) }, { easing: 'sineOut' })
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
     *
     * 动画流程（Phase A + Phase B 同时启动）：
     *   Phase A — 弧形飞入：牌堆顶部节点翻正面，FlyUtil 弧形飞到手牌目标位
     *   Phase B — 左移腾位：所有根容器向左移 shiftX
     *   飞行落地后：
     *     autoGroup  → _animateMergeExpand（合并展开）
     *     otherwise  → _state.addCard（新节点从落点起步，_doLayout 无位移）
     */
    addCard(card: number): void {
        const pileTop = this.tableAreaView?.popDeckCard() ?? null;

        // 新牌目标：panel 本地坐标（flyNode 是 this.node 的直接子节点，直接用本地坐标）
        const targetLocalX   = this._computeNewCardLocalX();
        const targetLocal    = new Vec3(targetLocalX, 0, 0);
        // 世界坐标用于 _spawnUngroupWorldPos（_syncUngroupNodes 调用 setWorldPosition）
        const targetWorldPos = this._localToWorld(targetLocal);

        // 所有根容器同步左移腾位（与落牌动画同时进行）
        this._preShiftRootsForNewCard();
        // 记录本次摸牌已占位（state.addCard 尚未调用，需要用此计数修正下次摸牌的目标位置）
        this._pendingUngroupCount++;

        // 落牌节点：翻正面后挂在 HandCardPanel，从目标上方滑落到目标位置
        const DROP_HEIGHT = 80;
        const DROP_DUR    = 0.25;

        let flyNode: Node | null = null;
        if (pileTop?.isValid) {
            flyNode = pileTop;
            this.node.addChild(flyNode);
            const cn = flyNode.getComponent(CardNode);
            if (cn) { cn.setCard(card); cn.setFaceDown(false); }
            flyNode.setPosition(targetLocal.x, targetLocal.y + DROP_HEIGHT, 0);
        }

        const doFinalize = async () => {
            this._pendingUngroupCount--;
            if (this._state.autoGroupEnabled) {
                // flyNode 加入 _ungroupRoot 一起参与合并动画，_animateMergeExpand 统一清理
                if (flyNode?.isValid) {
                    const wp = flyNode.getWorldPosition().clone();
                    this._ungroupRoot.addChild(flyNode);
                    flyNode.setWorldPosition(wp);
                }
                const snap = this._state.snapshot();
                const allCards = [
                    ...snap.groups.reduce<number[]>((acc, g) => acc.concat(g.cards), []),
                    ...snap.ungroup,
                    card,
                ];
                await delay(DEAL_PAUSE_MS);
                await this._animateMergeExpand(allCards);
            } else {
                if (flyNode?.isValid) flyNode.destroy();
                // 新节点从落点起步，_doLayout 无额外位移
                this._spawnUngroupWorldPos = targetWorldPos.clone();
                this._state.addCard(card);
            }
        };

        if (flyNode) {
            // 下降动画：从上方滑落到目标位置
            tween(flyNode)
                .to(DROP_DUR,
                    { position: new Vec3(targetLocal.x, targetLocal.y, 0) },
                    { easing: 'quadOut' })
                .call(() => { void doFinalize(); })
                .start();
        } else {
            void doFinalize();
        }
    }

    /**
     * 计算摸牌后新牌在 HandCardPanel 本地坐标系中的目标 X。
     *
     * 推导：设 GW = 组区总宽（含组区与散牌区之间的 GROUP_GAP；无组时为 0），
     *       n = 当前散牌张数，则新牌 panel-local X = (GW + n × CARD_SPACING) / 2。
     *
     * flyNode 是 this.node 的直接子节点，直接用本地坐标设位置，无需世界坐标转换。
     */
    private _computeNewCardLocalX(): number {
        const snap = this._state.snapshot();
        const n = snap.ungroup.length + this._pendingUngroupCount;
        let GW = 0;
        for (const g of snap.groups) {
            const gv = this._groupViews.get(g.id);
            if (gv) GW += gv.width + GROUP_GAP;
        }
        return (GW + n * CARD_SPACING) / 2;
    }

    /** 将 HandCardPanel 本地坐标转为世界坐标（正确处理节点缩放与旋转） */
    private _localToWorld(localPos: Vec3): Vec3 {
        const tf = this.node.getComponent(UITransform);
        if (tf) return tf.convertToWorldSpaceAR(localPos);
        const s = this.node.worldScale;
        const w = this.node.getWorldPosition();
        return new Vec3(w.x + localPos.x * s.x, w.y + localPos.y * s.y, 0);
    }

    /**
     * 将所有根容器向左移 shiftX，与弧形飞入动画同步进行，为新牌在右侧腾出位置。
     * shiftX = (newTotalW − currentTotalW) / 2
     */
    private _preShiftRootsForNewCard(): void {
        const snap  = this._state.snapshot();
        const n     = snap.ungroup.length + this._pendingUngroupCount;
        const cardW = this._layoutCardW();

        // 计算加入新牌后的 totalW（与 _doLayout 公式一致）
        // 组区：sum(gv.width + GROUP_GAP)，两次 ±GROUP_GAP 相抵，直接用 sum
        let newTotalW = 0;
        for (const g of snap.groups) {
            const gv = this._groupViews.get(g.id);
            if (gv) newTotalW += gv.width + GROUP_GAP;
        }
        newTotalW += n * CARD_SPACING + cardW;

        // 与 _doLayout 使用相同的绝对终点公式，避免从中间动画值出发导致目标偏移
        const targetX = -newTotalW / 2;
        const dur  = 0.35;
        const opts = { easing: 'quadOut' as const };

        for (const root of [this._groupRoot, this._ungroupRoot, this._dragLayer, this._markerOverlayRoot]) {
            Tween.stopAllByTarget(root);
            tween(root).to(dur, { position: new Vec3(targetX, 0, 0) }, opts).start();
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
        this._dragLayer.setPosition(0, 0, 0);
        this._markerOverlayRoot.setPosition(0, 0, 0);
        this._ungroupRoot.removeAllChildren();
        this._dragLayer.removeAllChildren();
        this._markerOverlayRoot.removeAllChildren();
        for (const gv of this._groupViews.values()) {
            gv.setMarkerOverlayParent(null);
            gv.node.destroy();
        }
        this._groupViews.clear();
        for (const cn of this._ungroupNodes.values()) cn.node.destroy();
        this._ungroupNodes.clear();
    }

    // ── 按钮操作入口（ActionPanel 调用） ─────────────────

    onGroupBtn(): void {
        // 捕获所有选中节点的世界坐标中心，作为新组的起飞点
        const snap = this._state.snapshot();
        let sumX = 0, sumY = 0, count = 0;
        for (const gId of snap.selectedGroupIds) {
            const gv = this._groupViews.get(gId);
            if (gv) { const wp = gv.node.getWorldPosition(); sumX += wp.x; sumY += wp.y; count++; }
        }
        for (const val of snap.selectedUngroupCards) {
            const cn = this._ungroupNodes.get(val);
            if (cn) { const wp = cn.node.getWorldPosition(); sumX += wp.x; sumY += wp.y; count++; }
        }
        if (count > 0) this._spawnGroupWorldPos = new Vec3(sumX / count, sumY / count, 0);
        this._state.createGroup();
    }

    onUngroupBtn(): void {
        // 捕获被解散组的世界坐标，作为散牌节点的起飞点
        const snap = this._state.snapshot();
        const [gId] = [...snap.selectedGroupIds];
        if (gId) {
            const gv = this._groupViews.get(gId);
            if (gv) this._spawnUngroupWorldPos = gv.node.getWorldPosition().clone();
        }
        this._state.dissolveGroup();
    }

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

    /**
     * 是否允许点击牌堆进行抽牌（转发给 TableAreaView）。
     * 注意：具体是否”轮到自己”由上层 TongitsView 负责判定后调用本方法。
     */
    setDeckDrawEnabled(enabled: boolean): void {
        this.tableAreaView?.setDeckDrawEnabled(enabled);
    }

    // ── 状态变化响应 ──────────────────────────────────────

    private _onStateChange(snap: HandCardSnapshot): void {
        this._syncGroupViews(snap.groups, snap.selectedGroupIds);
        this._syncUngroupNodes(snap.ungroup, snap.selectedUngroupCards);
        this._doLayout(snap.groups, snap.ungroup);
        this._emitSelection(snap);
    }

    /** 构建 SelectionInfo 并触发回调，同时输出调试日志 */
    private _emitSelection(snap: HandCardSnapshot): void {
        const selectedCards  = [...snap.selectedUngroupCards];
        const selectedGroups = snap.groups.filter(g => snap.selectedGroupIds.has(g.id));

        console.log('[Selection]', {
            cards:   selectedCards,
            groups:  selectedGroups.map(g => ({ type: g.type, cards: g.cards })),
            buttons: snap.buttonStates,
        });

        this.onSelectionChange?.({
            selectedCards,
            selectedGroups,
            buttons: snap.buttonStates,
        });
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
                gv.setMarkerOverlayParent(null);
                gv.node.destroy();
                this._groupViews.delete(id);
            }
        }

        // 新增 / 更新
        for (const g of groups) {
            let gv = this._groupViews.get(g.id);
            if (!gv) {
                const groupNode = this.cardGroupPrefab
                    ? instantiate(this.cardGroupPrefab)
                    : new Node(`Group_${g.id}`);
                this._groupRoot.addChild(groupNode);
                // 手动组合时从选中牌的中心起飞；其他情况（autoGroup / prefab 偏移）从原点出发
                if (this._spawnGroupWorldPos && !g.isAuto) {
                    groupNode.setWorldPosition(this._spawnGroupWorldPos);
                    this._spawnGroupWorldPos = null;
                } else {
                    groupNode.setPosition(0, 0, 0);
                }
                // 确保有 CardGroupView 组件（prefab 里已挂好，fallback 时手动添加）
                gv = groupNode.getComponent(CardGroupView) ?? groupNode.addComponent(CardGroupView);
                gv.onGroupClick = (id) => this._state.toggleGroup(id);
                gv.init(g, (v) => this._createCardNode(v));
                gv.setMarkerOverlayParent(this._markerOverlayRoot);
                this._groupViews.set(g.id, gv);
            } else {
                gv.refresh(g, (v) => this._createCardNode(v));
                gv.setMarkerOverlayParent(this._markerOverlayRoot);
            }
            gv.setSelected(selectedIds.has(g.id));
            // 绑定（或重绑）所有组内牌的拖拽回调
            for (const cn of gv.cardNodes) {
                this._bindCardDrag(cn, 'group', g.id);
            }
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
                this._bindCardDrag(cn, 'ungroup');
                this._ungroupRoot.addChild(n);
                // 解散组时从原组位置起飞，而非从左端(0,0,0)
                if (this._spawnUngroupWorldPos) {
                    n.setWorldPosition(this._spawnUngroupWorldPos);
                }
                // 按数组顺序设置 sibling index，保证叠牌 Z 序正确
                n.setSiblingIndex(ungroup.indexOf(val));
                cn.setFaceDown(false);       // 正常显示时翻到正面
                this._ungroupNodes.set(val, cn);
            }
            // 更新选中状态
            this._ungroupNodes.get(val)?.setSelected(selectedCards.has(val));
        }
        this._spawnUngroupWorldPos = null;
    }

    // ── 布局 ──────────────────────────────────────────────

    /** groupMarker 挂在 overlay 上时，需与组世界坐标同步（每帧或 snap 后调用） */
    private _syncAllGroupMarkers(): void {
        for (const gv of this._groupViews.values()) {
            gv.syncMarkerLayout();
        }
    }

    /**
     * 计算并应用所有组 + UNGROUP 散牌的目标位置，使用 tween 平滑过渡。
     * 发牌后首次调用会使用 _dealReorderDur（更长），之后自动还原为 LAYOUT_DUR。
     *
     * 关键顺序：
     *   1. 预算总宽 → 定位容器（setPosition 或 tween）
     *   2. 应用拖拽释放起飞点（需在容器定位后，牌 tween 启动前）
     *   3. 启动各组容器 tween + 散牌 tween
     */
    private _doLayout(groups: readonly GroupData[], ungroup: readonly number[]): void {
        const dur = this._dealReorderDur;
        this._dealReorderDur = LAYOUT_DUR;

        // ── 1. 预算总宽度 ─────────────────────────────────────
        // 组的视觉宽度：组间有 GROUP_GAP，首尾不加（不含尾部间距）
        let totalW = 0;
        for (const g of groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            totalW += gv.width + GROUP_GAP;
        }
        if (groups.length > 0) totalW -= GROUP_GAP; // 去掉最后一组的尾部间距

        let ungroupStartX = 0;
        if (ungroup.length > 0) {
            if (groups.length > 0) totalW += GROUP_GAP; // 组区与散牌区之间的间距
            // 首张散牌中心 = 当前左边界 + 半牌宽，使散牌视觉区两侧对称
            ungroupStartX = totalW + this._layoutCardW() / 2;
            totalW += (ungroup.length - 1) * CARD_SPACING + this._layoutCardW();
        }
        this._ungroupStartX = ungroupStartX;

        const targetX = -totalW / 2;

        // ── 2. 容器定位（先于个体 tween，保证起飞点坐标转换正确）──
        const easeQuad = { easing: 'quadOut' as const };
        if (dur > LAYOUT_DUR) {
            // 展开动画：容器 tween；每帧同步 overlay 上的 groupMarker（与 _groupRoot 同轨，避免全程错位）
            const rootTweenOpts = {
                easing: 'quadOut' as const,
                onUpdate: () => { this._syncAllGroupMarkers(); },
            };
            tween(this._groupRoot)  .to(dur, { position: new Vec3(targetX, 0, 0) }, rootTweenOpts).start();
            tween(this._ungroupRoot).to(dur, { position: new Vec3(targetX, 0, 0) }, easeQuad).start();
            tween(this._dragLayer)  .to(dur, { position: new Vec3(targetX, 0, 0) }, easeQuad).start();
            tween(this._markerOverlayRoot).to(dur, { position: new Vec3(targetX, 0, 0) }, easeQuad).start();
        } else {
            this._groupRoot.setPosition(targetX, 0, 0);
            this._ungroupRoot.setPosition(targetX, 0, 0);
            this._dragLayer.setPosition(targetX, 0, 0);
            this._markerOverlayRoot.setPosition(targetX, 0, 0);
        }

        // ── 3. 应用拖拽释放起飞点（仅普通 layout，仅散牌目标）──
        if (this._spawnCardValue >= 0 && dur <= LAYOUT_DUR) {
            const spawnCn = this._ungroupNodes.get(this._spawnCardValue);
            if (spawnCn) {
                // 容器已就位，setWorldPosition 可正确转换到容器本地坐标
                spawnCn.node.setWorldPosition(this._spawnWorldPos3);
            }
            this._spawnCardValue = -1;
        }

        // ── 4. 各组容器 tween ─────────────────────────────────
        let curX = 0;
        for (const g of groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            const halfW = gv.width / 2;
            curX += halfW;
            // 每帧同步：容器与组 x 同时 tween 时，任一次更新后重算 overlay 世界坐标
            const gvOpts = {
                easing: 'quadOut' as const,
                onUpdate: () => { gv.syncMarkerLayout(); },
            };
            tween(gv.node)
                .to(dur, { position: new Vec3(curX, 0, 0) }, gvOpts)
                .start();
            curX += halfW + GROUP_GAP;
        }

        // ── 5. 散牌 tween ─────────────────────────────────────
        for (let i = 0; i < ungroup.length; i++) {
            const cn = this._ungroupNodes.get(ungroup[i]);
            if (!cn) continue;
            cn.tweenToX(ungroupStartX + i * CARD_SPACING, dur);
        }
    }

    // ── 工具 ──────────────────────────────────────────────

    /**
     * 停止所有组容器 / 散牌节点上正在运行的 tween，并将它们吸附到
     * _doLayout 最终目标位置。拖拽开始前调用，防止残留 tween 与
     * _containerTargets lerp 竞争，导致世界坐标补偿公式基准值错误。
     */
    private _snapAllToLayoutTargets(): void {
        const snap = this._state.snapshot();

        // 组容器：按与 _doLayout 完全相同的公式重算并 snap
        let curX = 0;
        for (const g of snap.groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            Tween.stopAllByTarget(gv.node);
            const halfW = gv.width / 2;
            curX += halfW;
            gv.node.setPosition(curX, 0, 0);
            curX += halfW + GROUP_GAP;

            // 组内卡牌：停止 tweenToX 等残留动画
            for (const cn of gv.cardNodes) Tween.stopAllByTarget(cn.node);
        }

        // root 节点：停止残留展开动画（发牌期间可能有 tween），snap 到 _doLayout 最终目标
        // 不 snap 则 _findDropTarget 中 groupRX 会取到中间值，导致坐标基准错误
        Tween.stopAllByTarget(this._groupRoot);
        Tween.stopAllByTarget(this._ungroupRoot);
        Tween.stopAllByTarget(this._dragLayer);
        Tween.stopAllByTarget(this._markerOverlayRoot);
        if (snap.groups.length > 0) curX -= GROUP_GAP; // 去掉最后一组尾部间距，与 _doLayout 一致
        let totalW = curX;
        if (snap.ungroup.length > 0) {
            if (snap.groups.length > 0) totalW += GROUP_GAP;
            totalW += (snap.ungroup.length - 1) * CARD_SPACING + this._layoutCardW();
        }
        const rootX = totalW > 0 ? -totalW / 2 : 0;
        this._groupRoot.setPosition(rootX, 0, 0);
        this._ungroupRoot.setPosition(rootX, 0, 0);
        this._dragLayer.setPosition(rootX, 0, 0);
        this._markerOverlayRoot.setPosition(rootX, 0, 0);

        // 散牌：停止 tweenToX 残留动画，并 snap 到 _ungroupStartX 基准
        for (const [val, cn] of this._ungroupNodes) {
            Tween.stopAllByTarget(cn.node);
            const idx = snap.ungroup.indexOf(val);
            if (idx >= 0) {
                cn.node.setPosition(
                    this._ungroupStartX + idx * CARD_SPACING,
                    cn.node.position.y,
                    0,
                );
            }
        }

        this._syncAllGroupMarkers();
    }

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
        tf.setContentSize(0, this._layoutCardH());
        return n;
    }

    /**
     * 当前手牌区用于布局的牌面宽（与 CardNode 根 UITransform 一致）。
     * 优先正在拖拽的浮层牌，其次散牌、组内首张；全无则默认。
     */
    private _layoutCardW(): number {
        if (this._drag?.floatNode?.isValid) {
            const cn = this._drag.floatNode.getComponent(CardNode);
            if (cn) return getCardContentSize(this._drag.floatNode).w;
        }
        for (const cn of this._ungroupNodes.values()) {
            return getCardContentSize(cn.node).w;
        }
        for (const gv of this._groupViews.values()) {
            const first = gv.cardNodes[0];
            if (first) return getCardContentSize(first.node).w;
        }
        return DEFAULT_CARD_W;
    }

    private _layoutCardH(): number {
        if (this._drag?.floatNode?.isValid) {
            const cn = this._drag.floatNode.getComponent(CardNode);
            if (cn) return getCardContentSize(this._drag.floatNode).h;
        }
        for (const cn of this._ungroupNodes.values()) {
            return getCardContentSize(cn.node).h;
        }
        for (const gv of this._groupViews.values()) {
            const first = gv.cardNodes[0];
            if (first) return getCardContentSize(first.node).h;
        }
        return DEFAULT_CARD_H;
    }

    /** 牌堆节点在本 panel 坐标系中的位置（发牌起点） */
    private _deckLocalPos(): Vec3 {
        const world = this.tableAreaView?.getDeckWorldPos() ?? this.node.getWorldPosition();
        const local = this._worldToLocal(world);
        // 若牌堆与 panel 重叠，强制偏移到上方作为起点
        const ch = this._layoutCardH();
        if (Math.abs(local.y) < ch) local.y = ch * 3;
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

        // ── 根容器归零，保持子节点世界坐标不变 ────────────────────────────
        // 无论 _doLayout 将根节点偏移到何处，合并动画始终收敛到 panel 中心（local 0,0）。
        // 发牌路径：根节点本就在原点，此处为无操作。
        // 摸牌路径：根节点已被 _doLayout 偏移，须先归零再收集。
        for (const root of [this._groupRoot, this._ungroupRoot, this._dragLayer, this._markerOverlayRoot]) {
            Tween.stopAllByTarget(root);
        }
        for (const root of [this._groupRoot, this._ungroupRoot]) {
            if (root.position.x !== 0 || root.position.y !== 0) {
                const worldPositions = [...root.children].map(c => c.getWorldPosition().clone());
                root.setPosition(0, 0, 0);
                [...root.children].forEach((c, i) => c.setWorldPosition(worldPositions[i]));
            }
        }
        this._dragLayer.setPosition(0, 0, 0);
        this._markerOverlayRoot.setPosition(0, 0, 0);

        // 隐藏所有组标记（合并期间不参与动画；展开后随新 CardGroupView 重建）
        for (const gv of this._groupViews.values()) {
            if (gv.groupMarker?.node) gv.groupMarker.node.active = false;
        }

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
        await delay(60);
        // 合并完成，展开前通知外部（ActionPanel 在此时机显示按钮）
        this.onDealMergeComplete?.();

        for (const gv of this._groupViews.values()) {
            gv.setMarkerOverlayParent(null);
        }

        // 清理状态映射（节点稍后统一销毁）
        this._ungroupNodes.clear();
        this._groupViews.clear();

        // 销毁动画节点
        for (const n of allNodes) { if (n.isValid) n.destroy(); }
        // 保险：清除容器残余
        this._ungroupRoot.removeAllChildren();
        this._groupRoot.removeAllChildren();
        this._dragLayer.removeAllChildren();
        this._markerOverlayRoot.removeAllChildren();
        this._ungroupRoot.setPosition(0, 0, 0);
        this._groupRoot.setPosition(0, 0, 0);
        this._dragLayer.setPosition(0, 0, 0);
        this._markerOverlayRoot.setPosition(0, 0, 0);



        // 触发展开（_doLayout 使用较长时长产生仪式感）
        // 发牌合并展开固定用 BY_RANK，不受玩家当前排序设置影响
        this._dealReorderDur = DEAL_REORDER_DUR;
        this._state.setCards(newCards, SortMode.BY_RANK);
    }

    private _worldToLocal(worldPos: Vec3): Vec3 {
        const tf = this.node.getComponent(UITransform);
        if (tf) return tf.convertToNodeSpaceAR(worldPos);
        const self = this.node.getWorldPosition();
        return new Vec3(worldPos.x - self.x, worldPos.y - self.y, 0);
    }

    // ── 拖拽 ──────────────────────────────────────────────

    private _bindCardDrag(cn: CardNode, kind: 'ungroup' | 'group', groupId?: string): void {
        cn.onDragStart = (val, uiPos) => this._onCardDragStart(cn, val, uiPos, kind, groupId);
        cn.onDragMove  = (uiPos)      => this._onCardDragMove(uiPos);
        cn.onDragEnd   = (uiPos)      => this._onCardDragEnd(uiPos);
    }


    private _onCardDragStart(
        cn: CardNode, cardValue: number, uiPos: Vec2,
        sourceKind: 'ungroup' | 'group', sourceGroupId?: string,
    ): void {
        if (this._drag) return;

        // ── 拖拽开始前捕获元数据（需在 removeCard 之前）────────────────
        // 来源下标（用于计算容器偏移）
        let sourceIndex = 0;
        if (sourceKind === 'group' && sourceGroupId) {
            const gv = this._groupViews.get(sourceGroupId);
            sourceIndex = gv?.groupData.cards.indexOf(cardValue) ?? 0;
        } else {
            sourceIndex = [...this._state.ungroup].indexOf(cardValue);
        }

        // 停止所有正在运行的布局 tween，并将容器与散牌节点吸附到最终目标位置。
        // 若 tween 中途被打断而不 snap，_origGroupLocalX 会捕捉到中间值，
        // 导致后续补偿 delta 错误（来源组卡牌世界坐标偏移）。
        this._snapAllToLayoutTargets();

        // 快照各组容器当前 local X（_applyPreviewLayout 中计算 delta 的基准）
        // snap 已保证此时 gv.node.position.x 等于最终布局目标，无需额外覆盖。
        this._origGroupLocalX.clear();
        this._groupContainerTargetX.clear();
        for (const [id, gv] of this._groupViews) {
            this._origGroupLocalX.set(id, gv.node.position.x);
            this._groupContainerTargetX.set(id, gv.node.position.x);
        }

        // ── 从映射中移除，避免 _applyPreviewLayout 重复处理 ─────────────
        if (sourceKind === 'ungroup') {
            this._ungroupNodes.delete(cardValue);
        } else if (sourceKind === 'group' && sourceGroupId) {
            this._groupViews.get(sourceGroupId)?.removeCard(cardValue);
        }

        // 挂到拖拽层（在 _groupRoot 之上、_markerOverlayRoot 之下，组标记盖住拖牌）
        const worldPos = cn.node.getWorldPosition();
        this._dragLayer.addChild(cn.node);
        cn.node.setWorldPosition(worldPos);

        this._drag = {
            cardValue,
            floatNode:    cn.node,
            sourceKind,
            sourceGroupId,
            sourceIndex,
            hoverKind:    null,
            hoverIndex:   0,
        };

        // 初始预览（仅关闭来源缺口，无悬停目标）
        this._applyPreviewLayout(null, null, 0);
    }

    private _onCardDragMove(uiPos: Vec2): void {
        const drag = this._drag;
        if (!drag) return;

        // 浮牌挂在 _dragLayer 上：用 Panel 本地坐标减去拖拽层位移，得到相对 _dragLayer 的本地坐标
        const pl = this._worldToLocal(new Vec3(uiPos.x, uiPos.y, 0));
        const dp = this._dragLayer.position;
        drag.floatNode.setPosition(pl.x - dp.x, pl.y - dp.y, 0);

        // 检测悬停目标（与 _findDropTarget 约定一致：Panel 本地 X）
        const { kind, groupId, index } = this._findDropTarget(pl.x);

        if (kind !== drag.hoverKind || groupId !== drag.hoverGroupId || index !== drag.hoverIndex) {
            drag.hoverKind    = kind;
            drag.hoverGroupId = groupId;
            drag.hoverIndex   = index;
            this._applyPreviewLayout(kind, groupId ?? null, index);
        }
    }

    private _onCardDragEnd(_uiPos: Vec2): void {
        const drag = this._drag;
        if (!drag) return;
        this._drag = null;

        // 记录释放点（世界坐标），供 _doLayout 设置新节点起飞位置
        drag.floatNode.getWorldPosition(this._spawnWorldPos3);
        this._spawnCardValue = drag.cardValue;

        const target = drag.hoverKind === 'group' && drag.hoverGroupId
            ? drag.hoverGroupId
            : 'ungroup';

        // 先提交状态（_onStateChange 同步创建新节点并设好起飞点）
        this._state.moveCard(drag.cardValue, target, drag.hoverIndex);

        // 清空 Lerp 目标表，停止 update() 差值驱动
        this._previewTargets.clear();
        this._containerTargets.clear();
        this._slotTargetWidths.clear();
        this._origGroupLocalX.clear();
        this._groupContainerTargetX.clear();

        // 再销毁 floatNode：新节点已就位，不会出现空白帧
        if (drag.floatNode.isValid) drag.floatNode.destroy();
    }

    /**
     * 根据拖拽牌的 panelLocalX，找出落点区域和插入位置。
     *
     * 核心原则：全程使用"稳定参考中心"（_origGroupLocalX + sourceDelta），
     * 不依赖 lerp 中的 gv.node.position.x，避免区段边界抖动和插位来回翻转。
     *
     *   稳定中心 = 来源组收缩后的中心（delta 公式保证非拖拽牌绝对坐标不变），
     *             非来源组保持原始中心。
     *   目标组的 targetDelta 不计入——其均值为 0，纳入反而引入循环依赖。
     *
     * 第一步：区段归属（中点分区）
     *   以各组稳定中心作为区段代表，相邻中点为分界线。
     *
     * 第二步：组内插位
     *   以稳定参考中心 + 原始 m 张布局计算各牌参考位置，找插入边界。
     *   （对边缘插入完全准确；中间插入误差 ≤ CARD_SPACING/2，视觉可接受）
     */
    private _findDropTarget(panelX: number): { kind: 'ungroup' | 'group'; groupId?: string; index: number } {
        const drag      = this._drag!;
        const cardValue = drag.cardValue;
        const groupRX   = this._groupRoot.position.x;
        const ungRX     = this._ungroupRoot.position.x;

        // ── 辅助：取各组容器的目标中心（_applyPreviewLayout 同步，稳定不受 lerp 影响）────
        const stableCenter = (id: string, gv: CardGroupView): number => {
            const targetX = this._groupContainerTargetX.get(id)
                         ?? this._origGroupLocalX.get(id)
                         ?? gv.node.position.x;
            return targetX + groupRX;
        };

        // ── 第一步：构建区段列表并按稳定中心排序 ────────────────────

        interface Zone {
            kind:      'ungroup' | 'group';
            groupId?:  string;
            refCenter: number; // 稳定中心 X（panel 坐标，不受 lerp 影响）
        }

        const zones: Zone[] = [];

        for (const [id, gv] of this._groupViews) {
            zones.push({ kind: 'group', groupId: id, refCenter: stableCenter(id, gv) });
        }

        const ungroupVals = [...this._state.ungroup].filter(c => c !== cardValue);
        // 使用 _previewUngroupStartX（_applyPreviewLayout 实时计算值），而非 _doLayout 缓存值
        const ungRefCenter = ungroupVals.length > 0
            ? ungRX + this._previewUngroupStartX + (ungroupVals.length - 1) / 2 * CARD_SPACING
            : ungRX + this._previewUngroupStartX;
        zones.push({ kind: 'ungroup', refCenter: ungRefCenter });

        zones.sort((a, b) => a.refCenter - b.refCenter);

        if (zones.length === 0) return { kind: 'ungroup', index: 0 };

        // 中点分界确定目标区段
        let zone = zones[0];
        for (let i = 0; i < zones.length - 1; i++) {
            const midX = (zones[i].refCenter + zones[i + 1].refCenter) / 2;
            if (panelX < midX) { zone = zones[i]; break; }
            zone = zones[i + 1];
        }

        // ── 第二步：在目标区段内确定插入位置 ─────────────────────────

        if (zone.kind === 'ungroup') {
            for (let i = 0; i < ungroupVals.length; i++) {
                const cardX = ungRX + this._previewUngroupStartX + i * CARD_SPACING;
                if (panelX < cardX + CARD_SPACING / 2) return { kind: 'ungroup', index: i };
            }
            return { kind: 'ungroup', index: ungroupVals.length };
        }

        // group 区段：以稳定参考中心 + 原始 m 张布局计算参考插位边界
        const id     = zone.groupId!;
        const gv     = this._groupViews.get(id)!;
        const gCards = gv.groupData.cards.filter(c => c !== cardValue);
        const refCX  = zone.refCenter; // 稳定参考中心，不受 lerp 影响

        for (let i = 0; i < gCards.length; i++) {
            const cardX = refCX + (i - (gCards.length - 1) / 2) * CARD_SPACING;
            if (panelX < cardX + CARD_SPACING / 2) return { kind: 'group', groupId: id, index: i };
        }
        return { kind: 'group', groupId: id, index: gCards.length };
    }

    /**
     * 仿照原版 calculateFullLayout + refreshAllTargets 的完整布局重算。
     *
     * 核心：用"虚拟槽位数"计算每组有效宽度，再从左到右累积容器中心 X。
     *   来源组：保留空槽（宽度不变），仅当牌离开到其他组/散牌区时才收缩。
     *   目标组：扩展一个空槽（宽度增加 CARD_SPACING）。
     *   由于来源收缩量 == 目标扩张量，总宽度始终守恒，root 节点 X 不变。
     */
    private _applyPreviewLayout(
        hoverKind:    'ungroup' | 'group' | null,
        hoverGroupId: string | null,
        hoverIndex:   number,
    ): void {
        const drag      = this._drag!;
        const cardValue = drag.cardValue;
        const snap      = this._state.snapshot();

        this._previewTargets.clear();
        this._containerTargets.clear();
        this._slotTargetWidths.clear();

        // ── 1. 各组虚拟槽位信息 ─────────────────────────────────────
        interface GSlot {
            id: string; gv: CardGroupView;
            realCards: number[];   // 不含拖拽牌的实际牌
            slotCount: number;     // 含虚拟空槽的布局总数
            width: number;         // 容器目标宽度
            keepNull: boolean;     // 来源组是否仍保留空槽（牌未离开时 true）
        }
        const gSlots: GSlot[] = [];

        for (const g of snap.groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            const realCards = g.cards.filter(c => c !== cardValue);
            const isSource  = drag.sourceKind === 'group' && drag.sourceGroupId === g.id;
            const isTarget  = hoverKind === 'group' && hoverGroupId === g.id;
            // 来源组仅在悬停自身（组内拖拽）或牌悬空（null）时保留空槽，
            // 跨组或拖到散牌区时收缩为实际剩余牌数宽度，与目标组扩展量相抵，总宽守恒。
            const keepNull  = isSource && (hoverKind === null || isTarget);
            // 仅跨组目标才扩展（组内拖拽时 isSource && isTarget，keepNull 已覆盖）
            const addSlot   = isTarget && !isSource;
            const slotCount = Math.max(1, realCards.length + (keepNull ? 1 : 0) + (addSlot ? 1 : 0));
            const width     = this._layoutCardW() + Math.max(0, slotCount - 1) * CARD_SPACING;
            gSlots.push({ id: g.id, gv, realCards, slotCount, width, keepNull });

            // 实时预览该组有效性：目标组加入拖拽牌后的类型；来源组移走拖拽牌后的类型
            const previewType: GroupType | null = isTarget
                ? judgeGroupType([...realCards, drag.cardValue])
                : isSource
                    ? judgeGroupType(realCards)
                    : null;
            gv.setPreviewType(previewType);
        }

        // 散牌区槽位数
        const ungroupVals      = snap.ungroup.filter(c => c !== cardValue);
        const ungIsSource      = drag.sourceKind === 'ungroup';
        const ungKeepNull      = ungIsSource && (hoverKind === null || hoverKind === 'ungroup');
        const ungAddSlot       = hoverKind === 'ungroup' && !ungIsSource;
        const ungSlotCount     = ungroupVals.length + (ungKeepNull ? 1 : 0) + (ungAddSlot ? 1 : 0);

        // ── 2. 各组容器中心 X（相对 _groupRoot，从 0 累积）─────────
        let curX = 0;
        for (const gs of gSlots) {
            const halfW = gs.width / 2;
            curX += halfW;
            this._containerTargets.set(gs.gv.node, curX);
            this._slotTargetWidths.set(gs.gv.node, gs.width);
            this._groupContainerTargetX.set(gs.id, curX);
            curX += halfW + GROUP_GAP;
        }

        // ── 3. 散牌起始 X（相对 _ungroupRoot，与 _doLayout 公式一致）──
        if (gSlots.length > 0) curX -= GROUP_GAP; // 去掉最后一组尾部间距
        let ungroupStartX = curX;
        if (ungSlotCount > 0) {
            if (gSlots.length > 0) ungroupStartX += GROUP_GAP; // 组区与散牌区间距
            ungroupStartX += this._layoutCardW() / 2;          // 首张牌中心偏移
        }
        this._previewUngroupStartX = ungroupStartX;

        // ── 3.5 重新居中：跨组拖拽时目标组扩展（+CARD_SPACING）使总宽增加，
        //         将两个 root 节点加入 _containerTargets，由 update() Lerp 驱动重新居中，
        //         消除跨组悬停时的整体漂移。
        let newTotalW = curX;
        if (ungSlotCount > 0) {
            if (gSlots.length > 0) newTotalW += GROUP_GAP;
            newTotalW += Math.max(0, ungSlotCount - 1) * CARD_SPACING + this._layoutCardW();
        }
        const newRootX = newTotalW > 0 ? -newTotalW / 2 : 0;
        this._containerTargets.set(this._groupRoot,   newRootX);
        this._containerTargets.set(this._ungroupRoot, newRootX);
        this._containerTargets.set(this._dragLayer,   newRootX);
        this._containerTargets.set(this._markerOverlayRoot, newRootX);

        // ── 4. 各组内牌坐标目标 ──────────────────────────────────
        for (const gs of gSlots) {
            const { id, gv, realCards, slotCount, keepNull } = gs;
            const isTarget = hoverKind === 'group' && hoverGroupId === id;
            const isSource = drag.sourceKind === 'group' && drag.sourceGroupId === id;

            for (let j = 0; j < realCards.length; j++) {
                const cn = gv.cardNodes.find(c => c.cardValue === realCards[j]);
                if (!cn) continue;

                let slotIdx = j;
                if (isTarget) {
                    // 目标组：空槽跟随 hoverIndex
                    if (j >= hoverIndex) slotIdx = j + 1;
                } else if (isSource && keepNull) {
                    // 来源组悬停自身或悬空：空槽保留在 sourceIndex
                    if (j >= drag.sourceIndex) slotIdx = j + 1;
                }
                // isSource && !keepNull（跨组/到散牌）：slotIdx = j，牌紧凑居中排列
                this._previewTargets.set(cn, (slotIdx - (slotCount - 1) / 2) * CARD_SPACING);
            }
        }

        // ── 5. 散牌坐标目标 ────────────────────────────────────────
        for (let i = 0; i < ungroupVals.length; i++) {
            const cn = this._ungroupNodes.get(ungroupVals[i]);
            if (!cn) continue;
            let slotIdx = i;
            if (hoverKind === 'ungroup') {
                if (i >= hoverIndex) slotIdx = i + 1;
            } else if (ungIsSource && ungKeepNull) {
                // 来源在散牌区且牌未离开：保留空槽在 sourceIndex 位置
                if (i >= drag.sourceIndex) slotIdx = i + 1;
            }
            // ungIsSource && !ungKeepNull：牌已离开散牌区，ungroupStartX 已随目标组扩展
            // 右移，slotIdx 不加 1，避免双重偏移
            this._previewTargets.set(cn, ungroupStartX + slotIdx * CARD_SPACING);
        }
    }
}
