/*************************************************************************************
 * @File        : VirtualListDataManager.ts
 * @Author      : xingkong6
 * @Date        : 2025年6月29日
 * @Description : 虚拟列表数据管理类
 **************************************************************************************/

import { Node, UITransform, isValid } from 'cc';
import { ScrollDirection, TemplateItem, ViewLayoutType } from './VirtualListTypes';

/**
 * 虚拟列表数据管理类
 * 负责数据源管理、尺寸计算、累积值计算等
 */
export class VirtualListDataManager {
    // 类型数据源
    private mItemsTypes: Array<string | number> = [];
    // 各项尺寸
    private mItemSizes: Array<number> = [];
    // 自定义尺寸
    private mCustomSizes: Array<number> = [];
    // 累积尺寸数组
    private mCumulativeSizes: Array<number> = [];
    // 网格模式下单元格尺寸
    private mCellWidth: number = 0;
    private mCellHeight: number = 0;

    constructor(
        private layoutType: ViewLayoutType,
        private scrollDirection: ScrollDirection,
        private cols: number,
        private rows: number,
        private itemSpacing: number,
        private girdVertRowsSpacing: number,
        private girdHoriColsSpacing: number,
        public templateItems: Map<string | number, TemplateItem>,
        public defaultTemplateType: string | number
    ) { }

    /**
     * 设置数据源
     */
    public SetDataSource(typeArray: Array<string | number>, customSizes: number[] = []): void {
        this.mItemsTypes = typeArray.slice();
        this.mCustomSizes = customSizes.slice();
        this.InitializeItemSizes();
        this.UpdateCumulativeSizes();
    }

    /**
     * 获取数据总数
     */
    public GetItemCount(): number {
        return this.mItemsTypes.length;
    }


    /**
     * 获取指定索引的项目类型
     */
    public GetItemType(index: number): string | number {
        if (index < 0 || index >= this.mItemsTypes.length) {
            console.warn(`GetItemType: 索引 ${index} 超出范围`);
            return this.defaultTemplateType;
        }
        return this.mItemsTypes[index] || this.defaultTemplateType;
    }


    /**
     * 插入数据
     */
    public InsertData(index: number, type: string | number): void {
        this.mItemsTypes.splice(index, 0, type);
        this.RecalculateSize(index);
    }

    /**
     * 移除数据
     */
    public RemoveData(index: number): void {
        this.mItemsTypes.splice(index, 1);
        this.mItemSizes.splice(index, 1);
        this.UpdateCumulativeSizes();
    }

    /**
     * 获取项目尺寸
     */
    public GetItemSize(index: number): number {
        return this.mItemSizes[index] || 0;
    }

    /**
     * 获取所有项目尺寸
     */
    public GetAllItemSizes(): number[] {
        return this.mItemSizes;
    }

    /**
     * 更新项目类型
     */
    public UpdateItemType(index: number, type: string | number): void {
        if (index >= 0 && index < this.mItemsTypes.length) {
            this.mItemsTypes[index] = type;
            this.RecalculateSize(index);
        }
    }

    /**
     * 更新项目尺寸
     */
    public UpdateItemSize(index: number, newSize: number): void {
        if (index >= 0 && index < this.mItemSizes.length) {
            this.mItemSizes[index] = newSize;
            this.UpdateCumulativeSizes();
        }
    }

    /**
     * 获取累积尺寸
     */
    public GetCumulativeSizes(): number[] {
        return this.mCumulativeSizes;
    }

    /**
     * 获取网格单元格尺寸
     */
    public GetCellSize(): { width: number, height: number } {
        return { width: this.mCellWidth, height: this.mCellHeight };
    }

