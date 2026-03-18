import type { PanelItem } from 'db://assets/script/config/UIConfig';
import { UILayer } from 'db://nexus-framework/index';

/** 老虎机子游戏 UI 面板 ID */
export const slotGameUI = {
    RESULT: 'slotGameResult',
    SETTINGS: 'slotGameSettings',
} as const;

/** 老虎机面板配置：预制体路径相对于 slotGame Bundle 根目录 */
export const SlotGameUIPanelConfig: Record<string, PanelItem> = {
    [slotGameUI.RESULT]: {
        layer: UILayer.POPUP,
        prefab: 'prefabs/slotGameResult',
    },
    [slotGameUI.SETTINGS]: {
        layer: UILayer.PANEL,
        prefab: 'prefabs/slotGameSettings',
    },
};
