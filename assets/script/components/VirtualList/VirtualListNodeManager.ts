/*************************************************************************************
 * @File        : VirtualListNodeManager.ts
 * @Author      : xingkong6
 * @Date        : 2025年6月29日
 * @Description : 虚拟列表节点管理类
 **************************************************************************************/

import { Node, NodePool, instantiate, isValid, Vec3, Tween, tween, easing, Widget, UITransform } from 'cc';
import { TemplateItem, ViewLayoutType, ScrollDirection } from './VirtualListTypes';

/**
 * 虚拟列表节点管理类
 * 负责节点的创建、回收、对象池管理等
 */
export class VirtualListNodeManager {
    // 模板相关
    private mTemplateItems: Map<string | number, TemplateItem> = new Map();
    private mDefaultTemplateType: string | number = "default";

    // Map 存储当前显示的单元格，键为单元格索引，值为节点
    private mVisibleItemsMap: Map<number, Node> = new Map();
    set VisibleItemsMap(value: Map<number, Node>) {
        this.mVisibleItemsMap = value;
    }

    // 初始化回调
    private mItemInitFunc: ((node: Node, index: number) => void) = () => { };
    set ItemInitFunc(func: (node: Node, index: number) => void) {
        this.mItemInitFunc = func;
    }

    // 更新回调
    private mItemUpdateFunc: (node: Node, index: number) => void = () => { };
    set ItemUpdateFunc(func: (node: Node, index: number) => void) {
        this.mItemUpdateFunc = func;
    }

    constructor(
        private layoutType: ViewLayoutType,
        private scrollDirection: ScrollDirection,
        private cols: number,
        private rows: number,
        private paddingTop: number,
        private paddingBottom: number,
        private paddingLeft: number,
        private paddingRight: number,
        private girdVertRowsSpacing: number,
        private girdVertColsSpacing: number,
        private girdHoriRowsSpacing: number,
        private girdHoriColsSpacing: number,
    ) { }

    /**
     * 注册模板类型
     */
    public RegisterTemplate(type: string | number, nodeOrGetter: Node | (() => Node), isDefault: boolean = false): void {
        const pool = new NodePool();
        this.mTemplateItems.set(type, {
            type,
            node: nodeOrGetter,
            pool
        });

        if (isDefault) {
            this.mDefaultTemplateType = type;
        }
    }

    /**
     * 批量注册模板
     */
    public RegisterTemplates(templates: { type: string, node: Node | (() => Node) }[], defaultType?: string): void {
        for (const template of templates) {
            this.RegisterTemplate(template.type, template.node);
        }

        if (defaultType && this.mTemplateItems.has(defaultType)) {
            this.mDefaultTemplateType = defaultType;
        }
    }

    /**
     * 清理所有模板和对象池
     */
    public ClearTemplates(): void {
        this.mTemplateItems.forEach(template => {
            if (template.pool) {
                template.pool.clear();
            }
        });
        this.mTemplateItems.clear();
        this.mDefaultTemplateType = "default";
    }

    /**
     * 获取模板映射
     */
    public GetTemplateItems(): Map<string | number, TemplateItem> {
        return this.mTemplateItems;
    }

    /**
     * 获取是否有目标模版
     */
    public HasTemplate(type: string | number): boolean {
        return this.mTemplateItems.has(type);
    }

    /**
     * 获取默认模板类型
     */
    public GetDefaultTemplateType(): string | number {
        return this.mDefaultTemplateType;
    }


    /**
     * 清除所有可见项
     */
    public ClearVisibleItemsMap(): void {
        this.mVisibleItemsMap.clear();
    }

    /**
     * 设置可见项映射
     */
    public SetVisibleItemsKeyValue(index: number, node: Node): void {
        this.mVisibleItemsMap.set(index, node);
    }

    /**
     * 获取可见项映射
     */
    public GetVisibleItems(): Map<number, Node> {
        return this.mVisibleItemsMap;
    }

