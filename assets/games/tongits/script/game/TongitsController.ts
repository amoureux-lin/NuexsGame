import { Nexus } from 'db://nexus-framework/index';
import { MvcController } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import { tongitsUI } from '../config/TongitsUIConfig';
import type { TongitsModel } from './TongitsModel';

/**
 * 老虎机 Controller：处理旋转、返回大厅、设置等命令。
 */
export class TongitsController extends MvcController {

    constructor(private readonly _model: TongitsModel) {
        super();
    }

    protected registerCommands(): void {
        this.handle<{ bet: number }>(TongitsEvents.CMD_SPIN, (data) => this.onSpin(data?.bet ?? 0));
        this.handle(TongitsEvents.CMD_OPEN_SETTINGS, () => this.onOpenSettings());
        this.handle(TongitsEvents.CMD_BACK_LOBBY, () => this.onBackLobby());
    }

    override async start(params?: Record<string, unknown>): Promise<void> {
        await this._model.fetchBalance();
    }

    private async onSpin(bet: number): Promise<void> {
        if (bet <= 0) return;
        Nexus.ui.showLoading();
        try {
            const result = await this._model.spin(bet);
            if (result.win > 0) {
                await Nexus.ui.show(tongitsUI.RESULT, { win: result.win });
            }
        } finally {
            Nexus.ui.hideLoading();
        }
    }

    private onOpenSettings(): void {
        Nexus.ui.show(tongitsUI.SETTINGS);
    }

    private async onBackLobby(): Promise<void> {
        await Nexus.bundle.enter('lobby');
    }

    override destroy(): void {
        this._model.destroy();
        super.destroy();
    }
}
