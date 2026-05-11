import type { NexusConfig } from './NexusConfig';
import { ServiceBase } from './ServiceBase';

export type ServiceToken<T extends ServiceBase> = abstract new (...args: any[]) => T;

export class ServiceRegistry {
    private static readonly _map = new Map<ServiceToken<ServiceBase>, ServiceBase>();
    private static _order: ServiceBase[] = [];

    /** 按 token 注册服务实例，并记录生命周期顺序。 */
    static register<T extends ServiceBase>(token: ServiceToken<T>, impl: T, options?: { replace?: boolean }): void {
        if (ServiceRegistry._map.has(token)) {
            if (!options?.replace) {
                throw new Error(`[Nexus] Service already registered: ${token.name}`);
            }
            ServiceRegistry.unregister(token);
        }

        ServiceRegistry._map.set(token, impl);
        ServiceRegistry._order.push(impl);
    }

    /** 反注册指定服务；一般用于 init 前替换默认服务。 */
    static unregister<T extends ServiceBase>(token: ServiceToken<T>): void {
        const service = ServiceRegistry._map.get(token);
        if (!service) return;

        ServiceRegistry._map.delete(token);
        const idx = ServiceRegistry._order.indexOf(service);
        if (idx >= 0) {
            ServiceRegistry._order.splice(idx, 1);
        }
    }

    /** 通过 token 获取已注册的服务实例。 */
    static get<T extends ServiceBase>(token: ServiceToken<T>): T {
        const service = ServiceRegistry._map.get(token);
        if (!service) {
            throw new Error(`[Nexus] Service not registered: ${token.name}`);
        }

        return service as T;
    }

    /** 判断某个服务是否已经注册。 */
    static has<T extends ServiceBase>(token: ServiceToken<T>): boolean {
        return ServiceRegistry._map.has(token);
    }

    /** 按注册顺序依次执行所有服务的 onBoot。 */
    static async bootAll(config: NexusConfig): Promise<void> {
        for (const service of ServiceRegistry._order) {
            await service.onBoot(config);
        }
    }

    /** 按注册逆序依次执行所有服务的 onDestroy。 */
    static async destroyAll(): Promise<void> {
        for (const service of [...ServiceRegistry._order].reverse()) {
            await service.onDestroy();
        }

        ServiceRegistry._map.clear();
        ServiceRegistry._order = [];
    }

    /** 广播 Bundle 进入事件给所有服务。 */
    static async notifyBundleEnter(bundleName: string): Promise<void> {
        for (const service of ServiceRegistry._order) {
            await service.onBundleEnter(bundleName);
        }
    }

    /** 按逆序广播 Bundle 退出事件给所有服务。 */
    static async notifyBundleExit(bundleName: string): Promise<void> {
        for (const service of [...ServiceRegistry._order].reverse()) {
            await service.onBundleExit(bundleName);
        }
    }
}
