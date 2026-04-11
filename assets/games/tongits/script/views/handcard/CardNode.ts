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
    Color, Vec3, Vec2, tween, Tween, UIOpacity, SpriteAtlas, SpriteFrame, Sprite, EventTouch,
} from 'cc';

const { ccclass, property } = _decorator;

// ── 常量 ──────────────────────────────────────────────────

/** 无 SpriteFrame 或尺寸无效时的回退宽高（布局与占位用） */
export const DEFAULT_CARD_W = 80;
export const DEFAULT_CARD_H = 110;

/** @deprecated 请用 DEFAULT_CARD_W 或节点 UITransform / getCardContentSize */
export const CARD_W = DEFAULT_CARD_W;
/** @deprecated 请用 DEFAULT_CARD_H 或节点 UITransform / getCardContentSize */
export const CARD_H = DEFAULT_CARD_H;

/** 牌与牌之间的叠牌间距（px），散牌与分组统一使用 */
export const CARD_SPACING = 64;

/** 从已挂 CardNode 的节点读取内容区宽高（无组件或尺寸为 0 时回退默认） */
export function getCardContentSize(cardRoot: Node | null): { w: number; h: number } {
    if (!cardRoot?.isValid) return { w: DEFAULT_CARD_W, h: DEFAULT_CARD_H };
    const tf = cardRoot.getComponent(UITransform);
    if (!tf) return { w: DEFAULT_CARD_W, h: DEFAULT_CARD_H };
    const { width: cw, height: ch } = tf.contentSize;
    if (cw > 0 && ch > 0) return { w: cw, h: ch };
    return { w: DEFAULT_CARD_W, h: DEFAULT_CARD_H };
}

const LIFT_Y        = 30; //上移距离
const LIFT_DURATION = 0.1;

// ── 组件 ──────────────────────────────────────────────────

@ccclass('CardNode')
export class CardNode extends Component {

    @property({ type: Sprite,      tooltip: '牌面/牌背显示 Sprite'  }) cardSprite:       Sprite      | null = null;
    @property({ type: SpriteAtlas, tooltip: '牌面图集'               }) pokerAtlas:       SpriteAtlas | null = null;
    @property({ type: SpriteFrame, tooltip: '牌背 SpriteFrame'       }) pokerNormalBacks: SpriteFrame | null = null;
    @property({ type: Node,        tooltip: '遮罩节点'           }) maskNode:   Node        | null = null;
    @property({ type: Node,        tooltip: '提示节点'           }) tipNode:   Node        | null = null;
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

    /** 拖拽开始（已超过阈值） */
    onDragStart: ((cardValue: number, uiPos: Vec2) => void) | null = null;
    /** 拖拽移动 */
    onDragMove:  ((uiPos: Vec2) => void) | null = null;
    /** 拖拽结束 / 取消 */
    onDragEnd:   ((uiPos: Vec2) => void) | null = null;

    private _touchStartPos: Vec2 | null = null;
    private _dragging      = false;
    private _lastUIPos     = new Vec2();

    // ── 生命周期 ──────────────────────────────────────────

