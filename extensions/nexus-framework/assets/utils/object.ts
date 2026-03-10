/**
 * 对象与数组工具。
 */

/** 浅拷贝对象，仅一层。 */
export function shallowCopy<T extends object>(obj: T): T {
    if (Array.isArray(obj)) return obj.slice() as T;
    return { ...obj };
}

/**
 * 简单深拷贝（仅支持 JSON 可序列化结构）。
 * 含 Date/RegExp/函数等需自行处理。
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) return obj.map((item) => deepClone(item)) as unknown as T;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        result[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
    return result as T;
}

/** 从对象中只保留指定 key。 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const k of keys) {
        if (k in obj) result[k] = obj[k];
    }
    return result;
}

/** 从对象中排除指定 key。 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
    const result = { ...obj };
    for (const k of keys) delete result[k];
    return result as Omit<T, K>;
}

/**
 * 若 key 存在则返回值，否则设置 value 并返回。
 */
export function getOrSet<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
    let v = map.get(key);
    if (v === undefined) {
        v = factory();
        map.set(key, v);
    }
    return v;
}

/** 判断是否为非空对象（排除 null、数组）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
