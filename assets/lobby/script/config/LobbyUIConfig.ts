import { type PanelItem } from 'db://assets/script/config/UIConfig';
import { UILayer } from 'db://nexus-framework/index';

/** 大厅 UI 面板 ID：仅大厅专属，公共用 CommonUI；show(lobbyUI.LOBBY_TOAST) */
export const lobbyUI = {
    LOBBY_TOAST: 'lobbyToast',
    GAME_LIST: 'gameList',
} as const;

/** 大厅面板配置表：仅大厅面板，查表 LobbyUIPanelConfig[lobbyUI.LOBBY_TOAST] */
export const LobbyUIPanelConfig: Record<string, PanelItem> = {
    [lobbyUI.LOBBY_TOAST]: {
        layer: UILayer.TIPS,
        prefab: 'lobby/ui/lobbyToast',
    },
    [lobbyUI.GAME_LIST]: {
        layer: UILayer.PANEL,
        prefab: 'lobby/ui/gameList',
    },
};