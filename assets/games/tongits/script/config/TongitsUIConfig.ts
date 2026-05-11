import {UILayer, UIPanelOptions} from 'db://nexus-framework/index';

/** Tongits 子游戏 UI 面板 ID */
export const TongitsUI = {
    MOCK_VIEW: 'mockView',
    RULE_VIEW: 'ruleView',
    RECORD_VIEW:'recordView'
} as const;

/** Tongits 面板配置：预制体路径相对于 tongits Bundle 根目录 */
export const TongitsUIPanelConfig: Record<string, UIPanelOptions> = {
    [TongitsUI.MOCK_VIEW]: {
        layer: UILayer.POPUP,
        prefab: 'res/prefabs/mockView',
        mask:true,
        maskClose:true,
        maskColor:"#00000000"
    },
    [TongitsUI.RULE_VIEW]: {
        layer: UILayer.POPUP,
        prefab: 'res/prefabs/ruleView',
        mask: true,
        maskClose: false,
    },
    [TongitsUI.RECORD_VIEW]: {
        layer: UILayer.POPUP,
        prefab: 'res/prefabs/recordView',
        mask: true,
        maskClose: false,
    },
};
