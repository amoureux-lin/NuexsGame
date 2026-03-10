/**
 * 数学与数值工具。
 */

/** 将数值限制在 [min, max] 范围内。 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** 将数值限制在 [0, 1] 范围内。 */
export function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

/** 线性插值：t 在 [0,1] 时返回 a 到 b 的插值。 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp01(t);
}

/** 在 [min, max] 内取随机整数（含 min、含 max）。 */
export function randomInt(min: number, max: number): number {
    min = Math.floor(min);
    max = Math.floor(max);
    return min + Math.floor(Math.random() * (max - min + 1));
}

/** 在 [min, max) 内取随机小数。 */
export function randomFloat(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/** 从数组中随机取一个元素。 */
export function randomPick<T>(arr: T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[randomInt(0, arr.length - 1)];
}

/** 保留小数位数（不四舍五入，直接截断）。 */
export function toFixed(value: number, digits: number): number {
    const k = 10 ** digits;
    return Math.floor(value * k) / k;
}

/** 将数值映射到另一区间 [outMin, outMax]。 */
export function mapRange(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
): number {
    const t = (value - inMin) / (inMax - inMin || 1);
    return outMin + t * (outMax - outMin);
}
