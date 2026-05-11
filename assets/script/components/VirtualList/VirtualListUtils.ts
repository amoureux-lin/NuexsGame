/*************************************************************************************
 * @File        : VirtualListUtils.ts
 * @Author      : xingkong6
 * @Date        : 2025-07-02 16:28:04
 * @Date        : Copyright (c) 2025 by xingkong6, All Rights Reserved.
 * @Description : 虚拟列表工具类
 **************************************************************************************/

/**
 * 虚拟列表日志工具类
 */
export class VirtualLog {
    private static readonly PREFIX = '[VirtualViewList]';
    private static mIsDebugMode: boolean = false;

    /**
     * 设置调试模式
     */
    public static SetDebugMode(enabled: boolean): void {
        this.mIsDebugMode = enabled;
    }

    /**
     * 输出调试日志
     */
    public static Debug(message: string, ...args: any[]): void {
        if (!this.mIsDebugMode) return;
        console.log(`${this.PREFIX}[DEBUG] ${message}`, ...args);
    }

    /**
     * 输出信息日志
     */
    public static Info(message: string, ...args: any[]): void {
        if (!this.mIsDebugMode) return;
        console.info(`${this.PREFIX}[INFO] ${message}`, ...args);
    }

    /**
     * 输出警告日志
     */
    public static Warn(message: string, ...args: any[]): void {
        if (!this.mIsDebugMode) return;
        console.warn(`${this.PREFIX}[WARN] ${message}`, ...args);
    }

    /**
     * 输出错误日志
     */
    public static Error(message: string, ...args: any[]): void {
        console.error(`${this.PREFIX}[ERROR] ${message}`, ...args);
    }
}


/**
 * 工具函数类
 */
export class VirtualListUtils {
    /**
     * 安全的数组访问
     */
    public static SafeArrayAccess<T>(array: T[], index: number, defaultValue: T): T {
        return (index >= 0 && index < array.length) ? array[index] : defaultValue;
    }

    /**
     * 限制数值在指定范围内
     */
    public static Clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * 线性插值
     */
    public static Lerp(a: number, b: number, t: number): number {
        return a + (b - a) * this.Clamp(t, 0, 1);
    }

    /**
     * 检查是否为有效的索引
     */
    public static IsValidIndex(index: number, arrayLength: number): boolean {
        return index >= 0 && index < arrayLength && Number.isInteger(index);
    }

    /**
     * 防抖函数
     */
    public static Debounce(func: Function, wait: number): Function {
        let timeout: any;
        return function executedFunction(...args: any[]) {
            const later = () => {
                clearTimeout(timeout);
                //@ts-ignore
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 节流函数
     */
    public static Throttle(func: Function, limit: number): Function {
        let inThrottle: boolean;
        return function executedFunction(...args: any[]) {
            if (!inThrottle) {
                //@ts-ignore
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * 深拷贝对象
     */
    public static DeepClone<T>(obj: T): T {
        if (obj === null || typeof obj !== "object") return obj;
        if (obj instanceof Date) return new Date(obj.getTime()) as any;
        if (obj instanceof Array) return obj.map(item => this.DeepClone(item)) as any;
        if (typeof obj === "object") {
            const clonedObj = {} as any;
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.DeepClone(obj[key]);
                }
            }
            return clonedObj;
        }
        return obj;
    }

    /**
     * 检查对象是否为空
     */
    public static IsEmpty(obj: any): boolean {
        if (obj === null || obj === undefined) return true;
        if (typeof obj === 'string' || Array.isArray(obj)) return obj.length === 0;
        if (typeof obj === 'object') return Object.keys(obj).length === 0;
        return false;
    }

    /**
     * 批处理操作
     */
    public static Batch<T>(items: T[], batchSize: number, processor: (batch: T[]) => void): void {
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            processor(batch);
        }
    }

    /**
     * 异步批处理操作
     */
    public static async AsyncBatch<T>(items: T[], batchSize: number,
        processor: (batch: T[]) => Promise<void>, delay: number = 0): Promise<void> {
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            await processor(batch);
            if (delay > 0 && i + batchSize < items.length) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}