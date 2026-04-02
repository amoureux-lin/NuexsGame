import { AssetManager, assetManager, director, error, instantiate, Node, Prefab, Scene } from 'cc';
import { Nexus } from '../core/Nexus';
import { NexusBaseEntry } from '../base/NexusBaseEntry';
import type { BundleConfig, NexusConfig } from '../core/NexusConfig';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { IBundleService, UILayer } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';

/** 入口场景名约定：bundleName + 'Main'，如 lobbyMain、slotGameMain */
const ENTRY_SCENE_SUFFIX = 'Main';
/** Cocos Creator 内置 Bundle，不可卸载，避免破坏引擎 */
const BUILTIN_BUNDLES = new Set<string>(['internal', 'main', 'resources']);

/**
 * 基于 assetManager.loadBundle + director.loadScene 的 Bundle 管理实现。
 *
 * 切换流程：
 *   1. notifyBundleExit(prev) → 卸载非 common Bundle
 *   2. loadBundle(next) → 加载并挂载 Entry Prefab（onPreload → onEnter）
 *   3. Entry 完成逻辑后主动调用 Nexus.bundle.runScene() → loadScene → onSceneReady → notifyBundleEnter
 */
export class BundleServiceImpl extends IBundleService {

    private readonly _configs  = new Map<string, BundleConfig>();
    private readonly _bundles  = new Map<string, AssetManager.Bundle>();
    private _current = '';
    /** 常驻运行时根节点：挂载自动创建的 Entry（避免依赖场景手挂脚本）。 */
    private _runtimeRoot: Node | null = null;
    /** 当前 bundle 的运行时 Entry 节点与组件引用（用于 exit 时清理）。 */
    private _runtimeEntryNode: Node | null = null;
    private _runtimeEntryComp: NexusBaseEntry | null = null;
    /** 标记：Entry.onEnter 已在”Entry Prefab 加载完成后”提前执行过，避免 runScene 后重复执行。 */
    private _runtimeEntered = false;
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
     * 执行 Bundle 切换流程（不含场景跳转）。
     *
     * 切换流程：
     *   1. 退出旧 Bundle（notifyBundleExit → 卸载）
     *   2. 加载新 Bundle → 加载并挂载 Entry Prefab（onPreload → onEnter）
     *   3. Entry 在 onEnter 中完成所有逻辑后，主动调用 Nexus.bundle.runScene() 跳转场景
     */
    async enter(bundleName: string, params?: Record<string, unknown>): Promise<void> {
        this.ensureConfig(bundleName);

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

        // 加载并挂载 Entry Prefab → onPreload → onEnter
        // Entry 在 onEnter 中完成资源加载等逻辑后，主动调用 Nexus.bundle.runScene() 跳转场景
        try {
            await this.loadAndAttachEntryPrefab(bundleName, params);
        } catch (e) {
            error(`[Nexus][BundleService] Failed to load entry for bundle: ${bundleName}`, e);
            // 回退状态，避免框架卡在无 Bundle 可用的中间态
            this._current = '';
            await ServiceRegistry.notifyBundleExit(bundleName);
        }
    }

    /** 由 Entry 在加载完成后主动调用，加载并切换到当前 Bundle 的主场景。 */
    async runScene(): Promise<void> {
        const bundleName = this._current;
        if (!bundleName) {
            error('[Nexus][BundleService] runScene: no active bundle');
            return;
        }

        const entrySceneName = `scene/${bundleName + ENTRY_SCENE_SUFFIX}`;
        const scene = await this.tryLoadScene(bundleName, entrySceneName);

        if (scene) {
            await new Promise<void>((resolve) => {
                director.runScene(scene, undefined, async () => {
                    await this.invokeEnterHooks();
                    await ServiceRegistry.notifyBundleEnter(bundleName);
                    Nexus.event.emit(NexusEvents.BUNDLE_ENTER, bundleName);
                    // Entry 挂在持久化 UI 的 LOADING 层，runScene 不会移除它，否则会一直挡在主场景之上
                    if (this._runtimeEntryNode?.isValid) {
                        this._runtimeEntryNode.active = false;
                    }
                    resolve();
                });
            });
        } else {
            await ServiceRegistry.notifyBundleEnter(bundleName);
            Nexus.event.emit(NexusEvents.BUNDLE_ENTER, bundleName);
        }
    }

