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
    UITransform, Vec2, Vec3, tween,
} from 'cc';
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
import { autoGroup, GroupData }                           from '../../utils/GroupAlgorithm';
import { SortMode }                                      from '../../utils/CardDef';
import { CardGroupView }                                 from './CardGroupView';
import { CardNode, CARD_W, CARD_H, CARD_SPACING }         from './CardNode';

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
const GROUP_GAP          = 48;
/** 布局重排动画时长（正常交互） */
const LAYOUT_DUR         = 0.14;
/**
 * 拖拽预览 Lerp 平滑系数（指数差值）
 * factor = 1 - pow(LERP_SMOOTHING, dt)
 * 值越小越柔和：0.0001 ≈ 0.25s 到位，0.00001 ≈ 0.4s 到位
 */
const LERP_SMOOTHING = 0.00001;
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

    /**
     * 选中状态变化时的统一出口（每次状态变化都触发）
     * ActionPanel / TongitsView 通过此回调决定按钮显示
     */
    onSelectionChange: ((info: SelectionInfo) => void) | null = null;

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

    /** 拖拽状态（null = 无拖拽） */
    private _drag: DragState | null = null;
    /** Lerp 预览目标：CardNode → 目标 X（在各自父容器坐标系中） */
    private _previewTargets = new Map<CardNode, number>();
    /** Lerp 容器目标：gv.node → 目标 local X（在 _groupRoot 坐标系中） */
    private _containerTargets = new Map<Node, number>();
    /** 拖拽开始时各组容器的 local X（_groupRoot 坐标系），用于计算 delta */
    private _origGroupLocalX  = new Map<string, number>();
    /** 散牌区第一张牌在 _ungroupRoot 坐标系中的 X（_doLayout 中缓存，供预览逻辑使用） */
    private _ungroupStartX = 0;
    /** 拖拽释放时 floatNode 的世界坐标（新节点起飞点），-1 表示无待处理 */
    private _spawnCardValue  = -1;
    private _spawnWorldPos3  = new Vec3();

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

    /**
     * 拖拽预览 Lerp 驱动：每帧将各牌的当前 X 差值趋近目标 X。
     * 仅在拖拽进行时运行，无拖拽时零开销。
     */
    update(dt: number): void {
        if (!this._drag) return;
        // 指数差值系数：帧率无关
        const factor = 1 - Math.pow(LERP_SMOOTHING, dt);
        // 驱动各牌的 local X
        for (const [cn, targetX] of this._previewTargets) {
            if (!cn.node.isValid) continue;
            const pos  = cn.node.position;
            const newX = pos.x + (targetX - pos.x) * factor;
            cn.node.setPosition(newX, pos.y, 0);
        }
        // 驱动组容器的 local X（跨组拖拽时容器展宽/收缩）
        for (const [node, targetX] of this._containerTargets) {
            if (!node.isValid) continue;
            const pos  = node.position;
            const newX = pos.x + (targetX - pos.x) * factor;
            node.setPosition(newX, pos.y, 0);
        }
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
                // 按数组顺序设置 sibling index，保证叠牌 Z 序正确
                n.setSiblingIndex(ungroup.indexOf(val));
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
        let totalW = 0;
        for (const g of groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            totalW += gv.width + GROUP_GAP;
        }
        let ungroupStartX = totalW;
        if (ungroup.length > 0) {
            if (groups.length > 0) totalW += GROUP_GAP;
            ungroupStartX = totalW;
            totalW += (ungroup.length - 1) * CARD_SPACING + CARD_W;
        }
        this._ungroupStartX = ungroupStartX;

        const targetX = -totalW / 2;

        // ── 2. 容器定位（先于个体 tween，保证起飞点坐标转换正确）──
        if (dur > LAYOUT_DUR) {
            // 展开动画：容器从中心 tween 展开
            tween(this._groupRoot)  .to(dur, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' }).start();
            tween(this._ungroupRoot).to(dur, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' }).start();
        } else {
            this._groupRoot.setPosition(targetX, 0, 0);
            this._ungroupRoot.setPosition(targetX, 0, 0);
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
            tween(gv.node)
                .to(dur, { position: new Vec3(curX, 0, 0) }, { easing: 'quadOut' })
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

        // 快照各组容器当前 local X（_applyPreviewLayout 中计算 delta 的基准）
        this._origGroupLocalX.clear();
        for (const [id, gv] of this._groupViews) {
            this._origGroupLocalX.set(id, gv.node.position.x);
        }

        // ── 从映射中移除，避免 _applyPreviewLayout 重复处理 ─────────────
        if (sourceKind === 'ungroup') {
            this._ungroupNodes.delete(cardValue);
        } else if (sourceKind === 'group' && sourceGroupId) {
            this._groupViews.get(sourceGroupId)?.removeCard(cardValue);
        }

        // 将牌节点重挂到 panel 顶层（维持世界坐标）
        const worldPos = cn.node.getWorldPosition();
        this.node.addChild(cn.node);
        cn.node.setWorldPosition(worldPos);
        cn.node.setSiblingIndex(this.node.children.length - 1);

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

        // 移动 floatNode 跟随手指
        const local = this._worldToLocal(new Vec3(uiPos.x, uiPos.y, 0));
        drag.floatNode.setPosition(local.x, local.y, 0);

        // 检测悬停目标
        const { kind, groupId, index } = this._findDropTarget(local.x);

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
        this._origGroupLocalX.clear();

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

        // ── 辅助：计算某组的稳定参考中心（panel 坐标）────────────────

        const stableCenter = (id: string, gv: import('./CardGroupView').CardGroupView): number => {
            const origX = this._origGroupLocalX.get(id) ?? gv.node.position.x;
            let delta = 0;
            if (drag.sourceGroupId === id) {
                const n = gv.groupData.cards.length; // 含被拖拽牌的原始总数
                if (n > 1) {
                    delta -= ((drag.sourceIndex - (n - 1) / 2) / (n - 1)) * CARD_SPACING;
                }
            }
            return origX + delta + groupRX;
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
        const ungRefCenter = ungroupVals.length > 0
            ? ungRX + this._ungroupStartX + (ungroupVals.length - 1) / 2 * CARD_SPACING
            : ungRX + this._ungroupStartX;
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
                const cardX = ungRX + this._ungroupStartX + i * CARD_SPACING;
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
     * 更新 Lerp 预览目标表：重算所有散牌和组内牌的目标 X，以及各组容器的目标 local X。
     * 实际位移由 update() 每帧驱动，天然平滑、无 tween 打断问题。
     * hoverKind=null 时仅收拢来源空缺，不打开目标空缺。
     *
     * 容器偏移推导（加权平均法，保证边缘插入/删除时非拖拽牌绝对位置不变）：
     *   - 来源组（从 n 张移出第 k 张）：delta = -((k - (n-1)/2) / (n-1)) * CARD_SPACING
     *   - 目标组（向 m 张中 hoverIndex h 处插入）：delta = ((2h - m) / (2m)) * CARD_SPACING
     *   两项对同一组叠加（支持组内拖拽自然抵消）。
     */
    private _applyPreviewLayout(
        hoverKind:    'ungroup' | 'group' | null,
        hoverGroupId: string | null,
        hoverIndex:   number,
    ): void {
        const drag      = this._drag!;
        const cardValue = drag.cardValue;

        this._previewTargets.clear();
        this._containerTargets.clear();

        // ── 散牌区 ──
        const ungroupVals = [...this._state.ungroup].filter(c => c !== cardValue);
        for (let i = 0; i < ungroupVals.length; i++) {
            const cn = this._ungroupNodes.get(ungroupVals[i]);
            if (!cn) continue;
            const displayI = (hoverKind === 'ungroup' && i >= hoverIndex) ? i + 1 : i;
            this._previewTargets.set(cn, this._ungroupStartX + displayI * CARD_SPACING);
        }

        // ── 各组（牌位置 + 容器位置）──
        for (const [id, gv] of this._groupViews) {
            const allCards = gv.groupData.cards;           // 原始牌列（含被拖拽牌）
            const gCards   = allCards.filter(c => c !== cardValue);
            const isTarget = hoverKind === 'group' && hoverGroupId === id;
            const total    = isTarget ? gCards.length + 1 : gCards.length;

            // ── 牌的 local X 目标 ──
            for (let i = 0; i < gCards.length; i++) {
                const cn = gv.cardNodes.find(c => c.cardValue === gCards[i]);
                if (!cn) continue;
                const displayI = (isTarget && i >= hoverIndex) ? i + 1 : i;
                this._previewTargets.set(cn, (displayI - (total - 1) / 2) * CARD_SPACING);
            }

            // ── 容器 local X 目标 ──
            const origX = this._origGroupLocalX.get(id) ?? gv.node.position.x;
            let delta = 0;

            // 来源组贡献：移出第 k 张，共 n 张
            if (drag.sourceGroupId === id) {
                const n = allCards.length;      // 原始总数（含被拖拽牌）
                if (n > 1) {
                    const k = drag.sourceIndex;
                    delta -= ((k - (n - 1) / 2) / (n - 1)) * CARD_SPACING;
                }
            }

            // 目标组贡献：向 m 张中 hoverIndex h 处插入
            if (isTarget) {
                const m = gCards.length;        // 不含拖拽牌的现有张数
                if (m > 0) {
                    delta += ((2 * hoverIndex - m) / (2 * m)) * CARD_SPACING;
                }
            }

            this._containerTargets.set(gv.node, origX + delta);
        }
    }
}
