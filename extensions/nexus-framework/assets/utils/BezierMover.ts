import { Node, Vec3, tween, Tween, math, UIOpacity } from 'cc';

/**
 * 旋转模式
 */
enum BezierRotateMode {
    /** 线性插值到终点角度（从 startAngle 到 endAngle） */
    LERP = 'lerp',
    /** 持续自旋N圈 */
    SPIN = 'spin',
    /** 沿曲线切线方向自动朝向（2D） */
    ALONG_PATH = 'alongPath',
    /** 翻牌效果（绕Y轴翻转） */
    FLIP = 'flip',
    /** 左右摇摆 */
    WOBBLE = 'wobble',
    /** 自定义：通过 customCurve 函数控制角度 */
    CUSTOM = 'custom',
}

/**
 * 旋转配置
 */
interface BezierRotateConfig {
    /** 旋转模式，默认 LERP */
    mode?: BezierRotateMode;
    /** 旋转轴: 'x' | 'y' | 'z'，默认 'z' */
    axis?: 'x' | 'y' | 'z';

    // --- LERP 模式参数 ---
    /** 终点角度（度），LERP 模式使用 */
    endAngle?: number;

    // --- SPIN 模式参数 ---
    /** 旋转圈数，正值=顺时针，负值=逆时针，默认 1 */
    spinTurns?: number;

    // --- WOBBLE 模式参数 ---
    /** 摇摆幅度（度），默认 15 */
    wobbleAmplitude?: number;
    /** 摇摆频率（完整周期数），默认 3 */
    wobbleFrequency?: number;

    // --- FLIP 模式参数 ---
    /** 翻转角度（度），默认 180（完整翻转） */
    flipAngle?: number;

    // --- ALONG_PATH 模式参数 ---
    /** 角度偏移（度），在切线方向基础上额外旋转，默认 0 */
    angleOffset?: number;

    // --- CUSTOM 模式参数 ---
    /** 自定义旋转曲线函数，参数 ratio(0~1)，返回当前角度（度） */
    customCurve?: (ratio: number) => number;
}

/**
 * 贝塞尔曲线运动配置
 */
interface BezierMoveOptions {
    /** 动画时长（秒），默认 0.3 */
    duration?: number;
    /** 缓动类型，默认 'sineOut' */
    easing?: string;
    /** 控制点数组（本地坐标），不传则自动生成 */
    controlPoints?: Vec3[];
    /** 自动生成控制点时的弧线高度（正值向上，负值向下），默认 150 */
    arcHeight?: number;
    /** 终点缩放，默认不变（null = 保持当前缩放） */
    endScale?: Vec3 | null;
    /**
     * 旋转配置
     * - 传 BezierRotateConfig 对象使用高级旋转
     * - 传 number 等同于 { mode: 'lerp', endAngle: number }（向后兼容）
     * - 不传或 null = 不旋转
     */
    rotation?: BezierRotateConfig | number | null;
    /** 终点透明度 0-255，默认不变（null = 保持当前透明度） */
    endOpacity?: number | null;
    /** 动画更新回调，参数为当前进度 0~1 */
    onUpdate?: (ratio: number) => void;
    /** 动画完成回调 */
    onComplete?: () => void;
    /** 动画延迟开始时间（秒），默认 0 */
    delay?: number;
}

/**
 * 贝塞尔曲线预设弧线类型
 */
enum BezierArcType {
    /** 向上弧线（默认） */
    ARC_UP = 'arcUp',
    /** 向下弧线 */
    ARC_DOWN = 'arcDown',
    /** 向左弧线 */
    ARC_LEFT = 'arcLeft',
    /** 向右弧线 */
    ARC_RIGHT = 'arcRight',
    /** S形曲线 */
    S_CURVE = 'sCurve',
    /** 抛物线（先快后慢） */
    THROW = 'throw',
    /** 回弹轨迹（overshoot） */
    OVERSHOOT = 'overshoot',
}

