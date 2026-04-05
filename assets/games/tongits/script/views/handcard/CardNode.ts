/**
 * CardNode — 单张牌节点组件
 *
 * 职责：
 *   - 通过 cardSprite 显示牌面（图集）或牌背（SpriteFrame）
 *   - 管理选中态 / Meld 提示态（纵向 tween 上移）
 *   - 对外暴露 onClick 回调
 */

import {
    _decorator, Component, Node, UITransform, Graphics,
    Color, Vec3, tween, Tween, UIOpacity, SpriteAtlas, SpriteFrame, Sprite,
} from 'cc';

const { ccclass, property } = _decorator;

// ── 常量 ──────────────────────────────────────────────────

export const CARD_W       = 80;
export const CARD_H       = 110;
/** 牌与牌之间的叠牌间距（px），散牌与分组统一使用 */
export const CARD_SPACING = 64;

const LIFT_Y        = 30; //上移距离
const LIFT_DURATION = 0.1;

// ── 组件 ──────────────────────────────────────────────────

@ccclass('CardNode')
export class CardNode extends Component {

    @property({ type: Sprite,      tooltip: '牌面/牌背显示 Sprite'  }) cardSprite:       Sprite      | null = null;
    @property({ type: SpriteAtlas, tooltip: '牌面图集'               }) pokerAtlas:       SpriteAtlas | null = null;
    @property({ type: SpriteFrame, tooltip: '牌背 SpriteFrame'       }) pokerNormalBacks: SpriteFrame | null = null;
    @property({ type: Node,        tooltip: '选中高亮节点'           }) selectedBorder:   Node        | null = null;
    @property({ type: Node,        tooltip: 'Meld 提示高亮节点'     }) hintOverlay:      Node        | null = null;

    // ── 运行时状态 ────────────────────────────────────────

    private _cardValue: number  = 0;
    private _selected:  boolean = false;
    private _hinted:    boolean = false;
    private _faceDown:  boolean = true;   // 默认背面朝上
    private _liftTween: Tween<Node> | null = null;
    private _moveTween: Tween<Node> | null = null;

    /** 点击回调（由父节点赋值） */
    onClick: ((cardValue: number) => void) | null = null;

    // ── 生命周期 ──────────────────────────────────────────

    onLoad(): void {
        this._ensureVisuals();
        this.node.on(Node.EventType.TOUCH_END, this._onTap, this);
    }

    onDestroy(): void {
        this._liftTween?.stop();
        this._moveTween?.stop();
    }

    // ── 公开 API ──────────────────────────────────────────

    /** 设置牌值并刷新显示 */
    setCard(value: number): void {
        this._cardValue = value;
        this._ensureVisuals();
        this._refreshDisplay();
    }

    get cardValue(): number { return this._cardValue; }

    /** 正/背面切换：true → 牌背，false → 牌面 */
    setFaceDown(faceDown: boolean): void {
        this._faceDown = faceDown;
        this._refreshDisplay();
    }

    get isFaceDown(): boolean { return this._faceDown; }

    /** 选中态：true → 上移 + 黄边高亮 */
    setSelected(selected: boolean): void {
        if (this._selected === selected) return;
        this._selected = selected;
        this._updateLift();
        if (this.selectedBorder) this.selectedBorder.active = selected;
    }

    get isSelected(): boolean { return this._selected; }

    /** Meld 提示态：true → 上移 + 蓝色蒙层 */
    setHinted(hinted: boolean): void {
        if (this._hinted === hinted) return;
        this._hinted = hinted;
        this._updateLift();
        if (this.hintOverlay) this.hintOverlay.active = hinted;
    }

    get isHinted(): boolean { return this._hinted; }

    /** 动画移动到目标 X 位置（布局重排时调用），同时保持正确的 lift Y */
    tweenToX(x: number, duration: number): void {
        this._moveTween?.stop();
        this._liftTween?.stop(); // 统一由此 tween 负责 Y，避免两个 tween 冲突
        const y = (this._selected || this._hinted) ? LIFT_Y : 0;
        this._moveTween = tween(this.node)
            .to(duration, { position: new Vec3(x, y, 0) }, { easing: 'quadOut' })
            .call(() => { this._moveTween = null; })
            .start();
    }

    // ── 私有 ──────────────────────────────────────────────

    private _onTap(): void {
        this.onClick?.(this._cardValue);
    }

    private _updateLift(): void {
        // 如果 tweenToX 正在运行，它已包含正确的 Y，无需再单独 tween
        if (this._moveTween) return;
        this._liftTween?.stop();
        const offsetY = (this._selected || this._hinted) ? LIFT_Y : 0;
        const pos     = this.node.position;
        this._liftTween = tween(this.node)
            .to(LIFT_DURATION, { position: new Vec3(pos.x, offsetY, pos.z) }, { easing: 'quadOut' })
            .call(() => { this._liftTween = null; })
            .start();
    }

    /** 刷新 cardSprite 的 spriteFrame：牌背或牌面 */
    private _refreshDisplay(): void {
        if (!this.cardSprite) return;
        if (this._faceDown) {
            if (this.pokerNormalBacks) this.cardSprite.spriteFrame = this.pokerNormalBacks;
        } else {
            if (this.pokerAtlas && this._cardValue) {
                const frame = this.pokerAtlas.getSpriteFrame(String(this._cardValue));
                if (frame) this.cardSprite.spriteFrame = frame;
            }
        }
    }

    /**
     * 程序化创建默认视觉节点（幂等，addChild 前可安全调用）。
     * Inspector 已绑定则跳过对应创建。
     */
    private _ensureVisuals(): void {
        let tf = this.node.getComponent(UITransform);
        if (!tf) tf = this.node.addComponent(UITransform);
        tf.setContentSize(CARD_W, CARD_H);

        // 牌面/牌背 Sprite（直接挂在根节点）
        if (!this.cardSprite) {
            this.cardSprite = this.node.addComponent(Sprite);
            this.cardSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }

        // 选中高亮（黄色描边）
        if (!this.selectedBorder) {
            const n = new Node('_selectedBorder');
            n.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
            const g = n.addComponent(Graphics);
            g.lineWidth   = 3;
            g.strokeColor = new Color(255, 210, 0, 255);
            g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 6);
            g.stroke();
            n.active = false;
            this.node.addChild(n);
            this.selectedBorder = n;
        }

        // Meld 提示高亮（蓝色半透明蒙层）
        if (!this.hintOverlay) {
            const n = new Node('_hintOverlay');
            n.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
            n.addComponent(UIOpacity).opacity = 80;
            const g = n.addComponent(Graphics);
            g.fillColor = new Color(0, 140, 255, 255);
            g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 6);
            g.fill();
            n.active = false;
            this.node.addChild(n);
            this.hintOverlay = n;
        }

        this._refreshDisplay();
    }
}
