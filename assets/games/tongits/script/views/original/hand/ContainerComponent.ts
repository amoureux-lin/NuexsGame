import { _decorator, Component, Node, Tween, tween, UITransform, Vec3 } from 'cc';
// import { TongitsGroup } from '../../game/CardGroupValidator';
// import { CardComponent } from '../card/CardComponent';
const { ccclass } = _decorator;

const DEFAULT_ANIMATE_DURATION = 0.2;

/**
 * 单组手牌容器节点脚本
 * 职责：本容器内位置、宽度、子卡牌位置的设置（含动画）
 * 由 HandComponent 统一计算后调用，不负责布局计算
 * 同时保存当前牌组信息（TongitsGroup），用于拖拽后校验、分数、出牌与标记等
 *
 * 双模式驱动：
 *   - 拖拽模式（dragMode）：由 update() 每帧 lerp 逼近目标值，零 tween，消除 stop/restart 抖动
 *   - 普通模式：由外部调用 setPosition / setCardPositions 等方法，用 tween 过渡
 */
@ccclass('ContainerComponent')
export class ContainerComponent extends Component {
    /** 动画时长 */
    private _animateDuration: number = DEFAULT_ANIMATE_DURATION;

    index: number = -1;

    /** 当前牌组数据（创建时写入，拖拽结束后由 Hand 同步更新） */
    // private _groupData: TongitsGroup | null = null;

    /** 槽位列表，null 表示空位（被拖走的牌） */
    private _slots: (Node | null)[] = [];

    /** 容器的目标位置（不受 tween/lerp 中间值影响） */
    private _targetPosition: Vec3 = new Vec3();

    /** 容器的目标宽度（不受 tween/lerp 中间值影响） */
    private _targetWidth: number = 0;

    /** 记录每个卡牌上一次的目标位置，避免重复重启 tween（普通模式用） */
    private _lastTargetPositions: Map<Node, Vec3> = new Map();

    /** 选中状态：选中的卡牌节点 */
    private _selectedNodes: Set<Node> = new Set();
    /** 哪些节点做过上移（仅未分组手牌单张选时节点上移，有效组只容器上移） */
    private _nodesWithOffset: Set<Node> = new Set();
    /** 容器整体是否选中（有效牌组整组选中时容器上移） */
    private _isContainerSelected: boolean = false;
    /** 选中时上移偏移量 */
    private readonly SELECT_OFFSET_Y = 40;
    /** 选中变化回调（由 HandComponent 设置，用于汇总并通知外部） */
    public onSelectionChanged: (container: ContainerComponent) => void = null;

    // ============ 拖拽模式（帧驱动 Lerp） ============

    /** 是否处于拖拽模式 */
    private _isDragMode: boolean = false;

    /** lerp 速度因子（越大越快逼近目标，20 约在 3~4 帧内基本到位） */
    private _lerpSpeed: number = 20;

    /** 每个槽位的目标位置（拖拽模式下由 HandComponent 写入，update 负责 lerp） */
    private _slotTargetPositions: Vec3[] = [];

    /** 位置近似判定阈值 */
    private readonly LERP_EPSILON: number = 0.5;

    /** 复用 Vec3，减少 GC */
    private _tempLerpVec: Vec3 = new Vec3();

    public setContainerIndex(index: number) {
        this.index = index;
    }

    public getContainerIndex(): number {
        return this.index;
    }

    /** 设置/更新牌组数据（创建容器或拖拽结束后由 HandComponent 调用） */
    // public setGroupData(group: TongitsGroup | null) {
    //     this._groupData = group ? { ...group, cards: group.cards ? [...group.cards] : [] } : null;
    // }
    //
    // /** 获取当前牌组数据（用于分数、出牌、标记等） */
    // public getGroupData(): TongitsGroup | null {
    //     return this._groupData ? { ...this._groupData, cards: [...this._groupData.cards] } : null;
    // }
    //
    // /** 从当前子节点/槽位按顺序收集卡牌 ID（用于校验与同步 groupData） */
    // public getCardIds(): number[] {
    //     const list: number[] = [];
    //     const nodes = this._slots.length > 0 ? this._slots : this.node.children;
    //     for (const n of nodes) {
    //         if (!n) continue;
    //         const card = n.getComponent(CardComponent);
    //         if (card) {
    //             const id = card.getData();
    //             if (id != null) list.push(id);
    //         }
    //     }
    //     return list;
    // }
    //
    // /**
    //  * 按槽位顺序返回卡牌 ID 列表，空位用「正在拖入的牌」填充
    //  */
    // public getCardIdsWithDraggingCard(draggingCardId: number): number[] {
    //     if (this._slots.length === 0) return this.getCardIds();
    //     const list: number[] = [];
    //     for (const slot of this._slots) {
    //         if (slot) {
    //             const card = slot.getComponent(CardComponent);
    //             if (card) {
    //                 const id = card.getData();
    //                 if (id != null) list.push(id);
    //             }
    //         } else {
    //             list.push(draggingCardId);
    //         }
    //     }
    //     return list;
    // }

