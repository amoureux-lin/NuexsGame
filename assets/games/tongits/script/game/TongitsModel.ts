import { Model, Nexus } from 'db://nexus-framework/index';
import { SlotGameEvents } from '../config/TongitsEvents';

export interface SpinResult {
    win: number;
    balance: number;
    lines?: number[];
    [key: string]: unknown;
}

/**
 * 老虎机 Model：余额、旋转请求与结果，通过事件通知 View。
 */
export class SlotGameModel extends Model {
    private _balance = 0;

    get balance(): number {
        return this._balance;
    }

    /** 拉取/同步余额并通知 View */
    async fetchBalance(): Promise<void> {
        try {
            // TODO: 替换为真实接口，如 Nexus.net.get<{ balance: number }>('/api/slot/balance')
            this._balance = 1000;
            this.notify(SlotGameEvents.DATA_BALANCE_UPDATED, { balance: this._balance });
        } catch (e) {
            console.error('[SlotGameModel] fetchBalance failed', e);
            this.notify(SlotGameEvents.DATA_BALANCE_UPDATED, { balance: this._balance });
        }
    }

    /** 下注旋转，返回结果并通知 View */
    async spin(bet: number): Promise<SpinResult> {
        try {
            // TODO: 替换为真实接口，如 Nexus.net.post<SpinResult>('/api/slot/spin', { bet })
            const win = Math.random() > 0.7 ? bet * 2 : 0;
            this._balance = this._balance - bet + win;
            const result: SpinResult = { win, balance: this._balance };
            this.notify(SlotGameEvents.DATA_BALANCE_UPDATED, { balance: this._balance });
            this.notify(SlotGameEvents.DATA_SPIN_RESULT, result);
            return result;
        } catch (e) {
            console.error('[SlotGameModel] spin failed', e);
            this.notify(SlotGameEvents.DATA_BALANCE_UPDATED, { balance: this._balance });
            return { win: 0, balance: this._balance };
        }
    }

    override destroy(): void {
        this._balance = 0;
        super.destroy();
    }
}
