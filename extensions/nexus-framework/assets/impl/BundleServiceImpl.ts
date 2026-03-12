import { AssetManager, assetManager, director, Node, Scene } from 'cc';
import { Nexus } from '../core/Nexus';
import { BaseEntry } from '../base/BaseEntry';
import { BaseLoading } from '../base/BaseLoading';
import type { BundleConfig, NexusConfig } from '../core/NexusConfig';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { IBundleService, UILayer } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';

/** 入口场景名约定：bundleName + 'Main'，如 lobbyMain、slotGameMain */
const ENTRY_SCENE_SUFFIX = 'Main';
/** Loading 面板名约定：bundleName + 'Loading'，如 lobbyLoading、slotGameLoading */
const LOADING_PANEL_SUFFIX = 'Loading';
/** Cocos Creator 内置 Bundle，不可卸载，避免破坏引擎 */
const BUILTIN_BUNDLES = new Set<string>(['internal', 'main', 'resources']);

/**
 * 基于 assetManager.loadBundle + director.loadScene 的 Bundle 管理实现。
 *
 * 切换流程：
 *   1. notifyBundleExit(prev) → 卸载非 common Bundle
 *   2. loadBundle(next) → show(bundleName+'Loading') 拿到节点引用
 *   3. 并行：loadScene(bundleName+'Main') + BaseLoading.execute(params)
 *   4. 两者均完成后：runScene → BaseEntry.onEnter → notifyBundleEnter → destroy Loading
 */
export class BundleServiceImpl extends IBundleService {

    private readonly _configs  = new Map<string, BundleConfig>();
    private readonly _bundles  = new Map<string, AssetManager.Bundle>();
    private _activeEntries: BaseEntry[] = [];
    private _current = '';
    /** 当前正在显示的 Loading 面板名，用于并发取消时销毁 */
    private _currentBundleLoadingName = '';
    /** 当前 Loading 组件引用，用于取消时调用 onCancel() */
    private _currentLoadingComp: BaseLoading | null = null;
    /** 并发 enter() 控制：每次 enter 递增，异步步骤间检测是否已被新 enter 取代 */
    private _enterGeneration = 0;

    /** 缓存 Bundle 配置并预加载标记为 preload 的包。 */
    async onBoot(config: NexusConfig): Promise<void> {
        this._configs.clear();
        for (const b of config.bundles) {
            this._configs.set(b.name, b);
        }
        const preloads = config.bundles.filter(b => b.preload);
        await Promise.all(preloads.map(b => this.load(b.name)));
    }

