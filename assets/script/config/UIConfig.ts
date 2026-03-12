import { UILayer } from 'db://nexus-framework/index';

/** 单条面板配置：key 为 CommonUI.ALERT 等字符串，value 用此结构 */
export interface PanelItem {
    layer: number;
    prefab: string;
    mask?: boolean;
    vacancy?: boolean;
}

/** 公共 UI 面板 ID：仅公共弹窗，如 CommonUI.ALERT */
export const CommonUI = {
    ALERT: 'alert',
} as const;

/** 公共面板配置表：查表 UIPanelConfig[CommonUI.ALERT] */
export const UIPanelConfig: Record<string, PanelItem> = {
    [CommonUI.ALERT]: {
        layer: UILayer.POPUP,
        prefab: 'prefabs/alert',
        mask: true,
    }
};

