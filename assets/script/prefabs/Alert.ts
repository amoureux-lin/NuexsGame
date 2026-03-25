import { _decorator, Component, Label, Node, Sprite, Button } from 'cc';
import { Nexus } from 'db://nexus-framework/index';

const { ccclass, property } = _decorator;

/** 弹窗参数：通过 Nexus.ui.show(CommonUI.ALERT, params) 传入 */
export interface AlertParams {
    /** 主文案 */
    content: string;
    /** 是否显示图标节点（为 false 时隐藏 iconNode） */
    showIcon?: boolean;
    /** 图标 SpriteFrame 路径（相对 common 或当前 Bundle），可选；不填且 showIcon 为 true 时用预制体默认图 */
    iconPath?: string;
    /** 确认按钮文案，默认「确认」 */
    confirmText?: string;
    /** 取消按钮文案，默认「取消」 */
    cancelText?: string;
    /** 是否显示确认按钮，默认 true */
    showConfirm?: boolean;
    /** 是否显示取消按钮，默认 false */
    showCancel?: boolean;
    /** 点击确认后回调（可在此内关闭弹窗或做后续逻辑） */
    onConfirm?: () => void;
    /** 点击取消/遮罩后回调 */
    onCancel?: () => void;
}

/**
 * 通用弹窗：挂到 alert 预制体根节点。
 * 在 onShow(params) 中根据 params 设置文案、图标、确认/取消按钮的显示与回调。
 * 使用：Nexus.ui.show(CommonUI.ALERT, { content: '确定退出？', showCancel: true, onConfirm: () => {}, onCancel: () => {} });
 */
@ccclass('Alert')
export class Alert extends Component {

    @property(Label)
    contentLabel: Label | null = null;

    @property(Node)
    iconNode: Node | null = null;

    @property(Button)
    confirmBtn: Button | null = null;

    @property(Label)
    confirmLabel: Label | null = null;

    @property(Button)
    cancelBtn: Button | null = null;

    @property(Label)
    cancelLabel: Label | null = null;

    private _params: AlertParams | null = null;

    onEnter(params?: unknown): void {
        const p = (params ?? {}) as AlertParams;
        this._params = p;

        if (this.contentLabel) this.contentLabel.string = p.content ?? '';

        if (this.iconNode) {
            this.iconNode.active = p.showIcon === true;
            if (p.showIcon && p.iconPath && this.iconNode.getComponent(Sprite)) {
                // TODO: 若需动态换图，可在此 Nexus.asset.load('common', p.iconPath, SpriteFrame) 后赋给 sprite.spriteFrame
            }
        }

        const showConfirm = p.showConfirm !== false;
        const showCancel = p.showCancel === true;

        if (this.confirmBtn) {
            this.confirmBtn.node.active = showConfirm;
            if (this.confirmLabel) this.confirmLabel.string = p.confirmText ?? '确认';
        }
        if (this.cancelBtn) {
            this.cancelBtn.node.active = showCancel;
            if (this.cancelLabel) this.cancelLabel.string = p.cancelText ?? '取消';
        }

        this._bindButtons();
    }

    onExit(): void {
        this._params = null;
        this._unbindButtons();
    }

    private _bindButtons(): void {
        this._unbindButtons();
        if (this.confirmBtn?.node.active) {
            this.confirmBtn.node.on(Button.EventType.CLICK, this._onConfirm, this);
        }
        if (this.cancelBtn?.node.active) {
            this.cancelBtn.node.on(Button.EventType.CLICK, this._onCancel, this);
        }
    }

    private _unbindButtons(): void {
        this.confirmBtn?.node.off(Button.EventType.CLICK, this._onConfirm, this);
        this.cancelBtn?.node.off(Button.EventType.CLICK, this._onCancel, this);
    }

    private _onConfirm(): void {
        this._params?.onConfirm?.();
        this._close();
    }

    private _onCancel(): void {
        this._params?.onCancel?.();
        this._close();
    }

    private _close(): void {
        Nexus.ui.hide('alert');
    }
}
