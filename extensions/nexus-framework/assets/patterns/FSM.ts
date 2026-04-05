/** 状态转移定义。from 可以是单个状态或状态数组（多对一转移）。 */
export interface FsmTransition<S extends string, E extends string> {
    from: S | S[];
    event: E;
    to: S;
}

type StateCb<S extends string>       = (state: S) => void;
type TransitionCb<S extends string, E extends string> = (from: S, to: S, event: E) => void;

/**
 * 泛型有限状态机。
 *
 * 用法示例：
 * ```ts
 * type State = 'waiting' | 'playing' | 'settling';
 * type Event = 'GAME_START' | 'GAME_RESULT' | 'ROOM_RESET';
 *
 * const fsm = new FSM<State, Event>('waiting', [
 *     { from: 'waiting',   event: 'GAME_START',  to: 'playing'   },
 *     { from: 'playing',   event: 'GAME_RESULT', to: 'settling'  },
 *     { from: 'settling',  event: 'ROOM_RESET',  to: 'waiting'   },
 * ]);
 *
 * fsm.onEnter('playing', () => showActionPanel());
 * fsm.onExit('playing',  () => hideActionPanel());
 *
 * fsm.transition('GAME_START'); // waiting → playing
 * console.log(fsm.state);       // 'playing'
 * ```
 */
export class FSM<S extends string, E extends string = string> {
    private _state: S;
    private readonly _transitions: FsmTransition<S, E>[];
    private readonly _onEnterMap      = new Map<S, StateCb<S>[]>();
    private readonly _onExitMap       = new Map<S, StateCb<S>[]>();
    private readonly _onTransitionMap = new Map<E, TransitionCb<S, E>[]>();

    constructor(initial: S, transitions: FsmTransition<S, E>[]) {
        this._state = initial;
        this._transitions = transitions;
    }

    /** 当前状态。 */
    get state(): S {
        return this._state;
    }

    /** 判断当前是否处于指定状态。 */
    is(state: S): boolean {
        return this._state === state;
    }

    /** 判断当前状态下是否允许触发指定事件。 */
    can(event: E): boolean {
        return !!this._findTransition(event);
    }

    /**
     * 触发事件，执行状态转移。
     * @returns true 转移成功；false 当前状态不允许此事件
     */
    transition(event: E): boolean {
        const def = this._findTransition(event);
        if (!def) {
            console.warn(`[FSM] Invalid transition: "${event}" from state "${this._state}"`);
            return false;
        }

        const from = this._state;
        const to   = def.to;

        // 触发 exit 回调
        for (const fn of this._onExitMap.get(from) ?? []) fn(from);
        // 切换状态
        this._state = to;
        // 触发 transition 回调
        for (const fn of this._onTransitionMap.get(event) ?? []) fn(from, to, event);
        // 触发 enter 回调
        for (const fn of this._onEnterMap.get(to) ?? []) fn(to);

        return true;
    }

    /** 注册进入某状态时的回调。 */
    onEnter(state: S, fn: StateCb<S>): this {
        if (!this._onEnterMap.has(state)) this._onEnterMap.set(state, []);
        this._onEnterMap.get(state)!.push(fn);
        return this;
    }

    /** 注册离开某状态时的回调。 */
    onExit(state: S, fn: StateCb<S>): this {
        if (!this._onExitMap.has(state)) this._onExitMap.set(state, []);
        this._onExitMap.get(state)!.push(fn);
        return this;
    }

    /** 注册某个事件触发时的回调（在 exit/enter 之间调用，可拿到 from/to）。 */
    onTransition(event: E, fn: TransitionCb<S, E>): this {
        if (!this._onTransitionMap.has(event)) this._onTransitionMap.set(event, []);
        this._onTransitionMap.get(event)!.push(fn);
        return this;
    }

    /** 强制重置到指定状态（不触发任何回调，用于初始化或容灾）。 */
    reset(state: S): void {
        this._state = state;
    }

    /** 清空所有回调注册（销毁前调用）。 */
    destroy(): void {
        this._onEnterMap.clear();
        this._onExitMap.clear();
        this._onTransitionMap.clear();
    }

    private _findTransition(event: E): FsmTransition<S, E> | undefined {
        return this._transitions.find(t => {
            const froms = Array.isArray(t.from) ? t.from : [t.from];
            return t.event === event && froms.includes(this._state);
        });
    }
}
