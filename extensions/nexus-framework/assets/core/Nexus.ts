import type { NexusConfig } from './NexusConfig';
import { ServiceRegistry } from './ServiceRegistry';
import {
    IAssetService,
    IAudioService,
    IBundleService,
    IEventService,
    II18nService,
    INetService,
    IStorageService,
    IUIService,
} from '../services/contracts';

export class Nexus {
    private static _initialized = false;
    private static _config: NexusConfig | null = null;

    /** 初始化框架并按顺序启动所有已注册服务。 */
    static async init(config: NexusConfig): Promise<void> {
        Nexus._config = config;
        await ServiceRegistry.bootAll(config);
        Nexus._initialized = true;
    }

    /** 进入配置中的入口 Bundle。 */
    static async start(): Promise<void> {
        Nexus.ensureInitialized();
        await Nexus.bundle.enter(Nexus._config!.entryBundle);
    }

    /** 销毁框架并释放全部服务。 */
    static async destroy(): Promise<void> {
        await ServiceRegistry.destroyAll();
        Nexus._initialized = false;
        Nexus._config = null;
    }

    /** 返回当前生效的框架配置。 */
    static get config(): NexusConfig {
        Nexus.ensureInitialized();
        return Nexus._config!;
    }

    /** UI 服务快捷入口。 */
    static get ui(): IUIService {
        return ServiceRegistry.get(IUIService);
    }

    /** Bundle 服务快捷入口。 */
    static get bundle(): IBundleService {
        return ServiceRegistry.get(IBundleService);
    }

    /** 事件服务快捷入口。 */
    static get event(): IEventService {
        return ServiceRegistry.get(IEventService);
    }

    /** 网络服务快捷入口。 */
    static get net(): INetService {
        return ServiceRegistry.get(INetService);
    }

    /** 音频服务快捷入口。 */
    static get audio(): IAudioService {
        return ServiceRegistry.get(IAudioService);
    }

    /** 存储服务快捷入口。 */
    static get storage(): IStorageService {
        return ServiceRegistry.get(IStorageService);
    }

    /** 国际化服务快捷入口。 */
    static get i18n(): II18nService {
        return ServiceRegistry.get(II18nService);
    }

    /** 资源服务快捷入口。 */
    static get asset(): IAssetService {
        return ServiceRegistry.get(IAssetService);
    }

    /** 监听全局事件。 */
    static on<T>(event: string, fn: (data: T) => void, target?: object): void {
        Nexus.event.on(event, fn, target);
    }

    /** 监听一次性全局事件。 */
    static once<T>(event: string, fn: (data: T) => void, target?: object): void {
        Nexus.event.once(event, fn, target);
    }

    /** 发送全局事件。 */
    static emit<T>(event: string, data?: T): void {
        Nexus.event.emit(event, data);
    }

    /** 移除指定事件监听。 */
    static off<T>(event: string, fn: (data: T) => void, target?: object): void {
        Nexus.event.off(event, fn, target);
    }

    /** 移除 target 绑定的全部事件监听。 */
    static offTarget(target: object): void {
        Nexus.event.offTarget(target);
    }

    /** 在访问服务前校验框架是否已初始化。 */
    private static ensureInitialized(): void {
        if (!Nexus._initialized || !Nexus._config) {
            throw new Error('[Nexus] Call bootstrapNexus() and Nexus.init() before using services.');
        }
    }
}
