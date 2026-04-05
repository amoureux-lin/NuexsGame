/**
 * HandCardState — 手牌数据状态管理
 *
 * 职责：
 *   - 持有所有手牌数据（groups + ungroup）
 *   - 管理选牌状态（selectedGroupIds / selectedUngroupCards）
 *   - 处理 autoGroup 开关 / 排序模式切换
 *   - 计算按钮激活状态
 *   - 通过 onChange 通知视图层重绘
 */

import {
    autoGroup as runAutoGroup,
    GroupData, GroupType, judgeGroupType,
} from './GroupAlgorithm';
import { SortMode, sortCards, calcPoint } from './CardDef';

export type { GroupData, GroupType };
export { SortMode };

// ── 类型定义 ──────────────────────────────────────────────

/** 按钮激活状态（由选牌状态派生，阶段判断由外部叠加） */
export interface ButtonStates {
    /** 2张+选中 → 可组合 */
    canGroup:   boolean;
    /** 选中了1个完整组且无散牌 → 可解散 */
    canUngroup: boolean;
    /** 选中了1个 VALID/SPECIAL 组且无散牌 → 可放牌 */
    canDrop:    boolean;
    /** 选中了1张散牌且无组 → 可弃牌（外部再叠加"出牌阶段"判断） */
    canDump:    boolean;
    /** 与 canDump 相同（外部再叠加"可压牌"判断） */
    canSapaw:   boolean;
    /** 当前唯一选中的散牌（供外部做 Sapaw/Dump 具体判断） */
    selectedSingleCard: number | null;
}

/** 每次状态变化后向视图层发出的快照 */
export interface HandCardSnapshot {
    groups:               readonly GroupData[];
    ungroup:              readonly number[];
    selectedGroupIds:     ReadonlySet<string>;
    selectedUngroupCards: ReadonlySet<number>;
    sortMode:             SortMode;
    autoGroupEnabled:     boolean;
    buttonStates:         ButtonStates;
    /** 手牌当前点数（INVALID 组 + UNGROUP 区计分） */
    point:                number;
}

export type ChangeListener = (snap: HandCardSnapshot) => void;

// ── HandCardState ─────────────────────────────────────────

let _idSeq = 0;
function newGroupId(): string { return `g_${++_idSeq}_${Date.now()}`; }

export class HandCardState {

    private _groups:    GroupData[] = [];
    private _ungroup:   number[]    = [];
    private _sortMode:  SortMode    = SortMode.BY_RANK;
    private _autoGroupEnabled       = true;

    private _selectedGroupIds     = new Set<string>();
    private _selectedUngroupCards = new Set<number>();

    private _listeners: ChangeListener[] = [];

    // ── 订阅 ──────────────────────────────────────────────

    onChange(fn: ChangeListener): () => void {
        this._listeners.push(fn);
        return () => { this._listeners = this._listeners.filter(l => l !== fn); };
    }

    private _notify(): void {
        const snap = this.snapshot();
        for (const fn of this._listeners) fn(snap);
    }

    // ── 快照 ──────────────────────────────────────────────

    snapshot(): HandCardSnapshot {
        return {
            groups:               [...this._groups],
            ungroup:              [...this._ungroup],
            selectedGroupIds:     new Set(this._selectedGroupIds),
            selectedUngroupCards: new Set(this._selectedUngroupCards),
            sortMode:             this._sortMode,
            autoGroupEnabled:     this._autoGroupEnabled,
            buttonStates:         this._calcButtons(),
            point:                this._calcPoint(),
        };
    }

