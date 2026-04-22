import { Node, Prefab, Tween, tween, UIOpacity, UITransform, v3 } from 'cc';
import type { SpriteFrame } from 'cc';
import { Nexus } from '../core/Nexus';
import {
    IToastService,
    ToastConfig,
    ToastPosition,
    ToastShowOptions,
    ToastType,
    UILayer,
} from '../services/contracts';
import { ToastItem } from '../base/ToastItem';

const POOL_KEY = '__nexus_toast__';

const DEFAULT_DURATION: Record<ToastType, number> = {
    info:    2000,
    success: 2000,
    error:   3000,
    warn:    2500,
};

const DEFAULT_POSITION_Y: Record<ToastPosition, number> = {
    top:    380,
    center: 0,
    bottom: -380,
};

/** 淡入时长（s） */
const FADE_IN  = 0.15;
/** 淡出 + 飘移时长（s） */
const FADE_OUT = 0.35;
/** 向上飘移距离（px） */
const DRIFT_PX = 60;
/** 加速淡出时长（s），限流时使用 */
const FAST_OUT = 0.15;
/** 堆叠间距（px），加在两条 toast 实际高度之间 */
const STACK_GAP = 10;

interface ActiveEntry {
    node: Node;
    message: string;
    position: ToastPosition;
    /** 所有正在运行的 tween，reclaim 时统一 stop */
    tweens: Tween<unknown>[];
    /** 防止重复回收的标志 */
    done: boolean;
}

/**
 * Toast 全局提示服务。
 *
 * 特性：
 * - 并发堆叠：多条 toast 同时显示，按 position 分组垂直排列
 * - 去重：相同消息已在显示中时跳过（跨所有 position）
 * - 限流：超过 maxCount 时加速淡出最旧的一条
 * - 对象池：节点复用，避免反复 instantiate / destroy
 * - 动画：淡入 → 停留 → 向上飘移 + 淡出
 *
 * 用法：
 *   // 启动时
 *   Nexus.toast.setPrefab(notifyPrefab);
 *   Nexus.toast.configure({ maxCount: 4, positionY: { top: 420 } });
 *
 *   // 业务代码
 *   Nexus.toast.show('操作成功');
 *   Nexus.toast.error('网络异常', { duration: 4000 });
 *   Nexus.toast.success('准备完成', { position: 'bottom', icon: starFrame });
 */
export class ToastServiceImpl extends IToastService {
    private _prefab: Prefab | null = null;
    private _maxCount = 5;
    private _positionY: Record<ToastPosition, number> = { ...DEFAULT_POSITION_Y };
    private _active: ActiveEntry[] = [];

    // ── 公开 API ─────────────────────────────────────────────────────────────

    setPrefab(prefab: Prefab): void {
        this._prefab = prefab;
    }

    configure(config: ToastConfig): void {
        if (config.maxCount != null)  this._maxCount = config.maxCount;
        if (config.positionY)         Object.assign(this._positionY, config.positionY);
    }

    show(msg: string, options?: ToastShowOptions): void    { this._push('info',    msg, options); }
    success(msg: string, options?: ToastShowOptions): void { this._push('success', msg, options); }
    error(msg: string, options?: ToastShowOptions): void   { this._push('error',   msg, options); }
    warn(msg: string, options?: ToastShowOptions): void    { this._push('warn',    msg, options); }

    // ── 内部实现 ──────────────────────────────────────────────────────────────

