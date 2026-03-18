import { _decorator } from 'cc';
import { Nexus, NexusBaseEntry } from 'db://nexus-framework/index';
import { lobbyUI, LobbyUIPanelConfig } from './config/LobbyUIConfig';
import { LobbyController } from './game/LobbyController';
import { LobbyModel } from './game/LobbyModel';

const { ccclass } = _decorator;

/**
 * 大厅入口：挂载到 lobby 的 Main 场景根节点，Bundle 进入时由框架调用 onEnter/onExit。
 * 使用 MVC：创建 Model、Controller，由 Controller 拉数并响应 View 命令；View 挂到场景节点上自行监听与派发。
 */
@ccclass('LobbyEntry')
export class LobbyEntry extends NexusBaseEntry {

    private _model: LobbyModel | null = null;
    private _controller: LobbyController | null = null;

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        Nexus.ui.registerPanels(LobbyUIPanelConfig);

        this._model = new LobbyModel();
        this._controller = new LobbyController(this._model);
        await this._controller.start(params);
        console.log('LobbyEntry onEnter');
    }

    async onExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(lobbyUI);
        await super.onExit();
    }
}
