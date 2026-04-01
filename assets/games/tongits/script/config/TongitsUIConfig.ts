import type { PanelItem } from 'db://assets/script/config/UIConfig';
import { UILayer } from 'db://nexus-framework/index';

/** Tongits 子游戏 UI 面板 ID */
export const TongitsUI = {
    SETTING: 'settingView',
} as const;

/** Tongits 面板配置：预制体路径相对于 tongits Bundle 根目录 */
export const TongitsUIPanelConfig: Record<string, PanelItem> = {
    [TongitsUI.SETTING]: {
        layer: UILayer.POPUP,
        prefab: 'res/prefabs/settingView',
    }
};
