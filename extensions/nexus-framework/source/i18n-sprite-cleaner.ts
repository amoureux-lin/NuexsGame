import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

type SerializedRecord = Record<string, unknown>;

export function cleanI18nSpriteSerializedDependencies(projectPath: string): number {
    const assetsRoot = join(projectPath, 'assets');
    let changedCount = 0;

    for (const file of walkFiles(assetsRoot, (path) => path.endsWith('.scene') || path.endsWith('.prefab'))) {
        const content = readFileSync(file, 'utf8');
        let data: unknown;
        try {
            data = JSON.parse(content);
        } catch {
            continue;
        }

        if (!Array.isArray(data)) continue;
        if (!cleanSerializedAsset(data)) continue;

        writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
        changedCount++;
    }

    return changedCount;
}

function cleanSerializedAsset(items: unknown[]): boolean {
    let changed = false;
    const i18nSpriteNodeIds = new Set<number>();
    const i18nSpineNodeIds = new Set<number>();
    const i18nDragonBonesNodeIds = new Set<number>();

    for (const item of items) {
        if (!isRecord(item)) continue;

        if (isI18nSpriteRecord(item)) {
            const nodeId = readSerializedNodeId(item);
            if (nodeId !== undefined) {
                i18nSpriteNodeIds.add(nodeId);
            }

            if ('_sourceSpriteFrame' in item) {
                delete item._sourceSpriteFrame;
                changed = true;
            }
        }

        if (isI18nSpineRecord(item)) {
            const nodeId = readSerializedNodeId(item);
            if (nodeId !== undefined) {
                i18nSpineNodeIds.add(nodeId);
            }

            if ('_sourceSkeletonData' in item) {
                delete item._sourceSkeletonData;
                changed = true;
            }
        }

        if (isI18nDragonBonesRecord(item)) {
            const nodeId = readSerializedNodeId(item);
            if (nodeId !== undefined) {
                i18nDragonBonesNodeIds.add(nodeId);
            }

            if ('_sourceDragonAsset' in item) {
                delete item._sourceDragonAsset;
                changed = true;
            }
            if ('_sourceDragonAtlasAsset' in item) {
                delete item._sourceDragonAtlasAsset;
                changed = true;
            }
        }
    }

    for (const item of items) {
        if (!isRecord(item)) continue;
        const nodeId = readSerializedNodeId(item);
        if (nodeId === undefined) continue;

        if (item.__type__ === 'cc.Sprite' && i18nSpriteNodeIds.has(nodeId) && item._spriteFrame !== null) {
            item._spriteFrame = null;
            changed = true;
        }

        if (item.__type__ === 'sp.Skeleton' && i18nSpineNodeIds.has(nodeId) && item._skeletonData !== null) {
            item._skeletonData = null;
            changed = true;
        }

        if (item.__type__ === 'dragonBones.ArmatureDisplay' && i18nDragonBonesNodeIds.has(nodeId)) {
            if (item._dragonAsset !== null) {
                item._dragonAsset = null;
                changed = true;
            }
            if (item._dragonAtlasAsset !== null) {
                item._dragonAtlasAsset = null;
                changed = true;
            }
        }
    }

    return changed;
}

function isI18nSpriteRecord(record: SerializedRecord): boolean {
    return typeof record._bundleName === 'string'
        && typeof record._relativePath === 'string'
        && !('_key' in record)
        && !('_sourceSkeletonData' in record)
        && !('_animationName' in record);
}

function isI18nSpineRecord(record: SerializedRecord): boolean {
    return typeof record._bundleName === 'string'
        && typeof record._relativePath === 'string'
        && '_animationName' in record;
}

function isI18nDragonBonesRecord(record: SerializedRecord): boolean {
    return typeof record._bundleName === 'string'
        && typeof record._dragonAssetPath === 'string'
        && typeof record._dragonAtlasAssetPath === 'string';
}

function readSerializedNodeId(record: SerializedRecord): number | undefined {
    const node = record.node;
    if (!isRecord(node)) return undefined;

    const id = node.__id__;
    return typeof id === 'number' ? id : undefined;
}

function walkFiles(root: string, matcher: (file: string) => boolean): string[] {
    if (!existsSync(root)) return [];

    const result: string[] = [];
    for (const entry of readdirSync(root)) {
        const file = join(root, entry);
        const stat = statSync(file);
        if (stat.isDirectory()) {
            result.push(...walkFiles(file, matcher));
        } else if (matcher(file)) {
            result.push(file);
        }
    }

    return result;
}

function isRecord(value: unknown): value is SerializedRecord {
    return !!value && typeof value === 'object';
}
