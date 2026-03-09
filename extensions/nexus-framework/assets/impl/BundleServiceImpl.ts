import { AssetManager, assetManager, director, Scene } from 'cc';
import { SubGameBase } from '../SubGameBase';
import type { BundleConfig, NexusConfig } from '../core/NexusConfig';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { IBundleService } from '../services/contracts';

/**
 * 基于 assetManager.loadBundle + director.loadScene 的 Bundle 管理实现。
 *
 * 切换流程：
 *   1. notifyBundleExit(prev) → 卸载非 common Bundle
 *   2. loadBundle(next)
 *   3. loadScene('Main') → runScene
 *   4. notifyBundleEnter(next)
 */
export class BundleServiceImpl extends IBundleService {

    private readonly _configs  = new Map<string, BundleConfig>();
    private readonly _bundles  = new Map<string, AssetManager.Bundle>();
    private _activeEntries: SubGameBase[] = [];
    private _current = '';

    /** 缓存 Bundle 配置并预加载标记为 preload 的包。 */
    async onBoot(config: NexusConfig): Promise<void> {
        this._configs.clear();
        for (const b of config.bundles) {
            this._configs.set(b.name, b);
        }
        // 预加载标记了 preload 的 Bundle（一般是 common）
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

    /** 执行完整的 Bundle 切换流程。 */
    async enter(bundleName: string, params?: Record<string, unknown>): Promise<void> {
        this.ensureConfig(bundleName);

        const previous = this._current;

        // 退出旧 Bundle
        if (previous && previous !== bundleName) {
            await this.invokeExitHooks();
            await ServiceRegistry.notifyBundleExit(previous);
            const prevCfg = this._configs.get(previous);
            if (prevCfg?.type !== 'common') {
                this.unload(previous);
            }
        }

        // 加载新 Bundle
        await this.load(bundleName);
        this._current = bundleName;

        // 加载并切换入口场景（约定场景名 'Main'，找不到则跳过）
        await this.tryRunScene(bundleName, 'Main');
        await this.invokeEnterHooks(params);

        await ServiceRegistry.notifyBundleEnter(bundleName);
    }

    /** 退出当前 Bundle，并触发退出生命周期。 */
    async exit(bundleName: string): Promise<void> {
        if (this._current !== bundleName) return;
        await this.invokeExitHooks();
        await ServiceRegistry.notifyBundleExit(bundleName);
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
        this._configs.clear();
        this._bundles.clear();
        this._activeEntries = [];
        this._current = '';
    }

    // ── 私有工具 ─────────────────────────────────────

    /** 确保目标 Bundle 已在配置中声明。 */
    private ensureConfig(bundleName: string): void {
        if (!this._configs.has(bundleName)) {
            throw new Error(`[Nexus] Bundle not configured: ${bundleName}`);
        }
    }

    /** 尝试加载并运行约定的入口场景。 */
    private tryRunScene(bundleName: string, sceneName: string): Promise<void> {
        const bundle = this._bundles.get(bundleName);
        if (!bundle) return Promise.resolve();

        return new Promise<void>((resolve) => {
            bundle.loadScene(sceneName, (err, scene: Scene) => {
                if (err) {
                    // 没有 Main 场景时静默跳过
                    this._activeEntries = [];
                    resolve();
                    return;
                }
                director.runScene(scene, undefined, () => resolve());
            });
        });
    }

    /** 收集当前场景中的 SubGameBase，并依次调用 onEnter。 */
    private async invokeEnterHooks(params?: Record<string, unknown>): Promise<void> {
        const scene = director.getScene();
        this._activeEntries = scene?.getComponentsInChildren(SubGameBase) ?? [];

        for (const entry of this._activeEntries) {
            await entry.onEnter(params);
        }
    }

    /** 依次调用上一个子游戏入口的 onExit。 */
    private async invokeExitHooks(): Promise<void> {
        for (const entry of this._activeEntries) {
            await entry.onExit();
        }
        this._activeEntries = [];
    }
}
