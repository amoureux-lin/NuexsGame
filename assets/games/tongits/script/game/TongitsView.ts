import { _decorator } from 'cc';
import { MvcView } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import type { SpinResult } from './TongitsModel';

const { ccclass } = _decorator;

/**
 * Tongits View：挂到 tongitsMain 场景的“主界面”节点。
 * 监听余额/旋转结果刷新 UI，用户操作通过 dispatch 发给 Controller。
 */
@ccclass('TongitsView')
export class TongitsView extends MvcView {

    protected registerEvents(): void {
        this.listen<{ balance: number }>(TongitsEvents.DATA_BALANCE_UPDATED, (data) => {
            this.onBalanceUpdated(data.balance);
        });
        this.listen<SpinResult>(TongitsEvents.DATA_SPIN_RESULT, (data) => {
            this.onSpinResult(data);
        });
    }

    /** 余额更新时调用，子类可覆写绑定到 UI */
    protected onBalanceUpdated(_balance: number): void {}

    /** 旋转结果时调用，子类可覆写（如播动画、弹结果面板） */
    protected onSpinResult(_result: SpinResult): void {}

    /** 用户点击旋转时由子类或节点事件调用 */
    protected spin(bet: number): void {
        this.dispatch(TongitsEvents.CMD_SPIN, { bet });
    }

    protected openSettings(): void {
        this.dispatch(TongitsEvents.CMD_OPEN_SETTINGS);
    }

    protected backLobby(): void {
        this.dispatch(TongitsEvents.CMD_BACK_LOBBY);
    }
}
