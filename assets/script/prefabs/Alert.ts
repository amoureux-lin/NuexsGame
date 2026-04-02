import { _decorator, Label, Node, Sprite, Button } from 'cc';
import { UIPanel } from 'db://nexus-framework/index';

const { ccclass, property } = _decorator;

/** 弹窗参数：通过 Nexus.ui.show(CommonUI.ALERT, params) 传入 */
export interface AlertParams {
    /** 主文案 */
    content: string;
    /** 是否显示图标节点（为 false 时隐藏 iconNode） */
    showIcon?: boolean;
    /** 图标 SpriteFrame 路径（相对 common 或当前 Bundle），可选 */
    iconPath?: string;
    /** 确认按钮文案，默认「确认」 */
    confirmText?: string;
    /** 取消按钮文案，默认「取消」 */
    cancelText?: string;
    /** 是否显示确认按钮，默认 true */
    showConfirm?: boolean;
    /** 是否显示取消按钮，默认 false */
    showCancel?: boolean;
    /** 点击确认后回调 */
    onConfirm?: () => void;
    /** 点击取消/遮罩后回调 */
    onCancel?: () => void;
}

/**
 * 通用弹窗：继承 UIPanel，由框架自动注入 panelName。
 * 使用：Nexus.ui.show(CommonUI.ALERT, { content: '确定退出？', showCancel: true, onConfirm: () => {} });
 */
@ccclass('Alert')
export class Alert extends UIPanel {

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

    onShow(params?: AlertParams): void {
        const p = (params ?? {}) as AlertParams;
        this._params = p;

        if (this.contentLabel) this.contentLabel.string = p.content ?? '';

        if (this.iconNode) {
            this.iconNode.active = p.showIcon === true;
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

    onHide(): void {
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
        this.close();  // 使用基类方法，不再硬编码 name
    }

    private _onCancel(): void {
        this._params?.onCancel?.();
        this.close();
    }
}