    /**
     * 获取指定索引的节点
     */
    public GetItemNode(index: number): Node | null {
        return this.mVisibleItemsMap.get(index) || null;
    }

    /**
     * 初始化指定索引的节点 
     */
    public InitItemNode(node: Node, index: number): void {
        this.mItemInitFunc && this.mItemInitFunc(node, index);
    }

    /**
     * 更新指定索引的节点 
     */
    public UpdateItemNode(node: Node, index: number): void {
        this.mItemUpdateFunc && this.mItemUpdateFunc(node, index);
    }

    /**
     * 创建并添加节点到可见项映射
     */
    public AddOrUpdateItem(index: number, type: string | number, parent: Node, itemSizes: number[], cumulativeSizes: number[], cellWidth: number, cellHeight: number): Node | null {

        if (this.mVisibleItemsMap.has(index)) {
            const existNode = this.mVisibleItemsMap.get(index)!;
            this.UpdateItemNode(existNode, index);
            return existNode;
        }

        const node = this.GetTemplateNodeByType(type ?? this.mDefaultTemplateType);
        if (!node) return null;

        // 计算位置
        const pos = this.CalculateItemPosition(index, itemSizes, cumulativeSizes, cellWidth, cellHeight);
        node.setPosition(pos);
        node.active = true;

        // 更新尺寸
        const uiTrans = node.getComponent(UITransform);
        if (uiTrans) {
            switch (this.layoutType) {
                case ViewLayoutType.VERTICAL:
                    uiTrans.height = itemSizes[index];
                    break;
                case ViewLayoutType.HORIZONTAL:
                    uiTrans.width = itemSizes[index];
                    break;
                case ViewLayoutType.GRID:
                    uiTrans.width = cellWidth;
                    uiTrans.height = cellHeight;
                    break;
            }
            // 更新Widget对齐
            node.getComponentInChildren(Widget)?.updateAlignment();
        }

        // 添加到父节点
        if (node.parent !== parent) {
            node.parent = parent;
        }

        // 调用初始化回调
        // @ts-ignore
        if (!node['__reused__']) {
            this.InitItemNode(node, index);
        }
        this.UpdateItemNode(node, index);

        // 添加到可见项映射
        this.mVisibleItemsMap.set(index, node);
        return node;
    }

    /**
     * 回收节点
     */
    public RecycleNode(node: Node): void {
        if (!node || !isValid(node, true)) return;

        // @ts-ignore
        node['__reused__'] = true;
        Tween.stopAllByTarget(node);

        // 获取节点对应的数据和类型
        // @ts-ignore
        const type = node['__type__'] || this.mDefaultTemplateType;
        const template = this.mTemplateItems.get(type) || this.mTemplateItems.get(this.mDefaultTemplateType);
        if (template && template.pool) {
            template.pool.put(node);
        }
    }


    /**
     * 更新节点类型
     * @param node 
     * @param index 
     * @param type 
     */
    public UpdateItemType(node: Node, index: number, type: string | number): void {
        // @ts-ignore
        const nodeType = node['__type__'] || this.mDefaultTemplateType;
        if (nodeType === type) return;

        // 获取新的模板节点
        let newNode = this.GetTemplateNodeByType(type);
        if (!newNode) {
            console.error(`UpdateItemType 未找到类型为 ${type} 的模板`);
            return;
        }

        // 更新类型
        // @ts-ignore
        newNode['__type__'] = type;

        // 复制尺寸
        const newUiTrans = newNode.getComponent(UITransform);
        if (newUiTrans) {
            const nodeUiTrans = node.getComponent(UITransform);
            newUiTrans.width = nodeUiTrans?.width ?? 50;
            newUiTrans.height = nodeUiTrans?.height ?? 50;
            newNode.getComponentInChildren(Widget)?.updateAlignment();
        }

        // 复制位置
        newNode.setPosition(node.getPosition());
        newNode.active = true;

        // 添加到父节点
        if (newNode.parent !== node.parent) {
            newNode.parent = node.parent;
        }

        // 调用初始化回调
        this.InitItemNode(newNode, index);
        this.UpdateItemNode(newNode, index);

        // 添加到可见项映射
        this.mVisibleItemsMap.set(index, newNode);

        // 回收旧节点
        this.RecycleNode(node);
    }