    private _calcButtons(): ButtonStates {
        const selGIds  = this._selectedGroupIds;
        const selCards = this._selectedUngroupCards;

        // 所有选中组的牌数总和
        let selGroupCardTotal = 0;
        let selGroupType: GroupType | null = null;
        if (selGIds.size >= 1) {
            for (const id of selGIds) {
                const g = this._groups.find(x => x.id === id);
                if (g) selGroupCardTotal += g.cards.length;
            }
            if (selGIds.size === 1) {
                const g = this._groups.find(x => selGIds.has(x.id));
                selGroupType = g?.type ?? null;
            }
        }

        const totalSel = selGroupCardTotal + selCards.size;

        const canGroup   = totalSel >= 2;
        const canUngroup = selGIds.size === 1 && selCards.size === 0;
        const canDrop    = selGIds.size === 1 && selCards.size === 0
                        && (selGroupType === GroupType.VALID || selGroupType === GroupType.SPECIAL);
        const canDump    = selCards.size === 1 && selGIds.size === 0;
        const canSapaw   = selCards.size === 1 && selGIds.size === 0;
        const selectedSingleCard = canDump ? [...selCards][0] : null;

        return { canGroup, canUngroup, canDrop, canDump, canSapaw, selectedSingleCard };
    }

    private _calcPoint(): number {
        let total = calcPoint([...this._ungroup]);
        for (const g of this._groups) {
            if (g.type === GroupType.INVALID) total += calcPoint(g.cards);
        }
        return total;
    }

    // ── 初始化手牌 ────────────────────────────────────────

    /**
     * 发牌后调用：设置初始手牌并触发 autoGroup（若开启）
     */
    setCards(cards: number[]): void {
        this._clearSelSilent();
        this._groups  = [];
        this._ungroup = sortCards(cards, this._sortMode);
        if (this._autoGroupEnabled) this._runAutoGroupAll();
        this._notify();
    }

    // ── 单张牌增删 ────────────────────────────────────────

    /**
     * 摸牌：加入一张牌
     * autoGroup ON → 所有牌重新分组
     * autoGroup OFF → 追加到 UNGROUP 并排序
     */
    addCard(card: number): void {
        this._clearSelSilent();
        if (this._autoGroupEnabled) {
            const all = [...this._getAllCards(), card];
            this._groups  = [];
            this._ungroup = sortCards(all, this._sortMode);
            this._runAutoGroupAll();
        } else {
            this._ungroup = sortCards([...this._ungroup, card], this._sortMode);
        }
        this._notify();
    }

    /**
     * 弃牌：从 UNGROUP 区移除一张牌（不触发 autoGroup）
     */
    removeCard(card: number): void {
        this._clearSelSilent();
        this._ungroup = this._ungroup.filter(c => c !== card);
        this._notify();
    }

    // ── Group / Ungroup / Drop ─────────────────────────────

    /**
     * Group 按钮：将当前选中的所有牌合并为新组
     * - 从各自原位置移除
     * - 创建新 GroupData，type 由算法判断
     * - autoGroup ON 时，对剩余 UNGROUP 重新跑 autoGroup
     */
    createGroup(): void {
        const selCards = this._getSelectedCards();
        if (selCards.length < 2) return;

        // 从原组中删除
        const removeIds = new Set(this._selectedGroupIds);
        this._groups = this._groups.filter(g => !removeIds.has(g.id));

        // 从 UNGROUP 中删除
        const removeCards = new Set(this._selectedUngroupCards);
        this._ungroup = this._ungroup.filter(c => !removeCards.has(c));

        // 创建新组
        const newGroup: GroupData = {
            id:     newGroupId(),
            cards:  sortCards(selCards, this._sortMode),
            type:   judgeGroupType(selCards),
            isAuto: false,
        };
        this._groups.push(newGroup);

        // autoGroup ON → 对剩余 UNGROUP 补跑一次
        if (this._autoGroupEnabled) this._runAutoGroupOnUngroup();

        this._clearSelSilent();
        this._notify();
    }

    /**
     * Ungroup 按钮：解散选中的组
     * autoGroup ON → 所有牌重新分组
     * autoGroup OFF → 牌进入 UNGROUP 排序
     */
    dissolveGroup(): void {
        if (this._selectedGroupIds.size !== 1) return;
        const id    = [...this._selectedGroupIds][0];
        const group = this._groups.find(g => g.id === id);
        if (!group) return;

        const released = group.cards;
        this._groups   = this._groups.filter(g => g.id !== id);
        this._clearSelSilent();

        if (this._autoGroupEnabled) {
            const all = [...this._getAllCards(), ...released];
            this._groups  = [];
            this._ungroup = sortCards(all, this._sortMode);
            this._runAutoGroupAll();
        } else {
            this._ungroup = sortCards([...this._ungroup, ...released], this._sortMode);
        }

        this._notify();
    }

