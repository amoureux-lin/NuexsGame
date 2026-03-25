import { _decorator } from 'cc';
import { BaseLoading } from 'db://assets/script/base/BaseLoading';
import { CommonUI } from 'db://assets/script/config/UIConfig';
import { Nexus } from 'db://nexus-framework/index';

const { ccclass } = _decorator;

/** 子游戏 Loading 面板，完成后自动切换到 tongitsMain 场景。 */
@ccclass('TongitsLoading')
export class TongitsLoading extends BaseLoading {

    override onShow(params?: unknown): void {
        super.onShow(params);
        console.log('TongitsLoading params:', params);
    }

    /** 子游戏自定义资源，进度 20-80%。 */
    protected async loadRes(_params?: Record<string, unknown>): Promise<void> {
        this.setProgress(40, '加载游戏资源...');
        // TODO: 预加载子游戏 prefab、配置等
        await Promise.resolve();
    }

    protected async playMusic(): Promise<void> {
        await Promise.resolve();
    }

    /** 建连、进房等，进度 85-100%。 */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<boolean> {
        // TODO: 发 joinGame，等 GAME_JOIN_SUCCESS，再 return true；等 GAME_JOIN_FAIL return false
        // await Promise.resolve();
        return true; // 占位实现：当前还没有真实进房协议
    }

}

