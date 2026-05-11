/*************************************************************************************
 * @File        : VirtualListTypes.ts
 * @Author      : xingkong6
 * @Date        : 2025-07-02 16:28:21
 * @Date        : Copyright (c) 2025 by xingkong6, All Rights Reserved.
 * @Description : 虚拟列表类型定义
 **************************************************************************************/

import { EventTouch, Node, NodePool, ccenum } from 'cc';

// 布局类型：垂直、水平、网格
export enum ViewLayoutType {
    VERTICAL = 0,
    HORIZONTAL = 1,
    GRID = 2
}
ccenum(ViewLayoutType);

// 滚动方向：垂直、水平
export enum ScrollDirection {
    VERTICAL = 0,
    HORIZONTAL = 1
}
ccenum(ScrollDirection);

// 触摸方向：未确定、垂直、水平
export enum TouchDirection {
    NONE = 0,
    VERTICAL = 1,
    HORIZONTAL = 2
}
ccenum(TouchDirection);

// 动画操作类型：插入、移除
export enum ANIM_ATION {
    INSERT,   // 插入
    REMOVE,   // 移除
}

// 定义数据结构，包含type字段
export interface ItemTemplateData {
    type: string | number;
    data: any;
}

/**
 * 模板项定义
 */
export interface TemplateItem {
    type: string | number;               // 模板类型标识符
    node: Node | (() => Node);  // 模板节点或获取节点函数
    pool: NodePool;            // 该类型专用的对象池
}

/**
 * 虚拟列表回调接口
 */
export interface IVirtualListCallbacks {
    onItemInit?: (node: Node, index: number) => void;
    onItemUpdate?: (node: Node, index: number) => void;
    onScrolling?: (scrollRatio: number) => void;
    onLoadFinished?: () => void;
}

/**
 * 性能监控数据结构
 */
export interface PerformanceStats {
    frameTime: number;
    visibleCount: number;
    recycleCount: number;
    reusedCount: number;
    frameDrops: number;
    isLowPerformanceMode: boolean;
}

/**
 * 内存优化配置
 */
export interface MemoryConfig {
    lastGCTime: number;
    gcInterval: number;
    maxPoolSize: number;
    weakRefCache: WeakMap<Node, number>;
}

/**
 * 可见范围数据结构
 */
export interface VisibleRange {
    start: number;
    end: number;
}

/**
 * 加载参数
 */
export interface LoadParameters {
    bufferCount: number;
    batchSize: number;
}

/**
 * 动画队列项
 */
export interface AnimationQueueItem {
    anim: ANIM_ATION;
    index: number;
    type?: string | number;
    duration?: number;
    callback?: () => void;
}


/**
 * 自定义触摸事件
 */
export interface CustomEventTouch extends EventTouch {
    mock?: boolean;
}