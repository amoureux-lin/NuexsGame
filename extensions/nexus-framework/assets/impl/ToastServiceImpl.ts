import { Color, Graphics, Label, Node, tween, UIOpacity, UITransform, v3 } from 'cc';
import { Nexus } from '../core/Nexus';
import { IToastService, IUIService, ToastType, UILayer } from '../services/contracts';

/** 各类型 toast 背景颜色 [r, g, b, a] */
const BG_COLORS: Record<ToastType, [number, number, number, number]> = {
    info:    [30,  30,  30,  220],
    success: [20,  110, 50,  220],
    error:   [160, 30,  30,  220],
    warn:    [150, 90,  0,   220],
};

interface ToastItem {
    message: string;
    type: ToastType;
    duration: number;
}

/**
 * Toast 全局提示服务。
 *
 * - 消息队列：同时只显示一条，后续消息排队等待
 * - 动态节点：不依赖 prefab，纯代码创建 Label + 背景
 * - 挂载在 UILayer.TOP 层，显示于所有面板之上
 *
 * 用法：
 *   Nexus.toast.show('操作成功');
 *   Nexus.toast.error('网络异常，请重试');
 *   Nexus.toast.success('准备完成', 1500);
 */
export class ToastServiceImpl extends IToastService {
    private readonly _queue: ToastItem[] = [];
    private _processing = false;

    show(msg: string, duration = 2000): void {
        this._push('info', msg, duration);
    }

    success(msg: string, duration = 2000): void {
        this._push('success', msg, duration);
    }

    error(msg: string, duration = 3000): void {
        this._push('error', msg, duration);
    }

    warn(msg: string, duration = 2500): void {
        this._push('warn', msg, duration);
    }

    private _push(type: ToastType, message: string, duration: number): void {
        this._queue.push({ message, type, duration });
        if (!this._processing) {
            this._next();
        }
    }

    private _next(): void {
        if (this._queue.length === 0) {
            this._processing = false;
            return;
        }
        this._processing = true;
        const item = this._queue.shift()!;
        this._render(item).then(() => this._next());
    }

    private _render(item: ToastItem): Promise<void> {
        return new Promise<void>((resolve) => {
            // 获取 TOP 层容器
            let container: Node | null = null;
            try {
                container = Nexus.ui.getLayerNode(UILayer.TOP);
            } catch {
                // UIService 未就绪时直接跳过
                resolve();
                return;
            }

            const [r, g, b, a] = BG_COLORS[item.type];
            const W = 560, H = 76, RADIUS = 16;

            // ── 根节点 ──────────────────────────────────────────────
            const root = new Node('__Toast__');
            const tf = root.addComponent(UITransform);
            tf.setContentSize(W, H);
            const opacity = root.addComponent(UIOpacity);
            opacity.opacity = 0;
            root.setPosition(v3(0, 300, 0));
            container.addChild(root);

            // ── 背景（Graphics 画圆角矩形） ──────────────────────────
            const bgNode = new Node('bg');
            bgNode.addComponent(UITransform).setContentSize(W, H);
            const gfx = bgNode.addComponent(Graphics);
            gfx.fillColor = new Color(r, g, b, a);
            gfx.roundRect(-W / 2, -H / 2, W, H, RADIUS);
            gfx.fill();
            root.addChild(bgNode);

            // ── 文字 ────────────────────────────────────────────────
            const labelNode = new Node('label');
            labelNode.addComponent(UITransform).setContentSize(W - 40, H);
            const label = labelNode.addComponent(Label);
            label.string = item.message;
            label.fontSize = 28;
            label.lineHeight = 36;
            label.color = new Color(255, 255, 255, 255);
            label.overflow = Label.Overflow.CLAMP;
            root.addChild(labelNode);

            // ── 动画：淡入 → 停留 → 淡出 → 销毁 ────────────────────
            tween(opacity)
                .to(0.2, { opacity: 255 })
                .delay(item.duration / 1000)
                .to(0.25, { opacity: 0 })
                .call(() => {
                    if (root.isValid) root.destroy();
                    resolve();
                })
                .start();
        });
    }

    async onDestroy(): Promise<void> {
        this._queue.length = 0;
        this._processing = false;
    }
}