    private _push(type: ToastType, message: string, options?: ToastShowOptions): void {
        if (!this._prefab) {
            console.warn('[Toast] No prefab set. Call Nexus.toast.setPrefab() before use.');
            return;
        }

        const position: ToastPosition = options?.position ?? 'top';
        const duration  = options?.duration ?? DEFAULT_DURATION[type];
        const icon: SpriteFrame | null = options?.icon ?? null;

        // 去重：相同消息已在任意位置显示中，跳过
        if (this._active.some(e => e.message === message)) return;

        // 限流：超出最大数量时，加速淡出最旧的一条
        if (this._active.length >= this._maxCount) {
            this._fastOut(this._active[0]);
        }

        // 获取 TOP 层容器
        let container: Node | null = null;
        try {
            container = Nexus.ui.getLayerNode(UILayer.TOAST);
        } catch {
            return;
        }

        // 从对象池取节点（池空时自动 instantiate）
        const node = Nexus.pool.get(POOL_KEY, this._prefab)!;
        container.addChild(node);

        // 配置内容（调用游戏侧 ToastItem 子类实现）
        node.getComponent(ToastItem)?.setup(message, type, icon);

        // UIOpacity（prefab 根节点若未挂则自动添加）
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        opacity.opacity = 0;

        // 计算堆叠 Y 坐标（读取 Label 实际高度）
        const targetY = this._calcY(position, node);
        node.setPosition(v3(0, targetY, 0));

        const entry: ActiveEntry = { node, message, position, tweens: [], done: false };
        this._active.push(entry);

        // ── 动画时序 ────────────────────────────────────────────────────────
        // t=0          : opacity 0
        // t=FADE_IN    : opacity 255（淡入完成）
        // t=FADE_IN+dur: 开始向上飘移 + 淡出（同步启动）
        // t=+FADE_OUT  : 完成，回收到对象池

        const stayDelay = duration / 1000;
        const exitY     = targetY + DRIFT_PX;

        // 位置 tween：等待淡入 + 停留后向上漂移
        const tweenPos = tween(node)
            .delay(FADE_IN + stayDelay)
            .to(FADE_OUT, { position: v3(0, exitY, 0) })
            .start();

        // 透明度 tween：淡入 → 停留 → 淡出 → 回收
        const tweenOpa = tween(opacity)
            .to(FADE_IN, { opacity: 255 })
            .delay(stayDelay)
            .to(FADE_OUT, { opacity: 0 })
            .call(() => this._reclaim(entry))
            .start();

        entry.tweens.push(tweenPos as Tween<unknown>, tweenOpa as Tween<unknown>);
    }

    /**
     * 计算新 toast 在指定位置的 Y 坐标。
     * 读取节点 UITransform 的实际高度（Label RESIZE_HEIGHT 在 string 赋值后同步更新）。
     */
    private _calcY(position: ToastPosition, node: Node): number {
        const baseY = this._positionY[position];

        // 计算该 position 已有 toast 占用的总高度
        let usedHeight = 0;
        for (const e of this._active) {
            if (e.position !== position) continue;
            const h = e.node.getComponent(UITransform)?.contentSize.height ?? 0;
            usedHeight += h + STACK_GAP;
        }

        // top / center 向下堆叠（Y 递减），bottom 向上堆叠（Y 递增）
        return position === 'bottom'
            ? baseY + usedHeight
            : baseY - usedHeight;
    }

    /**
     * 加速淡出（限流时使用）：快速淡出后回收，不再向上漂移。
     */
    private _fastOut(entry: ActiveEntry): void {
        if (entry.done) return;

        // 停止原有 tween
        entry.tweens.forEach(t => t.stop());
        entry.tweens.length = 0;

        const opacity = entry.node.getComponent(UIOpacity);
        if (!opacity || !entry.node.isValid) {
            this._reclaim(entry);
            return;
        }

        const fastTween = tween(opacity)
            .to(FAST_OUT, { opacity: 0 })
            .call(() => this._reclaim(entry))
            .start();

        entry.tweens.push(fastTween as Tween<unknown>);
    }

    /** 停止所有 tween，将节点归还对象池。 */
    private _reclaim(entry: ActiveEntry): void {
        if (entry.done) return;
        entry.done = true;

        const idx = this._active.indexOf(entry);
        if (idx !== -1) this._active.splice(idx, 1);

        entry.tweens.forEach(t => t.stop());
        entry.tweens.length = 0;

        if (entry.node.isValid) {
            Nexus.pool.put(POOL_KEY, entry.node);
        }
    }

    async onDestroy(): Promise<void> {
        // 拷贝后遍历，避免 _reclaim 修改数组时产生问题
        [...this._active].forEach(e => this._reclaim(e));
    }
}
