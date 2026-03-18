import { _decorator } from 'cc';
import { Nexus, NexusBaseEntry } from 'db://nexus-framework/index';
import { tongitsUI, TongitsUIPanelConfig } from './config/TongitsUIConfig';
import { TongitsController } from './game/TongitsController';
import { TongitsModel } from './game/TongitsModel';
import { TONGITS_MSG_REGISTRY } from './proto/msg_registry_tongits';

const { ccclass } = _decorator;

/**
 * 老虎机子游戏入口：挂到 tongitsMain 场景根节点，Bundle 进入时由框架调用 onEnter/onExit。
 * 使用 MVC：Model + Controller 在 Entry 创建，View 挂到场景节点自行监听与派发。
 */
@ccclass('TongitsEntry')
export class TongitsEntry extends NexusBaseEntry {

    private _model: TongitsModel | null = null;
    private _controller: TongitsController | null = null;

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        // 子游戏启动时注册本游戏 Proto 映射（合并进运行时总表）
        Nexus.proto.registerSubgame(TONGITS_MSG_REGISTRY);
        Nexus.ui.registerPanels(TongitsUIPanelConfig);

        this._model = new TongitsModel();
        this._controller = new TongitsController(this._model);
        await this._controller.start(params);
        console.log('TongitsEntry onEnter');
        
    }

    async onExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(tongitsUI);
        await super.onExit();
    }
}
