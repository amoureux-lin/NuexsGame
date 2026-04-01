import { MvcModel, Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import {JoinRoomRes} from "db://assets/games/tongits/script/proto/tongits";

export interface SpinResult {
    win: number;
    balance: number;
    lines?: number[];
    [key: string]: unknown;
}

/**
 * 老虎机 Model：余额、旋转请求与结果，通过事件通知 View。
 */
export class TongitsModel extends MvcModel {
    private _balance = 0;

    get balance(): number {
        return this._balance;
    }

    /** 拉取/同步余额并通知 View */
    async fetchBalance(): Promise<void> {
        try {
            // TODO: 替换为真实接口，如 Nexus.net.get<{ balance: number }>('/api/slot/balance')
            this._balance = 1000;
            this.notify(TongitsEvents.DATA_BALANCE_UPDATED, { balance: this._balance });
        } catch (e) {
            console.error('[TongitsModel] fetchBalance failed', e);
            this.notify(TongitsEvents.DATA_BALANCE_UPDATED, { balance: this._balance });
        }
    }

    override destroy(): void {
        this._balance = 0;
        super.destroy();
    }

    /**
     *
     * @param res
     */
    joinRoom(res: JoinRoomRes) {

    }
}
