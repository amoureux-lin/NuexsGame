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
    UITransform, Vec2, Vec3, tween, Tween, Button, Label,
} from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { TableAreaView } from '../panel/TableAreaView';
import { HandCardState, ButtonStates, HandCardSnapshot, type ServerCards } from '../../../utils/HandCardState';
import { TongitsEvents } from '../../../config/TongitsEvents';

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
import { autoGroup, GroupData, judgeGroupType, GroupType } from '../../../utils/GroupAlgorithm';
import { SortMode, calcPoint }                           from '../../../utils/CardDef';
import { CardGroupView }                                 from './CardGroupView';
import { CardNode, DEFAULT_CARD_W, DEFAULT_CARD_H, CARD_SPACING, getCardContentSize } from './CardNode';

const { ccclass, property } = _decorator;

// ── 动画 ceremony 任务 ─────────────────────────────────────
//
// 设计：所有"会改变手牌可视集合"的 API（addCard / refreshWithServerGroupsAnimated /
// dealCards 等）都把 ceremony 入队，由 _runWorker 串行播放。期间 _renderLock 屏蔽
// _onStateChange 的响应式渲染——状态本身已立刻 commit 到 _state，只是渲染按 ceremony
// 节奏走，避免后续广播的 state 变更被动画路径覆盖。
//
// 每个 task 携带 fromSnap（ceremony 开始时视觉状态）+ toSnap（ceremony 结束时视觉状态）。
// fromSnap 在 API 入口、commit 之前抓取——等价于"上次 ceremony 完成时的视觉"，
// 因为 worker 严格 await 每个 ceremony，且每个 ceremony 末尾把视觉对齐到 toSnap。

type AnimTaskBody =
    | { kind: 'merge-expand'; fromSnap: HandCardSnapshot; toSnap: HandCardSnapshot; drawnCard?: number }
    | { kind: 'drop-only';    fromSnap: HandCardSnapshot; toSnap: HandCardSnapshot; drawnCard: number };

