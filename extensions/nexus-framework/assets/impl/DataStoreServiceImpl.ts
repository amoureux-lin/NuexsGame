import type { NexusConfig } from '../core/NexusConfig';
import { IDataStoreService } from '../services/contracts';

/**
 * 轻量 DataStore：纯内存 Map，不读写 Nexus.storage。
 */
export class DataStoreServiceImpl extends IDataStoreService {
    private readonly _memory = new Map<string, unknown>();

    async onBoot(_config: NexusConfig): Promise<void> {}

    get<T>(key: string, defaultValue?: T): T | undefined {
        if (this._memory.has(key)) {
            return this._memory.get(key) as T;
        }
        return defaultValue;
    }

    set<T>(key: string, value: T): void {
        this._memory.set(key, value);
    }

    remove(key: string): void {
        this._memory.delete(key);
    }

    has(key: string): boolean {
        return this._memory.has(key);
    }

    clear(): void {
        this._memory.clear();
    }
}
