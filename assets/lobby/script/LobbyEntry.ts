import { _decorator } from 'cc';
import { SubGameBase } from 'db://nexus-framework/index';

const { ccclass } = _decorator;

/**
 * 大厅入口：挂载到 lobby 的 Main 场景根节点，Bundle 进入时由框架调用 onEnter/onExit。
 */
@ccclass('LobbyEntry')
export class LobbyEntry extends SubGameBase {

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        // 大厅初始化：如请求游戏列表、刷新用户信息等
    }

    async onExit(): Promise<void> {
        // 大厅清理
        await super.onExit();
    }
}
