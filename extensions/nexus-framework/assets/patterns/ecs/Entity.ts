import { ECSComponent } from './ECSComponent';

type ComponentCtor<T extends ECSComponent> = new (...args: unknown[]) => T;

let _nextId = 0;

/**
 * ECS — Entity（实体）
 * 纯容器，通过 addComponent / getComponent 管理挂载的 Component。
 */
export class Entity {

    readonly id: number;
    readonly tag: string;

    private readonly _components = new Map<Function, ECSComponent>();

    /** 创建实体并分配唯一 id。 */
    constructor(tag = '') {
        this.id = _nextId++;
        this.tag = tag;
    }

    /** 向实体挂载一个组件实例。 */
    addComponent<T extends ECSComponent>(component: T): this {
        this._components.set(component.constructor, component);
        return this;
    }

    /** 获取指定类型的组件。 */
    getComponent<T extends ECSComponent>(type: ComponentCtor<T>): T | undefined {
        return this._components.get(type) as T | undefined;
    }

    /** 判断实体是否挂载了指定类型的组件。 */
    hasComponent<T extends ECSComponent>(type: ComponentCtor<T>): boolean {
        return this._components.has(type);
    }

    /** 移除指定类型的组件。 */
    removeComponent<T extends ECSComponent>(type: ComponentCtor<T>): void {
        this._components.delete(type);
    }
}
