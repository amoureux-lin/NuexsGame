import { ECSComponent } from './ECSComponent';
import { ECSSystem } from './ECSSystem';
import { Entity } from './Entity';

/**
 * ECS — World（运行时）
 * 管理所有 Entity 与 System，驱动每帧更新。
 *
 * @example
 * const world = new World();
 * world.addSystem(new MovementSystem()).addSystem(new CollisionSystem());
 *
 * const player = world.createEntity('Player');
 * player.addComponent(new PositionComponent(0, 0));
 * player.addComponent(new VelocityComponent(1, 0));
 *
 * // Cocos update 中驱动
 * update(dt: number) { world.update(dt); }
 */
export class World {

    private readonly _entities: Entity[] = [];
    private readonly _systems: ECSSystem[] = [];

    // ── System ──────────────────────────────────────────

    /** 添加一个系统，并立即触发其启动钩子。 */
    addSystem(system: ECSSystem): this {
        this._systems.push(system);
        system.onWorldStart();
        return this;
    }

    /** 移除一个系统，并触发其销毁钩子。 */
    removeSystem(system: ECSSystem): void {
        const idx = this._systems.indexOf(system);
        if (idx !== -1) {
            this._systems.splice(idx, 1);
            system.onWorldDestroy();
        }
    }

    // ── Entity ───────────────────────────────────────────

    /** 创建并注册一个新实体。 */
    createEntity(tag = ''): Entity {
        const entity = new Entity(tag);
        this._entities.push(entity);
        return entity;
    }

    /** 从 World 中移除指定实体。 */
    removeEntity(entity: Entity): void {
        const idx = this._entities.indexOf(entity);
        if (idx !== -1) this._entities.splice(idx, 1);
    }

    /** 按 tag 查询实体列表。 */
    getEntitiesByTag(tag: string): Entity[] {
        return this._entities.filter(e => e.tag === tag);
    }

    // ── Update ───────────────────────────────────────────

    /** 执行一帧更新，并将匹配实体分发给各个系统。 */
    update(dt: number): void {
        for (const system of this._systems) {
            if (!system.enabled) continue;

            const required = system.requiredComponents();
            const matched = this._entities.filter(e =>
                required.every(type => e.hasComponent(type as new (...args: unknown[]) => ECSComponent))
            );

            system.update(matched, dt);
        }
    }

    // ── Lifecycle ────────────────────────────────────────

    /** 销毁 World，并按逆序销毁全部系统。 */
    destroy(): void {
        for (const system of [...this._systems].reverse()) {
            system.onWorldDestroy();
        }
        this._systems.length = 0;
        this._entities.length = 0;
    }
}
