import { _decorator } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { BaseGameEntry } from 'db://assets/script/base/BaseGameEntry';
import { slotGameUI, SlotGameUIPanelConfig } from './config/SlotGameUIConfig';
import { SlotGameController } from './game/SlotGameController';
import { SlotGameModel } from './game/SlotGameModel';

const { ccclass } = _decorator;

@ccclass('SlotGameEntry')
export class SlotGameEntry extends BaseGameEntry {

    private _model: SlotGameModel | null = null;
    private _controller: SlotGameController | null = null;

    protected async onGameInit(params?: Record<string, unknown>): Promise<void> {
        Nexus.ui.registerPanels(SlotGameUIPanelConfig);

        this._model = new SlotGameModel();
        this._controller = new SlotGameController(this._model);
        await this._controller.start(params);
    }

    protected async onGameExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(slotGameUI);
    }
}