/**
 * BezierMover - Cocos Creator 通用贝塞尔曲线运动工具
 * 
 * 支持功能：
 * - 二阶/三阶/N阶贝塞尔曲线
 * - 自动生成控制点 或 手动指定控制点
 * - 位移 + 缩放 + 旋转 + 透明度 同步动画
 * - 丰富的旋转模式：LERP / SPIN / ALONG_PATH / FLIP / WOBBLE / CUSTOM
 * - 多种预设弧线类型
 * - Promise / Callback 双模式
 * - 链式串联多段动画
 * 
 * @example
 * // 基础用法
 * BezierMover.moveTo(card, targetPos);
 * 
 * // 带旋转
 * BezierMover.moveTo(card, targetPos, {
 *     arcHeight: 200,
 *     rotation: { mode: BezierRotateMode.SPIN, spinTurns: 2 }
 * });
 * 
 * // Promise
 * await BezierMover.moveToAsync(card, targetPos, { arcHeight: 200 });
 * 
 * // 预设弧线
 * BezierMover.moveWithArc(card, targetPos, BezierArcType.THROW);
 */
class BezierMover {

    // ==================== 贝塞尔曲线数学核心 ====================

    /**
     * 二阶贝塞尔曲线（1个控制点）
     * B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
     */
    public static quadratic(t: number, p0: Vec3, p1: Vec3, p2: Vec3, out: Vec3): Vec3 {
        const mt = 1 - t;
        out.x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
        out.y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
        out.z = mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z;
        return out;
    }

    /**
     * 三阶贝塞尔曲线（2个控制点）
     * B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
     */
    public static cubic(t: number, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, out: Vec3): Vec3 {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        const a = mt2 * mt;
        const b = 3 * mt2 * t;
        const c = 3 * mt * t2;
        const d = t2 * t;

        out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
        out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
        out.z = a * p0.z + b * p1.z + c * p2.z + d * p3.z;
        return out;
    }

    /**
     * N阶贝塞尔曲线（任意数量控制点）
     * 使用 de Casteljau 算法递归求值
     * @param t      进度 0~1
     * @param points 所有点（起点 + 控制点 + 终点）
     * @param out    输出向量
     */
    public static nOrder(t: number, points: Vec3[], out: Vec3): Vec3 {
        const n = points.length;
        if (n === 1) {
            out.set(points[0]);
            return out;
        }

        // de Casteljau 递推
        let current = points.map(p => p.clone());
        for (let r = 1; r < n; r++) {
            for (let i = 0; i < n - r; i++) {
                current[i].x = (1 - t) * current[i].x + t * current[i + 1].x;
                current[i].y = (1 - t) * current[i].y + t * current[i + 1].y;
                current[i].z = (1 - t) * current[i].z + t * current[i + 1].z;
            }
        }

        out.set(current[0]);
        return out;
    }

    /**
     * 根据点的数量自动选择最优贝塞尔算法
     * @param t         进度 0~1
     * @param allPoints 所有点（起点 + 控制点 + 终点）
     * @param out       输出向量
     */
    private static evaluate(t: number, allPoints: Vec3[], out: Vec3): Vec3 {
        switch (allPoints.length) {
            case 3:
                return this.quadratic(t, allPoints[0], allPoints[1], allPoints[2], out);
            case 4:
                return this.cubic(t, allPoints[0], allPoints[1], allPoints[2], allPoints[3], out);
            default:
                return this.nOrder(t, allPoints, out);
        }
    }

    // ==================== 控制点生成 ====================

    /**
     * 自动生成三阶贝塞尔的两个控制点
     * @param startPos  起点
     * @param endPos    终点
     * @param arcHeight 弧线高度（正=上，负=下）
     * @returns [cp1, cp2]
     */
    private static autoControlPoints(startPos: Vec3, endPos: Vec3, arcHeight: number): Vec3[] {
        const midY = (startPos.y + endPos.y) / 2;
        const cp1 = new Vec3(
            startPos.x + (endPos.x - startPos.x) * 0.25,
            midY + arcHeight,
            startPos.z + (endPos.z - startPos.z) * 0.25
        );
        const cp2 = new Vec3(
            startPos.x + (endPos.x - startPos.x) * 0.75,
            midY + arcHeight * 0.8,
            startPos.z + (endPos.z - startPos.z) * 0.75
        );
        return [cp1, cp2];
    }

