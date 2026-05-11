/*************************************************************************************
 * @File        : VirtualViewList.ts
 * @Author      : xingkong6
 * @Date        : 2025-07-02 16:27:47
 * @Date        : Copyright (c) 2025 by xingkong6, All Rights Reserved.
 * @Description : 虚拟列表组件
 **************************************************************************************/

import { _decorator, CCFloat, CCInteger, Component, EventTouch, Node, ScrollView, Size, UITransform, Vec2 } from 'cc';
import { ViewLayoutType, ScrollDirection, TouchDirection, IVirtualListCallbacks, ItemTemplateData, AnimationQueueItem, VisibleRange, CustomEventTouch, ANIM_ATION } from './VirtualListTypes';
import { VirtualListDataManager } from './VirtualListDataManager';
import { VirtualListNodeManager } from './VirtualListNodeManager';
import { VirtualListPerformanceManager } from './VirtualListPerformanceManager';
import { VirtualLog } from './VirtualListUtils';

const { ccclass, property, executeInEditMode } = _decorator;

/**
 * 虚拟列表组件 - 重构版本
 * 支持垂直、水平、网格三种布局模式
 * 高效渲染大量数据，只创建可见区域的节点
 */
@ccclass('VirtualViewList')
@executeInEditMode
export class VirtualViewList extends Component {
    // =========== 配置属性 ===========
    @property(ScrollView)
    protected scrollView: ScrollView = null!;

    @property({ type: ViewLayoutType, tooltip: "垂直布局: VERTICAL\n水平布局: HORIZONTAL\n网格布局: GRID" })
    protected layoutType: ViewLayoutType = ViewLayoutType.VERTICAL;

    @property({ type: CCFloat, tooltip: "项之间的间距（列表模式）", visible: function (this: VirtualViewList) { return this.layoutType !== ViewLayoutType.GRID } })
    private itemSpacing: number = 10;