    /**
     * 清空所有可见项
     */
    public ClearVisibleItems(): void {
        this.mVisibleItemsMap.forEach((node) => {
            this.RecycleNode(node);
        });
        this.mVisibleItemsMap.clear();
    }

    /**
     * 回收不在指定范围内的节点
     */
    public RecycleInvisibleItems(startIndex: number, endIndex: number): number {
        let recycledCount = 0;

        this.mVisibleItemsMap.forEach((node, index) => {
            if (index < startIndex || index >= endIndex) {
                this.RecycleNode(node);
                this.mVisibleItemsMap.delete(index);
                recycledCount++;
            }
        });

        return recycledCount;
    }

    /**
     * 预加载项到对象池
     */
    public PreloadItems(count: number = 10): void {
        if (this.mTemplateItems.size === 0) {
            console.error("PreloadItems 未设置模板节点，无法预加载");
            return;
        }

        let preloadedCount = 0;
        this.mTemplateItems.forEach((template, type) => {
            for (let i = 0; i < Math.ceil(count / this.mTemplateItems.size); i++) {
                let node: Node | null = null;
                if (template.node instanceof Node) {
                    node = instantiate(template.node);
                }
                else if (typeof template.node === 'function') {
                    node = template.node();
                }

                if (node) {
                    // @ts-ignore
                    node['__type__'] = type;
                    template.pool.put(node);
                    preloadedCount++;
                }
            }
        });
        console.log(`PreloadItems 已预加载 ${preloadedCount} 个节点到对象池`,this.mTemplateItems);
    }