    /**
     * 根据预设弧线类型生成控制点
     */
    private static arcTypeToControlPoints(startPos: Vec3, endPos: Vec3, arcType: BezierArcType): Vec3[] {
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (startPos.x + endPos.x) / 2;
        const midY = (startPos.y + endPos.y) / 2;
        const h = dist * 0.4;

        switch (arcType) {
            case BezierArcType.ARC_UP:
                return this.autoControlPoints(startPos, endPos, h);

            case BezierArcType.ARC_DOWN:
                return this.autoControlPoints(startPos, endPos, -h);

            case BezierArcType.ARC_LEFT:
                return [
                    new Vec3(midX - h, startPos.y + dy * 0.25, 0),
                    new Vec3(midX - h * 0.8, startPos.y + dy * 0.75, 0)
                ];

            case BezierArcType.ARC_RIGHT:
                return [
                    new Vec3(midX + h, startPos.y + dy * 0.25, 0),
                    new Vec3(midX + h * 0.8, startPos.y + dy * 0.75, 0)
                ];

            case BezierArcType.S_CURVE:
                return [
                    new Vec3(startPos.x + dx * 0.25, startPos.y + h, 0),
                    new Vec3(startPos.x + dx * 0.75, endPos.y - h, 0)
                ];

            case BezierArcType.THROW:
                // 抛物线：控制点偏向起点上方
                return [
                    new Vec3(startPos.x + dx * 0.15, startPos.y + h * 1.2, 0),
                    new Vec3(startPos.x + dx * 0.5, startPos.y + h * 0.8, 0)
                ];

            case BezierArcType.OVERSHOOT:
                // 回弹：终点方向延伸后折返
                const overshoot = 0.15;
                return [
                    new Vec3(midX, midY + h, 0),
                    new Vec3(endPos.x + dx * overshoot, endPos.y + dy * overshoot, 0)
                ];

            default:
                return this.autoControlPoints(startPos, endPos, h);
        }
    }

    // ==================== 旋转计算 ====================

    /**
     * 标准化旋转配置（兼容 number 写法）
     */
    private static normalizeRotation(rotation: BezierRotateConfig | number | null | undefined): BezierRotateConfig | null {
        if (rotation === null || rotation === undefined) return null;
        if (typeof rotation === 'number') {
            return { mode: BezierRotateMode.LERP, endAngle: rotation, axis: 'z' };
        }
        return { axis: 'z', ...rotation };
    }

    /**
     * 计算贝塞尔曲线在 t 处的切线方向角度（2D，度）
     */
    private static getTangentAngle(t: number, allPoints: Vec3[]): number {
        const delta = 0.001;
        const t0 = Math.max(0, t - delta);
        const t1 = Math.min(1, t + delta);
        const p0 = new Vec3();
        const p1 = new Vec3();
        this.evaluate(t0, allPoints, p0);
        this.evaluate(t1, allPoints, p1);
        return math.toDegree(Math.atan2(p1.y - p0.y, p1.x - p0.x));
    }

