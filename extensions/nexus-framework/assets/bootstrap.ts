import { AssetServiceImpl } from './impl/AssetServiceImpl';
import { AudioServiceImpl } from './impl/AudioServiceImpl';
import { BundleServiceImpl } from './impl/BundleServiceImpl';
import { EventServiceImpl } from './impl/EventServiceImpl';
import { I18nServiceImpl } from './impl/I18nServiceImpl';
import { NetServiceImpl } from './impl/NetServiceImpl';
import { StorageServiceImpl } from './impl/StorageServiceImpl';
import { UIServiceImpl } from './impl/UIServiceImpl';
import { ServiceRegistry } from './core/ServiceRegistry';
import {
    IAssetService,
    IAudioService,
    IBundleService,
    IEventService,
    II18nService,
    INetService,
    IStorageService,
    IUIService,
} from './services/contracts';

/**
 * 注册框架内置服务。
 * 可重复调用；已注册时直接跳过。
 */
export function bootstrapNexus(): void {
    if (ServiceRegistry.has(IEventService)) {
        return;
    }

    ServiceRegistry.register(IEventService, new EventServiceImpl());
    ServiceRegistry.register(IStorageService, new StorageServiceImpl());
    ServiceRegistry.register(IAssetService, new AssetServiceImpl());
    ServiceRegistry.register(IBundleService, new BundleServiceImpl());
    ServiceRegistry.register(IUIService, new UIServiceImpl());
    ServiceRegistry.register(IAudioService, new AudioServiceImpl());
    ServiceRegistry.register(II18nService, new I18nServiceImpl());
    ServiceRegistry.register(INetService, new NetServiceImpl());
}