    /** 加载指定 Bundle，并缓存原生 Bundle 实例。 */
    async load(bundleName: string): Promise<void> {
        this.ensureConfig(bundleName);
        if (this._bundles.has(bundleName)) return;

        const cfg = this._configs.get(bundleName)!;
        const url  = cfg.remoteUrl ?? bundleName;

        const bundle = await new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(url, (err, b) => err ? reject(err) : resolve(b));
        });
        this._bundles.set(bundleName, bundle);
    }

    /**
     * 执行完整的 Bundle 切换流程。
     * 若有上一次未完成的 enter（Loading 正在显示），先销毁它再开始新流程。
     */
    async enter(bundleName: string, params?: Record<string, unknown>): Promise<void> {
        this.ensureConfig(bundleName);

        // 取消上一次未完成的 enter：销毁旧 Loading 面板
        this._cancelPendingEnter();

        const generation = ++this._enterGeneration;
        const cancelled = (): boolean => generation !== this._enterGeneration;

        const previous = this._current;

        // 退出旧 Bundle
        if (previous && previous !== bundleName) {
            await this.invokeExitHooks();
            await ServiceRegistry.notifyBundleExit(previous);
            Nexus.event.emit(NexusEvents.BUNDLE_EXIT, previous);
            const prevCfg = this._configs.get(previous);
            const isCommon = prevCfg?.type === 'common';
            const isBuiltin = BUILTIN_BUNDLES.has(previous);
            if (!isCommon && !isBuiltin) {
                this.unload(previous);
            }
        }

        if (cancelled()) return;

        // 加载新 Bundle
        await this.load(bundleName);
        this._current = bundleName;

        if (cancelled()) return;

        const entrySceneName   = bundleName + ENTRY_SCENE_SUFFIX;
        const loadingPanelName = bundleName + LOADING_PANEL_SUFFIX;

        // 显示 Loading 面板并拿到节点引用
        let loadingNode: Node | null = null;
        try {
            loadingNode = await Nexus.ui.show(loadingPanelName, undefined, UILayer.LOADING);
            this._currentBundleLoadingName = loadingPanelName;
        } catch {
            // 无该 Loading 预制体时静默跳过
        }

        if (cancelled()) return;

        // 并行：从磁盘加载场景文件 + 执行业务加载逻辑（建连/预加载/join 等）
        const loadingComp = loadingNode?.getComponent(BaseLoading) ?? null;
        this._currentLoadingComp = loadingComp;
        const [scene] = await Promise.all([
            this.tryLoadScene(bundleName, entrySceneName),
            loadingComp?.execute(params) ?? Promise.resolve(),
        ]);

        if (cancelled()) return;

        // 两者均完成 → 切换场景
        if (scene) {
            await new Promise<void>((resolve) => {
                director.runScene(scene, undefined, async () => {
                    await this.invokeEnterHooks(params);
                    await ServiceRegistry.notifyBundleEnter(bundleName);
                    Nexus.event.emit(NexusEvents.BUNDLE_ENTER, bundleName);
                    resolve();
                });
            });
        } else {
            await ServiceRegistry.notifyBundleEnter(bundleName);
            Nexus.event.emit(NexusEvents.BUNDLE_ENTER, bundleName);
        }

        // 销毁 Loading 面板
        this._currentLoadingComp = null;
        if (this._currentBundleLoadingName) {
            Nexus.ui.destroy(this._currentBundleLoadingName);
            this._currentBundleLoadingName = '';
        }
    }

    /** 退出当前 Bundle，并触发退出生命周期。 */
    async exit(bundleName: string): Promise<void> {
        if (this._current !== bundleName) return;
        this._cancelPendingEnter();
        await this.invokeExitHooks();
        await ServiceRegistry.notifyBundleExit(bundleName);
        Nexus.event.emit(NexusEvents.BUNDLE_EXIT, bundleName);
        this._current = '';
    }

    /** 卸载 Bundle 并释放其全部资源引用。 */
    unload(bundleName: string): void {
        const b = this._bundles.get(bundleName);
        if (b) {
            b.releaseAll();
            assetManager.removeBundle(b);
            this._bundles.delete(bundleName);
        }
        if (this._current === bundleName) this._current = '';
    }

    /** 判断 Bundle 是否已经载入。 */
    isLoaded(bundleName: string): boolean {
        return this._bundles.has(bundleName);
    }

    /** 返回当前激活的 Bundle 名称。 */
    get current(): string {
        return this._current;
    }

    /** 销毁时执行退出钩子并清空缓存。 */
    async onDestroy(): Promise<void> {
        await this.invokeExitHooks();
        this._cancelPendingEnter();
        this._configs.clear();
        this._bundles.clear();
        this._activeEntries = [];
        this._current = '';
    }

    // ── 私有工具 ─────────────────────────────────────

    /**
     * 取消当前正在进行中的 enter：销毁已显示的 Loading 面板。
     * generation 计数器负责让旧 enter() 的后续逻辑自动放弃执行。
     */
    private _cancelPendingEnter(): void {
        if (this._currentLoadingComp) {
            this._currentLoadingComp.onCancel();
            this._currentLoadingComp = null;
        }
        if (this._currentBundleLoadingName) {
            Nexus.ui.destroy(this._currentBundleLoadingName);
            this._currentBundleLoadingName = '';
        }
    }

    /** 确保目标 Bundle 已在配置中声明。 */
    private ensureConfig(bundleName: string): void {
        if (!this._configs.has(bundleName)) {
            throw new Error(`[Nexus] Bundle not configured: ${bundleName}`);
        }
    }

    /** 仅加载入口场景到内存并返回，不 runScene。 */
    private tryLoadScene(bundleName: string, sceneName: string): Promise<Scene | null> {
        const bundle = this._bundles.get(bundleName);
        if (!bundle) return Promise.resolve(null);

        return new Promise<Scene | null>((resolve) => {
            bundle.loadScene(sceneName, (err: Error | null, scene: Scene) => {
                if (err) {
                    this._activeEntries = [];
                    resolve(null);
                    return;
                }
                resolve(scene);
            });
        });
    }

    /** 收集当前场景中的 BaseEntry，并依次调用 onEnter。 */
    private async invokeEnterHooks(params?: Record<string, unknown>): Promise<void> {
        const scene = director.getScene();
        this._activeEntries = scene?.getComponentsInChildren(BaseEntry) ?? [];

        for (const entry of this._activeEntries) {
            await entry.onEnter(params);
        }
    }

    /** 依次调用当前场景入口的 onExit。 */
    private async invokeExitHooks(): Promise<void> {
        for (const entry of this._activeEntries) {
            await entry.onExit();
        }
        this._activeEntries = [];
    }
}
