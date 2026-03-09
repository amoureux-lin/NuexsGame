/**
 * ECS — Component 基类（纯数据容器）
 * 不包含逻辑，所有行为由 System 处理。
 */
export abstract class ECSComponent {
    /** 标记该组件是否参与系统筛选与运行。 */
    enabled = true;
}
