import { Asset, AssetManager, assetManager } from 'cc';
import { AssetCtor, IAssetService } from '../services/contracts';

/**
 * 基于 assetManager 的资源管理实现。
 * load / loadDir 委托给对应 Bundle 的原生接口，release / releaseBundle 直接释放引用。
 */
export class AssetServiceImpl extends IAssetService {

    /** 加载单个资源；必要时先解析并加载 Bundle。 */
    async load<T extends Asset>(bundle: string, path: string, type?: AssetCtor<T>): Promise<T> {
        const b = await this.resolveBundle(bundle);
        return new Promise<T>((resolve, reject) => {
            const cb = (err: Error | null, asset: T) => err ? reject(err) : resolve(asset);
            type ? b.load(path, type as any, cb) : b.load(path, cb);
        });
    }

    /**
     * 加载目录下的同类资源集合。
     * 支持可选进度回调 onProgress，签名与 Cocos loadDir 一致：(finished, total, item)。
     */
    async loadDir<T extends Asset>(
        bundle: string,
        dir: string,
        type?: AssetCtor<T>,
        onProgress?: (finished: number, total: number, item: AssetManager.RequestItem) => void,
    ): Promise<T[]> {
        const b = await this.resolveBundle(bundle);
        return new Promise<T[]>((resolve, reject) => {
            const cb = (err: Error | null, assets: T[]) => err ? reject(err) : resolve(assets);
            if (onProgress) {
                if (type) {
                    b.loadDir(dir, type as any, (finished, total, item) => {
                        onProgress(finished, total, item);
                    }, cb);
                } else {
                    b.loadDir(dir, (finished, total, item) => {
                        onProgress(finished, total, item);
                    }, cb);
                }
            } else {
                type ? b.loadDir(dir, type as any, cb) : b.loadDir(dir, cb);
            }
        });
    }

    /** 释放指定资源路径。 */
    release(bundle: string, path: string): void {
        assetManager.getBundle(bundle)?.release(path);
    }

    /** 释放整个 Bundle 的资源并移除 Bundle 缓存。 */
    releaseBundle(bundle: string): void {
        const b = assetManager.getBundle(bundle);
        if (b) {
            b.releaseAll();
            assetManager.removeBundle(b);
        }
    }

    /** 预加载一组资源路径，降低首次使用卡顿。 */
    async preload(bundle: string, paths: string[]): Promise<void> {
        const b = await this.resolveBundle(bundle);
        await Promise.all(
            paths.map(path => new Promise<void>((resolve, reject) => {
                b.preload(path, (err) => err ? reject(err) : resolve());
            }))
        );
    }

    /** 已存在则直接返回，否则先 loadBundle */
    private resolveBundle(name: string): Promise<AssetManager.Bundle> {
        const existing = assetManager.getBundle(name);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            assetManager.loadBundle(name, (err, b) => err ? reject(err) : resolve(b));
        });
    }
}
