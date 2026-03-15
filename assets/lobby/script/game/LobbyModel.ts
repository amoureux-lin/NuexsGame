import { Model, Nexus } from 'db://nexus-framework/index';
import { LobbyEvents, LobbyWsCmd } from '../config/LobbyEvents';

/** 游戏列表项，按需扩展 */
export interface GameItem {
    gameId: number;
    bundleName: string;
    name?: string;
    icon?: string;
    [key: string]: unknown;
}

/** 用户信息，按需扩展 */
export interface UserInfo {
    userId?: string | number;
    nickname?: string;
    avatar?: string;
    balance?: number;
    [key: string]: unknown;
}

/**
 * 大厅 Model：负责游戏列表、用户信息等数据与拉取，通过事件通知 View 更新。
 */
export class LobbyModel extends Model {
    private _gameList: GameItem[] = [];
    private _userInfo: UserInfo = {};

    get gameList(): GameItem[] {
        return this._gameList;
    }

    get userInfo(): UserInfo {
        return this._userInfo;
    }

    /** 拉取游戏列表并通知 View */
    async fetchGameList(): Promise<void> {
        try {
            // TODO: 替换为真实接口，例如 const res = await Nexus.net.get<GameItem[]>('/api/game/list');
            this._gameList = [
                { gameId: 5, bundleName: 'slotGame', name: '老虎机' },
                // 扩展时在此或从接口追加
            ];
            this.notify(LobbyEvents.DATA_GAME_LIST_UPDATED, { list: this._gameList });
        } catch (e) {
            console.error('[LobbyModel] fetchGameList failed', e);
            this.notify(LobbyEvents.DATA_GAME_LIST_UPDATED, { list: [] });
        }
    }

    /** 拉取用户信息并通知 View */
    async fetchUserInfo(): Promise<void> {
        try {
            // TODO: 替换为真实接口
            this._userInfo = { userId: '1', nickname: '玩家', balance: 0 };
            this.notify(LobbyEvents.DATA_USER_INFO_UPDATED, { user: this._userInfo });
        } catch (e) {
            console.error('[LobbyModel] fetchUserInfo failed', e);
            this.notify(LobbyEvents.DATA_USER_INFO_UPDATED, { user: this._userInfo });
        }
    }

    /**
     * 注册 WebSocket 消息处理：收到对应 cmd 后更新数据并 notify。
     * 由 Controller 在 start() 中调用（需先 connectWs，或由业务保证已连接）；destroy 时 offWsMsgByTarget(this)。
     */
    registerHandlers(): void {
        Nexus.net.onWsMsg(LobbyWsCmd.GAME_LIST, this.onGameListMsg.bind(this), this);
        Nexus.net.onWsMsg(LobbyWsCmd.USER_INFO, this.onUserInfoMsg.bind(this), this);
    }

    private onGameListMsg(msg: unknown): void {
        const data = (msg as { data?: GameItem[] })?.data;
        if (Array.isArray(data)) {
            this._gameList = data;
            this.notify(LobbyEvents.DATA_GAME_LIST_UPDATED, { list: this._gameList });
        }
    }

    private onUserInfoMsg(msg: unknown): void {
        const data = (msg as { data?: UserInfo })?.data;
        if (data && typeof data === 'object') {
            this._userInfo = { ...this._userInfo, ...data };
            this.notify(LobbyEvents.DATA_USER_INFO_UPDATED, { user: this._userInfo });
        }
    }

    /** 发送 WebSocket 消息，按协议扩展。 */
    sendWs(cmd: string | number, data: unknown): void {
        Nexus.net.sendWs(cmd, data);
    }

    override destroy(): void {
        Nexus.net.offWsMsgByTarget(this);
        this._gameList = [];
        this._userInfo = {};
        super.destroy();
    }
}