    // =========== 网格布局属性 ===========
    @property({ type: ScrollDirection, tooltip: "主轴滚动方向\n垂直滚动: VERTICAL\n水平滚动: HORIZONTAL", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID } })
    private scrollDirection: ScrollDirection = ScrollDirection.VERTICAL;

    @property({ type: CCInteger, min: 1, tooltip: "垂直滚动: 列数", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID && this.scrollDirection == ScrollDirection.VERTICAL } })
    private cols: number = 2;

    @property({ type: CCFloat, tooltip: "垂直滚动: item行间距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID && this.scrollDirection == ScrollDirection.VERTICAL } })
    private girdVertRowsSpacing: number = 10;

    @property({ type: CCFloat, tooltip: "垂直滚动: item列间距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID && this.scrollDirection == ScrollDirection.VERTICAL } })
    private girdVertColsSpacing: number = 10;

    @property({ type: CCInteger, min: 1, tooltip: "水平滚动：行数", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID && this.scrollDirection == ScrollDirection.HORIZONTAL } })
    private rows: number = 2;

    @property({ type: CCFloat, tooltip: "水平滚动: item列间距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID && this.scrollDirection == ScrollDirection.HORIZONTAL } })
    private girdHoriColsSpacing: number = 10;

    @property({ type: CCFloat, tooltip: "水平滚动: item行间距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.GRID && this.scrollDirection == ScrollDirection.HORIZONTAL } })
    private girdHoriRowsSpacing: number = 10;

    // =========== 内边距属性 ===========
    @property({ type: CCFloat, tooltip: "列表顶部内边距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.VERTICAL || (this.layoutType === ViewLayoutType.GRID && this.scrollDirection === ScrollDirection.VERTICAL) } })
    private paddingTop: number = 0;

    @property({ type: CCFloat, tooltip: "列表底部内边距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.VERTICAL || (this.layoutType === ViewLayoutType.GRID && this.scrollDirection === ScrollDirection.VERTICAL) } })
    private paddingBottom: number = 0;

    @property({ type: CCFloat, tooltip: "列表左侧内边距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.HORIZONTAL || (this.layoutType === ViewLayoutType.GRID && this.scrollDirection === ScrollDirection.HORIZONTAL) } })
    private paddingLeft: number = 0;

    @property({ type: CCFloat, tooltip: "列表右侧内边距", visible: function (this: VirtualViewList) { return this.layoutType === ViewLayoutType.HORIZONTAL || (this.layoutType === ViewLayoutType.GRID && this.scrollDirection === ScrollDirection.HORIZONTAL) } })
    private paddingRight: number = 0;

    // =========== 高级特性属性 ===========
    @property({ tooltip: "是否开启嵌套触摸支持（多层虚拟列表，外层列表请开启）" })
    private enableNestedSupport: boolean = false;

    @property({ tooltip: "自动调整刷新频率以优化性能" })
    private autoOptimizePerformance: boolean = true;

    @property({ type: CCFloat, range: [0, 1], slide: true, step: 0.1, tooltip: "预加载缓冲区大小 (0-1 表示可见区域的倍数)" })
    private cacheRatio: number = 0.5;

    // =========== 管理器实例 ===========
    private mDataManager: VirtualListDataManager | null = null!;
    private get dataManager(): VirtualListDataManager {
        if (!this.mDataManager) {
            this.mDataManager = new VirtualListDataManager(
                this.layoutType, this.scrollDirection, this.cols, this.rows,
                this.itemSpacing, this.girdVertRowsSpacing, this.girdHoriColsSpacing,
                new Map(), "default"
            );
        }
        return this.mDataManager;
    }
    private mNodeManager: VirtualListNodeManager | null = null;
    private get nodeManager(): VirtualListNodeManager {
        if (!this.mNodeManager) {
            this.mNodeManager = new VirtualListNodeManager(
                this.layoutType, this.scrollDirection, this.cols, this.rows,
                this.paddingTop, this.paddingBottom, this.paddingLeft, this.paddingRight,
                this.girdVertRowsSpacing, this.girdVertColsSpacing, this.girdHoriRowsSpacing, this.girdHoriColsSpacing
            );
        }
        return this.mNodeManager;
    }
    private mPerformanceManager: VirtualListPerformanceManager | null = null;
    private get performanceManager(): VirtualListPerformanceManager {
        if (!this.mPerformanceManager) {
            this.mPerformanceManager = new VirtualListPerformanceManager(this.autoOptimizePerformance, this.cacheRatio);
        }
        return this.mPerformanceManager;
    }

    // =========== 内部状态变量 ===========
    private mContent: Node = null!;
    private mIsInitialLoad: boolean = true;
    private mLoadingQueue: number[] = [];
    private mLoadingScheduled: boolean = false;
    private mNeedFrameLoading: boolean = false;
    private mForceUpdate: boolean = false;
    private mLastVisibleIndices: VisibleRange = { start: -1, end: -1 };
    private mTouchDirection: TouchDirection = TouchDirection.NONE;
    private mTouchStartPos: Vec2 | null = null;
    private mAnimationQueue: AnimationQueueItem[] = [];
    private mIsAnimating: boolean = false;
    private mIsDebugMode: boolean = false;
    private mAutoPreloadCount: number = 10;

    // =========== 回调函数 ===========
    private mScrollCallback: ((scrollRatio: number) => void) | null = null;
    private mLoadFinishedCallback: (() => void) | null = null;

    onLoad() {
        
    }

    scrollViewInit(){
        if (!this.scrollView) {
            VirtualLog.Error("请在编辑器中将 ScrollView 组件拖拽到脚本的 scrollView 属性上");
            return;
        }

        this.InitScrollView();
        this.mContent = this.scrollView.content!;
        const contentUI = this.mContent.getComponent(UITransform);
        contentUI!.anchorPoint = this.scrollView.vertical ? new Vec2(0.5, 1) : new Vec2(0, 0.5);
        this.OnInit();
    }

    onDestroy() {
        this.unscheduleAllCallbacks();
        this.nodeManager?.ClearTemplates();
    }

    protected onEnable(): void {
        this.scrollView.node.on('scrolling', this.OnScrolling, this);
        this.scrollView.node.on('scroll-ended', this.OnScrollEnded, this);

        if (this.enableNestedSupport) {
            this.node.on(Node.EventType.TOUCH_START, this.OnNestTouchEvent, this, true);
            this.node.on(Node.EventType.TOUCH_MOVE, this.OnNestTouchEvent, this, true);
            this.node.on(Node.EventType.TOUCH_END, this.OnNestTouchEvent, this, true);
            this.node.on(Node.EventType.TOUCH_CANCEL, this.OnNestTouchEvent, this, true);
        }
    }

    protected onDisable(): void {
        this.scrollView.node.off('scrolling', this.OnScrolling, this);
        this.scrollView.node.off('scroll-ended', this.OnScrollEnded, this);
        this.node.targetOff(this);
    }

    /**
     * 初始化滚动视图设置
     */
    private InitScrollView() {
        this.scrollView.vertical = false;
        this.scrollView.horizontal = false;

        switch (this.layoutType) {
            case ViewLayoutType.VERTICAL:
                this.scrollView.vertical = true;
                break;
            case ViewLayoutType.HORIZONTAL:
                this.scrollView.horizontal = true;
                break;
            case ViewLayoutType.GRID:
                if (this.scrollDirection === ScrollDirection.VERTICAL) {
                    this.scrollView.vertical = true;
                } else {
                    this.scrollView.horizontal = true;
                }
                break;
        }
    }

    /**
     * 子类需要初始化时重写此方法
     */
    protected OnInit() {

    }

    // =========== 公共API ===========

    /**
     * 注册模板类型
     */
    public RegisterTemplate(type: string | number, nodeOrGetter: Node | (() => Node), isDefault: boolean = false): void {
        this.nodeManager.RegisterTemplate(type, nodeOrGetter, isDefault);
        // 同时更新数据管理器的模板引用
        this.dataManager.templateItems = this.nodeManager.GetTemplateItems();
        this.dataManager.defaultTemplateType = this.nodeManager.GetDefaultTemplateType();
    }

    /**
     * 批量注册模板
     */
    public RegisterTemplates(templates: { type: string, node: Node | (() => Node) }[], defaultType?: string): void {
        this.nodeManager.RegisterTemplates(templates, defaultType);
        // 同时更新数据管理器的模板引用
        this.dataManager.templateItems = this.nodeManager.GetTemplateItems();
        this.dataManager.defaultTemplateType = this.nodeManager.GetDefaultTemplateType();
    }

    /**
     * 清理所有模板和对象池
     */
    public ClearTemplates(): void {
        this.nodeManager.ClearTemplates();
    }

    /**
     * 设置虚拟列表回调接口
     */
    public SetCallbacks(callbacks: IVirtualListCallbacks) {
        if (callbacks.onItemInit) this.nodeManager.ItemInitFunc = callbacks.onItemInit;
        if (callbacks.onItemUpdate) this.nodeManager.ItemUpdateFunc = callbacks.onItemUpdate;
        if (callbacks.onScrolling) this.mScrollCallback = callbacks.onScrolling;
        if (callbacks.onLoadFinished) this.mLoadFinishedCallback = callbacks.onLoadFinished;
    }


    /**
     * 重新加载数据源
     * @param typeArray 类型数据
     * @param customSize 自定义尺寸数组
     * @returns 
     */
    public ReloadData(typeArray: Array<string | number>, customSize: number[] = []): void {
        this.mIsInitialLoad = true;
        this.mForceUpdate = true;
        this.mNeedFrameLoading = true;

        if (typeArray.length === 0) {
            this.HandleEmptyData();
            return;
        }

        this.ResetAllStates();
        this.nodeManager.ClearVisibleItems();
        this.dataManager.SetDataSource(typeArray, customSize);
        this.UpdateContentSize();
        this.UpdateList();
    }

    /**
     * 清空列表数据
     */
    public Clear(): void {
        this.dataManager.Clear();
        this.nodeManager.ClearVisibleItems();
        this.HandleEmptyData();
        this.ResetAllStates();
        this.mContent?.destroyAllChildren();
    }


    /**
     * 在指定位置插入项目
     * @param index 插入位置索引
     * @param type 插入的类型
     * @param animate 是否动画
     * @returns 
     */
    public InsertItemAt(index: number, type: string | number, animate: boolean = false): void {
        if (index < 0 || index > this.dataManager.GetItemCount()) {
            VirtualLog.Error(`InsertItemAt 插入位置 ${index} 超出有效范围`);
            return;
        }

        if (animate && this.mIsAnimating) {
            this.mAnimationQueue.push({ anim: ANIM_ATION.INSERT, index: index, type: type });
            return;
        }

        // 记录插入前的可见范围
        const oldVisibleRange = { ...this.mLastVisibleIndices };

        // 先插入数据
        this.dataManager.InsertData(index, type);
        this.UpdateContentSize();

        // 判断插入位置是否在原可见范围内
        const isInVisibleRange = index >= oldVisibleRange.start && index <= oldVisibleRange.end;
        const canAnimate = animate && isInVisibleRange;

        if (canAnimate) {
            this.mIsAnimating = true;
            this.scrollView.enabled = false;
        }

        // 更新可见项索引
        this.UpdateVisibleItemsAfterInsert(index, type, canAnimate, oldVisibleRange);

        // 重新计算可见范围
        this.mLastVisibleIndices = { start: -1, end: -1 }; // 强制重新计算
        this.mForceUpdate = true;
        this.UpdateList();

        if (canAnimate) {
            this.scheduleOnce(() => {
                this.scrollView.enabled = true;
                this.mIsAnimating = false;
                this.ProcessNextAnimationQueue();
            }, 0.35);
        }
    }


    /**
     * 移除指定位置的项目
     * @param index 
     * @param animate 
     * @returns 
     */
    public RemoveItemAt(index: number, animate: boolean = false): void {
        if (index < 0 || index >= this.dataManager.GetItemCount()) {
            VirtualLog.Error(`RemoveItemAt 移除位置 ${index} 超出有效范围`);
            return;
        }

        if (animate && this.mIsAnimating) {
            this.mAnimationQueue.push({ anim: ANIM_ATION.REMOVE, index: index });
            return;
        }

        // 记录删除前的可见范围
        const oldVisibleRange = { ...this.mLastVisibleIndices };
        const nodeToRemove = this.nodeManager.GetItemNode(index);
        const canAnimate = animate && nodeToRemove;

        if (canAnimate) {
            this.mIsAnimating = true;
            this.scrollView.enabled = false;

            // 执行删除动画
            this.nodeManager.ExecuteRemoveAnimation(nodeToRemove!, this.layoutType, () => {
                this.DoItemRemoval(index, oldVisibleRange);
                this.mIsAnimating = false;
                this.ProcessNextAnimationQueue();
            });
        }
        else {
            // 直接执行删除，不要动画
            this.DoItemRemoval(index, oldVisibleRange);
        }
    }

    /**
     * 刷新列表
     */
    public Refresh() {
        if (this.dataManager.GetItemCount() === 0) {
            this.HandleEmptyData();
            return;
        }

        this.mForceUpdate = true;
        this.mNeedFrameLoading = false;
        this.UpdateContentSize();
        this.nodeManager.ClearVisibleItems();
        this.UpdateList();
    }

    /**
     * 滚动到指定索引
     */
    public ScrollToIndex(index: number, duration: number = 0.3, callback?: () => void) {
        if (!this.scrollView || !this.scrollView.view) return;
        if (index < 0 || index > this.dataManager.GetItemCount() - 1) return;
        if (this.mIsAnimating) return;

        const isVertical = this.scrollView.vertical;
        const contentSize = this.mContent.getComponent(UITransform)!.contentSize;
        const viewSize = this.scrollView.view.contentSize;
        const viewLength = isVertical ? viewSize.height : viewSize.width;
        const totalContentLength = isVertical ? contentSize.height : contentSize.width;

        let itemPosition = this.CalculateScrollPosition(index);
        let desiredOffset = itemPosition - viewLength / 2;
        const maxOffset = totalContentLength - viewLength;
        desiredOffset = Math.max(0, Math.min(desiredOffset, maxOffset));

        this.scrollView.stopAutoScroll();
        if (isVertical) {
            this.scrollView.scrollToOffset(new Vec2(0, desiredOffset), duration);
        } else {
            this.scrollView.scrollToOffset(new Vec2(desiredOffset, 0), duration);
        }

        if (duration === 0) {
            this.mNeedFrameLoading = false;
            this.UpdateList();
            if (callback) callback();
        } else if (callback) {
            this.scheduleOnce(() => callback(), duration);
        }
    }

    /**
     * 滚动到顶部
     */
    public ScrollToTop(duration: number = 0.3, callback?: () => void) {
        this.ScrollToIndex(0, duration, callback);
    }

    /**
     * 滚动到底部
     */
    public ScrollToBottom(duration: number = 0.3, callback?: () => void) {
        this.ScrollToIndex(this.dataManager.GetItemCount() - 1, duration, callback);
    }

    /**
     * 获取指定单元格节点
     */
    public GetItemNode(index: number): Node | null {
        return this.nodeManager.GetItemNode(index);
    }

    /**
     * 更新指定单元格
     */
    public UpdateItemAt(index: number, type?: string | number): boolean {
        // 参数验证
        if (index < 0 || index >= this.dataManager.GetItemCount()) {
            VirtualLog.Warn(`UpdateItemAt: 索引 ${index} 超出有效范围 [0, ${this.dataManager.GetItemCount() - 1}]`);
            return false;
        }

        // 检查是否提供了新类型
        const hasNewType = type !== undefined && type !== null;

        if (hasNewType) {
            if (!this.nodeManager.HasTemplate(type)) {
                VirtualLog.Error(`UpdateItemAt: 模板类型 ${type} 未注册，请先调用 RegisterTemplate 注册该类型`);
                return false;
            }

            this.dataManager.UpdateItemType(index, type);
        }

        const node = this.GetItemNode(index);
        if (!node) {
            // 如果节点不在可见范围内，只更新数据，不更新视图
            if (hasNewType) {
                VirtualLog.Debug(`UpdateItemAt: 索引 ${index} 的节点不在可见范围内，已更新数据类型但未更新视图`);
            }
            return true;
        }

        // 更新可视节点
        if (hasNewType) {
            // 类型发生变化，需要重新创建或转换节点类型
            this.nodeManager.UpdateItemType(node, index, type);
        }
        else {
            // 仅刷新节点内容，不改变类型
            this.nodeManager.UpdateItemNode(node, index);
        }

        return true;
    }

    /**
     * 更新指定单元格的尺寸
     */
    public UpdateItemSize(index: number, newSize: number) {
        if (this.layoutType === ViewLayoutType.GRID) {
            VirtualLog.Warn("UpdateItemSize 不支持网格布局");
            return;
        }

        this.dataManager.UpdateItemSize(index, newSize);
        this.mForceUpdate = true;
        this.UpdateContentSize();
        this.nodeManager.ClearVisibleItems();
        this.UpdateList();
    }

    /**
     * 预加载数据
     */
    public PreloadItems(count: number = this.mAutoPreloadCount) {
        this.nodeManager.PreloadItems(count);
    }

    /**
     * 获取当前列表的总项数
     */
    public GetTotalItemCount(): number {
        return this.dataManager.GetItemCount();
    }

    /**
     * 启用或禁用调试模式
     */
    public EnableDebugMode(enabled: boolean = true): void {
        this.mIsDebugMode = enabled;
        VirtualLog.SetDebugMode(enabled);
    }

    /**
     * 获取当前组件的状态信息
     */
    public GetStatus(): any {
        return {
            itemCount: this.dataManager.GetItemCount(),
            visibleCount: this.nodeManager.GetVisibleItems().size,
            poolSize: this.nodeManager.GetTotalPoolSize(),
            isLowPerformanceMode: this.performanceManager.IsLowPerformanceMode(),
            memoryUsage: this.performanceManager.GetMemoryUsage()
        };
    }

    // =========== 私有方法 ===========

    /**
     * 重置所有状态
     */
    private ResetAllStates(): void {
        this.mLastVisibleIndices = { start: -1, end: -1 };
        this.mIsAnimating = false;
        this.unscheduleAllCallbacks();
        this.scrollView.enabled = true;
        this.mLoadingQueue = [];
        this.mLoadingScheduled = false;
        this.performanceManager.Reset();
    }

    /**
     * 处理空数据状态
     */
    private HandleEmptyData() {
        this.nodeManager.ClearVisibleItems();
        if (!this.mContent || !this.scrollView) return;

        const contentUI = this.mContent.getComponent(UITransform)!;
        contentUI.contentSize = this.scrollView.node.getComponent(UITransform)!.contentSize;
    }

    /**
     * 更新内容尺寸
     */
    private UpdateContentSize() {
        if (!this.scrollView || !this.scrollView.view) return;
        const contentSize = this.dataManager.CalculateContentSize();
        const contentUI = this.mContent.getComponent(UITransform)!;
        const viewSize = this.scrollView.view.contentSize;

        let totalWidth = Math.max(contentSize.width + this.paddingLeft + this.paddingRight, viewSize.width);
        let totalHeight = Math.max(contentSize.height + this.paddingTop + this.paddingBottom, viewSize.height);

        contentUI.contentSize = new Size(totalWidth, totalHeight);
    }

    /**
     * 计算滚动位置
     */
    private CalculateScrollPosition(index: number): number {
        if (this.layoutType === ViewLayoutType.GRID) {
            const cellSize = this.dataManager.GetCellSize();
            if (this.scrollDirection === ScrollDirection.VERTICAL) {
                const row = Math.floor(index / this.cols);
                return this.paddingTop + row * (cellSize.height + this.girdVertRowsSpacing) + cellSize.height / 2;
            } else {
                const col = Math.floor(index / this.rows);
                return this.paddingLeft + col * (cellSize.width + this.girdHoriColsSpacing) + cellSize.width / 2;
            }
        } else {
            const itemSizes = this.dataManager.GetAllItemSizes();
            const cumulativeSizes = this.dataManager.GetCumulativeSizes();

            if (index === 0) {
                const padding = this.layoutType === ViewLayoutType.VERTICAL ? this.paddingTop : this.paddingLeft;
                return padding + itemSizes[0] / 2;
            } else {
                const padding = this.layoutType === ViewLayoutType.VERTICAL ? this.paddingTop : this.paddingLeft;
                return padding + cumulativeSizes[index - 1] + itemSizes[index] / 2;
            }
        }
    }

    /**
     * 滚动事件处理
     */
    private OnScrolling() {
        if (!this.scrollView || !this.scrollView.view) return;

        const offset = this.scrollView.getScrollOffset();
        const currPos = this.scrollView.vertical ? offset.y : offset.x;

        // 更新性能数据并检查是否需要更新
        const shouldUpdate = this.performanceManager.UpdateScrollPerformance(currPos);

        // 触发滚动回调
        if (this.mScrollCallback) {
            const contentSize = this.mContent.getComponent(UITransform)!.contentSize;
            const viewSize = this.scrollView.view.contentSize;
            const totalScrollable = this.scrollView.vertical ?
                contentSize.height - viewSize.height : contentSize.width - viewSize.width;

            if (totalScrollable > 0) {
                const scrollRatio = Math.max(0, Math.min(1, currPos / totalScrollable));
                this.mScrollCallback(scrollRatio);
            }
        }

        if (shouldUpdate) {
            this.mNeedFrameLoading = false;
            this.UpdateList();
        }
    }

    /**
     * 滚动结束事件处理
     */
    private OnScrollEnded() {
        this.mNeedFrameLoading = false;
        this.UpdateList();
        this.performanceManager.OnScrollEnd();
        this.TriggerSmartGarbageCollection();
    }

    /**
     * 更新列表
     */
    private UpdateList() {
        if (this.dataManager.GetItemCount() === 0) return;

        const startTime = this.mIsDebugMode ? Date.now() : 0;

        // 性能监控
        if (this.autoOptimizePerformance) {
            this.performanceManager.MonitorFramePerformance(startTime);
        }

        // 计算可见区间
        const visibleRange = this.CalculateVisibleRange();
        let { start, end } = visibleRange;

        // 检查是否需要更新
        const needUpdate = this.NeedsUpdate(start, end);
        if (!needUpdate) return;

        // 更新当前可见范围记录
        this.mLastVisibleIndices = { start, end };
        this.mForceUpdate = false;

        // 回收不可见节点
        const recycledCount = this.nodeManager.RecycleInvisibleItems(start, end);

        // 计算需要加载的项
        this.CalculateMissingIndices(start, end);

        // 选择更新策略
        this.ApplyUpdateStrategy();

        // 记录调试信息
        if (this.mIsDebugMode) {
            this.UpdateDebugStats(startTime, recycledCount);
        }
    }

    /**
     * 计算可见区间
     */
    private CalculateVisibleRange(): VisibleRange {
        if (!this.scrollView || !this.scrollView.view) return { start: 0, end: 0 };

        const isVertical = this.scrollView.vertical;
        const offset = this.scrollView.getScrollOffset();
        const viewSize = this.scrollView.view.contentSize;
        const viewLength = isVertical ? viewSize.height : viewSize.width;

        const itemSizes = this.dataManager.GetAllItemSizes();
        const cellSize = this.dataManager.GetCellSize();

        const loadParams = this.performanceManager.ComputeLoadParameters(
            viewLength, itemSizes, this.layoutType, this.scrollDirection,
            this.cols, this.rows, cellSize.height, cellSize.width,
            this.girdVertRowsSpacing, this.girdHoriColsSpacing
        );

        const adjustedParams = this.performanceManager.AdjustParametersForPerformance(loadParams);

        let startIndex = 0, endIndex = 0;

        if (this.layoutType === ViewLayoutType.GRID) {
            // 网格布局计算
            if (this.scrollDirection === ScrollDirection.VERTICAL) {
                const rowHeight = cellSize.height + this.girdVertRowsSpacing;
                let firstRow = Math.floor(Math.abs(offset.y) / rowHeight);
                firstRow = Math.max(0, firstRow - adjustedParams.bufferCount);
                const visibleRows = Math.ceil(viewLength / rowHeight);
                let lastRow = Math.min(Math.ceil(this.dataManager.GetItemCount() / this.cols),
                    firstRow + visibleRows + 2 * adjustedParams.bufferCount);
                startIndex = firstRow * this.cols;
                endIndex = Math.min(this.dataManager.GetItemCount(), lastRow * this.cols);
            } else {
                const colWidth = cellSize.width + this.girdHoriColsSpacing;
                let firstCol = Math.floor(Math.abs(offset.x) / colWidth);
                firstCol = Math.max(0, firstCol - adjustedParams.bufferCount);
                const visibleCols = Math.ceil(viewLength / colWidth);
                let lastCol = Math.min(Math.ceil(this.dataManager.GetItemCount() / this.rows),
                    firstCol + visibleCols + 2 * adjustedParams.bufferCount);
                startIndex = firstCol * this.rows;
                endIndex = Math.min(this.dataManager.GetItemCount(), lastCol * this.rows);
            }
        } else {
            // 列表布局计算
            const scrollPos = isVertical ? offset.y : -offset.x;
            startIndex = this.dataManager.FindIndexByOffset(scrollPos);
            startIndex = Math.max(0, startIndex - adjustedParams.bufferCount);
            endIndex = this.dataManager.FindIndexByOffset(scrollPos + viewLength);
            endIndex = Math.min(this.dataManager.GetItemCount(), endIndex + adjustedParams.bufferCount);
        }

        return { start: startIndex, end: endIndex };
    }

    /**
     * 判断是否需要更新列表
     */
    private NeedsUpdate(startIndex: number, endIndex: number): boolean {
        return (
            this.mForceUpdate ||
            startIndex !== this.mLastVisibleIndices.start ||
            endIndex !== this.mLastVisibleIndices.end ||
            this.mLoadingQueue.length > 0
        );
    }

    /**
     * 计算缺失的索引
     */
    private CalculateMissingIndices(startIndex: number, endIndex: number): void {
        const visibleItems = this.nodeManager.GetVisibleItems();
        const missingIndicesSet = new Set<number>();

        for (let i = startIndex; i < endIndex; i++) {
            if (!visibleItems.has(i)) {
                missingIndicesSet.add(i);
            }
        }

        this.mLoadingQueue = Array.from(missingIndicesSet);
    }

    /**
     * 应用更新策略
     */
    private ApplyUpdateStrategy(): void {
        if (this.mNeedFrameLoading) {
            if (!this.mLoadingScheduled && this.mLoadingQueue.length > 0) {
                this.schedule(this.ProcessLoadingQueue, 0);
                this.mLoadingScheduled = true;
            }
        } else {
            this.LoadAllItemsDirectly();
            if (this.mIsInitialLoad && this.mLoadFinishedCallback) {
                this.mLoadFinishedCallback();
                this.mIsInitialLoad = false;
            }
        }
    }

    /**
     * 直接加载所有缺失项
     */
    private LoadAllItemsDirectly(): void {
        const maxItemsPerFrame = this.performanceManager.IsLowPerformanceMode() ? 10 : 20;
        let processedCount = 0;

        for (const index of this.mLoadingQueue) {
            if (processedCount >= maxItemsPerFrame) {
                this.scheduleOnce(() => {
                    this.LoadAllItemsDirectly();
                }, 0);
                break;
            }

            this.AddOrUpdateItemAt(index);
            processedCount++;
        }

        this.mLoadingQueue = [];
    }

    /**
     * 分帧处理加载队列
     */
    private ProcessLoadingQueue(): void {
        if (!this.scrollView || !this.scrollView.view) return;

        if (this.mLoadingQueue.length === 0) {
            this.mLoadingScheduled = false;
            this.unschedule(this.ProcessLoadingQueue);

            if (this.mIsInitialLoad && this.mLoadFinishedCallback) {
                this.mIsInitialLoad = false;
                this.mLoadFinishedCallback();
            }
            return;
        }

        const itemSizes = this.dataManager.GetAllItemSizes();
        const cellSize = this.dataManager.GetCellSize();
        const viewSize = this.scrollView.view.contentSize;
        const isVertical = this.scrollView.vertical;
        const viewLength = isVertical ? viewSize.height : viewSize.width;

        const loadParams = this.performanceManager.ComputeLoadParameters(
            viewLength, itemSizes, this.layoutType,
            this.scrollDirection, this.cols, this.rows, cellSize.height, cellSize.width,
            this.girdVertRowsSpacing, this.girdHoriColsSpacing
        );

        const batchSize = Math.min(this.mLoadingQueue.length, loadParams.batchSize);
        let processedCount = 0;

        while (processedCount < batchSize && this.mLoadingQueue.length > 0) {
            const index = this.mLoadingQueue.shift()!;
            this.AddOrUpdateItemAt(index);
            processedCount++;
        }
    }

    /**
     * 创建或刷新指定索引的单元格
     */
    private AddOrUpdateItemAt(index: number): void {
        const type = this.dataManager.GetItemType(index);
        const itemSizes = this.dataManager.GetAllItemSizes();
        const cumulativeSizes = this.dataManager.GetCumulativeSizes();
        const cellSize = this.dataManager.GetCellSize();

        this.nodeManager.AddOrUpdateItem(
            index, type, this.mContent, itemSizes, cumulativeSizes, cellSize.width, cellSize.height
        );
    }

    /**
     * 更新插入后的可见项
     */
    private UpdateVisibleItemsAfterInsert(index: number, type: string | number, animate: boolean, oldVisibleRange: VisibleRange): void {
        const visibleItems = this.nodeManager.GetVisibleItems();
        const updatedMap = new Map<number, Node>();

        // 先处理现有的可见项，更新它们的索引
        const itemsToUpdate: { newIndex: number, node: Node }[] = [];

        visibleItems.forEach((node, itemIndex) => {
            if (itemIndex >= index) {
                // 需要更新索引的项
                itemsToUpdate.push({ newIndex: itemIndex + 1, node: node });
            }
            else {
                // 索引不变的项
                updatedMap.set(itemIndex, node);
            }
        });

        // 清空旧的映射
        this.nodeManager.ClearVisibleItemsMap();

        // 重新设置不需要更新索引的项
        updatedMap.forEach((node, idx) => {
            this.nodeManager.SetVisibleItemsKeyValue(idx, node);
        });

        // 更新需要变更索引的项
        itemsToUpdate.forEach(({ newIndex, node }) => {
            this.nodeManager.SetVisibleItemsKeyValue(newIndex, node);

            // 更新节点位置和数据
            const itemSizes = this.dataManager.GetAllItemSizes();
            const cumulativeSizes = this.dataManager.GetCumulativeSizes();
            const cellSize = this.dataManager.GetCellSize();

            this.nodeManager.UpdateNodePosition(node, newIndex, itemSizes, cumulativeSizes, cellSize.width, cellSize.height, animate);
            this.nodeManager.UpdateItemNode(node, newIndex);
        });

        // 如果插入位置在原可见范围内，创建新节点
        const isInVisibleRange = index >= oldVisibleRange.start && index <= oldVisibleRange.end;
        if (isInVisibleRange) {
            const itemSizes = this.dataManager.GetAllItemSizes();
            const cumulativeSizes = this.dataManager.GetCumulativeSizes();
            const cellSize = this.dataManager.GetCellSize();

            const insertedNode = this.nodeManager.AddOrUpdateItem(
                index, type, this.mContent, itemSizes, cumulativeSizes,
                cellSize.width, cellSize.height
            );

            if (insertedNode) {
                this.nodeManager.SetVisibleItemsKeyValue(index, insertedNode);

                if (animate) {
                    this.nodeManager.ExecuteInsertAnimation(insertedNode, this.layoutType);
                }
            }
        }
    }


    /**
     * 执行实际的项目删除操作
     */
    private DoItemRemoval(index: number, oldVisibleRange?: VisibleRange): void {
        // 先移除数据
        this.dataManager.RemoveData(index);

        if (this.dataManager.GetItemCount() === 0) {
            this.HandleEmptyData();
            this.scrollView.enabled = true;
            return;
        }

        this.UpdateContentSize();

        // 更新可见项的索引和映射
        this.UpdateVisibleItemsAfterRemove(index, oldVisibleRange);

        // 重新计算可见范围
        this.mLastVisibleIndices = { start: -1, end: -1 }; // 强制重新计算
        this.mForceUpdate = true;
        this.scrollView.enabled = true;
        this.UpdateList();
    }


    /**
     * 更新删除后的可见项
     */
    private UpdateVisibleItemsAfterRemove(index: number, oldVisibleRange?: VisibleRange): void {
        const visibleItems = this.nodeManager.GetVisibleItems();
        const updatedMap = new Map<number, Node>();

        // 处理所有可见项的索引更新
        const itemsToUpdate: { oldIndex: number, newIndex: number, node: Node }[] = [];

        visibleItems.forEach((node, itemIndex) => {
            if (itemIndex === index) {
                // 被删除的项，回收节点
                this.nodeManager.RecycleNode(node);
            }
            else if (itemIndex > index) {
                // 需要更新索引的项
                const newIndex = itemIndex - 1;
                itemsToUpdate.push({ oldIndex: itemIndex, newIndex, node });
            } else {
                // 索引不变的项
                updatedMap.set(itemIndex, node);
            }
        });

        // 清空旧的映射
        this.nodeManager.ClearVisibleItemsMap();

        // 重新设置不需要更新索引的项
        updatedMap.forEach((node, idx) => {
            this.nodeManager.SetVisibleItemsKeyValue(idx, node);
        });

        // 更新需要变更索引的项
        itemsToUpdate.forEach(({ oldIndex, newIndex, node }) => {
            this.nodeManager.SetVisibleItemsKeyValue(newIndex, node);

            // 更新节点位置和数据
            const itemSizes = this.dataManager.GetAllItemSizes();
            const cumulativeSizes = this.dataManager.GetCumulativeSizes();
            const cellSize = this.dataManager.GetCellSize();

            // 删除操作不需要动画
            this.nodeManager.UpdateNodePosition(node, newIndex, itemSizes, cumulativeSizes, cellSize.width, cellSize.height, false);
            this.nodeManager.UpdateItemNode(node, newIndex);
        });

        // 检查是否需要创建新的可见项来填补空缺
        if (oldVisibleRange && oldVisibleRange.start >= 0 && oldVisibleRange.end >= 0) {
            const currentVisibleCount = this.nodeManager.GetVisibleItems().size;
            const originalVisibleCount = oldVisibleRange.end - oldVisibleRange.start;

            // 如果删除后可见项数量减少太多，尝试从边缘加载新项
            if (currentVisibleCount < originalVisibleCount - 1) {
                // 计算新的可见范围
                let newStartIndex = oldVisibleRange.start;
                let newEndIndex = oldVisibleRange.end - 1; // 减去被删除的一项

                // 如果删除的是范围内的项，调整范围
                if (index >= oldVisibleRange.start && index <= oldVisibleRange.end) {
                    if (index === oldVisibleRange.start) {
                        // 删除的是第一项，不需要调整start
                    } else if (index === oldVisibleRange.end) {
                        // 删除的是最后一项，减少end
                        newEndIndex = oldVisibleRange.end - 1;
                    } else {
                        // 删除的是中间项，范围基本不变
                        newEndIndex = oldVisibleRange.end - 1;
                    }
                }

                // 确保范围不超出数据边界
                newEndIndex = Math.min(this.dataManager.GetItemCount(), newEndIndex);

                // 检查是否有新的项需要显示
                for (let i = newStartIndex; i < newEndIndex; i++) {
                    if (!this.nodeManager.GetVisibleItems().has(i)) {
                        this.AddOrUpdateItemAt(i);
                    }
                }

                // 如果还需要更多项来填补，尝试向后扩展
                if (this.nodeManager.GetVisibleItems().size < originalVisibleCount - 1) {
                    let extendIndex = newEndIndex;
                    while (extendIndex < this.dataManager.GetItemCount() &&
                        this.nodeManager.GetVisibleItems().size < originalVisibleCount) {
                        if (!this.nodeManager.GetVisibleItems().has(extendIndex)) {
                            this.AddOrUpdateItemAt(extendIndex);
                        }
                        extendIndex++;
                    }
                }
            }
        }
    }

    /**
     * 处理动画队列中的下一个操作
     */
    private ProcessNextAnimationQueue(): void {
        if (this.mAnimationQueue.length === 0) return;

        const nextOperation = this.mAnimationQueue.shift();
        if (!nextOperation) return;

        switch (nextOperation.anim) {
            case ANIM_ATION.INSERT:
                this.InsertItemAt(nextOperation.index, nextOperation.type!, true);
                break;
            case ANIM_ATION.REMOVE:
                this.RemoveItemAt(nextOperation.index, true);
                break;
        }
    }

    /**
     * 触发智能垃圾收集
     */
    private TriggerSmartGarbageCollection(): void {
        if (this.performanceManager.ShouldTriggerGC()) {
            this.nodeManager.SmartGarbageCollection(this.performanceManager.GetMaxPoolSize());
            this.performanceManager.UpdateGCTime();
        }
    }

    /**
     * 处理嵌套滚动列表的触摸事件
     */
    private OnNestTouchEvent(event: CustomEventTouch): void {
        if (event.mock || event.simulate || (event.target as Node) === this.node) return;

        // 触摸开始
        if (event.type == Node.EventType.TOUCH_START) {
            this.mTouchStartPos = event.touch!.getLocation();
            this.InnerDisplatchTouchEvent(event);
            return;
        }

        // 触摸移动
        if (event.type == Node.EventType.TOUCH_MOVE) {
            if (this.mTouchStartPos) {
                const currentPos = event.touch!.getLocation();
                const deltaX = Math.abs(currentPos.x - this.mTouchStartPos!.x);
                const deltaY = Math.abs(currentPos.y - this.mTouchStartPos!.y);
                if (Math.max(deltaX, deltaY) > 5) {
                    this.InnerDisplatchTouchEvent(event);
                }
            }
            return;
        }

        // 触摸结束或取消
        if (event.type == Node.EventType.TOUCH_END || event.type == Node.EventType.TOUCH_CANCEL) {
            this.mTouchStartPos = null;
            this.InnerDisplatchTouchEvent(event);
        }
    }


    /**
     * 发送触摸事件到虚拟列表节点
     * @param event 
     */
    private InnerDisplatchTouchEvent(event: CustomEventTouch) {
        const copyEvent = new EventTouch(event.getTouches(), event.bubbles, event.type);
        copyEvent.touch = event.touch;
        // @ts-ignore
        copyEvent.mock = true;
        this.scheduleOnce(() => {
            this.node.dispatchEvent(copyEvent);
        });
    }


    /**
     * 更新调试统计信息
     */
    private UpdateDebugStats(startTime: number, recycledCount: number): void {
        const frameTime = Date.now() - startTime;
        const visibleCount = this.nodeManager.GetVisibleItems().size;
        this.performanceManager.UpdateRenderStats(frameTime, visibleCount, recycledCount);

        if (this.mIsDebugMode) {
            const stats = this.performanceManager.GetRenderStats();
            VirtualLog.Debug(`性能监控:
            - 渲染时间: ${stats.frameTime}ms
            - 可见项数: ${stats.visibleCount}
            - 回收节点数: ${stats.recycleCount}
            - 低性能模式: ${stats.isLowPerformanceMode ? '是' : '否'}
            - 对象池总大小: ${this.nodeManager.GetTotalPoolSize()}
            `);
        }
    }
}