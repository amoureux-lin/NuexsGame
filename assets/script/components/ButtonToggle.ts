import { _decorator, Button, Component, EventHandler, Node } from 'cc';
const { ccclass, property, requireComponent, executeInEditMode } = _decorator;
import { EDITOR } from 'cc/env';

/**
 * ButtonToggle — 双节点切换按钮组件
 *
 * 每次点击在 normalNode / checkNode 之间切换显示，
 * 同时派发 EventHandler 事件，回调参数为当前 isChecked 状态。
 * 配合 Button 组件使用，将两个带 Sprite 的子节点分别拖入即可。
 */
@ccclass('ButtonToggle')
@requireComponent(Button)
@executeInEditMode(true)
export class ButtonToggle extends Component {

    @property({ type: Node, tooltip: '常态显示的节点' })
    get normalNode(): Node { return this._normalNode; }
    set normalNode(v: Node) {
        this._normalNode = v;
        this._applyState();
    }
    @property
    private _normalNode: Node = null!;

    @property({ type: Node, tooltip: '选中状态显示的节点' })
    get checkNode(): Node { return this._checkNode; }
    set checkNode(v: Node) {
        this._checkNode = v;
        this._applyState();
    }
    @property
    private _checkNode: Node = null!;

    @property({ tooltip: '当前是否为选中状态' })
    get isChecked(): boolean { return this._isChecked; }
    set isChecked(v: boolean) {
        this._isChecked = v;
        this._applyState();
    }
    @property
    private _isChecked: boolean = false;

    @property({ type: [EventHandler], tooltip: '状态切换时的回调，参数为 isChecked (string "true"/"false")' })
    toggleEvents: EventHandler[] = [];

    protected onLoad(): void {
        this._applyState();
        if (EDITOR) return;
        this.node.on(Button.EventType.CLICK, this._onClick, this);
    }

    protected onEnable(): void {
        this._applyState();
    }

    protected onDestroy(): void {
        if (EDITOR) return;
        this.node.off(Button.EventType.CLICK, this._onClick, this);
    }

    /** 切换状态 */
    toggle(): void {
        this._isChecked = !this._isChecked;
        this._applyState();
        EventHandler.emitEvents(this.toggleEvents, this._isChecked);
    }

    private _onClick(): void {
        this.toggle();
    }

    private _applyState(): void {
        if (this._normalNode) this._normalNode.active = !this._isChecked;
        if (this._checkNode) this._checkNode.active = this._isChecked;
    }
}
