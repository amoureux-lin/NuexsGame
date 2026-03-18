import type { PanelItem } from 'db://assets/script/config/UIConfig';
import { UILayer } from 'db://nexus-framework/index';

/** 老虎机子游戏 UI 面板 ID */
export const tongitsUI = {
    RESULT: 'tongitsResult',
    SETTINGS: 'tongitsSettings',
} as const;

/** 老虎机面板配置：预制体路径相对于 tongits Bundle 根目录 */
export const TongitsUIPanelConfig: Record<string, PanelItem> = {
    [tongitsUI.RESULT]: {
        layer: UILayer.POPUP,
        prefab: 'prefabs/tongitsResult',
    },
    [tongitsUI.SETTINGS]: {
        layer: UILayer.PANEL,
        prefab: 'prefabs/tongitsSettings',
    },
};
