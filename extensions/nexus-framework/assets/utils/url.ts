/**
 * URL 解析工具，适用于 H5 从地址栏或分享链接中读取参数。
 */

/** 获取当前页面的 query 字符串（H5 下为 location.search，非 H5 为空字符串）。 */
export function getCurrentSearch(): string {
    if (typeof globalThis === 'undefined') return '';
    const g = globalThis as unknown as { location?: { search?: string } };
    return g.location?.search ?? '';
}

/**
 * 解析 query 字符串为键值对。
 * @param searchOrUrl 不传则使用当前页 location.search（H5）；也可传 ?a=1&b=2 或完整 URL。
 */
export function getQueryParams(searchOrUrl?: string): Record<string, string> {
    let search = searchOrUrl;
    if (search === undefined) search = getCurrentSearch();

    const query = search.indexOf('?') >= 0 ? search.slice(search.indexOf('?') + 1) : search;
    if (!query) return {};

    const params: Record<string, string> = {};
    const pairs = query.split('&');
    for (let i = 0; i < pairs.length; i++) {
        const part = pairs[i];
        const eq = part.indexOf('=');
        if (eq < 0) {
            if (part.length) params[decodeURIComponent(part)] = '';
            continue;
        }
        const key = decodeURIComponent(part.slice(0, eq));
        params[key] = decodeURIComponent(part.slice(eq + 1));
    }
    return params;
}

/**
 * 获取单个 query 参数。
 * @param name 参数名
 * @param searchOrUrl 不传则使用当前页 location.search（H5）
 */
export function getQueryParam(name: string | number, searchOrUrl?: string): string | undefined {
    const params = getQueryParams(searchOrUrl);
    return params[name];
}

/**
 * 将对象拼接为 query 字符串（不含前导 ?）。
 */
export function buildQueryString(params: Record<string, string | number | boolean>): string {
    const parts: string[] = [];
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null) continue;
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    return parts.join('&');
}
