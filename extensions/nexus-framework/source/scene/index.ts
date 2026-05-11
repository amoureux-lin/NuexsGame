type DesignResolution = {
    width: number;
    height: number;
};

type SceneNode = {
    children: SceneNode[];
    getComponent<T = unknown>(type: unknown): T | null;
    getComponents<T = unknown>(type: unknown): T[];
};

type SceneComponent = {
    constructor?: { name?: string };
    refreshEditorPreview?: () => void;
};

type CocosApi = {
    Component: unknown;
    Label: unknown;
    director: {
        getScene(): SceneNode | null;
    };
};

declare const cce: {
    Startup?: {
        initDesignResolution?: () => Promise<void>;
        changeDesignResolution?: (width: number, height: number) => void;
    };
    Engine?: {
        repaintInEditMode?: () => void;
    };
};

declare const require: ((name: string) => CocosApi) | undefined;

export const methods = {
    async refreshDesignResolution(resolution: DesignResolution): Promise<void> {
        if (!cce.Startup?.changeDesignResolution && !cce.Startup?.initDesignResolution) {
            throw new Error('cce.Startup design resolution methods are unavailable.');
        }

        cce.Startup?.changeDesignResolution?.(resolution.width, resolution.height);
        await cce.Startup?.initDesignResolution?.();
        cce.Engine?.repaintInEditMode?.();
    },

    refreshI18nComponents(translations: Record<string, string>): void {
        const cocos = getCocosApi();

        const scene = cocos.director.getScene();
        if (!scene) {
            return;
        }

        refreshNodeI18nComponents(scene, translations, cocos);
        cce.Engine?.repaintInEditMode?.();
    },

    refreshI18nLabels(translations: Record<string, string>): void {
        methods.refreshI18nComponents(translations);
    },
};

function getCocosApi(): CocosApi {
    const globalCc = (globalThis as { cc?: CocosApi }).cc;
    if (globalCc) return globalCc;

    if (typeof require === 'function') return require('cc');

    throw new Error('Cocos cc api is unavailable.');
}

function refreshNodeI18nComponents(node: SceneNode, translations: Record<string, string>, cocos: CocosApi): number {
    let count = 0;
    for (const comp of node.getComponents<SceneComponent>(cocos.Component)) {
        if (isI18nComponent(comp)) {
            comp.refreshEditorPreview?.();
        }

        const key = readI18nKey(comp);
        if (!key) continue;

        const label = node.getComponent<{ string: string }>(cocos.Label);
        if (!label) {
            continue;
        }

        label.string = translations[key] ?? key;
        count++;
    }

    for (const child of node.children) {
        count += refreshNodeI18nComponents(child, translations, cocos);
    }

    return count;
}

function isI18nComponent(comp: SceneComponent): boolean {
    const record = comp as unknown as Record<string, unknown>;
    const ctorName = comp.constructor?.name;
    return ctorName === 'I18nLabel'
        || ctorName === 'I18nSprite'
        || 'refreshEditorPreview' in record
        || '_key' in record
        || '_relativePath' in record;
}

function readI18nKey(comp: SceneComponent): string {
    const record = comp as unknown as Record<string, unknown>;
    const ctorName = comp.constructor?.name;
    if (ctorName !== 'I18nLabel' && !('_key' in record) && !('key' in record)) return '';

    const key = typeof record.key === 'string' ? record.key : record._key;
    return typeof key === 'string' ? key : '';
}
