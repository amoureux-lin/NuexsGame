type Observer<T> = (value: T, oldValue: T) => void;

/**
 * 响应式值容器。
 * 修改 .value 时自动通知所有观察者。
 *
 * @example
 * const score = new Observable(0);
 * score.observe((v) => label.string = String(v));
 * score.value = 100; // 触发回调
 */
export class Observable<T> {

    private _value: T;
    private readonly _observers = new Set<Observer<T>>();

    constructor(initialValue: T) {
        this._value = initialValue;
    }

    /** 读取当前值。 */
    get value(): T {
        return this._value;
    }

    /** 更新当前值，并通知所有观察者。 */
    set value(newValue: T) {
        if (newValue === this._value) return;
        const old = this._value;
        this._value = newValue;
        for (const observer of this._observers) {
            observer(newValue, old);
        }
    }

    /**
     * 订阅值变化，并返回取消订阅函数。
     */
    observe(fn: Observer<T>): () => void {
        this._observers.add(fn);
        return () => this._observers.delete(fn);
    }

    /** 清空全部观察者。 */
    dispose(): void {
        this._observers.clear();
    }
}
