import { Node, Vec3, sp, UIOpacity, tween, Label, Color, Tween, Layers, UITransform } from 'cc';
import { Nexus } from 'db://nexus-framework/index';

/** 播放参数 */
export interface EmojiPlayOptions {
    /** 表情名，对应 common/emojis/ 下的文件名（如 'Happy'） */
    name: string;
    /** 在哪个节点上方播放 */
    targetNode: Node;
    /** 相对 targetNode 的偏移，默认 (0, 80, 0) */
    offset?: Vec3;
    /** 是否循环播放，默认 false */
    loop?: boolean;
    /** 播放完成回调 */
    onComplete?: () => void;
}

/** 文字气泡参数 */
export interface TextBubbleOptions {
    /** 文字内容 */
    text: string;
    /** 在哪个节点上方显示 */
    targetNode: Node;
    /** 相对 targetNode 的偏移，默认 (0, 100, 0) */
    offset?: Vec3;
    /** 显示时长（秒），默认 2 */
    duration?: number;
    /** 显示完成回调 */
    onComplete?: () => void;
}

const DEFAULT_OFFSET = new Vec3(0, 0, 0);
const DEFAULT_TEXT_OFFSET = new Vec3(0, 100, 0);
const POOL_MAX = 3;

/**
 * EmojiPlayer — 通用表情/文字气泡播放器（单例）。
 *
 * 职责：
 *   - 在指定节点上方播放 Spine 表情动画
 *   - 在指定节点上方显示文字气泡
 *   - 对象池管理，避免频繁创建/销毁
 *   - 同一节点同时只播一个，新的打断旧的
 *
 * 不关心"哪个玩家"，只关心"在哪个节点播放"。
 * 玩家定位由各游戏 View 自行处理。
 */
export class EmojiPlayer {
    private static _instance: EmojiPlayer | null = null;

    static getInstance(): EmojiPlayer {
        if (!EmojiPlayer._instance) {
            EmojiPlayer._instance = new EmojiPlayer();
        }
        return EmojiPlayer._instance;
    }

    /** Spine 节点对象池 */
    private _spinePool: Node[] = [];
    /** 文字节点对象池 */
    private _textPool: Node[] = [];
    /** 当前正在播放的表情：targetNode → emojiNode（用于打断） */
    private _activeSpines = new Map<Node, Node>();
    /** 当前正在显示的文字：targetNode → textNode */
    private _activeTexts = new Map<Node, Node>();

    private constructor() {}

    // ── Spine 表情播放 ──────────────────────────────────────

    /**
     * 在 targetNode 上方播放 Spine 表情动画。
     * 同一 targetNode 只能同时播一个，新的打断旧的。
     */
    play(options: EmojiPlayOptions): void {
        const { name, targetNode, offset, loop, onComplete } = options;
        if (!targetNode?.isValid) return;

        // 打断同一节点上正在播放的
        this._stopSpine(targetNode);

        const node = this._getSpineNode();
        const skeleton = node.getComponent(sp.Skeleton)!;

        // 优先同步从缓存取（common bundle 已预加载），取不到再异步加载
        const path = `emojis/${name}`;
        const cached = Nexus.asset.get<sp.SkeletonData>(path, sp.SkeletonData);
        if (cached) {
            this._doPlaySpine(node, skeleton, cached, targetNode, offset, loop, onComplete);
        } else {
            Nexus.asset.load<sp.SkeletonData>('common', path, sp.SkeletonData).then((data) => {
                if (!targetNode.isValid) { this._recycleSpineNode(node); return; }
                this._doPlaySpine(node, skeleton, data, targetNode, offset, loop, onComplete);
            }).catch((err) => {
                console.warn('[EmojiPlayer] Failed to load:', path, err);
                this._recycleSpineNode(node);
            });
        }
    }

    private _doPlaySpine(
        node: Node, skeleton: sp.Skeleton, data: sp.SkeletonData,
        targetNode: Node, offset?: Vec3, loop?: boolean, onComplete?: () => void,
    ): void {
        skeleton.skeletonData = data;
        skeleton.premultipliedAlpha = false;

        // 挂到 targetNode 上
        targetNode.addChild(node);
        const off = offset ?? DEFAULT_OFFSET;
        node.setPosition(off.x, off.y, off.z);

        this._activeSpines.set(targetNode, node);

        // 播放默认动画
        skeleton.setAnimation(0, 'animation', loop ?? false);

        if (!loop) {
            skeleton.setCompleteListener(() => {
                skeleton.setCompleteListener(null);
                this._stopSpine(targetNode);
                onComplete?.();
            });
        }
    }

