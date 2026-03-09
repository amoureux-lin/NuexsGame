import { sys } from 'cc';
import type { NexusConfig } from '../core/NexusConfig';
import { IStorageService } from '../services/contracts';

/**
 * 基于 sys.localStorage 的持久化存储。
 * 所有 key 自动加 "nexus_<version>:" 命名空间前缀，避免多版本数据污染。
 */
export class StorageServiceImpl extends IStorageService {

    private _namespace = 'nexus';

    /** 根据版本号初始化存储命名空间。 */
    async onBoot(config: NexusConfig): Promise<void> {
        this._namespace = `nexus_${config.version}`;
    }

    /** 读取并反序列化指定 key 的值。 */
    get<T>(key: string, defaultValue?: T): T | undefined {
        const raw = sys.localStorage.getItem(this.ns(key));
        if (raw === null) return defaultValue;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return defaultValue;
        }
    }

    /** 序列化后写入本地存储。 */
    set<T>(key: string, value: T): void {
        sys.localStorage.setItem(this.ns(key), JSON.stringify(value));
    }

    /** 删除指定 key。 */
    remove(key: string): void {
        sys.localStorage.removeItem(this.ns(key));
    }

    /** 判断指定 key 是否存在。 */
    has(key: string): boolean {
        return sys.localStorage.getItem(this.ns(key)) !== null;
    }

    /** 只清除当前命名空间（版本）下的 key，不影响其他版本数据 */
    clear(): void {
        const prefix = `${this._namespace}:`;
        const toRemove: string[] = [];
        for (let i = 0; i < sys.localStorage.length; i++) {
            const k = sys.localStorage.key(i);
            if (k?.startsWith(prefix)) toRemove.push(k);
        }
        for (const k of toRemove) sys.localStorage.removeItem(k);
    }

    /** 为原始 key 补充当前命名空间前缀。 */
    private ns(key: string): string {
        return `${this._namespace}:${key}`;
    }
}
