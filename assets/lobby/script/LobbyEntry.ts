import { _decorator } from 'cc';
import { BaseEntry, Nexus } from 'db://nexus-framework/index';
import { lobbyUI, LobbyUIPanelConfig } from './config/LobbyUIConfig';

const { ccclass } = _decorator;

/**
 * 大厅入口：挂载到 lobby 的 Main 场景根节点，Bundle 进入时由框架调用 onEnter/onExit。
 */
@ccclass('LobbyEntry')
export class LobbyEntry extends BaseEntry {

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        // 大厅初始化：如请求游戏列表、刷新用户信息等
        console.log('LobbyEntry onEnter');
        Nexus.ui.registerPanels(LobbyUIPanelConfig);
    }

    async onExit(): Promise<void> {
        await super.onExit();
        Nexus.ui.unregisterPanels(lobbyUI);
    }
}
