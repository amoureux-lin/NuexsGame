import { Nexus } from 'db://nexus-framework/index';
import { Controller } from 'db://nexus-framework/index';
import { LobbyEvents } from '../config/LobbyEvents';
import { lobbyUI } from '../config/LobbyUIConfig';
import type { LobbyModel } from './LobbyModel';

/**
 * 大厅 Controller：处理 View 派发的命令，调用 Model 拉数、调 Nexus 打开面板/进子游戏。
 */
export class LobbyController extends Controller {

    constructor(private readonly _model: LobbyModel) {
        super();
    }

    protected registerCommands(): void {
        this.handle(LobbyEvents.CMD_OPEN_GAME_LIST, () => this.onOpenGameList());
        this.handle<{ bundleName: string; params?: Record<string, unknown> }>(
            LobbyEvents.CMD_ENTER_GAME,
            (data) => this.onEnterGame(data?.bundleName ?? '', data?.params),
        );
        this.handle(LobbyEvents.CMD_OPEN_SETTINGS, () => this.onOpenSettings());
    }

    override async start(params?: Record<string, unknown>): Promise<void> {
        await Promise.all([
            this._model.fetchGameList(),
            this._model.fetchUserInfo(),
        ]);
        // 若大厅需要 WebSocket 推送，先 connectWs(url) 再 registerHandlers
        this._model.registerHandlers();
    }

    private onOpenGameList(): void {
        Nexus.ui.show(lobbyUI.GAME_LIST);
    }

    private async onEnterGame(bundleName: string, params?: Record<string, unknown>): Promise<void> {
        if (!bundleName) return;
        await Nexus.bundle.enter(bundleName, params);
    }

    private onOpenSettings(): void {
        // TODO: Nexus.ui.show(settingsPanelId) 或扩展 lobbyUI.SETTINGS
    }

    override destroy(): void {
        this._model.destroy();
        super.destroy();
    }
}
