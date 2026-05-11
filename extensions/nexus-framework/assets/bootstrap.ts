import { AssetServiceImpl } from './impl/AssetServiceImpl';
import { AudioServiceImpl } from './impl/AudioServiceImpl';
import { BundleServiceImpl } from './impl/BundleServiceImpl';
import { ConfigServiceImpl } from './impl/ConfigServiceImpl';
import { DataStoreServiceImpl } from './impl/DataStoreServiceImpl';
import { EventServiceImpl } from './impl/EventServiceImpl';
import { I18nServiceImpl } from './impl/I18nServiceImpl';
import { NetServiceImpl } from './impl/NetServiceImpl';
import { ObjectPoolServiceImpl } from './impl/ObjectPoolServiceImpl';
import { StorageServiceImpl } from './impl/StorageServiceImpl';
import { ToastServiceImpl } from './impl/ToastServiceImpl';
import { UIServiceImpl } from './impl/UIServiceImpl';
import { ServiceRegistry } from './core/ServiceRegistry';
import {
    IAssetService,
    IAudioService,
    IBundleService,
    IConfigService,
    IDataStoreService,
    IEventService,
    II18nService,
    INetService,
    IObjectPoolService,
    IStorageService,
    IToastService,
    IUIService,
} from './services/contracts';
import type { ServiceBase } from './core/ServiceBase';

export interface BootstrapNexusOptions {
    replaceExisting?: boolean;
    services?: {
        event?: IEventService;
        storage?: IStorageService;
        data?: IDataStoreService;
        asset?: IAssetService;
        bundle?: IBundleService;
        ui?: IUIService;
        audio?: IAudioService;
        pool?: IObjectPoolService;
        toast?: IToastService;
        configs?: IConfigService;
        i18n?: II18nService;
        net?: INetService;
    };
}

/**
 * 注册框架内置服务。
 * 可重复调用；已注册时直接跳过。
 */
export function bootstrapNexus(options: BootstrapNexusOptions = {}): void {
    if (ServiceRegistry.has(IEventService) && !options.replaceExisting) {
        return;
    }

    registerDefault(IEventService, options.services?.event ?? new EventServiceImpl(), options.replaceExisting);
    registerDefault(IStorageService, options.services?.storage ?? new StorageServiceImpl(), options.replaceExisting);
    registerDefault(IDataStoreService, options.services?.data ?? new DataStoreServiceImpl(), options.replaceExisting);
    registerDefault(IAssetService, options.services?.asset ?? new AssetServiceImpl(), options.replaceExisting);
    registerDefault(IBundleService, options.services?.bundle ?? new BundleServiceImpl(), options.replaceExisting);
    registerDefault(IUIService, options.services?.ui ?? new UIServiceImpl(), options.replaceExisting);
    registerDefault(IAudioService, options.services?.audio ?? new AudioServiceImpl(), options.replaceExisting);
    registerDefault(IObjectPoolService, options.services?.pool ?? new ObjectPoolServiceImpl(), options.replaceExisting);
    registerDefault(IToastService, options.services?.toast ?? new ToastServiceImpl(), options.replaceExisting);
    registerDefault(IConfigService, options.services?.configs ?? new ConfigServiceImpl(), options.replaceExisting);
    registerDefault(II18nService, options.services?.i18n ?? new I18nServiceImpl(), options.replaceExisting);
    registerDefault(INetService, options.services?.net ?? new NetServiceImpl(), options.replaceExisting);
}

function registerDefault<T extends ServiceBase>(
    token: abstract new (...args: any[]) => T,
    impl: T,
    replaceExisting = false,
): void {
    if (ServiceRegistry.has(token) && !replaceExisting) return;
    ServiceRegistry.register(token, impl, { replace: replaceExisting });
}
