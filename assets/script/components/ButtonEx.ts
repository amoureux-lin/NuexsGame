import { _decorator, Button, Component, Sprite, SpriteFrame } from 'cc';
const { ccclass, property, requireComponent, executeInEditMode } = _decorator;
import { EDITOR } from 'cc/env';
/**
 * ButtonEx — 换图 + 防抖增强按钮组件
 *
 * 配合 Button.Transition = Scale 使用：
 *   - 按下缩放由 Button 原生 Scale Transition 处理（编辑器设置）
 *   - 本组件负责 Normal / Disabled 换图，以及点击防抖
 *   - targetSprite 自动取同节点的 Sprite 组件，无需手动拖拽
 *   - 在 Inspector 设置 normalSprite 后编辑器内立即生效预览
 */
@ccclass('ButtonEx')
@requireComponent(Button)
@requireComponent(Sprite)
@executeInEditMode(true)
export class ButtonEx extends Component {

    @property({ type: SpriteFrame, tooltip: '可交互时显示的图片（编辑器中实时预览）' })
    get normalSprite(): SpriteFrame { return this._normalSprite; }
    set normalSprite(v: SpriteFrame) {
        this._normalSprite = v;
        const sp = this.getComponent(Sprite);
        if (sp && v) sp.spriteFrame = v;
    }
    @property
    private _normalSprite: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '禁用时显示的图片' })
    disabledSprite: SpriteFrame = null!;

    @property({ tooltip: '防抖冷却时间（秒），0 表示不防抖' })
    cooldown: number = 0.3;

    private _button: Button = null!;
    private _interactable: boolean = true;
    private _cooling: boolean = false;

    protected onLoad(): void {
        if (EDITOR) return;
        this._button = this.getComponent(Button)!;
        if (this.cooldown > 0) {
            this.node.on(Button.EventType.CLICK, this._onClickDebounce, this);
        }
    }

    protected onDestroy(): void {
        if (EDITOR) return;
        this.node.off(Button.EventType.CLICK, this._onClickDebounce, this);
    }

    /** 由 ActionPanel._setInteractable 调用，同步逻辑状态并换图 */
    setInteractable(v: boolean): void {
        this._interactable = v;
        this._apply();
    }

    private _apply(): void {
        if (!this._button) this._button = this.getComponent(Button)!;
        if (!this._button) return;
        this._button.interactable = this._interactable && !this._cooling;
        const sp = this.getComponent(Sprite);
        if (sp) {
            const frame = this._interactable ? this._normalSprite : this.disabledSprite;
            if (frame) sp.spriteFrame = frame;
        }
    }

    private _onClickDebounce(): void {
        if (!this._button) this._button = this.getComponent(Button)!;
        if (!this._button) return;
        this._cooling = true;
        this._button.interactable = false;
        this.scheduleOnce(() => {
            this._cooling = false;
            if (this._button) this._button.interactable = this._interactable;
        }, this.cooldown);
    }
}