    /** 设置动画时长 */
    public setAnimateDuration(duration: number) {
        this._animateDuration = duration;
    }

    /** 获取容器的目标位置（而非 tween/lerp 中间值） */
    public getTargetPosition(): Vec3 {
        return this._targetPosition;
    }

    /** 获取容器的目标宽度（而非 tween/lerp 中间值） */
    public getTargetWidth(): number {
        return this._targetWidth;
    }

    // ============ 拖拽模式控制 ============

    /** 进入拖拽模式：停掉所有 tween，由 update lerp 接管 */
    public enterDragMode() {
        this._isDragMode = true;
        this._slotTargetPositions = [];
        // 停掉容器自身和所有子卡牌的 tween，避免与 lerp 冲突
        Tween.stopAllByTarget(this.node);
        const ut = this.node.getComponent(UITransform);
        if (ut) Tween.stopAllByTarget(ut);
        this.node.children.forEach(child => Tween.stopAllByTarget(child));
    }

    /** 退出拖拽模式 */
    public exitDragMode() {
        this._isDragMode = false;
        this._slotTargetPositions = [];
    }

    /** 是否处于拖拽模式 */
    public getIsDragMode(): boolean {
        return this._isDragMode;
    }

    /** 设置槽位目标位置（拖拽模式下由 HandComponent 写入，不触发动画） */
    public setSlotTargetPositions(positions: Vec3[]) {
        this._slotTargetPositions = positions;
    }

    /** 仅写入容器目标位置（拖拽模式下使用，不触发 tween） */
    public setTargetPositionOnly(pos: Vec3) {
        this._targetPosition.set(pos);
    }

    /** 仅写入容器目标宽度（拖拽模式下使用，不触发 tween） */
    public setTargetWidthOnly(width: number) {
        this._targetWidth = width;
    }

    // ============ 帧驱动 Lerp（拖拽模式核心） ============

    update(dt: number) {
        if (!this._isDragMode) return;

        const t = Math.min(1, this._lerpSpeed * dt);

        // 1. 容器位置 lerp
        const curPos = this.node.position;
        if (!this.isSamePosition(curPos, this._targetPosition, this.LERP_EPSILON)) {
            Vec3.lerp(this._tempLerpVec, curPos, this._targetPosition, t);
            this.node.setPosition(this._tempLerpVec);
        }

        // 2. 容器宽度 lerp
        const ut = this.node.getComponent(UITransform);
        if (ut && Math.abs(ut.width - this._targetWidth) > this.LERP_EPSILON) {
            ut.width += (this._targetWidth - ut.width) * t;
        }

        // 3. 卡牌位置 lerp（按槽位）
        if (this._slotTargetPositions.length > 0) {
            const slots = this._slots.length > 0 ? this._slots : this.node.children;
            for (let i = 0; i < slots.length; i++) {
                const node = slots[i];
                if (!node || !this._slotTargetPositions[i]) continue;

                const target = this._slotTargetPositions[i];
                const cur = node.position;
                if (this.isSamePosition(cur, target, this.LERP_EPSILON)) continue;

                Vec3.lerp(this._tempLerpVec, cur, target, t);
                node.setPosition(this._tempLerpVec);
            }
        }
    }

    // ============ 普通模式：Tween 驱动（非拖拽时使用） ============

    /**
     * 设置容器节点位置（普通模式用 tween，拖拽模式只写目标值）
     */
    public setPosition(position: Vec3, animate: boolean, duration: number = this._animateDuration) {
        this._targetPosition.set(position);

        if (this._isDragMode) return;

        Tween.stopAllByTarget(this.node);
        if (animate) {
            tween(this.node)
                .to(duration, { position: position.clone() })
                .start();
        } else {
            this.node.setPosition(position);
        }
    }

