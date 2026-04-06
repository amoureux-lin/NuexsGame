// import { _decorator, Component, EventTouch, Node, Tween, tween, UITransform, Vec3 } from 'cc';
// import { NodePool } from 'db://app-framework/HeronApp';
// import TongitsModel from '../../../model/TongitsModel';
// import { CardGroupValidator, HandAnalysisResult, TongitsGroup, TongitsGroupType } from '../../game/CardGroupValidator';
// import { CardComponent } from '../card/CardComponent';
// import { Drag } from '../drag/Drag';
// import { ContainerComponent } from './ContainerComponent';
// import { CoordinateHelper } from '../../../utils/CoordinateHelper';
// import { GroupMarkerComponent } from '../card/GroupMarkerComponent';
// const { ccclass, property } = _decorator;
//
// /** 牌组容器对齐方式 */
// export enum HandAlignment {
//     LEFT = 'left',
//     CENTER = 'center',
//     RIGHT = 'right'
// }
//
// /** 布局快照：单个容器 */
// interface ContainerLayout {
//     node: Node;
//     comp: ContainerComponent;
//     position: Vec3;
//     width: number;
//     cardPositions: Vec3[];
// }
//
// /** 布局快照：完整布局 */
// interface FullLayout {
//     containers: ContainerLayout[];
//     rootWidth: number;
// }
//
// @ccclass('HandComponent')
// export class HandComponent extends Component {
//     private _nodePool: NodePool = null;
//     private model: TongitsModel = TongitsModel.getInstance();
//
//     @property({type: Node, tooltip: "容器根节点"})
//     containersRoot: Node = null;
//
//     @property({type: Node, tooltip: "拖拽层"})
//     dragLayer: Node = null;
//
//     @property({type: Node, tooltip: "标记层"})
//     markerLayer: Node = null;
//
//     /** 单张牌宽度（用于计算组宽度），默认 80 */
//     cardWidth: number = 80;
//     /** 组内牌间距，默认 80 */
//     cardSpacing: number = 80;
//     /** 组与组之间的间距，默认 10 */
//     containerSpacing: number = 10;
//     /** 对齐方式：左/中/右，默认居中 */
//     alignment: HandAlignment = HandAlignment.CENTER;
//
//     /** 当前动画时长 */
//     curAnimateDuration: number = 0.2;
//
//     /** 手牌容器 */
//     private handContainer: Node = null!;
//     /** 卡牌节点 */
//     private cardNode: Node = null!;
//     /** 组标记节点 */
//     private groupMarkerNode: Node = null!;
//
//     /** 开始拖拽的容器 */
//     private startDragContainer: Node = null!;
//     private lastComp: ContainerComponent = null!;
//
//     /** 拖拽移动节流间隔（秒） */
//     private _dragMoveInterval: number = 0.033;  // 33ms ≈ 30fps
//     /** 上次处理拖拽移动的时间 */
//     private _lastDragMoveTime: number = 0;
//
//     private draggingInfo: {
//         node: Node;
//         originalParent: Node;
//         originalLocalPos: Vec3;
//         fromContainer: ContainerComponent;
//         currentContainer: ContainerComponent;
//         dragData: any;
//     } = null;
//
//     // 当前手牌牌组数据
//     private analysisData: HandAnalysisResult = {
//         isSapaw: false,
//         isTongits: false,
//         group: [] as TongitsGroup[],
//         points: 0
//     };
//
//     // ============ 松手飞行（帧驱动 Lerp） ============
//
//     /** 飞行阶段信息（松手后卡牌 lerp 飞往目标位置） */
//     private _settlingInfo: {
//         node: Node;                     // 飞行中的卡牌节点
//         targetDragLayerPos: Vec3;       // 目标位置（dragLayer 坐标系）
//         targetComp: ContainerComponent; // 目标容器（null 表示回退原位）
//         targetLocalPos: Vec3;           // 目标容器本地坐标
//         // 回退时用
//         originalParent: Node;
//         originalLocalPos: Vec3;
//     } | null = null;
//
//     /** 飞行 lerp 速度（比拖拽期间稍快，体感更灵敏） */
//     private readonly SETTLE_LERP_SPEED: number = 25;
//     /** 到达判定阈值 */
//     private readonly SETTLE_EPSILON: number = 1.0;
//     /** 复用 Vec3，减少 GC */
//     private _settleTempVec: Vec3 = new Vec3();
//
//     /** 容器 → 标记节点的映射 */
//     private markerMap: Map<Node, Node> = new Map();
//
//     // ============ 初始化 ============
//
//     public init(handContainer: Node, cardNode: any, groupMarkerNode: Node) {
//         this._nodePool = new NodePool();
//         this.handContainer = handContainer;
//         this.cardNode = cardNode;
//         this.groupMarkerNode = groupMarkerNode;
//         this.putPoolNode(this.handContainer);
//         this.putPoolNode(this.cardNode);
//         this.putPoolNode(this.groupMarkerNode);
//         let cardUT = this.cardNode.getComponent(UITransform);
//         this.cardWidth = cardUT.width;
//     }
//
//     public reset() {
//         // ★ 如果有飞行中的状态，先安全清理，防止锁死
//         if (this._settlingInfo) {
//             this.forceFinishSettling();
//         }
//         this.containersRoot.removeAllChildren();
//         this.draggingInfo = null;
//         this.clearAllMarkers();
//     }
//
//     // ============ 对象池管理 ============
//
//     public putPoolNode(node: Node) {
//         return this._nodePool.put(node, node.name);
//     }
//
//     public getPoolNode(nodeName: string) {
//         return this._nodePool.get(nodeName);
//     }
//
//     // ============ 数据初始化 ============
//
//     public initData(cards: number[], sortMode: 'group' | 'suit' = 'group') {
//         this.rebuildContainers(cards, sortMode);
//         this.expandContainers(false);
//     }
//
//     // ============ 发牌 ============
//
//     public sendCards(
//         cards: number[],
//         dealFromPos: Vec3,
//         sortMode: 'group' | 'suit' = 'group',
//         dealInterval: number = 0.05,
//         dealDuration: number = 0.1,
//         callback?: () => void
//     ) {
//         this.recycleAllContainers();
//         const ui = this.node.getComponent(UITransform);
//         const dealFromLocalPos = ui.convertToNodeSpaceAR(dealFromPos);
//
//         let container = this.createContainer({
//             cards, type: 0, isValid: false, points: 0,
//             isUngroupHand: false, isSpecial: false
//         }, -1, false);
//         let cardPositions = this.calculateCardPositions(cards.length);
//         let dealCards = this.createDealCards(cards, dealFromLocalPos, container);
//
//         this.animateDealCards(container, dealCards, cardPositions, dealInterval, dealDuration, () => {
//             this.sortCards(cards, sortMode, callback);
//         });
//     }
//
//     public sortCards(cards: number[], sortMode: 'group' | 'suit' = 'group', callback?: () => void) {
//         this.disableDrag();
//         this.mergeContainers(true, () => {
//             this.rebuildContainers(cards, sortMode);
//             this.expandContainers(true, callback);
//             this.enableDrag();
//         });
//     }
//
//     public sendSingleCard(card: number, callback?: () => void) {
//         this.deselectAllContainers(false);
//         const container = this.getUngroupHandContainer();
//         if (!container) {
//             console.warn('[HandComponent] sendSingleCard: 未找到 isUngroupHand 容器');
//             callback?.();
//             return;
//         }
//         const cardNode = this.createCardNode(card, false);
//         cardNode.parent = container.node;
//         const slotCount = container.node.children.length;
//         const cardPositions = this.calculateCardPositions(slotCount);
//         const finalPos = cardPositions[slotCount - 1];
//         const pos = finalPos.clone();
//         cardNode.setPosition(pos.x, pos.y + 60, pos.z);
//         this.validateContainerData(container);
//         this.applyLayout(this.calculateFullLayout(), true);
//         this.scheduleOnce(() => callback?.(), this.curAnimateDuration + 0.05);
//     }
//
//     // ============ 打牌 ============
//
//     public discardSingleCard(card: number, callback?: () => void) {
//         this.deselectAllContainers(false);
//         for (const containerNode of this.containersRoot.children) {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (!comp) continue;
//             for (const child of containerNode.children) {
//                 const cardComp = child.getComponent(CardComponent);
//                 if (cardComp && cardComp.getData() === card) {
//                     Tween.stopAllByTarget(child);
//                     child.removeFromParent();
//                     this.putPoolNode(child);
//                     this.validateContainerData(comp);
//                     this.applyLayout(this.calculateFullLayout(), true);
//                     this.scheduleOnce(() => callback?.(), this.curAnimateDuration + 0.05);
//                     return;
//                 }
//             }
//         }
//         callback?.();
//     }
//
//     public disCards(cards: number[], callback?: () => void) {
//         this.deselectAllContainers(false);
//         if (!cards?.length) {
//             callback?.();
//             return;
//         }
//         for (const cardId of cards) {
//             for (const containerNode of this.containersRoot.children) {
//                 const comp = containerNode.getComponent(ContainerComponent);
//                 if (!comp) continue;
//                 for (const child of containerNode.children) {
//                     const cardComp = child.getComponent(CardComponent);
//                     if (cardComp && cardComp.getData() === cardId) {
//                         Tween.stopAllByTarget(child);
//                         child.removeFromParent();
//                         this.putPoolNode(child);
//                         break;
//                     }
//                 }
//             }
//         }
//         const toRemove: Node[] = [];
//         this.containersRoot.children.forEach((containerNode) => {
//             if (containerNode.children.length === 0) toRemove.push(containerNode);
//         });
//         toRemove.forEach((containerNode) => {
//             containerNode.removeFromParent();
//             this.putPoolNode(containerNode);
//         });
//         this.containersRoot.children.forEach((containerNode) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (comp && containerNode.children.length > 0) this.validateContainerData(comp);
//         });
//         this.applyLayout(this.calculateFullLayout(), true);
//         this.scheduleOnce(() => callback?.(), this.curAnimateDuration + 0.05);
//     }
//
//     // ============ 收集牌节点 ============
//
//     private collectCardNodesAndRemoveEmptyContainers(cards: number[]): Node[] {
//         const cardNodes: Node[] = [];
//         for (const cardId of cards) {
//             let found = false;
//             for (const containerNode of this.containersRoot.children) {
//                 if (found) break;
//                 const comp = containerNode.getComponent(ContainerComponent);
//                 if (!comp) continue;
//                 for (const child of containerNode.children) {
//                     const cardComp = child.getComponent(CardComponent);
//                     if (cardComp && cardComp.getData() === cardId) {
//                         Tween.stopAllByTarget(child);
//                         child.removeFromParent();
//                         cardNodes.push(child);
//                         found = true;
//                         break;
//                     }
//                 }
//             }
//         }
//         const toRemove: Node[] = [];
//         this.containersRoot.children.forEach((containerNode) => {
//             if (containerNode.children.length === 0) toRemove.push(containerNode);
//         });
//         toRemove.forEach((containerNode) => {
//             containerNode.removeFromParent();
//             this.putPoolNode(containerNode);
//         });
//         return cardNodes;
//     }
//
//     // ============ 组合/解散牌组 ============
//
//     public groupCards(callback?: () => void) {
//         // 1. 获取散牌区选中的牌
//         const ungroupContainer = this.getUngroupHandContainer();
//         if (!ungroupContainer) {
//             callback?.();
//             return;
//         }
//
//         const selectedCards = ungroupContainer.getSelectedData();
//         if (selectedCards.length < 2) {
//             callback?.();
//             return;
//         }
//
//         this.deselectAllContainers(false);
//
//         const cardNodes = this.collectCardNodesAndRemoveEmptyContainers(selectedCards);
//         if (cardNodes.length === 0) {
//             callback?.();
//             return;
//         }
//
//         const result = CardGroupValidator.validate(selectedCards);
//         const points = result.isValid ? 0 : selectedCards.reduce((sum, id) => sum + CardGroupValidator.getCardPoints(id), 0);
//
//         const group: TongitsGroup = {
//             cards: [...selectedCards],
//             type: result.type,
//             isValid: result.isValid,
//             points,
//             isUngroupHand: false,
//             isSpecial: result.isSpecial
//         };
//
//         const ungroupNode = this.getUngroupHandContainer()?.node;
//         const insertIndex = ungroupNode
//             ? this.containersRoot.children.indexOf(ungroupNode)
//             : this.containersRoot.children.length;
//
//         const container = this.createContainer(group, insertIndex, false);
//         container.setSiblingIndex(insertIndex);
//
//         const comp = container.getComponent(ContainerComponent);
//
//         cardNodes.sort((a, b) => {
//             const idA = a.getComponent(CardComponent)?.getData() ?? 0;
//             const idB = b.getComponent(CardComponent)?.getData() ?? 0;
//             const valueA = CardGroupValidator.getCardValue(idA);
//             const valueB = CardGroupValidator.getCardValue(idB);
//             if (valueA !== valueB) return valueA - valueB;
//             return CardGroupValidator.getCardSuit(idB) - CardGroupValidator.getCardSuit(idA);
//         });
//
//         cardNodes.forEach((node, i) => {
//             node.parent = container;
//             node.setSiblingIndex(i);
//         });
//
//         if (comp) this.validateContainerData(comp);
//         this.syncAllContainersGroupData();  // ★ 内部会调 syncMarkers
//         this.applyLayout(this.calculateFullLayout(), false);
//         this.scheduleOnce(() => callback?.(), this.curAnimateDuration + 0.05);
//     }
//
//     public unGroupCards(callback?: () => void) {
//         const selectedContainers = this.containersRoot.children
//         .map(n => n.getComponent(ContainerComponent))
//         .filter((c): c is ContainerComponent =>
//             c != null && !c.isUngroupHand && c.getSelectedData().length > 0
//         );
//
//         if (selectedContainers.length !== 1) {
//             callback?.();
//             return;
//         }
//
//         const targetContainer = selectedContainers[0];
//         const allCards = targetContainer.getCardIds();
//         if (!allCards.length) {
//             callback?.();
//             return;
//         }
//
//         this.deselectAllContainers(false);
//
//         const cardNodes = this.collectCardNodesAndRemoveEmptyContainers(allCards);
//         if (cardNodes.length === 0) {
//             callback?.();
//             return;
//         }
//
//         let ungroupContainer = this.getUngroupHandContainer();
//         if (!ungroupContainer) {
//             const group: TongitsGroup = {
//                 cards: [],
//                 type: TongitsGroupType.INVALID,
//                 isValid: false,
//                 points: 0,
//                 isUngroupHand: true,
//                 isSpecial: false
//             };
//             this.createContainer(group, this.containersRoot.children.length, false);
//             ungroupContainer = this.getUngroupHandContainer();
//         }
//         if (!ungroupContainer) {
//             callback?.();
//             return;
//         }
//
//         cardNodes.forEach(node => {
//             node.parent = ungroupContainer!.node;
//         });
//
//         const children = [...ungroupContainer.node.children];
//         children.sort((a, b) => {
//             const idA = a.getComponent(CardComponent)?.getData() ?? 0;
//             const idB = b.getComponent(CardComponent)?.getData() ?? 0;
//             const valueA = CardGroupValidator.getCardValue(idA);
//             const valueB = CardGroupValidator.getCardValue(idB);
//             if (valueA !== valueB) return valueA - valueB;
//             return CardGroupValidator.getCardSuit(idB) - CardGroupValidator.getCardSuit(idA);
//         });
//         children.forEach((child, i) => child.setSiblingIndex(i));
//
//         this.validateContainerData(ungroupContainer);
//         this.syncAllContainersGroupData();  // ★ 内部会调 syncMarkers
//         this.applyLayout(this.calculateFullLayout(), false);
//         this.scheduleOnce(() => callback?.(), this.curAnimateDuration + 0.05);
//     }
//
//     // ============ 选中查询 ============
//
//     public hasSelectedValidGroup(): boolean {
//         return this.containersRoot.children.some((containerNode) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             return comp != null && comp.getSelectedData().length > 0 && (comp.getGroupData()?.isValid === true);
//         });
//     }
//
//     public getSelectedLooseCardsCount(): number {
//         const ung = this.getUngroupHandContainer();
//         return ung ? ung.getSelectedData().length : 0;
//     }
//
//     public getSelectedGroupCount(): number {
//         return this.containersRoot.children.filter((containerNode) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             return comp != null && !comp.isUngroupHand && comp.getSelectedData().length > 0;
//         }).length;
//     }
//
//     public getSelectedValidGroupCards(): number[] {
//         const c = this.containersRoot.children
//             .map((n) => n.getComponent(ContainerComponent))
//             .find((comp): comp is ContainerComponent => comp != null && comp.getSelectedData().length > 0 && (comp.getGroupData()?.isValid === true));
//         return c ? c.getSelectedData() : [];
//     }
//
//     public getSelectedLooseCards(): number[] {
//         const ung = this.getUngroupHandContainer();
//         if (!ung) return [];
//         return ung.getSelectedData().filter((id: any): id is number => typeof id === 'number');
//     }
//
//     public getUngroupHandContainer(): ContainerComponent | null {
//         const comps = this.containersRoot.children
//             .map((n) => n.getComponent(ContainerComponent))
//             .filter((c): c is ContainerComponent => c != null);
//         return comps.find((c) => c.isUngroupHand) ?? null;
//     }
//
//     public getSelectedGroups(): number[] {
//         const selectedContainers = this.containersRoot.children
//             .map((n) => n.getComponent(ContainerComponent))
//             .filter((c): c is ContainerComponent => c != null && c.getSelectedData().length > 0);
//         const validOne = selectedContainers.find((c) => c.getGroupData()?.isValid === true);
//         if (selectedContainers.length !== 1 || !validOne) return [];
//         return validOne.getSelectedData();
//     }
//
//     private deselectAllContainers(animate: boolean = false) {
//         this.containersRoot.children.forEach((containerNode) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (comp && comp.getSelectedData().length > 0) comp.deselectAll(animate);
//         });
//     }
//
//     // ============ 选中变化通知 ============
//
//     public onSelectionChanged: (selectedData: number[]) => void = null;
//
//     public onCardClick(node: Node) {
//         // ★ 飞行中或拖拽中不允许点击选中
//         if (this._settlingInfo || this.draggingInfo) return;
//         const containerNode = node.parent;
//         if (!containerNode || containerNode.getParent() !== this.containersRoot) return;
//         const comp = containerNode.getComponent(ContainerComponent);
//         if (!comp) return;
//         comp.handleCardClick(node);
//     }
//
//     private _notifySelectionChanged() {
//         if (!this.onSelectionChanged) return;
//         const selectedData: number[] = [];
//         this.containersRoot.children.forEach((containerNode) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (comp) selectedData.push(...comp.getSelectedData());
//         });
//         this.onSelectionChanged(selectedData);
//     }
//
//     // ============ 拖拽回调 ============
//
//     /** 拖拽开始 */
//     public onDragStart(node: Node) {
//         if (this._settlingInfo || this.draggingInfo) return;
//
//         // ★ 第一步：清除所有残留 tween，容器和卡牌全部 snap 到最终位置
//         this.stopAllTweensAndSnap();
//
//         this.deselectAllContainers(false);
//
//         // 此时所有位置都是最终值，记录的 originalLocalPos 一定正确
//         this.startDragContainer = node.parent as Node;
//         const fromComp = this.startDragContainer.getComponent(ContainerComponent) ?? null;
//         const dragData = node.getComponent(CardComponent)?.getData() ?? null;
//         const childIndex = this.startDragContainer.children.indexOf(node);
//
//         this.containersRoot.children.forEach((container) => {
//             const comp = container.getComponent(ContainerComponent);
//             if (comp) comp.initSlots();
//         });
//
//         this.draggingInfo = {
//             node,
//             originalParent: node.parent as Node,
//             originalLocalPos: node.position.clone(),
//             fromContainer: fromComp,
//             currentContainer: fromComp,
//             dragData
//         };
//
//         this.lastComp = fromComp;
//         this._lastDragMoveTime = 0;
//
//         const dragLayerLocalPos = CoordinateHelper.localToLocal(node.position, node.parent, this.dragLayer);
//         if (!dragLayerLocalPos) {
//             console.error('[HandComponent] 坐标转换失败');
//             this.draggingInfo = null;
//             return;
//         }
//         node.parent = this.dragLayer;
//         node.setPosition(dragLayerLocalPos);
//
//         if (fromComp) {
//             fromComp.setSlotNull(childIndex);
//         }
//
//         this.containersRoot.children.forEach((container) => {
//             const comp = container.getComponent(ContainerComponent);
//             if (comp) comp.enterDragMode();
//         });
//
//         this.refreshAllTargets();
//         this.disableDrag();
//         this.syncMarkers();
//     }
//
//     /** ★ 拖拽结束：启动帧驱动飞行（替代 tween） */
//     public onDragEnd(node: Node) {
//         if (!this.draggingInfo || this.draggingInfo.node !== node) return;
//
//         // 所有容器退出拖拽模式
//         this.containersRoot.children.forEach((container) => {
//             const comp = container.getComponent(ContainerComponent);
//             if (comp) comp.exitDragMode();
//         });
//
//         const targetComp = this.draggingInfo.currentContainer;
//         const targetNode = targetComp.node;
//         const emptyIndex = targetComp.getEmptySlotIndex();
//         const slotCount = targetComp.getSlotCount();
//         const cardPositions = this.calculateCardPositions(slotCount);
//         const targetLocalPos = cardPositions[emptyIndex];
//
//         const flyToPos = CoordinateHelper.localToLocal(targetLocalPos, targetNode, this.dragLayer);
//
//         if (flyToPos) {
//             // ★ 启动帧驱动飞行（替代 tween）
//             this._settlingInfo = {
//                 node,
//                 targetDragLayerPos: flyToPos,
//                 targetComp,
//                 targetLocalPos,
//                 originalParent: null,
//                 originalLocalPos: null
//             };
//         } else {
//             // 坐标转换失败，回退原位
//             const originalPos = CoordinateHelper.localToLocal(
//                 this.draggingInfo.originalLocalPos,
//                 this.draggingInfo.originalParent,
//                 this.dragLayer
//             );
//             if (originalPos) {
//                 this._settlingInfo = {
//                     node,
//                     targetDragLayerPos: originalPos,
//                     targetComp: null,
//                     targetLocalPos: null,
//                     originalParent: this.draggingInfo.originalParent,
//                     originalLocalPos: this.draggingInfo.originalLocalPos
//                 };
//             } else {
//                 // 彻底失败，直接清理
//                 node.parent = this.draggingInfo.originalParent;
//                 node.setPosition(this.draggingInfo.originalLocalPos);
//                 this.finishDragSettling(null, null, null);
//             }
//         }
//     }
//
//     /** 拖拽移动 */
//     public onDragMove(node: Node, pos: Vec3) {
//         if (!this.draggingInfo || this.draggingInfo.node !== node) return;
//         // ★ 飞行中不处理移动
//         if (this._settlingInfo) return;
//
//         const worldPos = CoordinateHelper.localToWorld(pos, node.parent);
//
//         // dragLimit 每帧执行，保证跟手
//         this.dragLimit(worldPos);
//
//         // 节流：容器检测和槽位更新
//         const now = Date.now();
//         if (now - this._lastDragMoveTime < this._dragMoveInterval * 1000) return;
//         this._lastDragMoveTime = now;
//
//         const targetContainer = this.findContainerAtWorldPosX(worldPos);
//         if (!targetContainer) return;
//
//         const previousContainer = this.draggingInfo.currentContainer;
//         if (!targetContainer || !previousContainer) return;
//
//         if (targetContainer.index !== previousContainer.index) {
//             // ---- 跨容器 ----
//             this.lastComp = previousContainer;
//             this.draggingInfo.currentContainer = targetContainer;
//             let lastIndex = this.lastComp?.index;
//             let targetIndex = targetContainer?.index;
//             console.log("跨容器拖拽切换之后的容器索引:", this.draggingInfo.currentContainer?.index,
//                 "上一个容器索引:", this.lastComp?.index,
//                 lastIndex < targetIndex ? "--从左到右" : "--从右到左"
//             );
//             this.switchContainers(previousContainer, targetContainer);
//                     // ★ 跨容器：只更新涉及的两个容器标记状态
//             this.syncMarkerForContainer(previousContainer.node);
//             this.syncMarkerForContainer(targetContainer.node);
//         }
//         else {
//             // ---- 同容器内移动 ----
//             const newSlotIndex = this.calculateSlotIndex(targetContainer, worldPos.x);
//             targetContainer.moveEmptySlotTo(newSlotIndex);
//         }
//
//         // ★ 统一刷新所有目标值（update 会 lerp 到位，无 tween）
//         this.refreshAllTargets();
//     }
//
//     /**
//      * 停掉所有残留 tween，将容器和卡牌 snap 到最终布局位置
//      * 确保 onDragStart 记录的位置一定是正确的最终值
//      */
//     private stopAllTweensAndSnap() {
//         // 1. 停掉 root 宽度 tween
//         const rootUT = this.containersRoot.getComponent(UITransform);
//         if (rootUT) Tween.stopAllByTarget(rootUT);
//
//         // 2. 停掉所有容器和卡牌的 tween
//         this.containersRoot.children.forEach((containerNode) => {
//             Tween.stopAllByTarget(containerNode);
//             const ut = containerNode.getComponent(UITransform);
//             if (ut) Tween.stopAllByTarget(ut);
//             containerNode.children.forEach((cardNode) => {
//                 Tween.stopAllByTarget(cardNode);
//             });
//         });
//
//         // 3. 计算正确的最终布局并立即 snap
//         const layout = this.calculateFullLayout();
//         for (const cl of layout.containers) {
//             if (!cl.comp) continue;
//             cl.comp.setPosition(cl.position, false);
//             cl.comp.setWidth(cl.width, false);
//             cl.comp.setCardPositions(cl.cardPositions, false);
//         }
//         if (rootUT) rootUT.width = layout.rootWidth;
//     }
//
//     // ============ 帧驱动：松手飞行 ============
//
//     update(dt: number) {
//         // 松手飞行阶段
//         if (this._settlingInfo) {
//             const info = this._settlingInfo;
//             const node = info.node;
//
//             if (!node || !node.parent) {
//                 this.forceFinishSettling();
//                 return;
//             }
//
//             const t = Math.min(1, this.SETTLE_LERP_SPEED * dt);
//             const cur = node.position;
//             const target = info.targetDragLayerPos;
//
//             Vec3.lerp(this._settleTempVec, cur, target, t);
//             node.setPosition(this._settleTempVec);
//
//             if (Math.abs(cur.x - target.x) < this.SETTLE_EPSILON
//                 && Math.abs(cur.y - target.y) < this.SETTLE_EPSILON) {
//                 node.setPosition(target);
//                 this.onSettlingComplete();
//             }
//             return;  // settling 阶段不需要同步标记
//         }
//
//         // ★ 拖拽期间每帧同步标记位置和宽度
//         if (this.draggingInfo) {
//             this.syncMarkerPositions();
//         }
//     }
//
//     /** 飞行到达后完成清理 */
//     private onSettlingComplete() {
//         const info = this._settlingInfo;
//         if (!info) return;
//
//         if (info.targetComp) {
//             // 成功放入目标容器
//             this.finishDragSettling(info.node, info.targetComp, info.targetLocalPos);
//         } else {
//             // 回退原位
//             info.node.parent = info.originalParent;
//             info.node.setPosition(info.originalLocalPos);
//             this.finishDragSettling(null, null, null);
//         }
//
//         this._settlingInfo = null;
//     }
//
//     /**
//      * 飞行完成后的统一清理（单一出口）
//      */
//     private finishDragSettling(node: Node | null, targetComp: ContainerComponent | null, targetLocalPos: Vec3 | null) {
//         if (node && targetComp && targetLocalPos) {
//             targetComp.replaceEmptySlot(node);
//             node.setPosition(targetLocalPos);
//         }
//
//         this.containersRoot.children.forEach((container) => {
//             const comp = container.getComponent(ContainerComponent);
//             if (comp) comp.clearSlots();
//         });
//
//         const layout = this.calculateFullLayout();
//
//         // ★ 全部 snap，零残留
//         for (const cl of layout.containers) {
//             if (!cl.comp) continue;
//             cl.comp.setPosition(cl.position, false);
//             cl.comp.setWidth(cl.width, false);
//             cl.comp.setCardPositions(cl.cardPositions, false);
//         }
//         this.updateRootWidth(layout.rootWidth, false);
//
//         this.syncAllContainersGroupData();
//         this.syncContainerIndices();
//         this.draggingInfo = null;
//         this.enableDrag();
//     }
//
//     /**
//      * 强制结束飞行（reset 等场景调用，防止锁死）
//      */
//     private forceFinishSettling() {
//         this._settlingInfo = null;
//         this.containersRoot.children.forEach((container) => {
//             const comp = container.getComponent(ContainerComponent);
//             if (comp) comp.clearSlots();
//         });
//         this.draggingInfo = null;
//     }
//
//     // ============ 合并/展开容器（非拖拽操作，使用 tween） ============
//
//     public mergeContainers(animate: boolean = true, callback?: () => void) {
//         // ★ 折叠前隐藏所有标记
//         this.hideAllMarkers();
//         let containers = this.containersRoot.children;
//         containers.forEach((container: Node) => {
//             this.updateContainerPosition(container, new Vec3(0, 0, 0), animate);
//             this.updateContainerWidth(container, 0, animate);
//             this.updateCardPosition(container, 0, animate);
//         });
//         this.updateRootWidth(this.cardWidth, animate);
//         this.scheduleOnce(() => {
//             callback?.();
//         }, this.curAnimateDuration + 0.2);
//     }
//
//     public expandContainers(animate: boolean = true, callback?: () => void) {
//         const containerPositions = this.calculateContainerPositions(this.analysisData.group);
//         this.updateAllContainers(this.analysisData.group, containerPositions, animate);
//         if(animate){
//             this.scheduleOnce(() => {
//                 // ★ 展开完成后同步标记（位置 + 状态 + 显示）
//                 this.syncMarkers();
//                 callback?.();
//             }, this.curAnimateDuration);
//         }
//         else {
//             this.syncMarkers();
//             callback?.();
//         }
//     }
//
//
//
//     // ============ 跨容器切换（纯状态操作，零动画） ============
//
//     public switchContainers(
//         lastContainer: ContainerComponent,
//         targetContainer: ContainerComponent,
//     ) {
//         lastContainer.removeEmptySlot();
//
//         targetContainer.insertEmptySlot(0);
//         const tempLayout = this.calculateFullLayout();
//         targetContainer.removeEmptySlot();
//
//         const targetIdx = this.containersRoot.children.indexOf(targetContainer.node);
//         const tempContainerPos = tempLayout.containers[targetIdx]?.position ?? new Vec3();
//
//         const dragWorldX = this.draggingInfo.node.worldPosition.x;
//         const newSlotCount = targetContainer.getSlotCount() + 1;
//         const insertIndex = this.calculateInsertIndexByTargetPos(
//             dragWorldX, newSlotCount, tempContainerPos
//         );
//
//         targetContainer.insertEmptySlot(insertIndex);
//
//         this.validateContainerData(lastContainer);
//         const dragCardId = this.draggingInfo?.dragData;
//         this.validateContainerData(
//             targetContainer,
//             dragCardId != null ? { draggingCardId: dragCardId } : undefined
//         );
//     }
//
//     // ============ 布局快照系统（核心） ============
//
//     private calculateFullLayout(): FullLayout {
//         const containers = this.containersRoot.children;
//         const layouts: ContainerLayout[] = [];
//
//         const slotCounts = containers.map((c) => {
//             const comp = c.getComponent(ContainerComponent);
//             return (comp && comp.getSlotCount() > 0) ? comp.getSlotCount() : c.children.length;
//         });
//
//         const widths = slotCounts.map((count) => this.calculateContainerWidth(count));
//         const totalWidth = widths.reduce((a, w) => a + w, 0)
//             + (containers.length - 1) * this.containerSpacing;
//
//         let startX = -totalWidth / 2;
//         for (let i = 0; i < containers.length; i++) {
//             const w = widths[i];
//             const centerX = startX + w / 2;
//             const comp = containers[i].getComponent(ContainerComponent);
//             const cardPositions = this.calculateCardPositions(slotCounts[i]);
//
//             layouts.push({
//                 node: containers[i],
//                 comp,
//                 position: new Vec3(centerX, 0, 0),
//                 width: w,
//                 cardPositions
//             });
//
//             startX += w + this.containerSpacing;
//         }
//
//         return { containers: layouts, rootWidth: totalWidth };
//     }
//
//     private applyLayout(layout: FullLayout, animate: boolean) {
//         for (const cl of layout.containers) {
//             if (!cl.comp) continue;
//
//             cl.comp.setPosition(cl.position, animate, this.curAnimateDuration);
//             cl.comp.setWidth(cl.width, animate, this.curAnimateDuration);
//
//             if (cl.comp.getSlotCount() > 0) {
//                 cl.comp.updateBySlots(cl.cardPositions, animate, this.curAnimateDuration);
//             } else {
//                 cl.comp.setCardPositions(cl.cardPositions, animate, this.curAnimateDuration);
//             }
//         }
//
//         this.updateRootWidth(layout.rootWidth, animate);
//
//         // ★ 布局变化后，标记位置需要延迟同步（等 tween 完成）
//         if (animate) {
//             this.scheduleOnce(() => this.syncMarkers(), this.curAnimateDuration);
//         } else {
//             this.syncMarkers();
//         }
//     }
//
//     private refreshAllTargets() {
//         const layout = this.calculateFullLayout();
//
//         for (const cl of layout.containers) {
//             if (!cl.comp) continue;
//
//             cl.comp.setTargetPositionOnly(cl.position);
//             cl.comp.setTargetWidthOnly(cl.width);
//             cl.comp.setSlotTargetPositions(cl.cardPositions);
//         }
//
//         const ut = this.containersRoot.getComponent(UITransform);
//         if (ut) ut.width = layout.rootWidth;
//     }
//
//     // ============ 牌组数据校验 ============
//
//     public validateContainerData(container: ContainerComponent, options?: { draggingCardId?: number }) {
//         const cardIds = (options?.draggingCardId != null && container.hasEmptySlot())
//             ? container.getCardIdsWithDraggingCard(options.draggingCardId)
//             : container.getCardIds();
//         if (cardIds.length === 0) {
//             container.setGroupData(null);
//             return;
//         }
//         const result = CardGroupValidator.validate(cardIds);
//         const points = result.isValid ? 0 : cardIds.reduce((sum, id) => sum + CardGroupValidator.getCardPoints(id), 0);
//         const wasUngroupHand = container.getGroupData()?.isUngroupHand ?? false;
//         container.setGroupData({
//             cards: cardIds,
//             type: result.type,
//             isValid: result.isValid,
//             points,
//             isUngroupHand: wasUngroupHand,
//             isSpecial: result.isSpecial
//         });
//     }
//
//     public syncAllContainersGroupData() {
//         this.containersRoot.children.forEach((containerNode, i) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (comp) {
//                 this.validateContainerData(comp);
//                 comp.setContainerIndex(i);  // ★ 顺带同步索引
//             }
//         });
//         //同步标记节点
//         this.syncMarkers();
//     }
//
//     // ============ 容器查找与索引计算 ============
//
//     private findContainerAtWorldPosX(worldPos: Vec3): ContainerComponent | null {
//         const children = this.containersRoot.children;
//         const rootUT = this.containersRoot.getComponent(UITransform);
//         if (!rootUT) return null;
//         const rootLocalX = rootUT.convertToNodeSpaceAR(worldPos).x;
//         const halfGap = this.containerSpacing / 2;
//
//         for (let i = 0; i < children.length; i++) {
//             const comp = children[i].getComponent(ContainerComponent);
//             if (!comp) continue;
//
//             const targetX = comp.getTargetPosition().x;
//             const halfW = comp.getTargetWidth() / 2 + halfGap;
//
//             const dx = rootLocalX - targetX;
//             if (dx >= -halfW && dx <= halfW) {
//                 return comp;
//             }
//         }
//         return null;
//     }
//
//     private calculateInsertIndex(containerComp: ContainerComponent, worldPosX: number, newSlotCount: number): number {
//         const positions = this.calculateCardPositions(newSlotCount);
//         if (positions.length === 0) return 0;
//
//         const rootUT = this.containersRoot.getComponent(UITransform);
//         if (!rootUT) return 0;
//         const rootLocalX = rootUT.convertToNodeSpaceAR(new Vec3(worldPosX, 0, 0)).x;
//         const localX = rootLocalX - containerComp.getTargetPosition().x;
//
//         if (localX <= positions[0].x) return 0;
//         if (localX >= positions[positions.length - 1].x) return newSlotCount - 1;
//
//         for (let i = 0; i < positions.length - 1; i++) {
//             const mid = (positions[i].x + positions[i + 1].x) / 2;
//             if (localX < mid) return i;
//         }
//         return newSlotCount - 1;
//     }
//
//     private calculateInsertIndexByTargetPos(worldPosX: number, newSlotCount: number, containerTargetPos: Vec3): number {
//         const positions = this.calculateCardPositions(newSlotCount);
//         if (positions.length === 0) return 0;
//
//         const rootUT = this.containersRoot.getComponent(UITransform);
//         if (!rootUT) return 0;
//         const rootLocalX = rootUT.convertToNodeSpaceAR(new Vec3(worldPosX, 0, 0)).x;
//         const localX = rootLocalX - containerTargetPos.x;
//
//         if (localX <= positions[0].x) return 0;
//         if (localX >= positions[positions.length - 1].x) return newSlotCount - 1;
//
//         for (let i = 0; i < positions.length - 1; i++) {
//             const mid = (positions[i].x + positions[i + 1].x) / 2;
//             if (localX < mid) return i;
//         }
//         return newSlotCount - 1;
//     }
//
//     private calculateSlotIndex(containerComp: ContainerComponent, worldPosX: number): number {
//         const slotCount = containerComp.getSlotCount();
//         const positions = this.calculateCardPositions(slotCount);
//         if (positions.length === 0) return 0;
//
//         const rootUT = this.containersRoot.getComponent(UITransform);
//         if (!rootUT) return 0;
//         const rootLocalX = rootUT.convertToNodeSpaceAR(new Vec3(worldPosX, 0, 0)).x;
//         const localX = rootLocalX - containerComp.getTargetPosition().x;
//
//         if (localX <= positions[0].x) return 0;
//         if (localX >= positions[positions.length - 1].x) return slotCount - 1;
//
//         for (let i = 0; i < positions.length - 1; i++) {
//             const mid = (positions[i].x + positions[i + 1].x) / 2;
//             if (localX < mid) return i;
//         }
//         return slotCount - 1;
//     }
//
//     // ============ 容器/卡牌创建与回收 ============
//
//     private recycleAllContainers() {
//         const containers = [...this.containersRoot.children];
//         containers.forEach((container: Node) => {
//             const cards = [...container.children];
//             cards.forEach((cardNode: Node) => {
//                 cardNode.removeFromParent();
//                 this.putPoolNode(cardNode);
//             });
//             container.removeFromParent();
//             this.putPoolNode(container);
//         });
//     }
//
//     private rebuildContainers(cards: number[], sortMode: 'group' | 'suit' = 'group') {
//         this.recycleAllContainers();
//         this.analysisData = CardGroupValidator.getSortedCards(cards, sortMode);
//         console.log('分析结果:', this.analysisData);
//         const containerPositions = this.calculateContainerPositions(this.analysisData.group);
//         console.log('容器位置:', containerPositions);
//         this.analysisData.group.forEach((group: TongitsGroup, index: number) => {
//             if (group.cards.length > 0) {
//                 this.createContainer(group, index);
//             }
//         });
//     }
//
//     private createContainer(group: TongitsGroup, index: number = 0, createCard: boolean = true): Node {
//         let container = this.getPoolNode(this.handContainer.name);
//         container.setPosition(0, 0, 0);
//         container.parent = this.containersRoot;
//
//         let comp: ContainerComponent = container.getComponent(ContainerComponent);
//         if (!comp) comp = container.addComponent(ContainerComponent);
//         comp.reset();
//         comp.setAnimateDuration(this.curAnimateDuration);
//         comp.setContainerIndex(index);
//         comp.setGroupData(group);
//         comp.clearSelection();
//         comp.onSelectionChanged = () => this._notifySelectionChanged();
//         if (createCard) {
//             group.cards.forEach((card: number, index: number) => {
//                 let cardNode = this.createCardNode(card, false);
//                 cardNode.setPosition(0, 0, 0);
//                 cardNode.parent = container;
//             });
//         }
//         return container;
//     }
//
//     private createCardNode(cardId: number, isBack: boolean = false): Node {
//         const node = this.getPoolNode(this.cardNode.name);
//         const cardComponent: CardComponent = node.getComponent(CardComponent);
//         if (cardComponent) {
//             cardComponent.setData(cardId);
//             if (isBack) {
//                 cardComponent.setCardBack();
//             } else {
//                 cardComponent.showFront();
//             }
//         }
//         const drag: Drag = node.getComponent(Drag);
//         if (drag) {
//             drag.onDragStart = (n: Node) => this.onDragStart(n);
//             drag.onDragEnd = (n: Node) => this.onDragEnd(n);
//             drag.onDragMove = (n: Node, _e: EventTouch, pos: Vec3) => this.onDragMove(n, pos);
//             drag.onClick = (n: Node) => this.onCardClick(n);
//         }
//         return node;
//     }
//
//     private createDealCards(cards: number[], dealFromPos: Vec3, parent: Node): Node[] {
//         const dealCards: Node[] = [];
//         cards.forEach((card, index) => {
//             const cardNode = this.createCardNode(card, true);
//             cardNode.setScale(0.6, 0.6, 1);
//             cardNode.parent = parent;
//             let y = dealFromPos.y + cards.length / 2 + index * 0.5;
//             cardNode.setPosition(dealFromPos.x, y, dealFromPos.z);
//             cardNode.getComponent(Drag).enabled = false;
//             dealCards.unshift(cardNode);
//         });
//         return dealCards;
//     }
//
//     // ============ 布局计算（纯计算，不修改节点） ============
//
//     private calculateRootWidth(groups: TongitsGroup[]): { totalWidth: number, widths: number[] } {
//         const widths: number[] = groups.map(g => this.calculateContainerWidth(g.cards?.length ?? 0));
//         const totalWidth = widths.reduce((a, w) => a + w, 0) + (groups.length - 1) * this.containerSpacing;
//         return { totalWidth: totalWidth, widths: widths };
//     }
//
//     private calculateContainerPositions(groups: TongitsGroup[]): Vec3[] {
//         const positions: Vec3[] = [];
//         if (!groups || groups.length === 0) return positions;
//         const { totalWidth, widths } = this.calculateRootWidth(groups);
//         let startX: number = -totalWidth / 2;
//         for (let i = 0; i < groups.length; i++) {
//             const w = widths[i];
//             const centerX = startX + w / 2;
//             positions.push(new Vec3(centerX, 0, 0));
//             startX += w + this.containerSpacing;
//         }
//         return positions;
//     }
//
//     private calculateContainerWidth(length: number): number {
//         return (length - 1) * this.cardSpacing + this.cardWidth;
//     }
//
//     private calculateCardPositions(length: number): Vec3[] {
//         const positions: Vec3[] = [];
//         if (length <= 0) return positions;
//         const totalWidth = this.calculateContainerWidth(length);
//         const startX = -totalWidth / 2 + this.cardWidth / 2;
//         for (let i = 0; i < length; i++) {
//             positions.push(new Vec3(startX + i * this.cardSpacing, 0, 0));
//         }
//         return positions;
//     }
//
//     // ============ 普通模式布局更新（非拖拽时使用） ============
//
//     private updateAllContainers(groups: TongitsGroup[], containerPositions: Vec3[], animate: boolean = false) {
//         let containers = this.containersRoot.children;
//         containers.forEach((container: Node, index: number) => {
//             this.updateContainerPosition(container, containerPositions[index], animate);
//             this.updateContainerWidth(container, groups[index]?.cards?.length ?? 0, animate);
//             this.updateCardPosition(container, groups[index]?.cards?.length ?? 0, animate);
//         });
//         const { totalWidth } = this.calculateRootWidth(groups);
//         this.updateRootWidth(totalWidth, animate);
//     }
//
//     private updateCardPosition(container: Node, length: number = 0, animate: boolean = false) {
//         const comp = container.getComponent(ContainerComponent);
//         if (comp) {
//             const positions = length === 0
//                 ? container.children.map(() => new Vec3(0, 0, 0))
//                 : this.calculateCardPositions(length);
//             comp.setCardPositions(positions, animate, this.curAnimateDuration);
//         } else {
//             if (length === 0) {
//                 container.children.forEach((cardNode: Node) => {
//                     this.setCardPosition(cardNode, new Vec3(0, 0, 0), animate);
//                 });
//             } else {
//                 const cardPositions = this.calculateCardPositions(length);
//                 container.children.forEach((cardNode: Node, index: number) => {
//                     this.setCardPosition(cardNode, cardPositions[index], animate);
//                 });
//             }
//         }
//     }
//
//     private updateContainerPosition(container: Node, position: Vec3, animate: boolean = false) {
//         const comp = container.getComponent(ContainerComponent);
//         if (comp) {
//             comp.setPosition(position, animate, this.curAnimateDuration);
//         } else {
//             Tween.stopAllByTarget(container);
//             if (animate) {
//                 tween(container).to(this.curAnimateDuration, { position }).start();
//             } else {
//                 container.setPosition(position);
//             }
//         }
//     }
//
//     private updateContainerWidth(container: Node, length: number, animate: boolean = false) {
//         const width = this.calculateContainerWidth(length);
//         const comp = container.getComponent(ContainerComponent);
//         if (comp) {
//             comp.setWidth(width, animate, this.curAnimateDuration);
//         } else {
//             const ut = container.getComponent(UITransform);
//             if (ut) {
//                 Tween.stopAllByTarget(ut);
//                 if (animate) {
//                     tween(ut).to(this.curAnimateDuration, { width }).start();
//                 } else {
//                     ut.width = width;
//                 }
//             }
//         }
//     }
//
//     private updateRootWidth(width: number, animate: boolean = false) {
//         const ut = this.containersRoot.getComponent(UITransform);
//         Tween.stopAllByTarget(ut);
//         if (animate) {
//             tween(ut).to(this.curAnimateDuration, { width: width }).start();
//         } else {
//             ut.width = width;
//         }
//     }
//
//     private setCardPosition(cardNode: Node, position: Vec3, animate: boolean = false) {
//         Tween.stopAllByTarget(cardNode);
//         if (animate) {
//             tween(cardNode).to(this.curAnimateDuration, { position: position }).start();
//         } else {
//             cardNode.setPosition(position);
//         }
//     }
//
//     // ============ 发牌动画 ============
//
//     private animateDealCards(
//         container: Node,
//         cardNodes: Node[],
//         targetPositions: Vec3[],
//         dealInterval: number,
//         dealDuration: number,
//         onComplete?: () => void
//     ): void {
//         const len = cardNodes.length;
//         let completed = 0;
//
//         for (let i = 0; i < len; i++) {
//             const cardNode = cardNodes[i];
//             const targetPos = targetPositions[i];
//             const index = i - (len / 2);
//
//             tween(cardNode)
//                 .delay(i * dealInterval)
//                 .call(() => cardNode.setSiblingIndex(container.children.length - 1))
//                 .set({
//                     scale: new Vec3(0.6, 0.8, 1),
//                     eulerAngles: new Vec3(0, 0, index * 2)
//                 })
//                 .parallel(
//                     tween(cardNode)
//                         .to(dealDuration, { position: targetPos }, { easing: 'sineOut' })
//                         .call(() => cardNode.getComponent(CardComponent)!.showFront()),
//                     tween(cardNode)
//                         .to(dealDuration * 0.2, { scale: new Vec3(0.6, 0.6, 1) }, { easing: 'backOut' })
//                         .to(dealDuration * 0.6, { scale: new Vec3(0.9, 0.9, 1), eulerAngles: new Vec3(0, 0, 0) }, { easing: 'sineOut' })
//                         .to(dealDuration * 0.2, { scale: new Vec3(0.8, 0.8, 1) }, { easing: 'sineOut' })
//                 )
//                 .to(0.15, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
//                 .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
//                 .call(() => {
//                     if (++completed >= len) {
//                         console.log('[HandComponent] 发牌动画完成');
//                         onComplete?.();
//                     }
//                 })
//                 .start();
//         }
//     }
//
//     // ============ 拖拽限制 ============
//
//     private dragLimit(worldPos: Vec3) {
//         if (!this.draggingInfo) return;
//         const rootTransform = this.containersRoot.getComponent(UITransform);
//         if (rootTransform) {
//             const localPos = rootTransform.convertToNodeSpaceAR(worldPos);
//
//             const halfWidth = rootTransform.contentSize.width / 2;
//             const padding = 20;
//             if (localPos.x < -halfWidth + padding) localPos.x = -halfWidth + padding;
//             if (localPos.x > halfWidth - padding) localPos.x = halfWidth - padding;
//
//             let minY = 0;
//             const HEIGHT_LIMIT = 80;
//
//             // ★ 使用目标位置而非实际位置（避免 lerp 中间值导致限制偏差）
//             if (this.draggingInfo && this.draggingInfo.currentContainer) {
//                 const currentContainer = this.draggingInfo.currentContainer;
//                 const containerTargetPos = currentContainer.getTargetPosition();
//                 minY = containerTargetPos.y;
//             }
//
//             const maxY = minY + HEIGHT_LIMIT;
//
//             if (localPos.y < minY) localPos.y = minY;
//             if (localPos.y > maxY) localPos.y = maxY;
//
//             const clampedWorldPos = rootTransform.convertToWorldSpaceAR(localPos);
//             worldPos.x = clampedWorldPos.x;
//             worldPos.y = clampedWorldPos.y;
//             worldPos.z = clampedWorldPos.z;
//
//             const dragNode = this.draggingInfo.node;
//             if (dragNode && dragNode.parent) {
//                 const nodeLocalPos = dragNode.parent.getComponent(UITransform)?.convertToNodeSpaceAR(worldPos);
//                 if (nodeLocalPos) {
//                     dragNode.setPosition(nodeLocalPos);
//                 }
//             }
//         }
//     }
//
//     // ============ 拖拽开关 ============
//
//     /**
//      * 禁用所有手牌的拖拽与点击事件
//      * 直接禁用 Drag 组件，从触摸事件层面阻断
//      */
//     public disableDrag() {
//         this.setAllCardsDragEnabled(false);
//     }
//
//     /**
//      * 启用所有手牌的拖拽与点击事件
//      */
//     public enableDrag() {
//         this.setAllCardsDragEnabled(true);
//     }
//
//     /**
//      * 遍历所有容器中的卡牌，设置 Drag 组件的 enabled 状态
//      */
//     private setAllCardsDragEnabled(enabled: boolean) {
//         this.containersRoot.children.forEach((containerNode) => {
//             containerNode.children.forEach((cardNode) => {
//                 const drag = cardNode.getComponent(Drag);
//                 if (drag) drag.enabled = enabled;
//             });
//         });
//     }
//
//     /**
//      * 同步所有容器的索引（按 containersRoot 中的实际顺序）
//      */
//     private syncContainerIndices() {
//         this.containersRoot.children.forEach((containerNode, i) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (comp) comp.setContainerIndex(i);
//         });
//     }
//
//
//
//
//     /**
//      * 全量同步所有容器的标记（增删 + 状态 + 位置 + 宽度）
//      */
//     private syncMarkers() {
//         const activeContainers = new Set<Node>();
//         const markerLayerUT = this.markerLayer.getComponent(UITransform);
//
//         this.containersRoot.children.forEach((containerNode) => {
//             const comp = containerNode.getComponent(ContainerComponent);
//             if (!comp) return;
//
//             const groupData = comp.getGroupData();
//
//             if (!groupData || groupData.isUngroupHand) {
//                 this.removeMarker(containerNode);
//                 return;
//             }
//
//             activeContainers.add(containerNode);
//
//             let marker = this.markerMap.get(containerNode);
//             if (!marker) {
//                 marker = this.getPoolNode(this.groupMarkerNode.name);
//                 marker.parent = this.markerLayer;
//                 this.markerMap.set(containerNode, marker);
//             }
//
//             this.updateMarkerState(marker, groupData);
//
//             const containerUT = containerNode.getComponent(UITransform);
//             const markerUT = marker.getComponent(UITransform);
//
//             if (containerUT && markerUT && markerLayerUT) {
//                 const worldPos = containerNode.worldPosition;
//                 const localPos = markerLayerUT.convertToNodeSpaceAR(worldPos);
//
//                 const containerBottomY = localPos.y - containerUT.height * containerUT.anchorY;
//                 const markerY = containerBottomY + markerUT.height * markerUT.anchorY;
//
//                 marker.setPosition(localPos.x, markerY, 0);
//                 markerUT.width = containerUT.width;
//             }
//         });
//
//         const toRemove: Node[] = [];
//         this.markerMap.forEach((marker, containerNode) => {
//             if (!activeContainers.has(containerNode)) {
//                 toRemove.push(containerNode);
//             }
//         });
//         toRemove.forEach(containerNode => this.removeMarker(containerNode));
//     }
//
//     /**
//      * 更新单个容器的标记状态（valid/special/显隐）
//      * 不更新位置和宽度，交给每帧 syncMarkerPositions
//      */
//     private syncMarkerForContainer(containerNode: Node) {
//         const comp = containerNode.getComponent(ContainerComponent);
//         if (!comp) return;
//
//         const groupData = comp.getGroupData();
//
//         if (!groupData || groupData.isUngroupHand) {
//             this.removeMarker(containerNode);
//             return;
//         }
//
//         let marker = this.markerMap.get(containerNode);
//         if (!marker) {
//             marker = this.getPoolNode(this.groupMarkerNode.name);
//             marker.parent = this.markerLayer;
//             this.markerMap.set(containerNode, marker);
//         }
//
//         this.updateMarkerState(marker, groupData);
//     }
//
//     /**
//      * 每帧同步所有标记的位置和宽度（读容器实际值，跟随 lerp 渐变）
//      */
//     private syncMarkerPositions() {
//         const markerLayerUT = this.markerLayer.getComponent(UITransform);
//         if (!markerLayerUT) return;
//
//         this.markerMap.forEach((marker, containerNode) => {
//             if (!marker.active) return;
//
//             const containerUT = containerNode.getComponent(UITransform);
//             const markerUT = marker.getComponent(UITransform);
//             if (!containerUT || !markerUT) return;
//
//             const worldPos = containerNode.worldPosition;
//             const localPos = markerLayerUT.convertToNodeSpaceAR(worldPos);
//
//             const containerBottomY = localPos.y - containerUT.height * containerUT.anchorY;
//             const markerY = containerBottomY + markerUT.height * markerUT.anchorY;
//
//             marker.setPosition(localPos.x, markerY, 0);
//             markerUT.width = containerUT.width;
//         });
//     }
//
//     /**
//      * 更新标记显示状态
//      */
//     private updateMarkerState(marker: Node, groupData: TongitsGroup) {
//         const markerComp = marker.getComponent(GroupMarkerComponent);
//         if (markerComp) {
//             markerComp.updateByGroupInfo(
//                 groupData.isValid,
//                 groupData.isUngroupHand,
//                 groupData.cards,
//                 groupData.isSpecial
//             );
//         }
//     }
//
//     /**
//      * 隐藏所有标记
//      */
//     private hideAllMarkers() {
//         this.markerMap.forEach((marker) => {
//             marker.active = false;
//         });
//     }
//
//     /**
//      * 移除指定容器的标记
//      */
//     private removeMarker(containerNode: Node) {
//         const marker = this.markerMap.get(containerNode);
//         if (marker) {
//             marker.removeFromParent();
//             this.putPoolNode(marker);
//             this.markerMap.delete(containerNode);
//         }
//     }
//
//     /**
//      * 清除所有标记
//      */
//     private clearAllMarkers() {
//         this.markerMap.forEach((marker) => {
//             marker.removeFromParent();
//             this.putPoolNode(marker);
//         });
//         this.markerMap.clear();
//     }
// }