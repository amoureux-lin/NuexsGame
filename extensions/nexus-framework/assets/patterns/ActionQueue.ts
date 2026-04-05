type ActionFn = () => Promise<void> | void;

/**
 * 动作序列队列：将若干异步/同步操作顺序执行。
 *
 * 典型用途：多步卡牌动画、结算序列、引导步骤等。
 *
 * 用法示例：
 * ```ts
 * await new ActionQueue()
 *     .add(() => dealCards())
 *     .delay(300)
 *     .add(() => flipCards())
 *     .delay(500)
 *     .call(() => playSound())
 *     .run();
 * ```
 */
export class ActionQueue {
    private readonly _actions: ActionFn[] = [];
    private _running = false;
    private _cancelled = false;

    /** 加入一个异步或同步操作。 */
    add(fn: ActionFn): this {
        this._actions.push(fn);
        return this;
    }

    /** 加入一段延迟（毫秒）。 */
    delay(ms: number): this {
        return this.add(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
    }

    /** 加入一个同步回调（语义上等同于 add，但更明确表示无异步操作）。 */
    call(fn: () => void): this {
        return this.add(fn);
    }

    /**
     * 顺序执行所有已加入的操作，返回 Promise 在全部完成后 resolve。
     * 若调用时队列已在运行，直接 return（不重复执行）。
     */
    async run(): Promise<void> {
        if (this._running) return;
        this._running = true;
        this._cancelled = false;
        for (const action of this._actions) {
            if (this._cancelled) break;
            await action();
        }
        this._running = false;
    }

    /**
     * 取消后续步骤（当前正在 await 的步骤会等待其自然完成，后续步骤跳过）。
     */
    cancel(): void {
        this._cancelled = true;
    }

    /** 清空队列并取消执行。 */
    clear(): void {
        this._actions.length = 0;
        this._cancelled = true;
    }

    /** 队列是否正在执行。 */
    get running(): boolean {
        return this._running;
    }
}
