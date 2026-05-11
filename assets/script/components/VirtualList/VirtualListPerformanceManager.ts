/*************************************************************************************
 * @File        : VirtualListPerformanceManager.ts
 * @Author      : xingkong6
 * @Date        : 2025年6月29日
 * @Description : 虚拟列表性能管理类
 **************************************************************************************/

import { PerformanceStats, MemoryConfig, LoadParameters, VisibleRange } from './VirtualListTypes';

/**
 * 虚拟列表性能管理类
 * 负责性能监控、内存优化、自适应调整等
 */
export class VirtualListPerformanceManager {
    // 渲染统计信息
    private mRenderStats: PerformanceStats = {
        frameTime: 0,
        visibleCount: 0,
        recycleCount: 0,
        reusedCount: 0,
        frameDrops: 0,
        isLowPerformanceMode: false
    };

    // 内存管理优化
    private mMemoryOptimizer: MemoryConfig = {
        lastGCTime: 0,
        gcInterval: 30000, // 30秒执行一次垃圾回收
        maxPoolSize: 50,   // 每个对象池最大节点数
        weakRefCache: new WeakMap()
    };

    // 性能监控优化
    private mPerformanceMonitor = {
        frameDrops: 0,
        lastFrameTime: 0,
        adaptiveThreshold: 5, // 连续5帧超时进入低性能模式
        isLowPerformanceMode: false
    };

    // 滚动与性能优化
    private mLastUpdateTime: number = 0;
    private mUpdateInterval: number = 16; // 默认约60fps
    private mScrollVelocity: number = 0;
    private mLastScrollPos: number = 0;
    private mFrameCount: number = 0;

    constructor(
        private autoOptimizePerformance: boolean = true,
        private cacheRatio: number = 0.5
    ) { }

    /**
     * 获取渲染统计信息
     */
    public GetRenderStats(): PerformanceStats {
        return { ...this.mRenderStats };
    }

    /**
     * 更新渲染统计
     */
    public UpdateRenderStats(frameTime: number, visibleCount: number, recycleCount: number): void {
        this.mRenderStats.frameTime = frameTime;
        this.mRenderStats.visibleCount = visibleCount;
        this.mRenderStats.recycleCount = recycleCount;
        this.mRenderStats.frameDrops = this.mPerformanceMonitor.frameDrops;
        this.mRenderStats.isLowPerformanceMode = this.mPerformanceMonitor.isLowPerformanceMode;
    }

    /**
     * 监控帧性能并进行自适应调整
     */
    public MonitorFramePerformance(frameStartTime: number): void {
        if (!frameStartTime || !this.autoOptimizePerformance) return;

        const now = Date.now();
        const frameDuration = now - this.mPerformanceMonitor.lastFrameTime;

        // 检测帧时间是否超过阈值 (33ms 约等于 30fps)
        if (frameDuration > 33) {
            this.mPerformanceMonitor.frameDrops++;

            // 连续掉帧超过阈值进入低性能模式
            if (this.mPerformanceMonitor.frameDrops >= this.mPerformanceMonitor.adaptiveThreshold) {
                this.mPerformanceMonitor.isLowPerformanceMode = true;
            }
        } else {
            // 恢复正常情况下，逐步减少掉帧计数
            this.mPerformanceMonitor.frameDrops = Math.max(0, this.mPerformanceMonitor.frameDrops - 0.5);

            // 当掉帧计数归零时恢复正常模式
            if (this.mPerformanceMonitor.frameDrops === 0 && this.mPerformanceMonitor.isLowPerformanceMode) {
                this.mPerformanceMonitor.isLowPerformanceMode = false;
            }
        }

        this.mPerformanceMonitor.lastFrameTime = now;
    }

    /**
     * 更新滚动性能数据
     */
    public UpdateScrollPerformance(currentScrollPos: number): boolean {
        // 计算滚动速度
        this.mScrollVelocity = Math.abs(currentScrollPos - this.mLastScrollPos);
        this.mLastScrollPos = currentScrollPos;

        // 自动优化刷新频率
        if (this.autoOptimizePerformance) {
            this.mFrameCount++;
            const now = Date.now();

            // 根据滚动速度动态调整更新间隔
            if (this.mScrollVelocity > 20) {
                this.mUpdateInterval = 8;  // 快速滚动时提高刷新率到120fps
            } else if (this.mScrollVelocity > 10) {
                this.mUpdateInterval = 16; // 中速滚动时使用60fps
            } else {
                this.mUpdateInterval = 33; // 慢速滚动时降低到30fps节省资源
            }

            if (now - this.mLastUpdateTime > this.mUpdateInterval) {
                this.mLastUpdateTime = now;
                this.mFrameCount = 0;
                return true; // 需要更新
            }
        } else {
            // 固定刷新率
            const now = Date.now();
            if (now - this.mLastUpdateTime > this.mUpdateInterval) {
                this.mLastUpdateTime = now;
                return true; // 需要更新
            }
        }

        return false; // 不需要更新
    }

