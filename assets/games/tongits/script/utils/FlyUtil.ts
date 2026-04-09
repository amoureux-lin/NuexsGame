import { Node, Vec3, tween, Tween, TweenEasing } from 'cc';

// ─────────────────────────────────────────────────────────────
//  FlyUtil — 弧形飞行动画工具
//
//  只负责动画逻辑，不关心节点内容。
//  调用方负责：
//    1. 将节点挂到合适的父节点（建议挂在 Canvas 根节点下避免父变换干扰）
//    2. 飞行结束后的节点归属（销毁 / 归还容器）
// ─────────────────────────────────────────────────────────────

export interface FlyArcOptions {
    /**
     * 飞行时长（秒）
     * @default 0.4
     */
    duration?: number;

    /**
     * 弧高（世界坐标单位）。
     * 值越大弧度越大；负值可将弧弯向相反方向。
     * @default 120
     */
    arcHeight?: number;

    /**
     * 自定义弧形偏移方向（世界空间向量，内部自动归一化）。
     * 省略时自动计算：取飞行方向的垂直向量，并偏向 Y 轴正方向（向上）。
     * 示例：new Vec3(0, 1, 0) → 始终向上弯；new Vec3(1, 0, 0) → 向右弯
     */
    arcDir?: Vec3;

    /**
     * 飞行过程中绕 Z 轴旋转的圈数（取绝对值）。
     * 0 = 不旋转；1 = 转一圈。
     * 方向自动判断：目标点在右侧 → 顺时针，在左侧 → 逆时针。
     * @default 0
     */
    rotate?: number;

    /**
     * tween easing 名称（Cocos Creator 内置缓动名）。
     * @default 'quadOut'
     */
    easing?: TweenEasing;

    /**
     * 飞行完成后的回调（在节点到达终点后触发）。
     */
    onComplete?: () => void;
}

export class FlyUtil {

    /**
     * 让 `node` 沿弧形路径从 `from` 飞到 `to`（世界坐标）。
     *
     * @param node    要飞行的节点（调用前请确保已挂载到场景）
     * @param from    起点世界坐标
     * @param to      终点世界坐标
     * @param options 飞行参数（见 FlyArcOptions）
     * @returns       tween 实例，可在外部调用 `.stop()` 中断
     *
     * @example
     * // 摸牌：从牌堆飞到手牌目标位
     * FlyUtil.fly(cardNode, deckWorldPos, handTargetWorldPos, {
     *     duration: 0.35,
     *     arcHeight: 100,
     *     rotate: 1,
     *     onComplete: () => { cardNode.destroy(); handCardPanel.finalizeAddCard(); }
     * });
     */
    static fly(node: Node, from: Vec3, to: Vec3, options?: FlyArcOptions): Tween<Node> {

        const {
            duration  = 0.4,
            arcHeight = 120,
            arcDir,
            rotate    = 0,
            easing    = 'quadOut',
            onComplete,
        } = options ?? {};

        // ── 计算二次贝塞尔控制点 ────────────────────────────
        const midX = (from.x + to.x) * 0.5;
        const midY = (from.y + to.y) * 0.5;

        let perpX: number;
        let perpY: number;

        if (arcDir) {
            // 用户指定方向
            const len = Math.sqrt(arcDir.x * arcDir.x + arcDir.y * arcDir.y) || 1;
            perpX = arcDir.x / len;
            perpY = arcDir.y / len;
        } else {
            // 自动：取飞行方向的 CCW 90° 垂直向量，确保朝上偏
            const dx  = to.x - from.x;
            const dy  = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            perpX = -dy / len;   // CCW 垂直
            perpY =  dx / len;
            // 若垂直向量 Y 分量为负（朝下），翻转为朝上
            if (perpY < 0) { perpX = -perpX; perpY = -perpY; }
        }

        const ctrlX = midX + perpX * arcHeight;
        const ctrlY = midY + perpY * arcHeight;

        // ── 旋转方向：目标在右 → 顺时针（Z 负），在左 → 逆时针（Z 正）──
        // CC3.x UI 节点：eulerAngles.z 增大 = 逆时针，减小 = 顺时针
        const spinSign = (to.x >= from.x) ? -1 : 1;

        // ── 初始位置 ─────────────────────────────────────────
        node.setWorldPosition(from);

        // ── tween 动画 ───────────────────────────────────────
        return tween(node)
            .to(duration, {}, {
                easing,
                onUpdate: (target: Node, ratio: number) => {
                    const inv = 1 - ratio;

                    // 二次贝塞尔位置
                    const x = inv * inv * from.x + 2 * inv * ratio * ctrlX + ratio * ratio * to.x;
                    const y = inv * inv * from.y + 2 * inv * ratio * ctrlY + ratio * ratio * to.y;
                    target.setWorldPosition(x, y, 0);

                    // 旋转（Z 轴）：切线朝向 + 自动方向的累计圈数
                    if (rotate !== 0) {
                        // B'(t) = 2(1-t)(ctrl - from) + 2t(to - ctrl)
                        const tx = 2 * inv * (ctrlX - from.x) + 2 * ratio * (to.x - ctrlX);
                        const ty = 2 * inv * (ctrlY - from.y) + 2 * ratio * (to.y - ctrlY);
                        const tangentDeg = Math.atan2(ty, tx) * (180 / Math.PI);
                        const spinDeg    = spinSign * Math.abs(rotate) * 360 * ratio;
                        target.eulerAngles = new Vec3(0, 0, tangentDeg + spinDeg);
                    }
                },
            })
            .call(() => onComplete?.())
            .start();
    }
}
