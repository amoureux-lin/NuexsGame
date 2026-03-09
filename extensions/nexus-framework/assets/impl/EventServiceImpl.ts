import { IEventService } from '../services/contracts';

interface ListenerRecord<T = unknown> {
    fn: (data: T) => void;
    once: boolean;
    target?: object;
}

export class EventServiceImpl extends IEventService {
    private readonly _listeners = new Map<string, Set<ListenerRecord>>();

    /** 注册常规事件监听。 */
    on<T>(event: string, fn: (data: T) => void, target?: object): void {
        this.addListener(event, fn, false, target);
    }

    /** 注册一次性事件监听。 */
    once<T>(event: string, fn: (data: T) => void, target?: object): void {
        this.addListener(event, fn, true, target);
    }

    /** 移除指定事件与回调的绑定。 */
    off<T>(event: string, fn: (data: T) => void, target?: object): void {
        const listeners = this._listeners.get(event);
        if (!listeners) {
            return;
        }

        for (const record of listeners) {
            if (record.fn === fn && record.target === target) {
                listeners.delete(record);
            }
        }

        if (listeners.size === 0) {
            this._listeners.delete(event);
        }
    }

    /** 移除某个 target 绑定的所有事件监听。 */
    offTarget(target: object): void {
        for (const [event, listeners] of this._listeners.entries()) {
            for (const record of listeners) {
                if (record.target === target) {
                    listeners.delete(record);
                }
            }

            if (listeners.size === 0) {
                this._listeners.delete(event);
            }
        }
    }

    /** 向当前事件的所有监听者派发数据。 */
    emit<T>(event: string, data?: T): void {
        const listeners = this._listeners.get(event);
        if (!listeners) {
            return;
        }

        for (const record of [...listeners]) {
            record.fn(data);
            if (record.once) {
                listeners.delete(record);
            }
        }

        if (listeners.size === 0) {
            this._listeners.delete(event);
        }
    }

    /** 判断某个事件当前是否存在监听者。 */
    has(event: string): boolean {
        return (this._listeners.get(event)?.size ?? 0) > 0;
    }

    /** 销毁时清空全部监听记录。 */
    async onDestroy(): Promise<void> {
        this._listeners.clear();
    }

    /** 统一创建并保存监听记录。 */
    private addListener<T>(event: string, fn: (data: T) => void, once: boolean, target?: object): void {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }

        this._listeners.get(event)!.add({
            fn: fn as (data: unknown) => void,
            once,
            target,
        });
    }
}
