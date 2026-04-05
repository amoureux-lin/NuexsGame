import {UILayer, UIPanelOptions} from 'db://nexus-framework/index';

/** 公共 UI 面板 ID：仅公共弹窗，如 CommonUI.ALERT */
export const CommonUI = {
    MASK:"mask",
    ALERT: 'alert',
    NET_LOADING: 'netLoading',
    SETTING: 'settingView',
} as const;

/** 公共面板配置表：查表 UIPanelConfig[CommonUI.ALERT] */
export const UIPanelConfig: Record<string, UIPanelOptions> = {
    [CommonUI.MASK]: { layer: UILayer.POPUP, prefab: 'prefabs/mask' },
    [CommonUI.ALERT]: {
        layer: UILayer.POPUP,
        prefab: 'prefabs/alert',
        mask: true,
    },
    [CommonUI.NET_LOADING]: {
        layer: UILayer.POPUP,
        prefab: 'prefabs/netLoading',
    },
    [CommonUI.SETTING]: {
        layer: UILayer.POPUP,
        prefab: 'prefabs/settingView',
        mask: true,
    }

};