interface AnimTask {
    body: AnimTaskBody;
    /** ceremony 完成时 resolve；调用方需要 await 时使用 */
    done: () => void;
}

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
const FLY_DUR            = 0.2;
/** 发牌每张间隔（ms） */
const DEAL_INTERVAL      = 45;
/** 弹跳单步时长 */
const BOUNCE_STEP        = 0.12;

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

    @property({ type: Button, tooltip: '自动排序"关闭"状态按钮（autoSort=OFF 时显示）' })
    autoSortBtn: Button | null = null;

    @property({ type: Button, tooltip: '自动排序"开启"状态按钮（autoSort=ON 时显示）' })
    autoSortActiveNode: Button | null = null;

    @property({ type: Button, tooltip: '排序规则切换按钮（按点数 ↔ 按花色）' })
    sortModeBtn: Button | null = null;

    @property({ type: Label, tooltip: '排序规则文字标签（显示当前规则）' })
    sortModeLabelNode: Label | null = null;

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

    /** 手牌分组结构被本地修改后触发，由 TongitsView 同步给服务端。 */
    onGroupsChange: ((groups: ServerCards[]) => void) | null = null;

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
    /** 一次性"瞬时布局"标记：showCards 时设为 true，下次 _doLayout 全部 setPosition 不走 tween */
    private _instantLayout: boolean = false;
    /** 观战模式：手牌全程拍背、不分组、排序按钮隐藏、交互禁用 */
    private _spectatorMode: boolean = false;
    // ── Ceremony 队列 / Render Lock（数据驱动渲染分层 / C 方案） ─
    /**
     * Ceremony 任务队列。
     * API 入口（addCard / dealCards / refreshWithServerGroupsAnimated）入队，
     * _runWorker 串行 pop 播放。
     */
    private _animQueue: AnimTask[] = [];
    /** worker 是否运行中，防止重复启动 */
    private _workerRunning = false;
    /**
     * Render Lock：true 时 _onStateChange 不立刻渲染，只缓存最新 snap。
     * worker 在播 ceremony 期间持锁，ceremony 结束 / worker 收尾时按需统一渲染。
     */
    private _renderLock = false;
    /** Lock 期间最新一次的 state snap，worker 收尾时拿来兜底渲染 */
    private _latestSnap: HandCardSnapshot | null = null;
    /** Lock 期间是否产生过 state 变更（区分"无变化"和"已用 _latestSnap 渲染"） */
    private _renderDirty = false;

    // ── 补牌提示 ──────────────────────────────────────────
    /** 当前有效的补牌提示集合，merge-expand 后自动恢复 */
    private _layoffTipsSet: Set<number> | null = null;

    // ── 吃牌模式 ──────────────────────────────────────────
    private _inTakeMode          = false;
    private _takeCandidates:     number[][] = [];
    private _selectedCandidateIdx            = 0;

    /** 拖拽状态（null = 无拖拽） */
    private _drag: DragState | null = null;
    /** 是否允许拖拽（Tongits 请求返回或结算通知后置 false） */
    private _dragEnabled = true;
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
    private _sapawCardValue  = -1;
    private _sapawWorldPos3  = new Vec3();
    /** createGroup 时选中牌的世界坐标中心（供新组起始位置使用） */
    private _sapawGroupWorldPos: Vec3 | null = null;
    /** dissolveGroup 时被解散组的世界坐标（供散牌起始位置使用） */
    private _sapawUngroupWorldPos: Vec3 | null = null;

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

        this.autoSortBtn?.node.on(Button.EventType.CLICK, this._onAutoSortClick, this);
        this.autoSortActiveNode?.node.on(Button.EventType.CLICK, this._onAutoSortClick, this);
        this.sortModeBtn?.node.on(Button.EventType.CLICK, this._onSortModeClick, this);

        // 初始化按钮视觉状态
        this._refreshSortButtons(this._state.snapshot());
    }

    onDestroy(): void {
        this.autoSortBtn?.node.off(Button.EventType.CLICK, this._onAutoSortClick, this);
        this.autoSortActiveNode?.node.off(Button.EventType.CLICK, this._onAutoSortClick, this);
        this.sortModeBtn?.node.off(Button.EventType.CLICK, this._onSortModeClick, this);
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
    async dealCards(handCardCount: number, handCards?: number[], deckCardCount = 0, oneCallback?: Function, serverGroups?: ServerCards[]): Promise<void> {
        this.clear();
        if (handCardCount <= 0) return;

        // 没传 handCards 或 length 不匹配 → 全程拍背 + 跳过合并展开
        const faceDown = !handCards || handCards.length !== handCardCount;

        const spreadXs = this._spreadPositions(handCardCount);

        // ── Phase 1: 在 sendCardNode 下建发牌堆，一次性 re-parent 到 _ungroupRoot ──
        this.tableAreaView?.setupSendDeck(handCardCount);
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

        const lastIdx = handCardCount - 1;

        // ── Phase 2 & 3: 错时飞入（parallel：位移 + 缩放旋转同步）→ 落地弹跳 ──
        await Promise.all(Array.from({ length: handCardCount }, (_, i) =>
            delay(i * DEAL_INTERVAL).then(() => new Promise<void>(resolve => {
                // 最后一张起飞时重建剩余牌堆
                if (i === lastIdx) this.tableAreaView?.setupDeck(deckCardCount);

                const n  = nodes[i];
                const cn = cns[i];

                // 按牌序偏转：中间牌垂直，两侧逐渐倾斜，形成扇形叠牌感
                const rotZ = (i - (handCardCount - 1) / 2) * 2;

                n.setSiblingIndex(handCardCount - 1); // 飞行期间置顶
                if (oneCallback) oneCallback();
                tween(n)
                    // 初始：微缩 + 扇形旋转（从牌堆起飞姿态）
                    .set({ scale: new Vec3(0.68, 0.68, 1), eulerAngles: new Vec3(0, 0, rotZ) })
                    // 飞行阶段：位移与缩放/旋转并行
                    .parallel(
                        // 位移：飞到展开位，到位后立刻翻正面（拍背模式跳过）
                        tween(n)
                            .to(FLY_DUR, { position: new Vec3(spreadXs[i], 0, 0) }, { easing: 'sineOut' })
                            .call(() => {
                                if (!faceDown) {
                                    cn.setCard(handCards![i]); // 翻面前设牌值
                                    cn.setFaceDown(false);
                                }
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

        // ── Phase 4: 合并 → 按组重排展开（拍背模式跳过：不分组、不进 _state） ──
        if (!faceDown) {
            // dealCards 是初始化场景：清空队列后独占播放 ceremony
            this._flushCeremonyQueue();
            const fromSnap = this._state.snapshot();
            this._renderLock = true;
            if (serverGroups !== undefined) {
                this._state.setCardsWithServerGroups(serverGroups);
            } else {
                // 不强制 override，使用 _state 当前的 sortMode（默认 BY_RANK，玩家可切换）
                this._state.setCards(handCards!);
            }
            const toSnap = this._state.snapshot();
            await this._enqueueCeremony({ kind: 'merge-expand', fromSnap, toSnap });
        } else {
            // 拍背模式没有合并展开，但仍要触发回调通知发牌结束（外部 _ts.isDealing 复位等）
            this.onDealMergeComplete?.();
        }
    }

    /**
     * 立即显示手牌（无动画），重连 / 中途加入时调用。
     *
     * @param handCardCount 手牌张数
     * @param handCards     可选：牌值（缺省/length 不匹配 → 全程拍背、不进 _state）
     * @param serverGroups  可选：服务端分组数据，传入则按服务端分组初始化，不走本地 autoGroup
     */
    showCards(handCardCount: number, handCards?: number[], serverGroups?: ServerCards[]): void {
        this.clear();
        if (handCardCount <= 0) return;

        const faceDown = !handCards || handCards.length !== handCardCount;
        if (faceDown) {
            // 拍背：直接在 _ungroupRoot 建 N 个拍背 CardNode，平铺布局，不走 _state/_doLayout
            const xs = this._spreadPositions(handCardCount);
            for (let i = 0; i < handCardCount; i++) {
                const n  = this._createCardNode(0);
                const cn = n.getComponent(CardNode)!;
                cn.setFaceDown(true);
                cn.onClick = null;
                n.setPosition(xs[i], 0, 0);
                this._ungroupRoot.addChild(n);
            }
            return;
        }
        this._instantLayout = true;
        if (serverGroups !== undefined) {
            this._prepareForAuthoritativeServerLayout();
            this._state.setCardsWithServerGroups(serverGroups);
        } else {
            this._state.setCards(handCards!);
        }
    }

    /**
     * 摸牌：加入一张牌（State-first / C 方案）
     *
     * 流程：
     *   1. 抓 fromSnap = 当前视觉 snap（ceremony 开始时的视觉状态）
     *   2. _renderLock=true 后立刻 commit 新状态到 _state
     *      （_onStateChange 被 lock 屏蔽，不立即渲染；外部状态查询已是新真相）
     *   3. 入队 ceremony，worker 串行播放 drop / merge / expand
     *
     * 选 ceremony 类型（以本地 autoGroup 为准）：
     *     autoGroup ON  → merge-expand（应用 serverGroups 或本地 autoGroup 后展开）
     *     autoGroup OFF → drop-only（忽略 serverGroups，仅下落追加到散牌区，
     *                                保留玩家手动分组结构）
     *
     * @param card         摸到的牌值
     * @param serverGroups 服务端下发的分组数据；autoGroup OFF 时被忽略
     */
    addCard(card: number, serverGroups?: ServerCards[]): void {
        if (this._spectatorMode) return;
        if (serverGroups !== undefined) {
            this._prepareForAuthoritativeServerLayout();
        }

        const fromSnap = this._state.snapshot();
        // ── 抓 lock + commit 状态（_onStateChange 此时被 lock 拦截，不立即渲染） ──
        this._renderLock = true;
        this._state.clearSelection();  // 摸牌进入 ACTION 阶段，清 SELECT 残留

        // autoGroup OFF：忽略 serverGroups，简单追加到散牌区（不破坏手动分组），走 drop-only。
        // 服务端在 autoGroup OFF 时仍会下发 groupCards，但应当被客户端忽略——
        // 用户已明确表达不要客户端自动重排手牌。
        if (!fromSnap.autoGroupEnabled) {
            this._state.addCard(card);
            const toSnap = this._state.snapshot();
            this._enqueueCeremony({ kind: 'drop-only', fromSnap, toSnap, drawnCard: card });
            return;
        }

        // autoGroup ON：优先服务端分组，否则本地 autoGroup
        if (serverGroups !== undefined) {
            this._state.setCardsWithServerGroups(serverGroups);
        } else {
            const allCards = [
                ...fromSnap.ungroup,
                ...fromSnap.groups.reduce<number[]>((a, g) => a.concat(g.cards), []),
                card,
            ];
            // 不强制 override，使用 _state 当前的 sortMode
            this._state.setCards(allCards);
        }
        const toSnap = this._state.snapshot();
        this._enqueueCeremony({ kind: 'merge-expand', fromSnap, toSnap, drawnCard: card });
    }

    /**
     * 使用服务端分组数据刷新手牌（无动画），用于关闭 autoGroup / ActionChange / 组牌响应等时机。
     * 仅当有有效 serverGroups 时生效，否则不做任何操作。
     */
    refreshWithServerGroups(serverGroups: ServerCards[]): void {
        if (!serverGroups) return;
        this._prepareForAuthoritativeServerLayout();
        this._instantLayout = true;
        this._state.setCardsWithServerGroups(serverGroups);
    }

    /**
     * 使用服务端分组数据刷新手牌（带合并展开动画），用于开启 autoGroup / 手动组牌响应等。
     * State-first：立刻 commit 状态 + 入队 merge-expand ceremony（无 drawnCard）。
     * 返回 Promise，调用方需要等动画完成时 await。
     */
    refreshWithServerGroupsAnimated(serverGroups: ServerCards[]): Promise<void> {
        if (!serverGroups || serverGroups.length === 0) {
            this.refreshWithServerGroups(serverGroups);
            return Promise.resolve();
        }
        this._prepareForAuthoritativeServerLayout();
        const fromSnap = this._state.snapshot();
        this._renderLock = true;
        this._state.setCardsWithServerGroups(serverGroups);
        const toSnap = this._state.snapshot();
        return this._enqueueCeremony({ kind: 'merge-expand', fromSnap, toSnap });
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
     * 弃牌 / 出牌：从 UNGROUP 区移除一张牌
     */
    removeCard(card: number): void {
        if (this._spectatorMode) return;
        // 若被移除的牌正在拖拽中（如服务端代操作打了这张）→ 先取消拖拽
        if (this._drag?.cardValue === card) this.cancelDrag();
        this._state.removeCard(card);
    }

    /**
     * 清空所有手牌（游戏结束 / 房间重置）
     */
    clear(): void {
        // 重置场景：丢弃任何残留 ceremony，避免 worker 在清空后继续操作已销毁节点
        this._flushCeremonyQueue();
        this._state.clear();
        this._groupRoot?.setPosition(0, 0, 0);
        this._ungroupRoot?.setPosition(0, 0, 0);
        this._dragLayer?.setPosition(0, 0, 0);
        this._markerOverlayRoot?.setPosition(0, 0, 0);
        this._ungroupRoot?.removeAllChildren();
        this._dragLayer?.removeAllChildren();
        this._markerOverlayRoot?.removeAllChildren();
        for (const gv of this._groupViews.values()) {
            gv.setMarkerOverlayParent(null);
            gv.node?.destroy();
        }
        this._groupViews?.clear();
        for (const cn of this._ungroupNodes.values()) cn.node.destroy();
        this._ungroupNodes?.clear();
    }

    // ── 按钮操作入口（ActionPanel 调用） ─────────────────

    onGroupBtn(): void {
        // 捕获所有选中节点的世界坐标中心，作为新组的起飞点
        const snap = this._state.snapshot();
        if (!snap.buttonStates.canGroup) return;
        let sumX = 0, sumY = 0, count = 0;
        for (const gId of snap.selectedGroupIds) {
            const gv = this._groupViews.get(gId);
            if (gv) { const wp = gv.node.getWorldPosition(); sumX += wp.x; sumY += wp.y; count++; }
        }
        for (const val of snap.selectedUngroupCards) {
            const cn = this._ungroupNodes.get(val);
            if (cn) { const wp = cn.node.getWorldPosition(); sumX += wp.x; sumY += wp.y; count++; }
        }
        if (count > 0) this._sapawGroupWorldPos = new Vec3(sumX / count, sumY / count, 0);
        // createGroup 内部已调用 _clearSelSilent，选中随之清除
        this._state.createGroup();
        this._emitGroupsChange();
    }

    onUngroupBtn(): void {
        // 捕获被解散组的世界坐标，作为散牌节点的起飞点
        const snap = this._state.snapshot();
        if (!snap.buttonStates.canUngroup) return;
        const [gId] = Array.from(snap.selectedGroupIds);
        if (gId) {
            const gv = this._groupViews.get(gId);
            if (gv) this._sapawUngroupWorldPos = gv.node.getWorldPosition().clone();
        }
        // dissolveGroup 内部已调用 _clearSelSilent，选中随之清除
        this._state.dissolveGroup();
        this._emitGroupsChange();
    }

    /**
     * Drop 按钮：只返回被 Drop 的 GroupData（供 TongitsView 发送服务端请求）。
     * 成功响应后再由 TongitsView 调用 removeTakeCards() 移除，避免请求失败时 UI 少牌。
     */
    onDropBtn(): GroupData | null {
        const snap = this._state.snapshot();
        if (snap.selectedGroupIds.size !== 1 || snap.selectedUngroupCards.size !== 0) return null;
        const id = Array.from(snap.selectedGroupIds)[0];
        const group = snap.groups.find(g => g.id === id);
        if (!group) return null;
        if (group.type !== GroupType.VALID && group.type !== GroupType.SPECIAL) return null;
        return group;
    }

    /**
     * Dump 按钮：只返回被弃的牌值，成功响应后再移除。
     */
    onDumpBtn(): number | null {
        const card = this._state.snapshot().buttonStates.selectedSingleCard;
        if (card == null) return null;
        return card;
    }

    onToggleAutoGroup(): void  { this._state.toggleAutoGroup(); }
    onToggleSortMode():  void  { this._state.toggleSortMode();  }

    /** 由服务端响应设置 autoGroup 开关状态 */
    setAutoGroupEnabled(v: boolean): void { this._state.setAutoGroupEnabled(v); }

    // ── 吃牌模式 API ──────────────────────────────────────

    /**
     * 进入吃牌选择模式。
     * @param candidates 候选组列表（每项为手牌子集，按分值降序），由 MeldValidator 计算。
     *                   第 0 项为默认选中（分值最高）。
     */
    enterTakeMode(candidates: number[][]): void {
        if (candidates.length === 0) return;
        // 进入吃牌模式前清除普通选中，避免与吃牌高亮叠加
        this._state.clearSelection();
        this._inTakeMode           = true;
        this._takeCandidates       = candidates;
        this._selectedCandidateIdx = 0;
        // 接管牌组点击，用于切换候选组
        for (const [, gv] of this._groupViews) {
            gv.onGroupClick = (id) => { if (this._dragEnabled) this._onTakeModeGroupClick(id); };
        }
        this._refreshTakeHighlight();
    }

    /** 退出吃牌模式，清除所有高亮 / 遮罩 */
    exitTakeMode(): void {
        if (!this._inTakeMode) return;
        this._inTakeMode     = false;
        this._takeCandidates = [];
        // 恢复牌组点击
        for (const [, gv] of this._groupViews) {
            gv.onGroupClick = (id) => { if (this._dragEnabled) this._state.toggleGroup(id); };
        }
        this._clearTakeHighlight();
        // _clearTakeHighlight 只清视觉，_state 层的选中也一并清除
        this._state.clearSelection();
    }

    /** 返回当前选中候选组的手牌值列表（供 TongitsView 发请求时使用） */
    getSelectedTakeCards(): number[] {
        if (!this._inTakeMode || this._takeCandidates.length === 0) return [];
        return this._takeCandidates[this._selectedCandidateIdx] ?? [];
    }

    /** 返回散牌区所有牌值（供吃牌候选计算） */
    getUngroupCards(): number[] {
        return [...this._state.snapshot().ungroup];
    }

    /** 返回全部手牌值（散牌 + 牌组内的牌），供吃牌候选计算使用 */
    getAllHandCards(): number[] {
        const snap = this._state.snapshot();
        const all: number[] = [...snap.ungroup];
        for (const g of snap.groups) all.push(...g.cards);
        return all;
    }

    /** 导出当前手牌分组为服务端 Cards[] 结构，用于手动组牌同步。 */
    getServerGroups(): ServerCards[] {
        const snap = this._state.snapshot();
        const result: ServerCards[] = [];
        if (snap.ungroup.length > 0) {
            result.push({
                groupId: 0,
                handCards: [...snap.ungroup],
                cardType: 0,
                cardPoint: calcPoint([...snap.ungroup]),
            });
        }
        let groupId = 1;
        for (const group of snap.groups) {
            result.push({
                groupId: groupId++,
                handCards: [...group.cards],
                cardType: this._toServerCardType(group.type),
                cardPoint: calcPoint([...group.cards]),
            });
        }
        return result;
    }

    private _emitGroupsChange(): void {
        if (this._spectatorMode) return;
        this.onGroupsChange?.(this.getServerGroups());
    }

    /**
     * 吃牌确认后批量移除手牌（支持散牌与牌组）。
     * 牌组处理规则：剩 0 张删组；剩 1 张解散到散牌；剩 2+ 张保留。
     */
    removeTakeCards(cards: number[]): void {
        if (this._spectatorMode) return;
        // 若拖拽中的牌在批量移除集合内 → 先取消拖拽
        if (this._drag && cards.includes(this._drag.cardValue)) this.cancelDrag();
        this._state.removeTakeCards(cards);
    }

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

    /**
     * 启用 / 禁用手牌拖拽。
     * Tongits 请求返回后、结算通知到达后由 TongitsView 调用 setDragEnabled(false)。
     */
    setDragEnabled(enabled: boolean): void {
        this._dragEnabled = enabled;
    }

    /**
     * 强制中断当前拖拽（服务端代操作 / 倒计时结束 / 离开自己回合等场景）。
     * 销毁浮牌节点，清空拖拽状态，再按 _state 重新同步 UI。
     * 若 _drag 为空则无副作用。
     */
    cancelDrag(): void {
        if (!this._drag) return;
        if (this._drag.floatNode?.isValid) this._drag.floatNode.destroy();
        this._drag = null;
        this._sapawCardValue = -1;
        // 重新按 _state 同步：若拖拽的牌还在 _state.ungroup（服务端打的不是这张），
        // _syncUngroupNodes 会在 _drag=null 后正常重建该节点
        this._onStateChange(this._state.snapshot());
    }

    /** 当前是否为观战模式 */
    get isSpectatorMode(): boolean { return this._spectatorMode; }

    /**
     * 切换观战模式：
     *   - 排序按钮显隐由 _refreshSortButtons 统一管理（观战隐藏、非观战恢复）
     *   - 拖拽禁用
     *   - 后续 dealCards / showCards / addCard 等会按观战分支处理
     */
    setSpectatorMode(v: boolean): void {
        if (this._spectatorMode === v) return;
        this._spectatorMode = v;
        this._refreshSortButtons(this._state.snapshot());
        this.setDragEnabled(!v);
    }

    // ── 状态变化响应 ──────────────────────────────────────

    private _onStateChange(snap: HandCardSnapshot): void {
        if (this._renderLock) {
            // Worker 持锁期间：状态已 commit 到 _state，但渲染节奏由 ceremony 控制。
            // 这里只缓存最新 snap，worker 末尾根据 _renderDirty 决定是否统一渲染。
            this._latestSnap = snap;
            this._renderDirty = true;
            // 选中态等 UI 反馈仍要即时（ActionPanel 按钮态依赖 _emitSelection），
            // 但 _emitSelection 不动节点，安全。
            this._emitSelection(snap);
            this._refreshSortButtons(snap);
            return;
        }
        this._render(snap);
    }

    /**
     * 实际把 snap 渲染到 DOM：节点增删 + 布局。
     * 与 _onStateChange 分离，让 ceremony / worker 可以在合适时机直接调用渲染，
     * 不经事件回路。
     */
    private _render(snap: HandCardSnapshot): void {
        this._syncGroupViews(snap.groups, snap.selectedGroupIds);
        this._syncUngroupNodes(snap.ungroup, snap.selectedUngroupCards);
        this._doLayout(snap.groups, snap.ungroup);
        if (this._layoffTipsSet) this.showLayoffTips(this._layoffTipsSet);
        this._emitSelection(snap);
        this._refreshSortButtons(snap);
    }

    /**
     * 服务端 groupCards 是权威布局。刷新前取消本地拖拽预览、空槽目标和残留 tween，
     * 避免旧预览帧把同一组牌继续撑出 1-2 个空位。
     */
    private _prepareForAuthoritativeServerLayout(): void {
        if (this._drag?.floatNode?.isValid) {
            this._drag.floatNode.destroy();
        }
        this._drag = null;

        this._previewTargets.clear();
        this._containerTargets.clear();
        this._slotTargetWidths.clear();
        this._origGroupLocalX.clear();
        this._groupContainerTargetX.clear();
        this._sapawCardValue = -1;
        this._sapawGroupWorldPos = null;
        this._sapawUngroupWorldPos = null;

        for (const root of [this._groupRoot, this._ungroupRoot, this._dragLayer, this._markerOverlayRoot]) {
            Tween.stopAllByTarget(root);
        }
        for (const gv of this._groupViews.values()) {
            Tween.stopAllByTarget(gv.node);
            for (const cn of gv.cardNodes) {
                Tween.stopAllByTarget(cn.node);
            }
        }
        for (const [, cn] of this._ungroupNodes) {
            Tween.stopAllByTarget(cn.node);
        }
    }

    // ── Ceremony 调度 ─────────────────────────────────────

    /**
     * 入队一个 ceremony 任务并启动 worker（已运行则不重复启动）。
     * 返回 Promise，在 ceremony 完成时 resolve（调用方需要 await 时使用）。
     * 调用方负责在 enqueue 之前完成 _state commit，并自行管理 _renderLock：
     *   - lock 必须在第一次 commit 之前设上，避免 _onStateChange 抢跑渲染；
     *   - lock 由 worker 在所有任务跑完时统一释放。
     */
    private _enqueueCeremony(body: AnimTaskBody): Promise<void> {
        return new Promise<void>((resolve) => {
            this._animQueue.push({ body, done: resolve });
            void this._runWorker();
        });
    }

    /**
     * Ceremony worker 主循环：串行 pop 队列、播 ceremony。
     * 单实例（_workerRunning 守卫）。任何 ceremony 失败都被 catch，绝不让 lock 死锁。
     */
    private async _runWorker(): Promise<void> {
        if (this._workerRunning) return;
        this._workerRunning = true;
        try {
            while (this._animQueue.length > 0) {
                const task = this._animQueue.shift()!;
                // ceremony 会重建大量节点 / 销毁 _dragLayer，先中断拖拽避免幽灵浮牌与
                // _drag 状态残留（Phase 4 的 _dragLayer.removeAllChildren 会销毁浮牌）
                if (this._drag) this.cancelDrag();
                try {
                    await this._playCeremony(task.body);
                } catch (err) {
                    console.error('[HandCardPanel] ceremony error:', err);
                } finally {
                    task.done();
                }
            }
        } finally {
            // 所有任务播完，释放 lock。
            // 若 lock 期间有 state 变更（_renderDirty=true），用 _latestSnap 兜底渲染。
            this._renderLock = false;
            // ceremony 用大 dur 跑完后，_doLayout 不会消费 _sapawCardValue（仅 dur≤LAYOUT_DUR
            // 才消费），残留会让下次普通 layout 误把节点重置回旧释放点。worker 收尾统一清零。
            this._sapawCardValue = -1;
            if (this._renderDirty && this._latestSnap) {
                this._render(this._latestSnap);
            }
            this._renderDirty = false;
            this._latestSnap = null;
            this._workerRunning = false;
        }
    }

    /** Ceremony 类型分发 */
    private async _playCeremony(body: AnimTaskBody): Promise<void> {
        switch (body.kind) {
            case 'merge-expand':
                await this._playMergeExpandCeremony(body);
                return;
            case 'drop-only':
                await this._playDropOnlyCeremony(body);
                return;
        }
    }

    /**
     * 跳过队列：把当前所有未播 ceremony 丢弃，立刻把 _state 当前快照 instant 渲染。
     * 用于 showCards / clear / dealCards 等"瞬时同步"场景（重连、初始化、游戏结束等）。
     * 调用方应自行确保该场景下队列里残留 ceremony 被丢弃是安全的。
     */
    private _flushCeremonyQueue(): void {
        this._animQueue.length = 0;
        this._renderLock = false;
        this._renderDirty = false;
        this._latestSnap = null;
    }

    private _toServerCardType(type: GroupType): number {
        if (type === GroupType.SPECIAL) return 2;
        if (type === GroupType.VALID) return 1;
        return 0;
    }

    /** 构建 SelectionInfo 并触发回调，同时输出调试日志 */
    private _emitSelection(snap: HandCardSnapshot): void {
        const selectedCards  = Array.from(snap.selectedUngroupCards);
        const selectedGroups = snap.groups.filter(g => snap.selectedGroupIds.has(g.id));

        // canSapaw：仅当选中的单张散牌在当前补牌提示集合中才为 true
        const base = snap.buttonStates;
        const canSapaw = base.canSapaw
            && this._layoffTipsSet !== null
            && base.selectedSingleCard !== null
            && this._layoffTipsSet.has(base.selectedSingleCard);
        const buttons: ButtonStates = { ...base, canSapaw };

        this.onSelectionChange?.({
            selectedCards,
            selectedGroups,
            buttons,
        });
    }

    // ── 排序按钮 ──────────────────────────────────────────

    private _onAutoSortClick(): void {
        // 发送切换请求到服务端，等服务端返回后再更新本地状态
        const newIsAuto = !this._state.autoGroupEnabled;
        Nexus.emit(TongitsEvents.CMD_SWITCH_AUTO_GROUP, { isAuto: newIsAuto });
    }

    private _onSortModeClick(): void {
        this.onToggleSortMode();
    }

    /** 根据快照刷新排序按钮的视觉状态 */
    private _refreshSortButtons(snap: HandCardSnapshot): void {
        // 观战短路：排序按钮全部隐藏，避免被 state 变化重新激活
        if (this._spectatorMode) {
            if (this.autoSortBtn?.node)        this.autoSortBtn.node.active = false;
            if (this.autoSortActiveNode?.node) this.autoSortActiveNode.node.active = false;
            if (this.sortModeBtn?.node)        this.sortModeBtn.node.active = false;
            if (this.sortModeLabelNode?.node)  this.sortModeLabelNode.node.active = false;
            return;
        }
        // 非观战：autoSort 两态按钮互斥；sortMode 按钮 + Label 始终显示
        if (this.autoSortBtn)              this.autoSortBtn.node.active = !snap.autoGroupEnabled;
        if (this.autoSortActiveNode)       this.autoSortActiveNode.node.active = snap.autoGroupEnabled;
        if (this.sortModeBtn?.node)        this.sortModeBtn.node.active = true;
        if (this.sortModeLabelNode?.node)  this.sortModeLabelNode.node.active = true;
        if (this.sortModeLabelNode) {
            this.sortModeLabelNode.string = snap.sortMode === SortMode.BY_RANK ? 'Rank' : 'Suit';
        }
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
            // 拖拽来源组：g.cards 仍含拖拽牌（_state 未改），但 gv.cardNodes 已被
            // _onCardDragStart 移除该牌。此处过滤一份给 view 层用，避免 init/refresh
            // 时按 g.cards 长度增节点导致拖拽牌在原组复活。
            const dragInThisGroup = this._drag
                && this._drag.sourceKind === 'group'
                && this._drag.sourceGroupId === g.id
                && g.cards.includes(this._drag.cardValue);
            const gForView: GroupData = dragInThisGroup
                ? { ...g, cards: g.cards.filter(c => c !== this._drag!.cardValue) }
                : g;

            let gv = this._groupViews.get(g.id);
            if (!gv) {
                const groupNode = this.cardGroupPrefab
                    ? instantiate(this.cardGroupPrefab)
                    : new Node(`Group_${g.id}`);
                this._groupRoot.addChild(groupNode);
                // 手动组合时从选中牌的中心起飞；其他情况（autoGroup / prefab 偏移）从原点出发
                if (this._sapawGroupWorldPos && !g.isAuto) {
                    groupNode.setWorldPosition(this._sapawGroupWorldPos);
                    this._sapawGroupWorldPos = null;
                } else {
                    groupNode.setPosition(0, 0, 0);
                }
                // 确保有 CardGroupView 组件（prefab 里已挂好，fallback 时手动添加）
                gv = groupNode.getComponent(CardGroupView) ?? groupNode.addComponent(CardGroupView);
                gv.onGroupClick = (id) => {
                    if (!this._dragEnabled) return;
                    this._inTakeMode ? this._onTakeModeGroupClick(id) : this._state.toggleGroup(id);
                };
                gv.init(gForView, (v) => this._createCardNode(v));
                gv.setMarkerOverlayParent(this._markerOverlayRoot);
                this._groupViews.set(g.id, gv);
            } else {
                gv.refresh(gForView, (v) => this._createCardNode(v));
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
        ungroup.forEach((val, i) => {
            // 拖拽中的牌：节点已在 _dragLayer，跳过重建避免 _ungroupRoot 出现重复牌
            if (this._drag?.cardValue === val) return;
            if (!this._ungroupNodes.has(val)) {
                const n  = this._createCardNode(val);
                const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);
                cn.onClick = (v) => {
                    if (!this._dragEnabled) return;
                    this._inTakeMode ? this._onTakeModeCardClick(v) : this._state.toggleUngroupCard(v);
                };
                this._bindCardDrag(cn, 'ungroup');
                cn.setFaceDown(false);       // 加入场景前先设正面，与组牌路径一致（addChild 触发 onLoad 时 _faceDown=false）
                this._ungroupRoot.addChild(n);
                // 解散组时从原组位置起飞，而非从左端(0,0,0)
                if (this._sapawUngroupWorldPos) {
                    n.setWorldPosition(this._sapawUngroupWorldPos);
                }
                        // 新节点按插入时的数组位置设初始 sibling index
                n.setSiblingIndex(ungroup.indexOf(val));
                this._ungroupNodes.set(val, cn);
            }
            // 更新选中状态
            this._ungroupNodes.get(val)?.setSelected(selectedCards.has(val));
        });
        // 按当前数组顺序统一更新 sibling index，保证排序切换后叠牌 Z-order 正确
        for (let i = 0; i < ungroup.length; i++) {
            const cn = this._ungroupNodes.get(ungroup[i]);
            if (cn) cn.node.setSiblingIndex(i);
        }

        this._sapawUngroupWorldPos = null;
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
        const instant = this._instantLayout;
        this._instantLayout = false;
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
        if (!instant && dur > LAYOUT_DUR) {
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
        if (this._sapawCardValue >= 0 && dur <= LAYOUT_DUR) {
            const sapawCn = this._ungroupNodes.get(this._sapawCardValue);
            if (sapawCn) {
                // 容器已就位，setWorldPosition 可正确转换到容器本地坐标
                sapawCn.node.setWorldPosition(this._sapawWorldPos3);
            }
            this._sapawCardValue = -1;
        }

        // ── 4. 各组容器 tween / snap ─────────────────────────
        let curX = 0;
        for (const g of groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            const halfW = gv.width / 2;
            curX += halfW;
            if (instant) {
                gv.node.setPosition(curX, 0, 0);
                gv.syncMarkerLayout();
            } else {
                // 每帧同步：容器与组 x 同时 tween 时，任一次更新后重算 overlay 世界坐标
                const gvOpts = {
                    easing: 'quadOut' as const,
                    onUpdate: () => { gv.syncMarkerLayout(); },
                };
                tween(gv.node)
                    .to(dur, { position: new Vec3(curX, 0, 0) }, gvOpts)
                    .start();
            }
            curX += halfW + GROUP_GAP;
        }

        // ── 5. 散牌 tween / snap ─────────────────────────────
        for (let i = 0; i < ungroup.length; i++) {
            const cn = this._ungroupNodes.get(ungroup[i]);
            if (!cn) continue;
            const targetCardX = ungroupStartX + i * CARD_SPACING;
            if (instant) {
                cn.snapToX(targetCardX);
            } else {
                cn.tweenToX(targetCardX, dur);
            }
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
     * Merge-Expand Ceremony（纯视觉，由 worker 调用）
     *
     * 前置：_state 已 commit 到 task.toSnap，_renderLock=true，
     *       视觉节点（_groupViews / _ungroupNodes）仍反映 task.fromSnap。
     * 流程：
     *   1.（可选）摸牌下落动画（drawnCard 提供时）
     *      ↳ 同步：所有现有容器同时左移，为新牌腾位
     *   2. 合并：所有现有可见牌 reparent 到 _ungroupRoot，tween 到 (0,0,0)
     *   3. 暂停 80ms，触发 onDealMergeComplete
     *   4. 销毁旧节点
     *   5. _render(toSnap)：按新状态创建节点 + _doLayout 启动展开 tween
     *   6. 等展开完成，恢复组标记
     */
    private async _playMergeExpandCeremony(task: AnimTaskBody & { kind: 'merge-expand' }): Promise<void> {
        const MERGE_DUR = 0.14;

        // ── Phase 1: 摸牌下落（可选）+ 现有牌同时左移 ───────────────
        let flyNode: Node | null = null;
        if (task.drawnCard !== undefined) {
            const DROP_DUR = 0.25;
            // 加入一张牌后总宽增加 CARD_SPACING，容器向左移半个间距
            const shiftX = -CARD_SPACING / 2;
            // 停止容器上残留 tween，确保起始位置稳定
            for (const root of [this._groupRoot, this._ungroupRoot, this._dragLayer, this._markerOverlayRoot]) {
                Tween.stopAllByTarget(root);
            }
            // 并行：新牌下落 + 所有容器左移
            const dropPromise = this._playDrawDrop(task.fromSnap, task.drawnCard).then(n => { flyNode = n; });
            const shiftPromise = Promise.all(
                ([this._groupRoot, this._ungroupRoot, this._dragLayer, this._markerOverlayRoot] as Node[]).map(root =>
                    tweenTo(root, DROP_DUR, { position: new Vec3(root.position.x + shiftX, 0, 0) })
                )
            );
            await Promise.all([dropPromise, shiftPromise]);
        }

        // ── Phase 2: 合并到中心 ─────────────────────────────
        for (const root of [this._groupRoot, this._ungroupRoot, this._dragLayer, this._markerOverlayRoot]) {
            Tween.stopAllByTarget(root);
        }
        for (const gv of this._groupViews.values()) {
            Tween.stopAllByTarget(gv.node);
            for (const cn of gv.cardNodes) Tween.stopAllByTarget(cn.node);
        }
        for (const [, cn] of this._ungroupNodes) {
            Tween.stopAllByTarget(cn.node);
        }
        // 根容器归零，保持子节点世界坐标不变
        for (const root of [this._groupRoot, this._ungroupRoot]) {
            if (root.position.x !== 0 || root.position.y !== 0) {
                const worldPositions = [...root.children].map(c => c.getWorldPosition().clone());
                root.setPosition(0, 0, 0);
                [...root.children].forEach((c, i) => c.setWorldPosition(worldPositions[i]));
            }
        }
        this._dragLayer.setPosition(0, 0, 0);
        this._markerOverlayRoot.setPosition(0, 0, 0);

        // 隐藏组标记
        for (const gv of this._groupViews.values()) {
            if (gv.groupMarker?.node) gv.groupMarker.node.active = false;
        }

        // 把 flyNode（落地后）一并加入合并队列
        if (flyNode?.isValid) {
            const wp = flyNode.getWorldPosition().clone();
            this._ungroupRoot.addChild(flyNode);
            flyNode.setWorldPosition(wp);
        }

        // 收集所有叶子牌节点 + 空组容器
        const allCardNodes: Node[] = [...this._ungroupRoot.children];
        const containerNodes: Node[] = [];
        for (const gv of this._groupViews.values()) {
            for (const cn of gv.cardNodes) {
                const wp = cn.node.getWorldPosition().clone();
                this._ungroupRoot.addChild(cn.node);
                cn.node.setWorldPosition(wp);
                allCardNodes.push(cn.node);
            }
            gv.node.active = false;
            containerNodes.push(gv.node);
        }

        if (allCardNodes.length > 0) {
            await Promise.all(allCardNodes.map(n =>
                new Promise<void>(resolve =>
                    tween(n)
                        .to(MERGE_DUR, { position: new Vec3(0, 0, 0) }, { easing: 'quadIn' })
                        .call(() => resolve())
                        .start()
                )
            ));
        }

        // ── Phase 3: 暂停 ───────────────────────────────────
        await delay(80);
        this.onDealMergeComplete?.();

        // ── Phase 4: 清理旧节点 ─────────────────────────────
        for (const gv of this._groupViews.values()) {
            gv.setMarkerOverlayParent(null);
        }
        this._ungroupNodes.clear();
        this._groupViews.clear();
        for (const n of allCardNodes)   { if (n.isValid) n.destroy(); }
        for (const n of containerNodes) { if (n.isValid) n.destroy(); }
        this._ungroupRoot.removeAllChildren();
        this._groupRoot.removeAllChildren();
        this._dragLayer.removeAllChildren();
        this._markerOverlayRoot.removeAllChildren();
        this._ungroupRoot.setPosition(0, 0, 0);
        this._groupRoot.setPosition(0, 0, 0);
        this._dragLayer.setPosition(0, 0, 0);
        this._markerOverlayRoot.setPosition(0, 0, 0);

        // ── Phase 5: 按 toSnap 渲染（创建新节点 + _doLayout 展开 tween） ──
        this._dealReorderDur = DEAL_REORDER_DUR;
        this._render(task.toSnap);

        // _syncGroupViews 会立即挂回 groupMarker，需在展开动画结束后才显示
        for (const gv of this._groupViews.values()) {
            if (gv.groupMarker?.node) gv.groupMarker.node.active = false;
        }

        // ── Phase 6: 等展开 tween 完成 ──────────────────────
        await new Promise<void>(resolve =>
            tween({ t: 0 })
                .to(DEAL_REORDER_DUR, { t: 1 })
                .call(() => resolve())
                .start()
        );
        for (const gv of this._groupViews.values()) {
            if (gv.groupMarker?.node) gv.groupMarker.node.active = true;
            gv.syncMarkerLayout();
        }
    }

    /**
     * Drop-Only Ceremony：autoGroup 关闭且无服务端分组时的摸牌路径。
     *
     * 并行设计：不使用临时 flyNode。新摸的牌直接以新散牌节点的形式
     * 从牌堆世界坐标起飞，由 _doLayout 的 tween 一次性完成 X+Y 过渡到散牌区末尾——
     * 期间左侧已存在的散牌/组也用同一 dur tween 到新位置，做到"下落"与"重排"完全并行。
     */
    private async _playDropOnlyCeremony(task: AnimTaskBody & { kind: 'drop-only' }): Promise<void> {
        // 牌堆顶视觉同步消失
        this.tableAreaView?.popDeckCard()?.destroy();

        // 新散牌节点的起飞点 = 牌堆世界坐标
        const deckWorld = this.tableAreaView?.getDeckWorldPos() ?? this.node.getWorldPosition();
        this._sapawUngroupWorldPos = deckWorld.clone();

        // 用比 LAYOUT_DUR 稍长的 dur，让"从牌堆飞到末尾"的过程视觉清晰
        const DROP_REORDER_DUR = 0.25;
        this._dealReorderDur = DROP_REORDER_DUR;

        // _render 触发：
        //   _syncUngroupNodes 用 _sapawUngroupWorldPos 把新节点放到牌堆位置
        //   _doLayout         所有散牌（含新牌）+ 容器同时 tween 到 toSnap 目标位置
        this._render(task.toSnap);

        // 等 tween 跑完再让 worker 进入下一个 ceremony
        await new Promise<void>(resolve =>
            tween({ t: 0 })
                .to(DROP_REORDER_DUR, { t: 1 })
                .call(() => resolve())
                .start()
        );
    }

    /**
     * 摸牌下落动画：popDeckCard → 翻面 → 下落到散牌目标位。
     * 返回落地后的 flyNode（仍挂在 panel 上，未销毁），调用方决定后续处理。
     */
    private async _playDrawDrop(fromSnap: HandCardSnapshot, card: number): Promise<Node | null> {
        const pileTop = this.tableAreaView?.popDeckCard() ?? null;
        if (!pileTop?.isValid) return null;

        const targetLocalX = this._computeNewCardLocalXFromSnap(fromSnap);
        const targetLocal  = new Vec3(targetLocalX, 0, 0);
        const DROP_HEIGHT  = 80;
        const DROP_DUR     = 0.25;

        this.node.addChild(pileTop);
        const cn = pileTop.getComponent(CardNode);
        if (cn) { cn.setCard(card); cn.setFaceDown(false); }
        pileTop.setPosition(targetLocal.x, targetLocal.y + DROP_HEIGHT, 0);

        await tweenTo(pileTop, DROP_DUR, { position: new Vec3(targetLocal.x, targetLocal.y, 0) }, 'quadOut');
        return pileTop;
    }

    /**
     * 基于 fromSnap（ceremony 开始时的视觉状态）计算新摸牌的目标本地 X。
     * 读 snap 而不是 _state（_state 已 commit 到 toSnap，节点数仍反映 fromSnap）。
     */
    private _computeNewCardLocalXFromSnap(snap: HandCardSnapshot): number {
        const n = snap.ungroup.length;
        let GW = 0;
        for (const g of snap.groups) {
            const gv = this._groupViews.get(g.id);
            if (gv) GW += gv.width + GROUP_GAP;
        }
        return (GW + n * CARD_SPACING) / 2;
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
        if (this._drag || !this._dragEnabled) return;

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
        drag.floatNode.getWorldPosition(this._sapawWorldPos3);
        this._sapawCardValue = drag.cardValue;

        const target = drag.hoverKind === 'group' && drag.hoverGroupId
            ? drag.hoverGroupId
            : 'ungroup';

        // 先提交状态（_onStateChange 同步创建新节点并设好起飞点）
        this._state.moveCard(drag.cardValue, target, drag.hoverIndex);
        this._emitGroupsChange();

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

    // ── 私有：吃牌模式辅助 ────────────────────────────────

    /**
     * 散牌被点击时（吃牌模式下）：
     * - 点当前选中候选组内的牌 → 循环切换到下一候选组
     * - 点其他候选组内的牌 → 直接切换到该候选组
     * - 非候选牌 → 忽略
     */
    private _onTakeModeCardClick(cardValue: number): void {
        const cur = this._takeCandidates[this._selectedCandidateIdx];
        if (cur?.includes(cardValue)) {
            this._selectedCandidateIdx =
                (this._selectedCandidateIdx + 1) % this._takeCandidates.length;
            this._refreshTakeHighlight();
            return;
        }
        for (let i = 0; i < this._takeCandidates.length; i++) {
            if (i === this._selectedCandidateIdx) continue;
            if (this._takeCandidates[i].includes(cardValue)) {
                this._selectedCandidateIdx = i;
                this._refreshTakeHighlight();
                return;
            }
        }
    }

    /**
     * 牌组被点击时（吃牌模式下）：
     * - 点当前选中候选组对应的牌组 → 循环切换到下一候选组
     * - 点其他候选组对应的牌组 → 直接切换到该候选组
     * - 与候选无关的牌组 → 忽略
     */
    private _onTakeModeGroupClick(groupId: string): void {
        const snap   = this._state.snapshot();
        const group  = snap.groups.find(g => g.id === groupId);
        if (!group) return;

        const cur         = this._takeCandidates[this._selectedCandidateIdx];
        const curHasGroup = group.cards.some(c => cur?.includes(c));

        if (curHasGroup) {
            // 点当前候选对应的牌组 → 循环切到下一候选
            this._selectedCandidateIdx =
                (this._selectedCandidateIdx + 1) % this._takeCandidates.length;
            this._refreshTakeHighlight();
            return;
        }
        // 点其他候选对应的牌组 → 切到首个包含该牌组牌的候选
        for (let i = 0; i < this._takeCandidates.length; i++) {
            if (i === this._selectedCandidateIdx) continue;
            if (group.cards.some(c => this._takeCandidates[i].includes(c))) {
                this._selectedCandidateIdx = i;
                this._refreshTakeHighlight();
                return;
            }
        }
    }

    /**
     * 刷新吃牌模式高亮（方案 B：只上移候选内的牌，不能吃的牌显示遮罩）：
     * - 当前选中候选内的牌 → setSelected(true)（上移），无遮罩
     * - 其他候选内的牌（可切换） → setSelected(false)，无遮罩
     * - 不属于任何候选的牌 → setMasked(true)
     * - 切换候选时遮罩不变，只更新 selected 状态
     */
    private _refreshTakeHighlight(): void {
        const selectedSet   = new Set(this._takeCandidates[this._selectedCandidateIdx] ?? []);
        const anyCandidateSet = new Set<number>();
        for (const cand of this._takeCandidates) {
            for (const v of cand) anyCandidateSet.add(v);
        }
        const snap = this._state.snapshot();

        // 1. 全量复位 selected（处理切换时旧候选牌落回）
        //    注意：不能用 gv.setSelected(false)，因为 take 模式从不调 gv.setSelected(true)，
        //    _isSelected 始终为 false，早返回会跳过对个体 CardNode 的重置。
        for (const [, cn] of this._ungroupNodes) {
            cn.setSelected(false);
            cn.setHinted(false);
        }
        for (const [, gv] of this._groupViews) {
            for (const cn of gv.cardNodes) cn.setSelected(false);
        }

        // 2. 散牌：按候选归属设置 selected 和遮罩
        for (const [val, cn] of this._ungroupNodes) {
            cn.setSelected(selectedSet.has(val));
            cn.setMasked(!anyCandidateSet.has(val));
        }

        // 3. 牌组：按候选归属设置各张牌的 selected 和遮罩
        for (const g of snap.groups) {
            const gv = this._groupViews.get(g.id);
            if (!gv) continue;
            for (const cn of gv.cardNodes) {
                cn.setSelected(selectedSet.has(cn.cardValue));
                cn.setMasked(!anyCandidateSet.has(cn.cardValue));
            }
        }
    }

    // ── 补牌提示 API ──────────────────────────────────────

    /** 返回指定牌值对应节点的世界坐标（散牌区或牌组均查找），不存在返回 null */
    getCardWorldPos(card: number): Vec3 | null {
        const cn = this._ungroupNodes.get(card);
        if (cn?.node.isValid) return cn.node.worldPosition.clone();
        for (const gv of this._groupViews.values()) {
            const found = gv.cardNodes.find(c => c.cardValue === card);
            if (found?.node.isValid) return found.node.worldPosition.clone();
        }
        return null;
    }

    /** 显示补牌提示（tipNode）：cardSet 中包含的手牌显示 tipNode，其余隐藏 */
    showLayoffTips(cardSet: Set<number>): void {
        this._layoffTipsSet = cardSet;
        for (const [val, cn] of this._ungroupNodes) {
            cn.setTipped(cardSet.has(val));
        }
        for (const [, gv] of this._groupViews) {
            for (const cn of gv.cardNodes) {
                cn.setTipped(cardSet.has(cn.cardValue));
            }
        }
    }

    /** 清除所有手牌的补牌提示 */
    clearLayoffTips(): void {
        this._layoffTipsSet = null;
        for (const [, cn] of this._ungroupNodes) cn.setTipped(false);
        for (const [, gv] of this._groupViews) {
            for (const cn of gv.cardNodes) cn.setTipped(false);
        }
    }

    /** 清除所有散牌与牌组的高亮与遮罩（退出吃牌模式时调用） */
    private _clearTakeHighlight(): void {
        for (const [, cn] of this._ungroupNodes) {
            cn.setSelected(false);
            cn.setHinted(false);
            cn.setMasked(false);
        }
        // 同样直接遍历个体牌，避免 gv.setSelected(false) 因 _isSelected 未变而早返回
        for (const [, gv] of this._groupViews) {
            for (const cn of gv.cardNodes) {
                cn.setSelected(false);
                cn.setMasked(false);
            }
        }
    }
}