    /**
     * 滚动结束处理
     */
    public OnScrollEnd(): void {
        this.mScrollVelocity = 0;
        this.mUpdateInterval = 16; // 恢复到高刷新率
    }

    /**
     * 计算加载参数
     */
    public ComputeLoadParameters(viewLength: number, itemSizes: number[],
        layoutType: any, scrollDirection: any, cols: number, rows: number,
        cellHeight: number, cellWidth: number, girdVertRowsSpacing: number, girdHoriColsSpacing: number): LoadParameters {

        if (itemSizes.length === 0) return { bufferCount: 1, batchSize: 1 };

        const bufferMultiplier = Math.max(0.1, this.cacheRatio);

        switch (layoutType) {
            case 0: // VERTICAL
            case 1: // HORIZONTAL
                const totalSize = itemSizes.reduce((acc, cur) => acc + cur, 0);
                const avgSize = totalSize / itemSizes.length;
                const visibleCount = Math.ceil(viewLength / avgSize);
                const bufferCount = Math.max(1, Math.ceil(visibleCount * bufferMultiplier));
                const batchSize = Math.max(1, Math.ceil(visibleCount * 0.5));
                return { bufferCount, batchSize };

            case 2: // GRID
                let visibleRows = 0, visibleCols = 0;
                switch (scrollDirection) {
                    case 0: // VERTICAL
                        const rowHeight = cellHeight + girdVertRowsSpacing;
                        visibleRows = Math.ceil(viewLength / rowHeight);
                        const bufferRows = Math.max(1, Math.ceil(visibleRows * bufferMultiplier));
                        const batchRows = Math.max(1, Math.ceil(visibleRows * 0.5));
                        return { bufferCount: bufferRows, batchSize: batchRows * cols };

                    case 1: // HORIZONTAL
                        const colWidth = cellWidth + girdHoriColsSpacing;
                        visibleCols = Math.ceil(viewLength / colWidth);
                        const bufferCols = Math.max(1, Math.ceil(visibleCols * bufferMultiplier));
                        const batchCols = Math.max(1, Math.ceil(visibleCols * 0.5));
                        return { bufferCount: bufferCols, batchSize: batchCols * rows };
                }
        }

        return { bufferCount: 1, batchSize: 1 };
    }

    /**
     * 根据性能状态调整加载参数
     */
    public AdjustParametersForPerformance(params: LoadParameters): LoadParameters {
        if (this.mPerformanceMonitor.isLowPerformanceMode) {
            // 低性能模式下减少预加载和批处理数量
            return {
                bufferCount: Math.max(1, Math.floor(params.bufferCount * 0.5)),
                batchSize: Math.max(1, Math.floor(params.batchSize * 0.7))
            };
        }
        return params;
    }

    /**
     * 是否需要智能垃圾回收
     */
    public ShouldTriggerGC(): boolean {
        const now = Date.now();
        return now - this.mMemoryOptimizer.lastGCTime >= this.mMemoryOptimizer.gcInterval;
    }

    /**
     * 更新垃圾回收时间
     */
    public UpdateGCTime(): void {
        this.mMemoryOptimizer.lastGCTime = Date.now();
    }

    /**
     * 获取最大对象池大小
     */
    public GetMaxPoolSize(): number {
        return this.mMemoryOptimizer.maxPoolSize;
    }

    /**
     * 是否为低性能模式
     */
    public IsLowPerformanceMode(): boolean {
        return this.mPerformanceMonitor.isLowPerformanceMode;
    }

    /**
     * 获取内存使用信息
     */
    public GetMemoryUsage(): any {
        return {
            lastGCTime: this.mMemoryOptimizer.lastGCTime,
            timeUntilNextGC: Math.max(0, this.mMemoryOptimizer.gcInterval - (Date.now() - this.mMemoryOptimizer.lastGCTime)),
            maxPoolSize: this.mMemoryOptimizer.maxPoolSize
        };
    }

    /**
     * 重置性能统计
     */
    public Reset(): void {
        this.mLastUpdateTime = 0;
        this.mFrameCount = 0;
        this.mScrollVelocity = 0;
        this.mLastScrollPos = 0;
        this.mPerformanceMonitor.frameDrops = 0;
        this.mPerformanceMonitor.isLowPerformanceMode = false;

        this.mRenderStats = {
            frameTime: 0,
            visibleCount: 0,
            recycleCount: 0,
            reusedCount: 0,
            frameDrops: 0,
            isLowPerformanceMode: false
        };
    }
}