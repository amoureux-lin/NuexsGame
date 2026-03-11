import { _decorator } from 'cc';
import { BaseLoading } from 'db://nexus-framework/index';

const { ccclass } = _decorator;

/**
 * 大厅 Loading 面板。
 * 框架显示此面板后调用 execute()，完成后自动切换到 lobbyMain 场景并销毁本面板。
 */
@ccclass('LobbyLoading')
export class LobbyLoading extends BaseLoading {

    /** Cocos 生命周期：做视觉初始化（进场动画、进度条归零等） */
    protected start(): void {
        // TODO: 播放进场动画、初始化进度条
    }

    /**
     * 框架调用：执行大厅所需的业务加载逻辑。
     * resolve → 框架切换到 lobbyMain 场景；reject → 框架收到错误。
     */
    async execute(_params?: Record<string, unknown>): Promise<void> {
        // TODO: 建连、拉取用户信息、预加载大厅资源等
        // 示例：
        // await NetService.connect();
        // await LobbyModel.fetchUserInfo();
        console.log('[LobbyLoading] execute');
        await new Promise(() => {});
    }
}