    /**
     * 根据旋转配置计算当前角度
     * @param ratio      当前进度 0~1
     * @param startAngle 起始角度（度）
     * @param config     旋转配置
     * @param allPoints  贝塞尔曲线所有点（ALONG_PATH 模式需要）
     * @returns 当前角度（度）
     */
    private static calculateRotationAngle(
        ratio: number,
        startAngle: number,
        config: BezierRotateConfig,
        allPoints: Vec3[]
    ): number {
        const mode = config.mode ?? BezierRotateMode.LERP;

        switch (mode) {
            case BezierRotateMode.LERP: {
                const endAngle = config.endAngle ?? startAngle;
                return startAngle + (endAngle - startAngle) * ratio;
            }

            case BezierRotateMode.SPIN: {
                const turns = config.spinTurns ?? 1;
                return startAngle + 360 * turns * ratio;
            }

            case BezierRotateMode.ALONG_PATH: {
                const tangentAngle = this.getTangentAngle(ratio, allPoints);
                const offset = config.angleOffset ?? 0;
                return tangentAngle + offset;
            }

            case BezierRotateMode.FLIP: {
                const flipAngle = config.flipAngle ?? 180;
                // 使用 smoothstep 让翻转更自然：中间快两头慢
                const t = ratio;
                const smooth = t * t * (3 - 2 * t);
                return startAngle + flipAngle * smooth;
            }

            case BezierRotateMode.WOBBLE: {
                const amplitude = config.wobbleAmplitude ?? 15;
                const frequency = config.wobbleFrequency ?? 3;
                // 摇摆 + 衰减（越到终点越小）
                const decay = 1 - ratio;
                return startAngle + amplitude * Math.sin(ratio * frequency * Math.PI * 2) * decay;
            }

            case BezierRotateMode.CUSTOM: {
                if (config.customCurve) {
                    return config.customCurve(ratio);
                }
                return startAngle;
            }

            default:
                return startAngle;
        }
    }

    /**
     * 获取指定轴的起始角度
     */
    private static getAxisAngle(node: Node, axis: string): number {
        const euler = node.eulerAngles;
        switch (axis) {
            case 'x': return euler.x;
            case 'y': return euler.y;
            case 'z': return euler.z;
            default: return euler.z;
        }
    }

    /**
     * 设置指定轴的角度
     */
    private static setAxisAngle(node: Node, axis: string, angle: number): void {
        const euler = node.eulerAngles;
        switch (axis) {
            case 'x': node.setRotationFromEuler(angle, euler.y, euler.z); break;
            case 'y': node.setRotationFromEuler(euler.x, angle, euler.z); break;
            case 'z': node.setRotationFromEuler(euler.x, euler.y, angle); break;
        }
    }

    /**
     * 获取旋转的最终角度（用于结束时精确设值）
     */
    private static getFinalAngle(startAngle: number, config: BezierRotateConfig): number {
        const mode = config.mode ?? BezierRotateMode.LERP;
        switch (mode) {
            case BezierRotateMode.LERP:
                return config.endAngle ?? startAngle;
            case BezierRotateMode.SPIN:
                return startAngle + 360 * (config.spinTurns ?? 1);
            case BezierRotateMode.FLIP:
                return startAngle + (config.flipAngle ?? 180);
            case BezierRotateMode.WOBBLE:
                return startAngle; // 摇摆结束回到原位
            case BezierRotateMode.CUSTOM:
                return config.customCurve ? config.customCurve(1) : startAngle;
            case BezierRotateMode.ALONG_PATH:
                return startAngle; // 由路径决定，不做精确修正
            default:
                return startAngle;
        }
    }

    // ==================== 核心运动方法 ====================

