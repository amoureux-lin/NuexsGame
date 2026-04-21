import { Component } from 'cc';
import type { SpriteFrame } from 'cc';
import type { ToastType } from '../services/contracts';

/**
 * Toast 节点的抽象基类。
 *
 * 用法：
 *   在游戏项目中创建 Notify 组件继承此类，实现 setup()，
 *   并将其挂载到 toast prefab 的根节点。
 *   ToastServiceImpl 从对象池取出节点后会自动调用 setup() 更新内容。
 *
 * @example
 * @ccclass('Notify')
 * export class Notify extends ToastItem {
 *     @property(Label) contentLabel: Label | null = null;
 *     setup(msg, type, icon) { this.contentLabel!.string = msg; }
 * }
 */
export abstract class ToastItem extends Component {
    /**
     * 初始化 toast 内容。由 ToastServiceImpl 在节点复用时调用。
     * @param msg  提示文案
     * @param type 类型（info / success / error / warn）
     * @param icon 图标 SpriteFrame；null 或 undefined 表示不显示图标
     */
    abstract setup(msg: string, type: ToastType, icon?: SpriteFrame | null): void;
}