    /**
     * Drop 按钮：将选中的有效组从手牌移除，返回该组供视图层处理动画
     * 返回 null 表示当前无法 Drop
     */
    dropGroup(): GroupData | null {
        if (this._selectedGroupIds.size !== 1) return null;
        const id    = [...this._selectedGroupIds][0];
        const group = this._groups.find(g => g.id === id);
        if (!group) return null;
        if (group.type !== GroupType.VALID && group.type !== GroupType.SPECIAL) return null;

        this._groups = this._groups.filter(g => g.id !== id);
        this._clearSelSilent();
        this._notify();
        return group;
    }

    // ── 自动排列开关 ──────────────────────────────────────

    toggleAutoGroup(): void {
        this._autoGroupEnabled = !this._autoGroupEnabled;
        this._clearSelSilent();

        const all = this._getAllCards();
        this._groups  = [];
        this._ungroup = sortCards(all, this._sortMode);

        if (this._autoGroupEnabled) {
            this._runAutoGroupAll();
        }
        this._notify();
    }

    get autoGroupEnabled(): boolean { return this._autoGroupEnabled; }

    // ── 排序模式切换 ──────────────────────────────────────

    toggleSortMode(): void {
        this._sortMode = this._sortMode === SortMode.BY_RANK
            ? SortMode.BY_SUIT
            : SortMode.BY_RANK;

        this._groups  = this._groups.map(g => ({ ...g, cards: sortCards(g.cards, this._sortMode) }));
        this._ungroup = sortCards(this._ungroup, this._sortMode);
        this._notify();
    }

    get sortMode(): SortMode { return this._sortMode; }

    // ── 选牌 ──────────────────────────────────────────────

    /** 点击 UNGROUP 区单张牌：切换选中 */
    toggleUngroupCard(card: number): void {
        if (this._selectedUngroupCards.has(card)) {
            this._selectedUngroupCards.delete(card);
        } else {
            this._selectedUngroupCards.add(card);
        }
        this._notify();
    }

    /** 点击组内任意牌：切换整组选中 */
    toggleGroup(groupId: string): void {
        if (this._selectedGroupIds.has(groupId)) {
            this._selectedGroupIds.delete(groupId);
        } else {
            this._selectedGroupIds.add(groupId);
        }
        this._notify();
    }

    clearSelection(): void {
        this._clearSelSilent();
        this._notify();
    }

    // ── 只读访问 ──────────────────────────────────────────

    get groups():  readonly GroupData[] { return this._groups; }
    get ungroup(): readonly number[]    { return this._ungroup; }
    get point():   number               { return this._calcPoint(); }

    // ── 私有工具 ──────────────────────────────────────────

    /** 获取手牌所有牌（所有组 + UNGROUP） */
    private _getAllCards(): number[] {
        const cards: number[] = [...this._ungroup];
        for (const g of this._groups) cards.push(...g.cards);
        return cards;
    }

    /** 获取当前所有选中的牌 */
    private _getSelectedCards(): number[] {
        const cards: number[] = [...this._selectedUngroupCards];
        for (const id of this._selectedGroupIds) {
            const g = this._groups.find(x => x.id === id);
            if (g) cards.push(...g.cards);
        }
        return cards;
    }

    private _clearSelSilent(): void {
        this._selectedGroupIds.clear();
        this._selectedUngroupCards.clear();
    }

    /**
     * 对 _ungroup 跑 autoGroup，结果追加到 _groups
     * 用于：手动 Group 后对剩余散牌补充自动分组
     */
    private _runAutoGroupOnUngroup(): void {
        const { groups, ungroup } = runAutoGroup(this._ungroup, this._sortMode);
        this._groups.push(...groups);
        this._ungroup = ungroup;
    }

    /**
     * 假设 _groups=[] 且 _ungroup 包含所有牌，
     * 对全量牌执行 autoGroup
     */
    private _runAutoGroupAll(): void {
        const { groups, ungroup } = runAutoGroup(this._ungroup, this._sortMode);
        this._groups.push(...groups);
        this._ungroup = ungroup;
    }
}
