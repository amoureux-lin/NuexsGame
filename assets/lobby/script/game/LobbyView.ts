import { _decorator } from 'cc';
import { View } from 'db://nexus-framework/index';
import { LobbyEvents } from '../config/LobbyEvents';
import type { GameItem, UserInfo } from './LobbyModel';

const { ccclass } = _decorator;

/**
 * 大厅 View：挂到大厅主场景的“主界面”节点上。
 * 只负责：监听数据事件刷新 UI，用户操作通过 dispatch 发给 Controller。
 */
@ccclass('LobbyView')
export class LobbyView extends View {

    protected registerEvents(): void {
        this.listen<{ list: GameItem[] }>(LobbyEvents.DATA_GAME_LIST_UPDATED, (data) => {
            this.onGameListUpdated(data.list);
        });
        this.listen<{ user: UserInfo }>(LobbyEvents.DATA_USER_INFO_UPDATED, (data) => {
            this.onUserInfoUpdated(data.user);
        });
    }

    /** 游戏列表数据更新时调用，子类可覆写以绑定到列表 UI */
    protected onGameListUpdated(_list: GameItem[]): void {
        // TODO: 绑定到 ScrollView/列表，渲染 GameItem
    }

    /** 用户信息更新时调用，子类可覆写以绑定到头像、昵称、余额等 */
    protected onUserInfoUpdated(_user: UserInfo): void {
        // TODO: 绑定到顶部栏等
    }

    /** 用户点击“游戏列表”按钮时由子类或节点事件调用 */
    protected openGameList(): void {
        this.dispatch(LobbyEvents.CMD_OPEN_GAME_LIST);
    }

    /** 用户点击某个游戏时调用，由子类传入 bundleName 和可选 params */
    protected enterGame(bundleName: string, params?: Record<string, unknown>): void {
        this.dispatch(LobbyEvents.CMD_ENTER_GAME, { bundleName, params });
    }

    /** 用户点击设置时调用 */
    protected openSettings(): void {
        this.dispatch(LobbyEvents.CMD_OPEN_SETTINGS);
    }
}
