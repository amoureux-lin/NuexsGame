import { Nexus } from 'db://nexus-framework/index';
import { MvcController } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import { tongitsUI } from '../config/TongitsUIConfig';
import type { TongitsModel } from './TongitsModel';
import {MessageType} from "db://assets/games/tongits/script/proto/message_type";

/**
 * 老虎机 Controller：处理旋转、返回大厅、设置等命令。
 */
export class TongitsController extends MvcController {

    constructor(private readonly _model: TongitsModel) {
        super();
    }

    protected registerCommands(): void {
        console.log("registerCommands")
        // 监听广播消息
        Nexus.net.onWsMsg(MessageType.TONGITS_JOIN_ROOM_RES, (msg) => {
            console.log('进入房间返回', msg);
        }, this);

        this.handle(TongitsEvents.CMD_OPEN_SETTINGS, () => this.onOpenSettings());
        this.handle(TongitsEvents.CMD_BACK_LOBBY, () => this.onBackLobby());
    }

    override async start(params?: Record<string, unknown>): Promise<void> {
        await this._model.fetchBalance();
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
        Nexus.net.offWsMsgByTarget(this);
    }
}
