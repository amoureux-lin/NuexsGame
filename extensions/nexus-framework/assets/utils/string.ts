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

/** 安全转字符串：null/undefined 返回 ''。 */
export function safeString(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}