    /**
     * 设置容器节点宽度（普通模式用 tween，拖拽模式只写目标值）
     */
    public setWidth(width: number, animate: boolean, duration: number = this._animateDuration) {
        this._targetWidth = width;

        if (this._isDragMode) return;

        const ut = this.node.getComponent(UITransform);
        if (!ut) return;
        Tween.stopAllByTarget(ut);
        if (animate) {
            tween(ut)
                .to(duration, { width })
                .start();
        } else {
            ut.width = width;
        }
    }

    /**
     * 设置本容器内所有子卡牌的位置（普通模式用 tween，拖拽模式只写目标值）
     */
    public setCardPositions(positions: Vec3[], animate: boolean, duration: number = this._animateDuration) {
        if (this._isDragMode) {
            this._slotTargetPositions = positions.map(p => p.clone());
            return;
        }

        const children = this.node.children;
        const len = Math.min(children.length, positions.length);
        for (let i = 0; i < len; i++) {
            const cardNode = children[i];
            const pos = positions[i];

            const last = this._lastTargetPositions.get(cardNode);
            if (last && this.isSamePosition(last, pos)) continue;
            this._lastTargetPositions.set(cardNode, pos.clone());

            Tween.stopAllByTarget(cardNode);
            if (animate) {
                tween(cardNode)
                    .to(duration, { position: pos.clone() })
                    .start();
            } else {
                cardNode.setPosition(pos);
            }
        }
    }

    /** 获取当前容器内卡牌数量（子节点数） */
    public getCardCount(): number {
        return this.node.children.length;
    }

    // ============ 槽位管理 ============

    /** 从当前子节点初始化槽位 */
    public initSlots() {
        this._slots = [...this.node.children];
    }

    /** 获取槽位数组 */
    public get slots(): (Node | null)[] { return this._slots; }

    /** 槽位总数（含空位） */
    public getSlotCount(): number { return this._slots.length; }

    /** 空位索引，无空位返回 -1 */
    public getEmptySlotIndex(): number { return this._slots.indexOf(null); }

    /** 是否有空位 */
    public hasEmptySlot(): boolean { return this._slots.indexOf(null) >= 0; }

    /** 将指定索引的槽位设为空（卡牌被拖走时调用） */
    public setSlotNull(index: number) {
        if (index >= 0 && index < this._slots.length) {
            this._slots[index] = null;
        }
    }

    /** 在指定位置插入空位 */
    public insertEmptySlot(index: number) {
        const clamped = Math.max(0, Math.min(index, this._slots.length));
        this._slots.splice(clamped, 0, null);
    }

    /** 移除空位，返回被移除的索引 */
    public removeEmptySlot(): number {
        const idx = this._slots.indexOf(null);
        if (idx >= 0) this._slots.splice(idx, 1);
        return idx;
    }

    /** 移动空位到新索引，返回是否发生了移动 */
    public moveEmptySlotTo(newIndex: number): boolean {
        const oldIdx = this._slots.indexOf(null);
        if (oldIdx < 0 || oldIdx === newIndex) return false;
        this._slots.splice(oldIdx, 1);
        const clamped = Math.max(0, Math.min(newIndex, this._slots.length));
        this._slots.splice(clamped, 0, null);
        return true;
    }

    /**
     * 用卡牌节点替换空位，将卡牌添加到正确的子节点位置
     */
    public replaceEmptySlot(node: Node): number {
        const idx = this._slots.indexOf(null);
        if (idx < 0) return -1;

        this._slots[idx] = node;

        let childIndex = 0;
        for (let i = 0; i < idx; i++) {
            if (this._slots[i] !== null) childIndex++;
        }

        node.parent = this.node;
        node.setSiblingIndex(childIndex);
        return idx;
    }