    /** 停止指定节点上的表情并回收 */
    private _stopSpine(targetNode: Node): void {
        const node = this._activeSpines.get(targetNode);
        if (!node) return;
        this._activeSpines.delete(targetNode);
        const skeleton = node.getComponent(sp.Skeleton);
        if (skeleton) {
            skeleton.setCompleteListener(null);
            skeleton.clearTracks();
        }
        this._recycleSpineNode(node);
    }

    // ── 文字气泡 ────────────────────────────────────────────

    /**
     * 在 targetNode 上方显示文字气泡。
     * 同一 targetNode 只能同时显示一个，新的打断旧的。
     */
    showText(options: TextBubbleOptions): void {
        const { text, targetNode, offset, duration, onComplete } = options;
        if (!targetNode?.isValid) return;

        // 打断同一节点上正在显示的
        this._stopText(targetNode);

        const node = this._getTextNode();
        const label = node.getComponent(Label)!;
        label.string = text;
        label.color = new Color(255, 255, 255, 255);

        // 挂到 targetNode 上
        targetNode.addChild(node);
        const off = offset ?? DEFAULT_TEXT_OFFSET;
        node.setPosition(off.x, off.y, off.z);

        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        opacity.opacity = 255;

        this._activeTexts.set(targetNode, node);

        const dur = duration ?? 2;
        // 停留后淡出
        tween(opacity)
            .delay(dur)
            .to(0.3, { opacity: 0 })
            .call(() => {
                this._stopText(targetNode);
                onComplete?.();
            })
            .start();
    }

    /** 停止指定节点上的文字气泡并回收 */
    private _stopText(targetNode: Node): void {
        const node = this._activeTexts.get(targetNode);
        if (!node) return;
        this._activeTexts.delete(targetNode);
        Tween.stopAllByTarget(node.getComponent(UIOpacity)!);
        this._recycleTextNode(node);
    }

    // ── 对象池 ──────────────────────────────────────────────

    private _getSpineNode(): Node {
        if (this._spinePool.length > 0) {
            const node = this._spinePool.pop()!;
            node.active = true;
            return node;
        }
        const node = new Node('EmojiSpine');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform);
        node.addComponent(sp.Skeleton);
        return node;
    }

    private _recycleSpineNode(node: Node): void {
        if (!node.isValid) return;
        node.removeFromParent();
        node.active = false;
        if (this._spinePool.length < POOL_MAX) {
            this._spinePool.push(node);
        } else {
            node.destroy();
        }
    }

    private _getTextNode(): Node {
        if (this._textPool.length > 0) {
            const node = this._textPool.pop()!;
            node.active = true;
            return node;
        }
        const node = new Node('EmojiText');
        const label = node.addComponent(Label);
        label.fontSize = 28;
        label.lineHeight = 32;
        label.color = new Color(255, 255, 255, 255);
        node.addComponent(UIOpacity);
        return node;
    }

    private _recycleTextNode(node: Node): void {
        if (!node.isValid) return;
        node.removeFromParent();
        node.active = false;
        if (this._textPool.length < POOL_MAX) {
            this._textPool.push(node);
        } else {
            node.destroy();
        }
    }

    // ── 清理 ────────────────────────────────────────────────

    /** 停止所有正在播放的表情和文字 */
    stopAll(): void {
        for (const targetNode of [...this._activeSpines.keys()]) {
            this._stopSpine(targetNode);
        }
        for (const targetNode of [...this._activeTexts.keys()]) {
            this._stopText(targetNode);
        }
    }

    /** 销毁对象池（退出游戏时调用） */
    destroy(): void {
        this.stopAll();
        for (const n of this._spinePool) n.destroy();
        for (const n of this._textPool) n.destroy();
        this._spinePool.length = 0;
        this._textPool.length = 0;
    }
}
