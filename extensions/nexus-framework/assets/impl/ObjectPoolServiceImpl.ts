import { instantiate, Node, Prefab } from 'cc';
import { IObjectPoolService } from '../services/contracts';

/**
 * 对象池服务：以 key 为分组管理节点的复用。
 *
 * 用法示例：
 *   // 预热
 *   await Nexus.pool.preload('card', cardPrefab, 20);
 *   // 取出
 *   const node = Nexus.pool.get('card', cardPrefab);
 *   parent.addChild(node);
 *   // 归还
 *   Nexus.pool.put('card', node);
 */
export class ObjectPoolServiceImpl extends IObjectPoolService {
    private readonly _pools = new Map<string, Node[]>();

    /**
     * 从池中取节点；池为空时若传了 prefab 则 instantiate 新节点。
     * 返回的节点 active 已恢复为 true。
     */
    get(key: string, prefab?: Prefab): Node | null {
        const pool = this._pools.get(key);
        if (pool && pool.length > 0) {
            const node = pool.pop()!;
            node.active = true;
            return node;
        }
        if (prefab) {
            return instantiate(prefab);
        }
        return null;
    }

    /**
     * 将节点归还池：自动 active = false + removeFromParent。
     * 节点不需要 destroy，框架保持其引用。
     */
    put(key: string, node: Node): void {
        if (!node.isValid) return;
        node.active = false;
        node.removeFromParent();
        if (!this._pools.has(key)) {
            this._pools.set(key, []);
        }
        this._pools.get(key)!.push(node);
    }

    /**
     * 预热：提前创建 count 个节点存入池，避免运行时 instantiate 卡顿。
     */
    async preload(key: string, prefab: Prefab, count: number): Promise<void> {
        for (let i = 0; i < count; i++) {
            const node = instantiate(prefab);
            this.put(key, node);
        }
    }

    /** 返回当前池中该 key 的节点数量。 */
    size(key: string): number {
        return this._pools.get(key)?.length ?? 0;
    }

    /** 销毁指定 key 下的所有缓存节点并清空池。 */
    clear(key: string): void {
        const pool = this._pools.get(key);
        if (!pool) return;
        for (const node of pool) {
            if (node.isValid) node.destroy();
        }
        this._pools.delete(key);
    }

    /** 销毁全部缓存节点。 */
    clearAll(): void {
        for (const key of [...this._pools.keys()]) {
            this.clear(key);
        }
    }

    async onDestroy(): Promise<void> {
        this.clearAll();
    }
}
