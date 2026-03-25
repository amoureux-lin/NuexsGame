import { Component, _decorator } from 'cc';

const { ccclass } = _decorator;

/**
 * Bundle Loading 面板基类，每个 Bundle 的 Loading 预制体根节点挂载继承此类的脚本。
 * 框架调用时序：
 *   onShow(params) → 面板显示时调用，可在此初始化并启动加载流程
 */
@ccclass('NexusBaseLoading')
export abstract class NexusBaseLoading extends Component {

    /**
     * 面板显示时由框架调用，可获取 enter() 传入的参数。
     * 子类在此做初始化并启动加载流程（如游戏侧 BaseLoading 在此调用 runLoading）。
     * 默认空实现，子类按需覆写。
     */
    onShow(_params?: unknown): void {}


}