    /**
     * 计算总内容尺寸
     */
    public CalculateContentSize(): { width: number, height: number } {
        let totalHeight = 0, totalWidth = 0;

        switch (this.layoutType) {
            case ViewLayoutType.VERTICAL:
                totalHeight = this.mCumulativeSizes.length > 0 ?
                    this.mCumulativeSizes[this.mCumulativeSizes.length - 1] : 0;
                break;

            case ViewLayoutType.HORIZONTAL:
                totalWidth = this.mCumulativeSizes.length > 0 ?
                    this.mCumulativeSizes[this.mCumulativeSizes.length - 1] : 0;
                break;

            case ViewLayoutType.GRID:
                switch (this.scrollDirection) {
                    case ScrollDirection.VERTICAL:
                        const rows = Math.ceil(this.mItemSizes.length / this.cols);
                        totalHeight = rows * this.mCellHeight + (rows - 1) * this.girdVertRowsSpacing;
                        totalWidth = this.cols * this.mCellWidth + (this.cols - 1) * this.girdVertRowsSpacing;
                        break;

                    case ScrollDirection.HORIZONTAL:
                        const cols = Math.ceil(this.mItemSizes.length / this.rows);
                        totalWidth = cols * this.mCellWidth + (cols - 1) * this.girdHoriColsSpacing;
                        totalHeight = this.rows * this.mCellHeight + (this.rows - 1) * this.girdHoriColsSpacing;
                        break;
                }
                break;
        }

        return { width: totalWidth, height: totalHeight };
    }

    /**
     * 二分查找索引
     */
    public FindIndexByOffset(offset: number): number {
        if (this.mCumulativeSizes.length === 0) return 0;

        let start = 0;
        let end = this.mCumulativeSizes.length - 1;

        while (start <= end) {
            const mid = Math.floor((start + end) / 2);
            const midPos = this.GetOffsetForIndex(mid);
            const midSize = this.mItemSizes[mid];

            if (offset < midPos) {
                end = mid - 1;
            } else if (offset >= midPos + midSize) {
                start = mid + 1;
            } else {
                return mid;
            }
        }

        return Math.max(0, Math.min(start, this.mCumulativeSizes.length - 1));
    }

    /**
     * 获取指定索引的偏移位置
     */
    public GetOffsetForIndex(index: number): number {
        if (index <= 0) return 0;

        switch (this.layoutType) {
            case ViewLayoutType.GRID:
                if (this.scrollDirection === ScrollDirection.VERTICAL) {
                    const row = Math.floor(index / this.cols);
                    return row * (this.mCellHeight + this.girdVertRowsSpacing);
                } else {
                    const col = Math.floor(index / this.rows);
                    return col * (this.mCellWidth + this.girdHoriColsSpacing);
                }

            default:
                return index === 0 ? 0 : this.mCumulativeSizes[index - 1];
        }
    }

    /**
     * 清空所有数据
     */
    public Clear(): void {
        this.mItemSizes = [];
        this.mItemsTypes = [];
        this.mCumulativeSizes = [];
        this.mCellWidth = 0;
        this.mCellHeight = 0;
    }

    /**
     * 初始化项目尺寸
     */
    private InitializeItemSizes(): void {
        this.mItemSizes = [];

        for (let i = 0; i < this.mItemsTypes.length; i++) {
            const type = this.GetItemType(i);

            // 获取模板节点用于测量尺寸
            let templateNode: Node | null = null;
            const template = this.templateItems.get(type) || this.templateItems.get(this.defaultTemplateType);

            if (template) {
                if (template.node instanceof Node) {
                    templateNode = template.node;
                } else if (typeof template.node === 'function') {
                    templateNode = template.node();
                    // 测量完尺寸后放入对象池
                    if (template.pool && isValid(templateNode, true)) {
                        // @ts-ignore
                        templateNode['__type__'] = type;
                        template.pool.put(templateNode);
                    }
                }
            }

            if (!templateNode) {
                console.error(`InitializeItemSizes 无法获取索引 ${i} (类型:${type}) 的模板节点`);
                this.mItemSizes.push(50); // 使用默认尺寸
                continue;
            }

            const uiTrans = templateNode.getComponent(UITransform);
            if (!uiTrans) {
                console.error(`InitializeItemSizes 模板节点缺少UITransform组件`);
                this.mItemSizes.push(50);
                continue;
            }

            // 根据布局类型获取尺寸
            let itemSize = 50;
            switch (this.layoutType) {
                case ViewLayoutType.VERTICAL:
                    itemSize = uiTrans.height;
                    break;
                case ViewLayoutType.HORIZONTAL:
                    itemSize = uiTrans.width;
                    break;
                case ViewLayoutType.GRID:
                    itemSize = this.scrollDirection === ScrollDirection.VERTICAL ? uiTrans.height : uiTrans.width;
                    // 记录第一个节点尺寸用于网格布局
                    if (i === 0) {
                        this.mCellWidth = uiTrans.width;
                        this.mCellHeight = uiTrans.height;
                    }
                    break;
            }

            this.mItemSizes.push(itemSize);
        }
    }

