import { _decorator } from 'cc';
import { BaseLoading } from 'db://assets/script/base/BaseLoading';
import { CommonUI } from 'db://assets/script/config/UIConfig';
import { Nexus } from 'db://nexus-framework/index';

const { ccclass } = _decorator;

/**
 * 大厅 Loading 面板。
 * 框架显示此面板后调用 onShow(params)，流程由基类启动；进度到 100% 后自动切场景并关闭本面板。
 */
@ccclass('LobbyLoading')
export class LobbyLoading extends BaseLoading {

    override onShow(params?: unknown): void {
        // 先让基类做初始化 + 启动 runLoading
        super.onShow(params);
        console.log('LobbyLoading params:', params);
    }

    /** 大厅自定义资源（如大厅预制、配置等），进度 20-80%。 */
    protected async loadRes(_params?: Record<string, unknown>): Promise<void> {
        // TODO: 预加载大厅 prefab、拉取用户信息等
        await Promise.resolve();
    }

    /** 大厅背景音乐。 */
    protected async playMusic(): Promise<void> {
        //await Nexus.audio.playMusic('lobby', 'xxx');
        // await Promise.resolve();
        //模拟暂停 resolve不返回结果，防止进度条直接到100%
        Nexus.ui.show(CommonUI.ALERT)
        await new Promise<void>(resolve => setTimeout(resolve, 10000));
    }

    /** 大厅无需进房，直接完成；若需建连可在此 await。 */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<void> {
        // TODO: 可选建连、拉取游戏列表等
        await Promise.resolve();
    }
}
