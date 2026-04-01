import { _decorator } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { BaseGameEntry } from 'db://assets/script/base/BaseGameEntry';
import { lobbyUI, LobbyUIPanelConfig } from './config/LobbyUIConfig';
import { LobbyController } from './game/LobbyController';
import { LobbyModel } from './game/LobbyModel';

const { ccclass } = _decorator;

@ccclass('LobbyEntry')
export class LobbyEntry extends BaseGameEntry {

    private _model: LobbyModel | null = null;
    private _controller: LobbyController | null = null;

    protected async onGameInit(params?: Record<string, unknown>): Promise<void> {
        Nexus.ui.registerPanels(LobbyUIPanelConfig);

        this._model = new LobbyModel();
        this._controller = new LobbyController(this._model);
        await this._controller.start(params);
    }

    protected async onGameExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(lobbyUI);
    }
}