    /**
     * 重新计算指定索引的尺寸
     */
    private RecalculateSize(index: number): void {
        // 为新插入的项目计算尺寸
        const type = this.GetItemType(index);
        const template = this.templateItems.get(type) || this.templateItems.get(this.defaultTemplateType);

        let itemSize = 50; // 默认尺寸

        if (template) {
            let templateNode: Node | null = null;
            if (template.node instanceof Node) {
                templateNode = template.node;
            } else if (typeof template.node === 'function') {
                templateNode = template.node();
                if (template.pool && isValid(templateNode, true)) {
                    // @ts-ignore
                    templateNode['__type__'] = type;
                    template.pool.put(templateNode);
                }
            }

            if (templateNode) {
                const uiTrans = templateNode.getComponent(UITransform);
                if (uiTrans) {
                    switch (this.layoutType) {
                        case ViewLayoutType.VERTICAL:
                            itemSize = uiTrans.height;
                            break;
                        case ViewLayoutType.HORIZONTAL:
                            itemSize = uiTrans.width;
                            break;
                        case ViewLayoutType.GRID:
                            itemSize = this.scrollDirection === ScrollDirection.VERTICAL ?
                                this.mCellHeight : this.mCellWidth;
                            break;
                    }
                }
            }
        }

        this.mItemSizes.splice(index, 0, itemSize);
        this.UpdateCumulativeSizes();
    }

    /**
     * 更新累积尺寸数组
     */
    private UpdateCumulativeSizes(): void {
        this.mCumulativeSizes = [];

        switch (this.layoutType) {
            case ViewLayoutType.VERTICAL:
            case ViewLayoutType.HORIZONTAL:
                // 如果有自定义尺寸且数量匹配，则使用自定义尺寸
                if (this.mCustomSizes.length === this.mItemsTypes.length) {
                    this.mItemSizes = this.mCustomSizes.slice();
                }
                let sum = 0;
                for (let i = 0; i < this.mItemSizes.length; i++) {
                    sum += this.mItemSizes[i] + this.itemSpacing;
                    this.mCumulativeSizes.push(sum);
                }
                break;

            case ViewLayoutType.GRID:
                const count = this.mItemSizes.length;
                switch (this.scrollDirection) {
                    case ScrollDirection.VERTICAL:
                        const rows = Math.ceil(count / this.cols);
                        for (let row = 0; row < rows; row++) {
                            const cumulative = (row + 1) * this.mCellHeight + row * this.girdVertRowsSpacing;
                            for (let col = 0; col < this.cols; col++) {
                                const idx = row * this.cols + col;
                                if (idx < count) {
                                    this.mCumulativeSizes.push(cumulative);
                                }
                            }
                        }
                        break;

                    case ScrollDirection.HORIZONTAL:
                        const cols = Math.ceil(count / this.rows);
                        for (let col = 0; col < cols; col++) {
                            const cumulative = (col + 1) * this.mCellWidth + col * this.girdHoriColsSpacing;
                            for (let row = 0; row < this.rows; row++) {
                                const idx = col * this.rows + row;
                                if (idx < count) {
                                    this.mCumulativeSizes.push(cumulative);
                                }
                            }
                        }
                        break;
                }
                break;
        }
    }
}