    onLoad(): void {
        if (this.maskNode) this.maskNode.active = false;
        if (this.tipNode) this.tipNode.active = false;
        this._ensureVisuals();
        this.node.on(Node.EventType.TOUCH_START,  this._onTouchStart,  this);
        this.node.on(Node.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        this.node.on(Node.EventType.TOUCH_END,    this._onTouchEnd,    this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    onDestroy(): void {
        this._liftTween?.stop();
        this._moveTween?.stop();
        this.node.off(Node.EventType.TOUCH_START,  this._onTouchStart,  this);
        this.node.off(Node.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        this.node.off(Node.EventType.TOUCH_END,    this._onTouchEnd,    this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
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

    /** 遮罩：true → 显示 maskNode（不能吃的牌等场景） */
    setMasked(masked: boolean): void {
        if (this.maskNode) this.maskNode.active = masked;
    }

    get isMasked(): boolean { return this.maskNode?.active ?? false; }

    /** 补牌提示：true → 显示 tipNode */
    setTipped(tipped: boolean): void {
        if (this.tipNode) this.tipNode.active = tipped;
    }

    get isTipped(): boolean { return this.tipNode?.active ?? false; }

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

    private _onTouchStart(e: EventTouch): void {
        const loc = e.getUILocation();
        this._touchStartPos = new Vec2(loc.x, loc.y);
        this._dragging      = false;
    }

    private _onTouchMove(e: EventTouch): void {
        if (!this._touchStartPos) return;
        const loc = e.getUILocation();
        this._lastUIPos.set(loc.x, loc.y);
        if (!this._dragging) {
            const dx = loc.x - this._touchStartPos.x;
            const dy = loc.y - this._touchStartPos.y;
            if (dx * dx + dy * dy >= 64) {   // 8px 阈值
                this._dragging = true;
                this.onDragStart?.(this._cardValue, new Vec2(loc.x, loc.y));
            }
        } else {
            this.onDragMove?.(new Vec2(loc.x, loc.y));
        }
    }

    private _onTouchEnd(e: EventTouch): void {
        const loc = e.getUILocation();
        if (this._dragging) {
            this._dragging      = false;
            this._touchStartPos = null;
            this.onDragEnd?.(new Vec2(loc.x, loc.y));
        } else {
            this._touchStartPos = null;
            this.onClick?.(this._cardValue);
        }
    }

    private _onTouchCancel(_e: EventTouch): void {
        if (this._dragging) {
            this._dragging = false;
            this.onDragEnd?.(new Vec2(this._lastUIPos.x, this._lastUIPos.y));
        }
        this._touchStartPos = null;
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

    /** 刷新 cardSprite 的 spriteFrame：牌背或牌面，并按帧图尺寸同步根节点与描边/蒙层 */
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
        this._syncNodeSizeFromCurrentFrame();
    }

    /**
     * 按当前 spriteFrame 的像素尺寸设置根 UITransform（CUSTOM 模式），
     * 并同步选中框 / 提示蒙层。
     */
    private _syncNodeSizeFromCurrentFrame(): void {
        const sf = this.cardSprite?.spriteFrame;
        const tf = this.node.getComponent(UITransform);
        if (!tf) return;

        let w = 0;
        let h = 0;
        if (sf) {
            const os = sf.originalSize;
            if (os && os.width > 0 && os.height > 0) {
                w = os.width;
                h = os.height;
            } else {
                const r = sf.rect;
                w = r.width;
                h = r.height;
            }
        }
        if (w <= 0 || h <= 0) {
            w = DEFAULT_CARD_W;
            h = DEFAULT_CARD_H;
        }
        tf.setContentSize(w, h);
        this._syncOverlaySizes(w, h);
    }

    private _syncOverlaySizes(w: number, h: number): void {
        const halfW = w / 2;
        const halfH = h / 2;
        const radius = Math.min(6, Math.min(w, h) * 0.08);

        if (this.selectedBorder) {
            this.selectedBorder.getComponent(UITransform)?.setContentSize(w, h);
            const g = this.selectedBorder.getComponent(Graphics);
            if (g) {
                g.clear();
                g.lineWidth   = 3;
                g.strokeColor = new Color(255, 210, 0, 255);
                g.roundRect(-halfW, -halfH, w, h, radius);
                g.stroke();
            }
        }
        if (this.hintOverlay) {
            this.hintOverlay.getComponent(UITransform)?.setContentSize(w, h);
            const g = this.hintOverlay.getComponent(Graphics);
            if (g) {
                g.clear();
                g.fillColor = new Color(0, 140, 255, 255);
                g.roundRect(-halfW, -halfH, w, h, radius);
                g.fill();
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
        tf.setContentSize(DEFAULT_CARD_W, DEFAULT_CARD_H);

        // 牌面/牌背 Sprite（直接挂在根节点）
        if (!this.cardSprite) {
            this.cardSprite = this.node.addComponent(Sprite);
            this.cardSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }

        // 选中高亮（黄色描边）— 具体尺寸在 _syncNodeSizeFromCurrentFrame 中按帧图重绘
        if (!this.selectedBorder) {
            const n = new Node('_selectedBorder');
            n.addComponent(UITransform).setContentSize(DEFAULT_CARD_W, DEFAULT_CARD_H);
            n.addComponent(Graphics);
            n.active = false;
            this.node.addChild(n);
            this.selectedBorder = n;
        }

        // Meld 提示高亮（蓝色半透明蒙层）
        if (!this.hintOverlay) {
            const n = new Node('_hintOverlay');
            n.addComponent(UITransform).setContentSize(DEFAULT_CARD_W, DEFAULT_CARD_H);
            n.addComponent(UIOpacity).opacity = 80;
            n.addComponent(Graphics);
            n.active = false;
            this.node.addChild(n);
            this.hintOverlay = n;
        }

        this._refreshDisplay();
    }
}