    /**
     * 执行插入动画
     */
    public ExecuteInsertAnimation(node: Node, layoutType: ViewLayoutType, callback?: () => void): void {
        let startScale = new Vec3(1, 1, 1);
        switch (layoutType) {
            case ViewLayoutType.VERTICAL:
                startScale = new Vec3(1, 0.01, 1);
                break;
            case ViewLayoutType.HORIZONTAL:
                startScale = new Vec3(0.01, 1, 1);
                break;
            case ViewLayoutType.GRID:
                startScale = new Vec3(0.01, 0.01, 1);
                break;
        }

        node.scale = startScale;
        tween(node)
            .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: easing.cubicOut })
            .call(() => {
                callback && callback();
            })
            .start();
    }

    /**
     * 执行移除动画
     */
    public ExecuteRemoveAnimation(node: Node, layoutType: ViewLayoutType, callback?: () => void): void {
        let targetScale = new Vec3(1, 1, 1);
        switch (layoutType) {
            case ViewLayoutType.VERTICAL:
                targetScale = new Vec3(1, 0.01, 1);
                break;
            case ViewLayoutType.HORIZONTAL:
                targetScale = new Vec3(0.01, 1, 1);
                break;
            case ViewLayoutType.GRID:
                targetScale = new Vec3(0.01, 0.01, 1);
                break;
        }

        tween(node)
            .to(0.25, { scale: targetScale }, { easing: easing.cubicOut })
            .call(() => {
                callback && callback();
            })
            .start();
    }

    /**
     * 更新节点位置（用于动画过程中的位置调整）
     */
    public UpdateNodePosition(node: Node, index: number, itemSizes: number[],
        cumulativeSizes: number[], cellWidth: number, cellHeight: number, animate: boolean = false): void {

        const pos = this.CalculateItemPosition(index, itemSizes, cumulativeSizes, cellWidth, cellHeight);

        if (animate) {
            tween(node)
                .to(0.3, { position: pos }, { easing: 'cubicOut' })
                .start();
        } else {
            node.setPosition(pos);
        }
    }

    /**
     * 获取对象池总大小
     */
    public GetTotalPoolSize(): number {
        let total = 0;
        this.mTemplateItems.forEach(template => {
            if (template.pool) {
                total += template.pool.size();
            }
        });
        return total;
    }

    /**
     * 智能垃圾回收
     */
    public SmartGarbageCollection(maxPoolSize: number): void {
        this.mTemplateItems.forEach(template => {
            const pool = template.pool;
            if (pool && pool.size() > maxPoolSize) {
                const toRemove = pool.size() - Math.floor(maxPoolSize / 2);
                for (let i = 0; i < toRemove; i++) {
                    const node = pool.get();
                    if (node && isValid(node, true)) {
                        node.destroy();
                    }
                }
            }
        });
    }

    /**
     * 获取指定类型的模板节点
     */
    private GetTemplateNodeByType(type: string | number): Node | null {
        const template = this.mTemplateItems.get(type) || this.mTemplateItems.get(this.mDefaultTemplateType);

        if (!template) {
            console.error(`GetTemplateNodeByType 未找到类型为 ${type} 的模板，且未设置默认模板`);
            return null;
        }

        let node: Node | null = null;

        // 先尝试从对象池获取
        if (template.pool && template.pool.size() > 0) {
            node = template.pool.get();
            if (node && isValid(node, true)) {
                node.scale = new Vec3(1, 1, 1);
            }
        }

        // 没有从对象池获取到，则创建新节点
        if (!node) {
            if (template.node instanceof Node) {
                node = instantiate(template.node);
            }
            else if (typeof template.node === 'function') {
                node = template.node();
            }
            // @ts-ignore
            node['__type__'] = type;
        }

        return node;
    }


    /**
     * 计算项目位置
     */
    private CalculateItemPosition(index: number, itemSizes: number[],
        cumulativeSizes: number[], cellWidth: number, cellHeight: number): Vec3 {

        // 网格布局位置计算
        if (this.layoutType === ViewLayoutType.GRID) {
            if (this.scrollDirection === ScrollDirection.VERTICAL) {
                const row = Math.floor(index / this.cols);
                const col = index % this.cols;

                const gridWidth = this.cols * cellWidth + (this.cols - 1) * this.girdVertColsSpacing;
                const startX = -gridWidth / 2 + cellWidth / 2;

                return new Vec3(
                    startX + col * (cellWidth + this.girdVertColsSpacing),
                    -(row * (cellHeight + this.girdVertRowsSpacing) + cellHeight / 2 + this.paddingTop),
                    0
                );
            } else {
                const colH = Math.floor(index / this.rows);
                const rowH = index % this.rows;

                const gridHeight = this.rows * cellHeight + (this.rows - 1) * this.girdHoriRowsSpacing;
                const startY = gridHeight / 2 - cellHeight / 2;

                return new Vec3(
                    colH * (cellWidth + this.girdHoriColsSpacing) + cellWidth / 2 + this.paddingLeft,
                    startY - rowH * (cellHeight + this.girdHoriRowsSpacing),
                    0
                );
            }
        }

        // 列表布局位置计算
        let position = new Vec3();

        if (index === 0) {
            if (this.layoutType === ViewLayoutType.VERTICAL) {
                position.y = -(itemSizes[0] / 2 + this.paddingTop);
            } else {
                position.x = itemSizes[0] / 2 + this.paddingLeft;
            }
        } else {
            const prevSum = cumulativeSizes[index - 1];
            const currSize = itemSizes[index];

            if (this.layoutType === ViewLayoutType.VERTICAL) {
                position.y = -(prevSum + currSize / 2 + this.paddingTop);
            } else {
                position.x = prevSum + currSize / 2 + this.paddingLeft;
            }
        }

        return position;
    }
}