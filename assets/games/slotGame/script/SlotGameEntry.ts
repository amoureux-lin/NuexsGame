import { _decorator } from 'cc';
import { Nexus, NexusBaseEntry } from 'db://nexus-framework/index';
import { slotGameUI, SlotGameUIPanelConfig } from './config/SlotGameUIConfig';
import { SlotGameController } from './game/SlotGameController';
import { SlotGameModel } from './game/SlotGameModel';

const { ccclass } = _decorator;

/**
 * 老虎机子游戏入口：挂到 slotGameMain 场景根节点，Bundle 进入时由框架调用 onEnter/onExit。
 * 使用 MVC：Model + Controller 在 Entry 创建，View 挂到场景节点自行监听与派发。
 */
@ccclass('SlotGameEntry')
export class SlotGameEntry extends NexusBaseEntry {

    private _model: SlotGameModel | null = null;
    private _controller: SlotGameController | null = null;

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        Nexus.ui.registerPanels(SlotGameUIPanelConfig);

        this._model = new SlotGameModel();
        this._controller = new SlotGameController(this._model);
        await this._controller.start(params);
    }

    async onExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(slotGameUI);
        await super.onExit();
    }
}