    /**
     * 根据槽位更新卡牌位置（普通模式用 tween，拖拽模式只写目标值）
     */
    public updateBySlots(cardPositions: Vec3[], animate: boolean, duration: number = this._animateDuration) {
        if (this._isDragMode) {
            this._slotTargetPositions = cardPositions.map(p => p.clone());
            return;
        }

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot && cardPositions[i]) {
                if (animate) {
                    Tween.stopAllByTarget(slot);
                    tween(slot).to(duration, { position: cardPositions[i].clone() }).start();
                } else {
                    slot.setPosition(cardPositions[i]);
                }
            }
        }
    }

    /** 清除槽位数据（拖拽结束后调用） */
    public clearSlots() {
        this._slots = [];
        this._slotTargetPositions = [];
        this._lastTargetPositions.clear();
    }

    /** 清除选中状态（容器复用或重建时调用） */
    public clearSelection() {
        this._selectedNodes.clear();
        this._nodesWithOffset.clear();
        this._isContainerSelected = false;
    }

    // ============ 选中 ============

    // /** 是否为未分组手牌容器 */
    // public get isUngroupHand(): boolean { return this._groupData?.isUngroupHand ?? false; }
    //
    // /** 是否允许整组选中 */
    // public get canSelectAsGroup(): boolean {
    //     const g = this._groupData;
    //     return g != null && g.isUngroupHand === false;
    // }
    //
    // /** 获取当前选中的卡牌 ID 列表 */
    // public getSelectedData(): number[] {
    //     const list: number[] = [];
    //     this._selectedNodes.forEach((n) => {
    //         const card = n.getComponent(CardComponent);
    //         if (card) {
    //             const id = card.getData();
    //             if (id != null) list.push(id);
    //         }
    //     });
    //     return list;
    // }

    public selectNode(node: Node, moveUp: boolean = true, log: boolean = true) {
        if (!this.node.children.includes(node)) return;
        if (this._selectedNodes.has(node)) return;
        this._selectedNodes.add(node);
        if (moveUp) {
            this._nodesWithOffset.add(node);
            const pos = node.position.clone();
            pos.y += this.SELECT_OFFSET_Y;
            Tween.stopAllByTarget(node);
            tween(node).to(this._animateDuration, { position: pos }).start();
        }
        if (log) this.onSelectionChanged?.(this);
    }

    public deselectNode(node: Node, log: boolean = true, animate: boolean = true) {
        if (!this._selectedNodes.has(node)) return;
        this._selectedNodes.delete(node);
        if (this._nodesWithOffset.has(node)) {
            this._nodesWithOffset.delete(node);
            const pos = node.position.clone();
            pos.y -= this.SELECT_OFFSET_Y;
            Tween.stopAllByTarget(node);
            if (animate) tween(node).to(this._animateDuration, { position: pos }).start();
            else node.setPosition(pos);
        }
        if (log) this.onSelectionChanged?.(this);
    }

    public selectAll(moveUp: boolean = true) {
        let changed = false;
        this.node.children.forEach((child) => {
            if (!this._selectedNodes.has(child)) {
                this.selectNode(child, moveUp, false);
                changed = true;
            }
        });
        if (changed) this.onSelectionChanged?.(this);
    }

    public deselectAll(animate: boolean = true) {
        this.deselectContainer(animate);
        const nodes = [...this._selectedNodes];
        nodes.forEach((n) => this.deselectNode(n, false, animate));
        if (nodes.length > 0) this.onSelectionChanged?.(this);
    }

    public selectContainer() {
        if (this._isContainerSelected) return;
        this._isContainerSelected = true;
        const pos = this.node.position.clone();
        pos.y += this.SELECT_OFFSET_Y;
        Tween.stopAllByTarget(this.node);
        tween(this.node).to(this._animateDuration, { position: pos }).start();
    }

    public deselectContainer(animate: boolean = true) {
        if (!this._isContainerSelected) return;
        this._isContainerSelected = false;
        const pos = this.node.position.clone();
        pos.y -= this.SELECT_OFFSET_Y;
        Tween.stopAllByTarget(this.node);
        if (animate) tween(this.node).to(this._animateDuration, { position: pos }).start();
        else this.node.setPosition(pos);
    }

    public handleCardClick(node: Node): boolean {
        // if (!this.node.children.includes(node)) return false;
        // const card = node.getComponent(CardComponent);
        // if (!card) return false;
        // const isSelected = this._selectedNodes.has(node);
        // const willSelect = !isSelected;
        //
        // if (willSelect) {
        //     if (this.canSelectAsGroup) {
        //         this.selectAll(true);
        //     } else {
        //         this.selectNode(node);
        //     }
        // } else {
        //     if (this.canSelectAsGroup) {
        //         this.deselectAll();
        //     } else {
        //         this.deselectNode(node);
        //     }
        // }
        return true;
    }

    // ============ 工具 ============

    private isSamePosition(a: Vec3, b: Vec3, epsilon: number = 0.1): boolean {
        return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
    }

    /** 从对象池取出时调用，清理所有残留状态 */
    public reset() {
        this._slots = [];
        this._lastTargetPositions.clear();
        this._targetPosition.set(0, 0, 0);
        this._targetWidth = 0;
        this.index = -1;
        this.clearSelection();
    }
}