    /**
     * 贝塞尔曲线移动（主方法）
     * @param node    目标节点
     * @param endPos  终点坐标（本地坐标）
     * @param options 动画配置
     * @returns Tween 实例（可用于 stop）
     */
    public static moveTo(node: Node, endPos: Vec3, options?: BezierMoveOptions): Tween<{ ratio: number }> {
        const opts = {
            duration: 0.3,
            easing: 'sineOut',
            arcHeight: 150,
            delay: 0,
            ...options
        };

        const startPos = node.position.clone();
        const startScale = node.scale.clone();
        const startOpacity = node.getComponent(UIOpacity)?.opacity ?? 255;

        const finalScale = opts.endScale ?? null;
        const finalOpacity = opts.endOpacity ?? null;

        // 旋转配置
        const rotateConfig = this.normalizeRotation(opts.rotation);
        const rotateAxis = rotateConfig?.axis ?? 'z';
        const startAngle = rotateConfig ? this.getAxisAngle(node, rotateAxis) : 0;

        // 构建所有点：起点 + 控制点 + 终点
        let controlPoints: Vec3[];
        if (opts.controlPoints && opts.controlPoints.length > 0) {
            controlPoints = opts.controlPoints;
        } else {
            controlPoints = this.autoControlPoints(startPos, endPos, opts.arcHeight!);
        }
        const allPoints = [startPos, ...controlPoints, endPos];

        // 缓存对象，避免每帧 GC
        const tempPos = new Vec3();
        const tempScale = new Vec3();
        const proxy = { ratio: 0 };

        let tw = tween(proxy);

        // 延迟
        if (opts.delay! > 0) {
            tw = tw.delay(opts.delay!);
        }

        tw = tw.to(opts.duration!, { ratio: 1 }, {
            easing: opts.easing as any,
            onUpdate: (target: { ratio: number }) => {
                // 切后台后节点可能已被销毁，避免对无效节点操作导致崩溃
                if (!node?.isValid) {
                    Tween.stopAllByTarget(proxy);
                    return;
                }
                const r = target.ratio;

                // 位置：贝塞尔插值
                BezierMover.evaluate(r, allPoints, tempPos);
                node.setPosition(tempPos);

                // 缩放
                if (finalScale) {
                    Vec3.lerp(tempScale, startScale, finalScale, r);
                    node.setScale(tempScale);
                }

                // 旋转
                if (rotateConfig) {
                    const angle = BezierMover.calculateRotationAngle(r, startAngle, rotateConfig, allPoints);
                    BezierMover.setAxisAngle(node, rotateAxis, angle);
                }

                // 透明度
                if (finalOpacity !== null) {
                    const uiOpacity = node.getComponent('cc.UIOpacity');
                    if (uiOpacity) {
                        (uiOpacity as any).opacity = startOpacity + (finalOpacity - startOpacity) * r;
                    }
                }

                // 用户自定义更新
                opts.onUpdate?.(r);
            }
        })
        .call(() => {
            // 切后台后节点可能已被销毁，避免对无效节点操作导致崩溃
            if (!node?.isValid) {
                opts.onComplete?.();
                return;
            }
            // 确保终态精确
            node.setPosition(endPos);
            if (finalScale) node.setScale(finalScale);
            if (rotateConfig) {
                const finalAngle = BezierMover.getFinalAngle(startAngle, rotateConfig);
                BezierMover.setAxisAngle(node, rotateAxis, finalAngle);
            }
            if (finalOpacity !== null) {
                const uiOpacity = node.getComponent('cc.UIOpacity');
                if (uiOpacity) (uiOpacity as any).opacity = finalOpacity;
            }
            opts.onComplete?.();
        });

        tw.start();
        return tw;
    }

    // ==================== 便捷方法 ====================

    /**
     * Promise 版本 — 支持 async/await
     * @example await BezierMover.moveToAsync(card, targetPos, { arcHeight: 200 });
     */
    public static moveToAsync(node: Node, endPos: Vec3, options?: BezierMoveOptions): Promise<void> {
        return new Promise((resolve) => {
            this.moveTo(node, endPos, {
                ...options,
                onComplete: () => {
                    options?.onComplete?.();
                    resolve();
                }
            });
        });
    }

    /**
     * 预设弧线类型快捷方法
     * @param node    目标节点
     * @param endPos  终点坐标
     * @param arcType 弧线预设类型
     * @param options 其他配置（controlPoints 会被覆盖）
     */
    public static moveWithArc(
        node: Node,
        endPos: Vec3,
        arcType: BezierArcType,
        options?: Omit<BezierMoveOptions, 'controlPoints' | 'arcHeight'>
    ): Tween<{ ratio: number }> {
        const startPos = node.position.clone();
        const controlPoints = this.arcTypeToControlPoints(startPos, endPos, arcType);
        return this.moveTo(node, endPos, { ...options, controlPoints });
    }

