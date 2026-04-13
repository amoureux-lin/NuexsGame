import { _decorator, Button, Component, Node, tween, Vec3 } from 'cc';
const { ccclass, property, requireComponent } = _decorator;

/**
 * ClickScale — 按钮点击缩放 + 防抖组件
 *
 * 挂到含 Button 组件的节点上即可自动生效。
 * Button.Transition 保持 Sprite，Normal/Disabled 换图由 Button 自己处理。
 *
 * 防抖原理：TOUCH_END 后将 button.interactable 置 false，
 * 从源头阻断 Button 响应下一次触摸，冷却结束后自动恢复。
 * 注意：冷却期间 Transition:Sprite 会显示 DisabledSprite，
 * 如不希望换图，改用 ButtonEx 组件。
 */
@ccclass('ClickScale')
@requireComponent(Button)
export class ClickScale extends Component {

    @property({ tooltip: '按下缩小到的比例（0~1）' })
    pressScale: number = 0.88;

    @property({ tooltip: '松手弹起时放大到的比例（>1 产生弹性感）' })
    bounceScale: number = 1.06;

    @property({ tooltip: '按下缩小耗时（秒）' })
    pressDuration: number = 0.08;

    @property({ tooltip: '弹起耗时（秒）' })
    bounceDuration: number = 0.10;

    @property({ tooltip: '回到原始大小耗时（秒）' })
    restoreDuration: number = 0.08;

    @property({ tooltip: '防抖冷却时间（秒），0 表示不防抖' })
    cooldown: number = 0.5;

    private _button: Button = null!;
    private _originScale: Vec3 = new Vec3(1, 1, 1);

    protected onLoad(): void {
        this._button = this.getComponent(Button)!;
        this._originScale = this.node.scale.clone();

        this.node.on(Node.EventType.TOUCH_START,  this._onTouchStart,  this);
        this.node.on(Node.EventType.TOUCH_END,    this._onTouchEnd,    this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_START,  this._onTouchStart,  this);
        this.node.off(Node.EventType.TOUCH_END,    this._onTouchEnd,    this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    private _onTouchStart(): void {
        if (!this._button.interactable) return;
        const o = this._originScale;
        tween(this.node)
            .stop()
            .to(this.pressDuration, { scale: new Vec3(o.x * this.pressScale, o.y * this.pressScale, 1) }, { easing: 'quadOut' })
            .start();
    }

    private _onTouchEnd(): void {
        if (!this._button.interactable) return;
        // 弹起动画
        const o = this._originScale;
        tween(this.node)
            .stop()
            .to(this.bounceDuration,  { scale: new Vec3(o.x * this.bounceScale, o.y * this.bounceScale, 1) }, { easing: 'quadOut' })
            .to(this.restoreDuration, { scale: new Vec3(o.x, o.y, 1) },                                       { easing: 'quadOut' })
            .start();
        // 防抖：设 interactable=false 从根源阻断 Button 响应下一次触摸
        if (this.cooldown > 0) {
            this._button.interactable = false;
            this.scheduleOnce(() => { this._button.interactable = true; }, this.cooldown);
        }
    }

    private _onTouchCancel(): void {
        const o = this._originScale;
        tween(this.node)
            .stop()
            .to(this.restoreDuration, { scale: new Vec3(o.x, o.y, 1) }, { easing: 'quadOut' })
            .start();
    }
}
