import {UILayer, UIPanelOptions} from 'db://nexus-framework/index';

/** Slzq 子游戏 UI 面板 ID */
export const SlzqUI = {
    MOCK_VIEW: 'mockView',
    RULE_VIEW: 'ruleView',
} as const;

/** Slzq 面板配置：预制体路径相对于 tongits Bundle 根目录 */
export const SlzqUIPanelConfig: Record<string, UIPanelOptions> = {
    [SlzqUI.MOCK_VIEW]: {
        layer: UILayer.POPUP,
        prefab: 'res/prefabs/mockView',
        mask:true,
        maskClose:true,
        maskColor:"#00000000"
    },
    [SlzqUI.RULE_VIEW]: {
        layer: UILayer.POPUP,
        prefab: 'res/prefabs/ruleView',
        mask: true,
        maskClose: false,
    },
};
