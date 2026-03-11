import { _decorator } from 'cc';
import { BaseEntry } from 'db://nexus-framework/index';

const { ccclass } = _decorator;


@ccclass('SlotGameEntry')
export class SlotGameEntry extends BaseEntry {

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        await super.onEnter(params);
        // 子游戏初始化：如请求游戏列表、刷新用户信息等
    }

    async onExit(): Promise<void> {
        // 大厅清理
        await super.onExit();
    }
}