    /**
     * 预设弧线类型 Promise 版本
     */
    public static moveWithArcAsync(
        node: Node,
        endPos: Vec3,
        arcType: BezierArcType,
        options?: Omit<BezierMoveOptions, 'controlPoints' | 'arcHeight'>
    ): Promise<void> {
        return new Promise((resolve) => {
            this.moveWithArc(node, endPos, arcType, {
                ...options,
                onComplete: () => {
                    options?.onComplete?.();
                    resolve();
                }
            });
        });
    }

    /**
     * 串联多段贝塞尔动画
     * @param node   目标节点
     * @param steps  动画步骤数组
     * @param onAllComplete 全部完成回调
     * 
     * @example
     * BezierMover.sequence(card, [
     *     { endPos: midPos, options: { arcHeight: 200, duration: 0.2 } },
     *     { endPos: finalPos, options: { arcHeight: -100, duration: 0.3 } }
     * ], () => console.log('全部完成'));
     */
    public static sequence(
        node: Node,
        steps: Array<{ endPos: Vec3; options?: BezierMoveOptions }>,
        onAllComplete?: () => void
    ): void {
        if (steps.length === 0) {
            onAllComplete?.();
            return;
        }

        let index = 0;
        const runNext = () => {
            if (index >= steps.length) {
                onAllComplete?.();
                return;
            }
            const step = steps[index++];
            this.moveTo(node, step.endPos, {
                ...step.options,
                onComplete: () => {
                    step.options?.onComplete?.();
                    runNext();
                }
            });
        };

        runNext();
    }

    /**
     * 串联多段动画 Promise 版本
     */
    public static async sequenceAsync(
        node: Node,
        steps: Array<{ endPos: Vec3; options?: BezierMoveOptions }>
    ): Promise<void> {
        for (const step of steps) {
            await this.moveToAsync(node, step.endPos, step.options);
        }
    }

    /**
     * 多节点同时执行贝塞尔动画
     * @param configs 节点配置数组
     * @param onAllComplete 全部完成回调
     */
    public static parallel(
        configs: Array<{ node: Node; endPos: Vec3; options?: BezierMoveOptions }>,
        onAllComplete?: () => void
    ): void {
        if (configs.length === 0) {
            onAllComplete?.();
            return;
        }

        let completedCount = 0;
        const total = configs.length;

        for (const config of configs) {
            this.moveTo(config.node, config.endPos, {
                ...config.options,
                onComplete: () => {
                    config.options?.onComplete?.();
                    completedCount++;
                    if (completedCount >= total) {
                        onAllComplete?.();
                    }
                }
            });
        }
    }

    /**
     * 多节点同时执行 Promise 版本
     */
    public static parallelAsync(
        configs: Array<{ node: Node; endPos: Vec3; options?: BezierMoveOptions }>
    ): Promise<void> {
        const promises = configs.map(config =>
            this.moveToAsync(config.node, config.endPos, config.options)
        );
        return Promise.all(promises).then(() => { });
    }

    // ==================== 工具方法 ====================

    /**
     * 获取贝塞尔曲线上的采样点（用于调试绘制路径）
     * @param startPos      起点
     * @param endPos        终点
     * @param controlPoints 控制点
     * @param segments      采样数量，默认 20
     * @returns 采样点数组
     */
    public static getSamplePoints(
        startPos: Vec3,
        endPos: Vec3,
        controlPoints: Vec3[],
        segments: number = 20
    ): Vec3[] {
        const allPoints = [startPos, ...controlPoints, endPos];
        const points: Vec3[] = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const p = new Vec3();
            this.evaluate(t, allPoints, p);
            points.push(p);
        }
        return points;
    }

    /**
     * 估算贝塞尔曲线长度（采样近似）
     */
    public static estimateLength(
        startPos: Vec3,
        endPos: Vec3,
        controlPoints: Vec3[],
        segments: number = 50
    ): number {
        const points = this.getSamplePoints(startPos, endPos, controlPoints, segments);
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            length += Vec3.distance(points[i - 1], points[i]);
        }
        return length;
    }
}

export { BezierMover, BezierArcType, BezierRotateMode };
export type { BezierMoveOptions, BezierRotateConfig };
