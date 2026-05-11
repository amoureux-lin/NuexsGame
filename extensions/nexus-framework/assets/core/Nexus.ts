import { game, Game } from 'cc';
import type { BundleConfig, NexusConfig } from './NexusConfig';
import { ProtoManager } from '../manager/protoManager';
import { ServiceRegistry } from './ServiceRegistry';
import { TimeService } from './TimeService';
import { NexusEvents } from '../NexusEvents';
import { getQueryParam } from '../utils/url';
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
} from '../services/contracts';

export class Nexus {
    private static _initialized = false;
    private static _config: NexusConfig | null = null;
    private static _hideTime = 0;
    private static readonly _onGameHide = (): void => {
        Nexus._hideTime = Date.now();
        Nexus.emit(NexusEvents.APP_HIDE);
    };
    private static readonly _onGameShow = (): void => {
        const duration = Nexus._hideTime > 0 ? Date.now() - Nexus._hideTime : 0;
        Nexus._hideTime = 0;
        Nexus.emit<number>(NexusEvents.APP_SHOW, duration);
    };
    private static readonly _onUnhandledRejection = (e: any): void => {
        console.error('[Nexus] Unhandled Promise rejection:', e.reason);
        try { Nexus.emit(NexusEvents.ERROR_UNHANDLED, { reason: e.reason }); } catch { /* ignore */ }
    };
    private static readonly _onWindowError = (e: any): void => {
        console.error('[Nexus] Uncaught error:', e.message, e.error);
        try { Nexus.emit(NexusEvents.ERROR_UNCAUGHT, { message: e.message, error: e.error }); } catch { /* ignore */ }
    };

    /** 初始化框架并按顺序启动所有已注册服务。 */
    static async init(config: NexusConfig): Promise<void> {
        if (Nexus._initialized) {
            throw new Error('[Nexus] Already initialized. Call Nexus.destroy() before Nexus.init() again.');
        }

        Nexus._config = config;
        await ServiceRegistry.bootAll(config);
        Nexus._initialized = true;
        Nexus.bindGlobalListeners();
    }

    /** 进入配置中的入口 Bundle（未配置时根据 enableLobby 与 bundles 自动推导）。 */
    static async start(params?: Record<string, unknown>): Promise<void> {
        Nexus.ensureInitialized();
        const entry = Nexus.resolveEntryBundle();
        await Nexus.bundle.enter(entry, params);
    }

    /** 解析入口 Bundle：显式 > enableLobby ? lobby : 按 URL game_id 找 subgame。 */
    private static resolveEntryBundle(): string {
        const cfg = Nexus._config!;
        if (cfg.entryBundle) return cfg.entryBundle;
        if (cfg.enableLobby) return 'lobby';
        const gameIdStr = getQueryParam('game_id');
        const sub = Nexus.findSubgameByGameId(cfg.bundles, gameIdStr);
        if (sub) return sub.name;
        throw new Error('[Nexus] enableLobby is false but no subgame in bundles. Add a bundle with type: "subgame".');
    }

    /** 根据 URL game_id 查找对应 subgame，未配置 game_id 或未匹配时返回第一个 subgame。 */
    private static findSubgameByGameId(bundles: BundleConfig[], gameIdStr: string | undefined): BundleConfig | undefined {
        const subs = bundles.filter((b) => b.type === 'subgame');
        if (subs.length === 0) return undefined;
        if (gameIdStr !== undefined && gameIdStr !== '') {
            const id = Number(gameIdStr);
            if (!Number.isNaN(id)) {
                const match = subs.find((b) => b.gameId !== undefined && b.gameId === id);
                if (match) return match;
            }
        }
        return subs[0];
    }

    /** 销毁框架并释放全部服务。 */
    static async destroy(): Promise<void> {
        Nexus.unbindGlobalListeners();
        await ServiceRegistry.destroyAll();
        Nexus._initialized = false;
        Nexus._config = null;
        Nexus._hideTime = 0;
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

    /** 存储服务快捷入口（持久化）。 */
    static get storage(): IStorageService {
        return ServiceRegistry.get(IStorageService);
    }

    /** 数据存储快捷入口（内存 + 可选持久化）。 */
    static get data(): IDataStoreService {
        return ServiceRegistry.get(IDataStoreService);
    }

    /** 国际化服务快捷入口。 */
    static get i18n(): II18nService {
        return ServiceRegistry.get(II18nService);
    }

    /** 资源服务快捷入口。 */
    static get asset(): IAssetService {
        return ServiceRegistry.get(IAssetService);
    }

    /** 对象池服务快捷入口。 */
    static get pool(): IObjectPoolService {
        return ServiceRegistry.get(IObjectPoolService);
    }

    /** Toast 全局提示服务快捷入口。 */
    static get toast(): IToastService {
        return ServiceRegistry.get(IToastService);
    }

    /** 配置服务快捷入口（CSV / JSON 配置加载与读取）。 */
    static get configs(): IConfigService {
        return ServiceRegistry.get(IConfigService);
    }

    /** Proto 消息类型映射：registerCommon 启动时调用，registerSubgame 子游戏 Loading 时调用。 */
    static get proto(): typeof ProtoManager {
        return ProtoManager;
    }

    /** 时间服务：服务端时间校准 + 倒计时工具。 */
    static get time(): typeof TimeService {
        return TimeService;
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

    private static bindGlobalListeners(): void {
        game.on(Game.EVENT_HIDE, Nexus._onGameHide);
        game.on(Game.EVENT_SHOW, Nexus._onGameShow);

        if (typeof window !== 'undefined') {
            window.addEventListener('unhandledrejection', Nexus._onUnhandledRejection);
            window.addEventListener('error', Nexus._onWindowError);
        }
    }

    private static unbindGlobalListeners(): void {
        game.off(Game.EVENT_HIDE, Nexus._onGameHide);
        game.off(Game.EVENT_SHOW, Nexus._onGameShow);

        if (typeof window !== 'undefined') {
            window.removeEventListener('unhandledrejection', Nexus._onUnhandledRejection);
            window.removeEventListener('error', Nexus._onWindowError);
        }
    }
}