    /** 退出当前 Bundle，并触发退出生命周期。 */
    async exit(bundleName: string): Promise<void> {
        if (this._current !== bundleName) return;
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

    /** 空实现，保留接口兼容。 */
    loadFinish(): void {}

    /** 销毁时执行退出钩子并清空缓存。 */
    async onDestroy(): Promise<void> {
        await this.invokeExitHooks();
        this._configs.clear();
        this._bundles.clear();
        this._current = '';
        if (this._runtimeRoot) {
            this._runtimeRoot.destroy();
            this._runtimeRoot = null;
        }
    }

    // ── 私有工具 ─────────────────────────────────────

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
                    error('[Nexus][BundleService] Failed to load scene:', `${bundleName}/${sceneName}`, err);
                    resolve(null);
                    return;
                }
                resolve(scene);
            });
        });
    }

    /** 调用当前 bundle 的 Entry.onEnter。 */
    private async invokeEnterHooks(params?: Record<string, unknown>): Promise<void> {
        if (!this._runtimeEntryComp) {
            throw new Error(`[Nexus] Entry prefab not loaded for bundle: ${this._current}`);
        }
        // onEnter 已提前执行过：这里不重复调用，改为可选 onSceneReady
        const sceneReady = (this._runtimeEntryComp as any).onSceneReady as undefined | ((p?: Record<string, unknown>) => Promise<void> | void);
        if (sceneReady) await sceneReady.call(this._runtimeEntryComp, params);
    }

    /** 依次调用当前场景入口的 onExit。 */
    private async invokeExitHooks(): Promise<void> {
        if (this._runtimeEntryComp) {
            await this._runtimeEntryComp.onExit();
            this._runtimeEntryComp = null;
        }
        if (this._runtimeEntryNode) {
            this._runtimeEntryNode.destroy();
            this._runtimeEntryNode = null;
        }
        this._runtimeEntered = false;
    }

    /** 确保常驻运行时根节点存在。 */
    private ensureRuntimeRoot(): Node {
        if (this._runtimeRoot && this._runtimeRoot.isValid) return this._runtimeRoot;
        const root = new Node('[NexusRuntime]');
        director.addPersistRootNode(root);
        this._runtimeRoot = root;
        return root;
    }

    /**
     * load(bundle) 后立即调用：加载并实例化 `<bundleName>Entry.prefab`，挂到常驻节点上。
     *
     * 约定（当前采用最简单规则）：
     * - Prefab 路径：`${bundleName}Entry`（位于 bundle 根目录，例如 tongits/tongitsEntry.prefab）
     * - Prefab 根节点（或子节点）上必须挂载一个继承 NexusBaseEntry 的组件
     */
    private async loadAndAttachEntryPrefab(bundleName: string, params?: Record<string, unknown>): Promise<void> {
        // 清理旧的运行时 Entry（防御：一般上一次会在 invokeExitHooks 清理）
        if (this._runtimeEntryNode) {
            this._runtimeEntryNode.destroy();
            this._runtimeEntryNode = null;
            this._runtimeEntryComp = null;
        }
        this._runtimeEntered = false;

        const bundle = this._bundles.get(bundleName);
        if (!bundle) throw new Error(`[Nexus] Bundle not loaded: ${bundleName}`);

        const entryPrefabPath = `${bundleName}Entry`;
        const prefab = await new Promise<Prefab | null>((resolve, reject) => {
            bundle.load(entryPrefabPath, Prefab, (err, p) => err ? reject(err) : resolve(p));
        }).catch((e) => {
            error(`[Nexus] Missing entry prefab: ${bundleName}/${entryPrefabPath}.prefab.`, e);
            return null;
        });
        if (!prefab) return;

        const node = instantiate(prefab);
        node.name = `[Entry:${bundleName}]`;
        // 挂到 UI 的 LOADING 层下，确保 Entry 的 UI 节点可见
        Nexus.ui.getLayerNode(UILayer.LOADING).addChild(node);

        const comp = node.getComponent(NexusBaseEntry) ?? node.getComponentInChildren(NexusBaseEntry);
        if (!comp) {
            node.destroy();
            error(`[Nexus] Entry prefab has no NexusBaseEntry component: ${bundleName}/${entryPrefabPath}.prefab`);
            return;
        }

        this._runtimeEntryNode = node;
        this._runtimeEntryComp = comp;

        // 更早执行：可选预加载钩子（注册 panels/proto/ws 等，不依赖场景节点）
        const pre = (comp as any).onPreload as undefined | ((p?: Record<string, unknown>) => Promise<void> | void);
        if (pre) await pre.call(comp, params);

        // 你期望更早启动：Entry Prefab 加载完成后立刻 onEnter（不等待场景加载/切换）
        // 注意：若 onEnter 内依赖场景节点，请改用可选 onSceneReady(params) 在 runScene 后执行。
        await comp.onEnter(params);
        this._runtimeEntered = true;
    }
}
