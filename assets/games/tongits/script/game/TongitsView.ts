import { _decorator } from 'cc';
import { View } from 'db://nexus-framework/index';
import { SlotGameEvents } from '../config/TongitsEvents';
import type { SpinResult } from './TongitsModel';

const { ccclass } = _decorator;

/**
 * 老虎机 View：挂到 slotGameMain 场景的“主界面”节点。
 * 监听余额/旋转结果刷新 UI，用户操作通过 dispatch 发给 Controller。
 */
@ccclass('SlotGameView')
export class SlotGameView extends View {

    protected registerEvents(): void {
        this.listen<{ balance: number }>(SlotGameEvents.DATA_BALANCE_UPDATED, (data) => {
            this.onBalanceUpdated(data.balance);
        });
        this.listen<SpinResult>(SlotGameEvents.DATA_SPIN_RESULT, (data) => {
            this.onSpinResult(data);
        });
    }

    /** 余额更新时调用，子类可覆写绑定到 UI */
    protected onBalanceUpdated(_balance: number): void {}

    /** 旋转结果时调用，子类可覆写（如播动画、弹结果面板） */
    protected onSpinResult(_result: SpinResult): void {}

    /** 用户点击旋转时由子类或节点事件调用 */
    protected spin(bet: number): void {
        this.dispatch(SlotGameEvents.CMD_SPIN, { bet });
    }

    protected openSettings(): void {
        this.dispatch(SlotGameEvents.CMD_OPEN_SETTINGS);
    }

    protected backLobby(): void {
        this.dispatch(SlotGameEvents.CMD_BACK_LOBBY);
    }
}
