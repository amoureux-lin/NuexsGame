import { _decorator } from 'cc';
import { BaseLoading } from 'db://assets/script/base/BaseLoading';

const { ccclass } = _decorator;

/** 子游戏 Loading 面板，完成后自动切换到 slotGameMain 场景。 */
@ccclass('SlotGameLoading')
export class SlotGameLoading extends BaseLoading {

    /** 子游戏自定义资源，进度 20-80%。 */
    protected async loadRes(_params?: Record<string, unknown>): Promise<void> {
        this.setProgress(40, '加载游戏资源...');
        // TODO: 预加载子游戏 prefab、配置等
        await Promise.resolve();
    }

    protected playMusic(): void {
        // TODO: 子游戏 BGM
    }

    /** 建连、进房等，进度 85-100%。 */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<void> {
        this.setProgress(90, '连接中...');
        // TODO: await Nexus.net.connectWs(...); 发 joinGame，等 GAME_JOIN_SUCCESS
        await Promise.resolve();
    }
}

