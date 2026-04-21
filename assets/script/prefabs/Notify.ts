import { _decorator, Color, Label, Sprite, SpriteFrame } from 'cc';
import { ToastItem, ToastType } from 'db://nexus-framework/index';

const { ccclass, property } = _decorator;

/** 各类型的文字颜色，可按项目视觉规范调整 */
const TYPE_LABEL_COLORS: Record<ToastType, Color> = {
    info:    new Color(255, 255, 255, 255),
    success: new Color(180, 255, 180, 255),
    error:   new Color(255, 120, 120, 255),
    warn:    new Color(255, 210,  80, 255),
};

/**
 * Toast 节点组件（notify.prefab 根节点挂载此脚本）。
 *
 * Prefab 节点结构建议：
 *   Notify  ← 本组件 + UIOpacity + UITransform
 *   ├── bg      (Sprite，圆角背景)
 *   └── content (Node)
 *       ├── icon  (Sprite，默认 active=false)
 *       └── label (Label，Overflow=RESIZE_HEIGHT，固定宽度)
 */
@ccclass('Notify')
export class Notify extends ToastItem {

    @property(Label)
    contentLabel: Label | null = null;

    /** 图标节点，setup 时根据 icon 参数控制 active */
    @property(Sprite)
    iconSprite: Sprite | null = null;

    setup(msg: string, type: ToastType, icon?: SpriteFrame | null): void {
        if (this.contentLabel) {
            this.contentLabel.string = msg;
            this.contentLabel.color  = TYPE_LABEL_COLORS[type];
        }

        const showIcon = !!icon;
        if (this.iconSprite) {
            this.iconSprite.node.active = showIcon;
            if (showIcon) this.iconSprite.spriteFrame = icon!;
        }
    }
}
