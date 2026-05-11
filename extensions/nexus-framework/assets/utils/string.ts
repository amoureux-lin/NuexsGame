/**
 * 字符串工具。
 */

/**
 * 简单模板替换：将 str 中的 {key} 替换为 params[key]。
 * @example format('分数：{score}', { score: 100 }) // '分数：100'
 */
export function format(str: string, params?: Record<string, unknown>): string {
    if (!params) return str;
    let result = str;
    for (const key of Object.keys(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(params[key]));
    }
    return result;
}

/** 左侧补足到指定长度。 */
export function padStart(str: string, length: number, char = ' '): string {
    if (str.length >= length) return str;
    let prefix = '';
    for (let i = 0; i < length - str.length; i++) prefix += char;
    return prefix + str;
}

/** 右侧补足到指定长度。 */
export function padEnd(str: string, length: number, char = ' '): string {
    if (str.length >= length) return str;
    let suffix = '';
    for (let i = 0; i < length - str.length; i++) suffix += char;
    return str + suffix;
}

/** 将数字格式化为带千分位的字符串。 */
export function formatNumber(value: number, locale?: string): string {
    return value.toLocaleString(locale);
}

/**
 * 转英文单位计数。
 * @example numberToThousand(12345) // '12.35K'
 */
export function numberToThousand(value: number, fixed: number = 2): string {
    const k = 1000;
    const sizes = ['', 'K', 'M', 'B'];
    if (value < k) {
        return value.toString();
    }
    const i = Math.min(Math.floor(Math.log(value) / Math.log(k)), sizes.length - 1);
    const r = value / Math.pow(k, i);
    return r.toFixed(fixed) + sizes[i];
}

/**
 * 字符串按显示宽度截取，非 ASCII 字符按 2 个宽度计算。
 * @param str 字符串
 * @param n 截取长度
 * @param showdot 是否把截取的部分用省略号代替
 */
export function strSub(str: string, n: number, showdot: boolean = false): string {
    const r = /[^\x00-\xff]/g;
    if (str.replace(r, 'mm').length <= n) {
        return str;
    }
    const m = Math.floor(n / 2);
    for (let i = m; i < str.length; i++) {
        if (str.substr(0, i).replace(r, 'mm').length >= n) {
            return showdot ? str.substr(0, i) + '...' : str.substr(0, i);
        }
    }
    return str;
}

/** 安全转字符串：null/undefined 返回 ''。 */
export function safeString(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}
