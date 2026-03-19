import { _decorator } from 'cc';
import { BaseLoading } from 'db://assets/script/base/BaseLoading';
import { CommonUI } from 'db://assets/script/config/UIConfig';
import { Nexus } from 'db://nexus-framework/index';

const { ccclass } = _decorator;

/** 子游戏 Loading 面板，完成后自动切换到 slotGameMain 场景。 */
@ccclass('SlotGameLoading')
export class SlotGameLoading extends BaseLoading {

    override onShow(params?: unknown): void {
        super.onShow(params);
        console.log('SlotGameLoading params:', params);
    }

    /** 子游戏自定义资源，进度 20-80%。 */
    protected async loadRes(_params?: Record<string, unknown>): Promise<void> {
        this.setProgress(40, '加载游戏资源...');
        // TODO: 预加载子游戏 prefab、配置等
        await Promise.resolve();
    }

    protected async playMusic(): Promise<void> {
        // TODO: await Nexus.audio.playMusic('slotGame', 'audios/bgm', true);
        // Nexus.ui.show(CommonUI.ALERT, {
        //     content: '操作成功',
        //     onConfirm: () => console.log('ok'),
        // });
        // 确认 + 取消
        // Nexus.ui.show(CommonUI.ALERT, {
        //     content: '确定退出吗？',
        //     confirmText: '确定',
        //     cancelText: '再想想',
        //     showCancel: true,
        //     onConfirm: () => {console.log('ok')},
        //     onCancel: () => {console.log('cancel')},
        // });
        // 带图标（仅显示预制体上的图标节点）
        // Nexus.ui.show(CommonUI.ALERT, {
        //     content: '网络异常',
        //     showIcon: true,
        //     confirmText: '知道了',
        // });
        await new Promise<void>(resolve => setTimeout(resolve, 3000));
        // await Promise.resolve();
    }

    /** 建连、进房等，进度 85-100%。 */
    protected async joinRoom(_params?: Record<string, unknown>): Promise<boolean> {
        this.setProgress(90, '连接中...');
        // TODO: 发 joinGame，等 GAME_JOIN_SUCCESS，再 return true；等 GAME_JOIN_FAIL return false
        await Promise.resolve();
        return true; // 占位实现：当前还没有真实进房协议
    }
}

