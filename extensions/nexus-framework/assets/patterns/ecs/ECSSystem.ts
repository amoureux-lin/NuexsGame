import { ECSComponent } from './ECSComponent';
import { Entity } from './Entity';

type ComponentCtor<T extends ECSComponent> = new (...args: unknown[]) => T;

/**
 * ECS — System 基类（逻辑处理单元）
 * 声明所需组件类型，World 自动筛选出符合条件的实体传入 update。
 */
export abstract class ECSSystem {

    /** 标记该系统是否参与当前帧更新。 */
    enabled = true;

    /**
     * 声明该 System 运行所需的组件集合。
     */
    abstract requiredComponents(): ComponentCtor<ECSComponent>[];

    /**
     * 每帧由 World 驱动调用。
     * @param entities 满足 requiredComponents 条件的实体列表
     * @param dt       帧间隔（秒）
     */
    abstract update(entities: Entity[], dt: number): void;

    /** System 加入 World 后调用一次。 */
    onWorldStart(): void {}

    /** System 从 World 移除或 World 销毁时调用。 */
    onWorldDestroy(): void {}
}
