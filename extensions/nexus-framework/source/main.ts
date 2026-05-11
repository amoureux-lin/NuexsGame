import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';

type DesignResolution = {
    fitWidth: boolean;
    fitHeight: boolean;
    width: number;
    height: number;
};

type NexusSettingsData = {
    bundleName: string;
    editorLanguage: string;
    orientation: number;
};

type ApplyDesignResolutionOptions = {
    force?: boolean;
    reloadScene?: boolean;
    refreshSceneWhenUnchanged?: boolean;
};

type DumpProperty = {
    value?: unknown;
    name?: string;
    displayName?: string;
    type?: string;
    [key: string]: unknown;
};

type DumpNode = {
    name?: DumpProperty;
    children?: DumpNode[];
    __comps__?: DumpProperty[];
};

const PACKAGE_NAME = 'nexus-framework';
const COMPONENT_NAME = 'NexusSettings';
const LEGACY_COMPONENT_NAME = 'SceneResolution';
const SCENE_SETTINGS_PATH = 'settings/v2/packages/scene.json';
const BUILD_TAG = '2026-05-06-edit-mode-orientation-sync';
const DEBUG = false;
const I18N_DEBUG = false;
const SCENE_SAVE_MESSAGE = 'save-scene';
const DEFAULT_EDITOR_LANGUAGE = 'zh_CN';
const EDITOR_LANGUAGE_PROFILE_KEY = 'i18n.editorLanguage';
const I18N_LANGUAGES_PROFILE_KEY = 'i18n.languages';
const I18N_SPRITE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const I18N_SPINE_EXTENSIONS = ['.skel', '.json'];
const I18N_DRAGON_BONES_ASSET_EXTENSIONS = ['.json'];
const I18N_DRAGON_BONES_ATLAS_EXTENSIONS = ['.json', '.atlas'];

const LANDSCAPE: DesignResolution = {
    fitWidth: false,
    fitHeight: true,
    width: 1334,
    height: 750,
};

const PORTRAIT: DesignResolution = {
    fitWidth: true,
    fitHeight: false,
    width: 750,
    height: 1334,
};

let syncTimer: NodeJS.Timeout | undefined;
let currentSceneUuid: string | undefined;
let lastAppliedResolutionKey: string | undefined;
let currentNexusSettings: NexusSettingsData = {
    bundleName: '',
    editorLanguage: DEFAULT_EDITOR_LANGUAGE,
    orientation: 0,
};
let currentI18nLanguages: string[] = [DEFAULT_EDITOR_LANGUAGE];
let i18nRevision = 0;

function logStep(step: string, ...args: unknown[]): void {
    if (!DEBUG) return;
    console.log(`[${PACKAGE_NAME}][debug] ${step}`, ...args);
}

function logI18nStep(step: string, ...args: unknown[]): void {
    if (!I18N_DEBUG) return;
    console.log(`[${PACKAGE_NAME}][i18n] ${step}`, ...args);
}

function resolutionKey(resolution: DesignResolution): string {
    return `${resolution.width}x${resolution.height}:${resolution.fitWidth ? 1 : 0}:${resolution.fitHeight ? 1 : 0}`;
}

async function softReloadScene(reason: string): Promise<void> {
    try {
        await Editor.Message.request('scene', 'soft-reload');
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to refresh scene:`, error);
    }
}

async function refreshDesignResolutionInScene(resolution: DesignResolution, reason: string): Promise<void> {
    try {
        await Editor.Message.request('scene', 'execute-scene-script', {
            name: PACKAGE_NAME,
            method: 'refreshDesignResolution',
            args: [resolution],
        });
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to refresh design resolution, fallback to scene reload:`, error);
        await softReloadScene(reason);
    }
}

async function refreshI18nComponentsInScene(): Promise<void> {
    try {
        const language = currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE;
        const bundleName = currentNexusSettings.bundleName || '';
        logI18nStep('refresh-scene:start', { bundleName, language });
        const translations = readI18nFile(bundleName, language);
        logI18nStep('refresh-scene:translations-ready', {
            bundleName,
            language,
            count: Object.keys(translations).length,
        });
        await Editor.Message.request('scene', 'execute-scene-script', {
            name: PACKAGE_NAME,
            method: 'refreshI18nComponents',
            args: [translations],
        });
        logI18nStep('refresh-scene:done', { bundleName, language });
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to refresh i18n labels in scene:`, error);
    }
}

function scheduleRefreshI18nComponentsInScene(delay = 500): void {
    setTimeout(() => {
        void refreshI18nComponentsInScene();
    }, delay);
}

function isSameResolution(a: unknown, b: DesignResolution): boolean {
    if (!a || typeof a !== 'object') return false;

    const record = a as Partial<DesignResolution>;
    return !!record.fitWidth === b.fitWidth
        && !!record.fitHeight === b.fitHeight
        && Number(record.width) === b.width
        && Number(record.height) === b.height;
}

async function queryDesignResolution(reason: string): Promise<unknown> {
    try {
        const value = await Editor.Message.request('project', 'query-config', 'project', 'general.designResolution');
        logStep('queryDesignResolution:result', { reason, value });
        return value;
    } catch (error) {
        logStep('queryDesignResolution:error', { reason, error });
        return undefined;
    }
}

async function saveCurrentScene(reason: string): Promise<boolean> {
    logStep('saveCurrentScene:start', { reason, message: SCENE_SAVE_MESSAGE });

    try {
        logStep('saveCurrentScene:request', { reason, message: SCENE_SAVE_MESSAGE });
        const result = await Editor.Message.request('scene', SCENE_SAVE_MESSAGE);
        logStep('saveCurrentScene:result', { reason, message: SCENE_SAVE_MESSAGE, result });
        return true;
    } catch (error) {
        logStep('saveCurrentScene:error', { reason, message: SCENE_SAVE_MESSAGE, error });
    }

    console.warn(`[${PACKAGE_NAME}] Failed to save current scene before applying design resolution.`);
    return false;
}

function readDumpValue<T = unknown>(dump: unknown): T | undefined {
    if (dump && typeof dump === 'object' && 'value' in dump) {
        return (dump as { value?: T }).value;
    }

    return dump as T | undefined;
}

function isNexusSettingsComponent(comp: DumpProperty): boolean {
    const value = comp.value;
    if (!value || typeof value !== 'object') return false;

    const name = readDumpValue((value as Record<string, unknown>).name);
    return name === COMPONENT_NAME
        || name === LEGACY_COMPONENT_NAME
        || comp.name === COMPONENT_NAME
        || comp.name === LEGACY_COMPONENT_NAME
        || 'orientation' in value
        || '_orientation' in value;
}

function findNexusSettings(root: DumpNode | undefined): DumpProperty | undefined {
    if (!root) return undefined;

    const comps = root.__comps__ ?? [];
    const matched = comps.find(isNexusSettingsComponent);
    if (matched) return matched;

    for (const child of root.children ?? []) {
        const result = findNexusSettings(child);
        if (result) return result;
    }

    return undefined;
}

function settingsFromComponent(comp: DumpProperty): NexusSettingsData | undefined {
    const value = comp.value;
    if (!value || typeof value !== 'object') return undefined;

    const record = value as Record<string, unknown>;
    if (!('orientation' in record) && !('_orientation' in record)) return undefined;

    const orientation = Number(readDumpValue(record.orientation) ?? readDumpValue(record._orientation) ?? 0);
    const bundleName = String(readDumpValue(record.bundleName) ?? readDumpValue(record._bundleName) ?? '');
    return {
        bundleName,
        editorLanguage: currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE,
        orientation,
    };
}

function resolutionFromSettings(settings: NexusSettingsData): DesignResolution {
    return settings.orientation === 1 ? PORTRAIT : LANDSCAPE;
}

function updateCurrentNexusSettings(settings: Partial<NexusSettingsData>): NexusSettingsData {
    const previousBundleName = currentNexusSettings.bundleName;
    const previousEditorLanguage = currentNexusSettings.editorLanguage;

    currentNexusSettings = {
        bundleName: settings.bundleName ?? currentNexusSettings.bundleName,
        editorLanguage: (settings.editorLanguage ?? currentNexusSettings.editorLanguage) || DEFAULT_EDITOR_LANGUAGE,
        orientation: Number(settings.orientation ?? currentNexusSettings.orientation ?? 0),
    };
    if (
        currentNexusSettings.bundleName !== previousBundleName
        || currentNexusSettings.editorLanguage !== previousEditorLanguage
    ) {
        i18nRevision++;
    }
    logI18nStep('settings:update', currentNexusSettings);
    return currentNexusSettings;
}

async function loadEditorLanguage(): Promise<string> {
    try {
        const value = await Editor.Profile.getProject(PACKAGE_NAME, EDITOR_LANGUAGE_PROFILE_KEY, 'project');
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    } catch (error) {
        logI18nStep('load-editor-language:error', error);
    }

    return DEFAULT_EDITOR_LANGUAGE;
}

async function initializeEditorLanguage(): Promise<void> {
    const editorLanguage = await loadEditorLanguage();
    const languages = await loadI18nLanguages();
    currentI18nLanguages = normalizeLanguages([...languages, editorLanguage]);
    const nextEditorLanguage = currentI18nLanguages.includes(editorLanguage) ? editorLanguage : currentI18nLanguages[0];
    updateCurrentNexusSettings({ editorLanguage: nextEditorLanguage });
}

async function saveEditorLanguage(editorLanguage: string): Promise<string> {
    const value = editorLanguage.trim() || DEFAULT_EDITOR_LANGUAGE;
    if (!currentI18nLanguages.includes(value)) {
        currentI18nLanguages = normalizeLanguages([...currentI18nLanguages, value]);
        await saveI18nLanguages(currentI18nLanguages);
    }

    await Editor.Profile.setProject(PACKAGE_NAME, EDITOR_LANGUAGE_PROFILE_KEY, value, 'project');
    updateCurrentNexusSettings({ editorLanguage: value });
    return value;
}

async function loadI18nLanguages(): Promise<string[]> {
    try {
        const value = await Editor.Profile.getProject(PACKAGE_NAME, I18N_LANGUAGES_PROFILE_KEY, 'project');
        if (Array.isArray(value)) {
            return normalizeLanguages(value);
        }
    } catch (error) {
        logI18nStep('load-i18n-languages:error', error);
    }

    return normalizeLanguages(availableEditorLanguages());
}

async function saveI18nLanguages(languages: string[]): Promise<string[]> {
    const values = normalizeLanguages(languages);
    currentI18nLanguages = values;
    await Editor.Profile.setProject(PACKAGE_NAME, I18N_LANGUAGES_PROFILE_KEY, values, 'project');
    return values;
}

async function waitSceneReady(maxRetry = 20): Promise<boolean> {
    logStep('waitSceneReady:start', { maxRetry });

    for (let i = 0; i < maxRetry; i++) {
        try {
            const ready = await Editor.Message.request('scene', 'query-is-ready');
            logStep('waitSceneReady:query', { retry: i + 1, ready });
            if (ready) {
                logStep('waitSceneReady:ready', { retry: i + 1 });
                return true;
            }
        } catch (error) {
            logStep('waitSceneReady:error', { retry: i + 1, error });
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
}

async function applyDesignResolution(
    resolution: DesignResolution,
    reason: string,
    options: ApplyDesignResolutionOptions = {},
): Promise<void> {
    logStep('applyDesignResolution:request', { reason, resolution, options });

    const key = resolutionKey(resolution);
    if (!options.force && lastAppliedResolutionKey === key) {
        logStep('applyDesignResolution:duplicate-still-apply', { reason, resolution });
    }

    const before = await queryDesignResolution(`${reason}:before`);
    const changed = !isSameResolution(before, resolution);
    logStep('applyDesignResolution:change-check', { reason, before, resolution, changed });

    if (!options.force && !changed) {
        lastAppliedResolutionKey = key;
        logStep('applyDesignResolution:skip-unchanged', { reason, resolution });
        if (options.refreshSceneWhenUnchanged && options.reloadScene !== false) {
            await refreshDesignResolutionInScene(resolution, 'unchanged-resolution');
        }
        return;
    }

    const ok = await Editor.Message.request('project', 'set-config', 'project', 'general.designResolution', resolution);
    logStep('applyDesignResolution:result', { reason, resolution, ok });

    if (!ok) {
        console.warn(`[${PACKAGE_NAME}] Failed to apply design resolution.`);
        return;
    }

    lastAppliedResolutionKey = key;
    await queryDesignResolution(`${reason}:after`);

    if (options.reloadScene !== false && (changed || options.refreshSceneWhenUnchanged)) {
        await refreshDesignResolutionInScene(resolution, 'applied-resolution');
    } else if (!changed) {
        logStep('applyDesignResolution:skip-soft-reload-unchanged', { reason });
    } else {
        logStep('applyDesignResolution:skip-soft-reload', { reason });
    }
}

async function applyNexusSettings(settings: NexusSettingsData, reason: string, options: ApplyDesignResolutionOptions = {}): Promise<void> {
    const next = updateCurrentNexusSettings(settings);
    await applyDesignResolution(resolutionFromSettings(next), reason, options);
    await refreshI18nComponentsInScene();
    scheduleRefreshI18nComponentsInScene();
}

function readJsonFile<T = unknown>(file: string): T | undefined {
    logStep('readJsonFile:start', { file });

    try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as T;
        logStep('readJsonFile:success', { file });
        return data;
    } catch (error) {
        logStep('readJsonFile:error', { file, error });
        return undefined;
    }
}

function readI18nFile(bundleName: string, language: string): Record<string, string> {
    logI18nStep('read-file:start', { bundleName, language });
    const languageNames = languagePathNames(language);
    const candidates: string[] = [];

    for (const lang of languageNames) {
        candidates.push(...languageBundleFiles(lang, 'common'));
        if (bundleName) {
            candidates.push(...languageBundleFiles(lang, bundleName));
        }
    }

    const result: Record<string, string> = {};
    for (const file of unique(candidates)) {
        if (!existsSync(file)) {
            logI18nStep('read-file:missing', { file });
            continue;
        }

        const data = readJsonFile<Record<string, unknown>>(file);
        if (!data) {
            logI18nStep('read-file:invalid-json', { file });
            continue;
        }

        let count = 0;
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string') {
                result[key] = value;
                count++;
            }
        }
        logI18nStep('read-file:loaded', { file, count });
    }
    logI18nStep('read-file:done', { bundleName, language, count: Object.keys(result).length });
    return result;
}

function languagePathNames(language: string): string[] {
    const names = [language];
    if (language.includes('_')) names.push(language.replace(/_/g, '-'));
    if (language.includes('-')) names.push(language.replace(/-/g, '_'));
    return unique(names.filter(Boolean));
}

function languageBundleFiles(language: string, bundleName: string): string[] {
    const root = join(Editor.Project.path, 'assets', 'languages', language, bundleName);
    return [
        `${root}.json`,
        join(root, `${language}.json`),
        join(root, `${language.replace(/-/g, '_')}.json`),
        join(root, 'index.json'),
    ];
}

function availableEditorLanguages(): string[] {
    const result = [DEFAULT_EDITOR_LANGUAGE];
    const languageRoot = join(Editor.Project.path, 'assets', 'languages');
    if (existsSync(languageRoot)) {
        for (const entry of readdirSync(languageRoot)) {
            const path = join(languageRoot, entry);
            if (statSync(path).isDirectory()) {
                result.push(entry);
            }
        }
    }

    return unique(result).sort();
}

function normalizeLanguages(languages: unknown[]): string[] {
    const result = languages
        .map((language) => typeof language === 'string' ? language.trim() : '')
        .filter(Boolean);
    return unique(result.length > 0 ? result : [DEFAULT_EDITOR_LANGUAGE]);
}

function unique<T>(items: T[]): T[] {
    return items.filter((item, index) => items.indexOf(item) === index);
}

function formatText(text: string, params?: Record<string, unknown>): string {
    if (!params) return text;

    let result = text;
    for (const key of Object.keys(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(params[key]));
    }
    return result;
}

function queryI18nText(key: string, params?: Record<string, unknown>): string {
    const language = currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE;
    const bundleName = currentNexusSettings.bundleName || '';
    logI18nStep('query-text:start', { key, bundleName, language, hasParams: !!params });
    const translations = readI18nFile(bundleName, language);
    const result = formatText(translations[key] ?? key, params);
    logI18nStep('query-text:result', { key, result, matched: result !== key });
    return result;
}

async function parseI18nSpriteAsset(uuid: string): Promise<{ bundleName: string; relativePath: string } | null> {
    return parseI18nLocalizedAsset(uuid, stripSpritePathDecorations);
}

async function parseI18nLocalizedAsset(
    uuid: string,
    stripPathDecorations: (path: string) => string = stripI18nAssetPathDecorations,
): Promise<{ bundleName: string; relativePath: string } | null> {
    const info = await queryAssetInfo(uuid);
    const infoUrl = info?.url;
    const infoSource = info?.source;
    const url = normalizeAssetUrl(
        typeof infoUrl === 'string' ? infoUrl : typeof infoSource === 'string' ? infoSource : '',
    );
    if (!url) return null;

    const parsed = parseI18nAssetUrl(url);
    if (!parsed) return null;

    return {
        bundleName: parsed.bundleName,
        relativePath: stripPathDecorations(parsed.relativePath),
    };
}

async function queryI18nSpriteAsset(bundleName: string, relativePath: string): Promise<{ uuid: string; url: string } | null> {
    const cleanBundleName = String(bundleName || '').trim();
    const cleanRelativePath = stripSpritePathDecorations(String(relativePath || '').trim());
    if (!cleanBundleName || !cleanRelativePath) return null;

    const languages = languagePathNames(currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE);
    for (const language of languages) {
        const result = await queryI18nSpriteAssetByLanguage(language, cleanBundleName, cleanRelativePath);
        if (result) return result;
    }

    return null;
}

async function queryI18nSpineAsset(bundleName: string, relativePath: string): Promise<{ uuid: string; url: string } | null> {
    return queryI18nAsset(bundleName, relativePath, I18N_SPINE_EXTENSIONS, findAssetUuid);
}

async function queryI18nDragonBonesAsset(bundleName: string, relativePath: string): Promise<{ uuid: string; url: string } | null> {
    return queryI18nAsset(bundleName, relativePath, I18N_DRAGON_BONES_ASSET_EXTENSIONS, findAssetUuid);
}

async function queryI18nDragonBonesAtlasAsset(bundleName: string, relativePath: string): Promise<{ uuid: string; url: string } | null> {
    return queryI18nAsset(bundleName, relativePath, I18N_DRAGON_BONES_ATLAS_EXTENSIONS, findAssetUuid);
}

async function queryI18nAsset(
    bundleName: string,
    relativePath: string,
    extensions: string[],
    findUuid: (info: Record<string, unknown> | null) => string,
): Promise<{ uuid: string; url: string } | null> {
    const cleanBundleName = String(bundleName || '').trim();
    const cleanRelativePath = stripI18nAssetPathDecorations(String(relativePath || '').trim());
    if (!cleanBundleName || !cleanRelativePath) return null;

    const languages = languagePathNames(currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE);
    for (const language of languages) {
        for (const ext of extensions) {
            const assetUrl = `db://assets/languages/${language}/${cleanBundleName}/${cleanRelativePath}${ext}`;
            const info = await queryAssetInfo(assetUrl);
            const uuid = findUuid(info);
            if (uuid) {
                return { uuid, url: assetUrl };
            }
        }
    }

    return null;
}

async function queryI18nSpriteAssetByLanguage(
    language: string,
    bundleName: string,
    relativePath: string,
): Promise<{ uuid: string; url: string } | null> {
    for (const ext of I18N_SPRITE_EXTENSIONS) {
        const assetUrl = `db://assets/languages/${language}/${bundleName}/${relativePath}${ext}`;
        const info = await queryAssetInfo(assetUrl);
        const uuid = findSpriteFrameUuid(info);
        if (uuid) {
            return { uuid, url: assetUrl };
        }
    }

    return null;
}

async function queryAssetInfo(urlOrUuidOrPath: string): Promise<Record<string, unknown> | null> {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', urlOrUuidOrPath) as Record<string, unknown> | null;
    } catch (error) {
        logStep('queryAssetInfo:error', { urlOrUuidOrPath, error });
        return null;
    }
}

function findSpriteFrameUuid(info: Record<string, unknown> | null): string {
    if (!info) return '';

    if (info.type === 'cc.SpriteFrame' || info.importer === 'sprite-frame' || info.name === 'spriteFrame') {
        return typeof info.uuid === 'string' ? info.uuid : '';
    }

    const subAssets = info.subAssets;
    if (!subAssets || typeof subAssets !== 'object') return '';

    for (const subAsset of Object.values(subAssets as Record<string, unknown>)) {
        if (!subAsset || typeof subAsset !== 'object') continue;

        const record = subAsset as Record<string, unknown>;
        if (record.importer === 'sprite-frame' || record.name === 'spriteFrame' || record.type === 'cc.SpriteFrame') {
            return typeof record.uuid === 'string' ? record.uuid : '';
        }
    }

    return '';
}

function findAssetUuid(info: Record<string, unknown> | null): string {
    return typeof info?.uuid === 'string' ? info.uuid : '';
}

function normalizeAssetUrl(url: string): string {
    return url.replace(/\/spriteFrame$/, '');
}

function parseI18nAssetUrl(url: string): { language: string; bundleName: string; relativePath: string } | null {
    const match = normalizeAssetUrl(url).match(/^db:\/\/assets\/languages\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) return null;

    return {
        language: match[1],
        bundleName: match[2],
        relativePath: stripSpritePathDecorations(match[3]),
    };
}

function stripSpritePathDecorations(path: string): string {
    return path
        .replace(/\/spriteFrame$/, '')
        .replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

function stripI18nAssetPathDecorations(path: string): string {
    return path
        .replace(/\/spriteFrame$/, '')
        .replace(/\.(png|jpg|jpeg|webp|skel|json|atlas)$/i, '');
}

function walkFiles(root: string, matcher: (file: string) => boolean): string[] {
    if (!existsSync(root)) {
        logStep('walkFiles:missing-root', { root });
        return [];
    }

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

function readCurrentSceneUuid(): string | undefined {
    if (currentSceneUuid) {
        logStep('readCurrentSceneUuid:from-broadcast', { uuid: currentSceneUuid });
        return currentSceneUuid;
    }

    const settingsPath = join(Editor.Project.path, SCENE_SETTINGS_PATH);
    logStep('readCurrentSceneUuid:from-settings:start', { settingsPath });

    const settings = readJsonFile<Record<string, unknown>>(settingsPath);
    const uuid = settings?.['current-scene'];
    const result = typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined;
    logStep('readCurrentSceneUuid:from-settings:result', { uuid: result });
    return result;
}

function findScenePathByUuid(uuid: string): string | undefined {
    const assetsRoot = join(Editor.Project.path, 'assets');
    logStep('findScenePathByUuid:start', { uuid, assetsRoot });

    const sceneMetas = walkFiles(assetsRoot, (file) => file.endsWith('.scene.meta'));
    logStep('findScenePathByUuid:metas-found', { count: sceneMetas.length });

    for (const metaPath of sceneMetas) {
        const meta = readJsonFile<Record<string, unknown>>(metaPath);
        if (meta?.uuid === uuid) {
            const scenePath = metaPath.replace(/\.meta$/, '');
            logStep('findScenePathByUuid:matched-meta', { metaPath, scenePath, exists: existsSync(scenePath) });
            return existsSync(scenePath) ? scenePath : undefined;
        }
    }

    logStep('findScenePathByUuid:not-found', { uuid });
    return undefined;
}

function findScenePathByRootName(rootName: string): string | undefined {
    const assetsRoot = join(Editor.Project.path, 'assets');
    logStep('findScenePathByRootName:start', { rootName, assetsRoot });

    const sceneMetas = walkFiles(assetsRoot, (file) => file.endsWith('.scene.meta'));
    logStep('findScenePathByRootName:metas-found', { count: sceneMetas.length });

    for (const metaPath of sceneMetas) {
        const scenePath = metaPath.replace(/\.meta$/, '');
        const sceneName = basename(scenePath, '.scene');
        if (sceneName === rootName) {
            logStep('findScenePathByRootName:matched-file-name', { sceneName, metaPath, scenePath, exists: existsSync(scenePath) });
            return existsSync(scenePath) ? scenePath : undefined;
        }
    }

    logStep('findScenePathByRootName:not-found', { rootName });
    return undefined;
}

function findSettingsInSerializedScene(sceneData: unknown, path = '$'): NexusSettingsData | undefined {
    if (Array.isArray(sceneData)) {
        for (let i = 0; i < sceneData.length; i++) {
            const result = findSettingsInSerializedScene(sceneData[i], `${path}[${i}]`);
            if (result !== undefined) return result;
        }
        return undefined;
    }

    if (!sceneData || typeof sceneData !== 'object') return undefined;

    const record = sceneData as Record<string, unknown>;
    if (
        typeof record.orientation === 'number'
        || typeof record._orientation === 'number'
    ) {
        const orientation = typeof record.orientation === 'number' ? record.orientation : record._orientation;
        const bundleName = typeof record.bundleName === 'string' ? record.bundleName : record._bundleName;
        const settings = {
            bundleName: typeof bundleName === 'string' ? bundleName : '',
            editorLanguage: currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE,
            orientation: typeof orientation === 'number' ? orientation : 0,
        };
        logStep('findSettingsInSerializedScene:hit', { path, settings, type: record.__type__ });
        return settings;
    }

    for (const [key, value] of Object.entries(record)) {
        const result = findSettingsInSerializedScene(value, `${path}.${key}`);
        if (result !== undefined) return result;
    }

    return undefined;
}

function settingsFromCurrentSceneAsset(): NexusSettingsData | undefined {
    logStep('settingsFromCurrentSceneAsset:start');

    const uuid = readCurrentSceneUuid();
    if (!uuid) {
        logStep('settingsFromCurrentSceneAsset:no-current-uuid');
        return undefined;
    }

    const scenePath = findScenePathByUuid(uuid);
    if (!scenePath) {
        console.warn(`[${PACKAGE_NAME}] Could not find scene file for uuid: ${uuid}`);
        return undefined;
    }

    const sceneData = readJsonFile(scenePath);
    if (!sceneData) {
        logStep('settingsFromCurrentSceneAsset:no-scene-data', { scenePath });
        return undefined;
    }

    const settings = findSettingsInSerializedScene(sceneData);
    if (!settings) {
        logStep('settingsFromCurrentSceneAsset:no-component', { scenePath });
        return undefined;
    }

    logStep('settingsFromCurrentSceneAsset:resolved', { uuid, scenePath, settings });
    return settings;
}

function settingsFromScenePath(scenePath: string, reason: string): NexusSettingsData | undefined {
    const sceneData = readJsonFile(scenePath);
    if (!sceneData) {
        logStep('settingsFromScenePath:no-scene-data', { scenePath, reason });
        return undefined;
    }

    const settings = findSettingsInSerializedScene(sceneData);
    if (!settings) {
        logStep('settingsFromScenePath:no-component', { scenePath, reason });
        return undefined;
    }

    logStep('settingsFromScenePath:resolved', { reason, scenePath, settings });
    return settings;
}

async function syncFromCurrentScene(options: ApplyDesignResolutionOptions = {}): Promise<void> {
    logStep('syncFromCurrentScene:start', { currentSceneUuid });

    const ready = await waitSceneReady();
    if (!ready) {
        console.warn(`[${PACKAGE_NAME}] Scene is not ready, skip resolution sync.`);
        return;
    }

    const tree = await Editor.Message.request('scene', 'query-node-tree') as unknown as DumpNode | undefined;
    const rootName = readDumpValue<string>(tree?.name);
    logStep('syncFromCurrentScene:query-node-tree-result', {
        hasTree: !!tree,
        rootName,
        childCount: tree?.children?.length ?? 0,
        compCount: tree?.__comps__?.length ?? 0,
    });

    const comp = findNexusSettings(tree);
    if (comp) {
        const settings = settingsFromComponent(comp);
        if (settings) {
            await applyNexusSettings(settings, `Synced from live ${COMPONENT_NAME}`, options);
            return;
        }

        console.warn(`[${PACKAGE_NAME}] Invalid live ${COMPONENT_NAME} component data.`);
    } else {
        logStep('syncFromCurrentScene:no-live-component');
    }

    if (rootName) {
        const scenePath = findScenePathByRootName(rootName);
        if (scenePath) {
            const settingsFromRootName = settingsFromScenePath(scenePath, `rootName=${rootName}`);
            if (settingsFromRootName) {
                await applyNexusSettings(settingsFromRootName, `Synced from ${COMPONENT_NAME} scene asset by root name`, options);
                return;
            }
        }
    }

    const settingsFromAsset = settingsFromCurrentSceneAsset();
    if (settingsFromAsset) {
        await applyNexusSettings(settingsFromAsset, `Synced from ${COMPONENT_NAME} scene asset`, options);
        return;
    }

    logStep('syncFromCurrentScene:no-component');
}

function scheduleSyncFromCurrentScene(options: ApplyDesignResolutionOptions = {}): void {
    logStep('scheduleSyncFromCurrentScene', { hadPendingTimer: !!syncTimer, currentSceneUuid });

    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = undefined;
        void syncFromCurrentScene(options).catch((error) => {
            console.error(`[${PACKAGE_NAME}] Sync failed:`, error);
        });
    }, 300);
}

function addBroadcastListener(message: string, handler: (...args: unknown[]) => void): void {
    const protectedMessage = (Editor.Message as unknown as {
        __protected__?: {
            addBroadcastListener?: (message: string, func: Function) => void;
        };
    }).__protected__;

    protectedMessage?.addBroadcastListener?.(message, handler);
}

function removeBroadcastListener(message: string, handler: (...args: unknown[]) => void): void {
    const protectedMessage = (Editor.Message as unknown as {
        __protected__?: {
            removeBroadcastListener?: (message: string, func: Function) => void;
        };
    }).__protected__;

    protectedMessage?.removeBroadcastListener?.(message, handler);
}

function updateCurrentSceneUuid(args: unknown[]): void {
    logStep('updateCurrentSceneUuid:args', args);

    const uuid = args.find((arg) => typeof arg === 'string' && /^[0-9a-f-]{32,36}$/i.test(arg));
    if (typeof uuid === 'string') {
        currentSceneUuid = uuid;
        logStep('updateCurrentSceneUuid:matched', { uuid });
    } else {
        logStep('updateCurrentSceneUuid:not-matched');
    }
}

const onSceneOpened = (...args: unknown[]) => {
    logStep('event:multi-open-scene', args);
    updateCurrentSceneUuid(args);
    scheduleSyncFromCurrentScene({ refreshSceneWhenUnchanged: true });
};

const onSceneFocused = (...args: unknown[]) => {
    logStep('event:multi-scene-focus', args);
    updateCurrentSceneUuid(args);
    scheduleSyncFromCurrentScene({ refreshSceneWhenUnchanged: true });
};

const onSceneDirty = (...args: unknown[]) => {
    logStep('event:multi-scene-dirty', args);
    updateCurrentSceneUuid(args);
    scheduleSyncFromCurrentScene();
};

export const methods: { [key: string]: (...args: any[]) => any } = {
    showLog() {
        console.log('Nexus Framework');
    },

    async openI18nPanel() {
        await Editor.Panel.open(`${PACKAGE_NAME}.i18n`);
    },

    queryI18nPanelState() {
        return {
            bundleName: currentNexusSettings.bundleName,
            editorLanguage: currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE,
            languages: currentI18nLanguages,
        };
    },

    async setEditorLanguage(editorLanguage: string) {
        const value = await saveEditorLanguage(String(editorLanguage || ''));
        await refreshI18nComponentsInScene();
        return {
            bundleName: currentNexusSettings.bundleName,
            editorLanguage: value,
            languages: currentI18nLanguages,
        };
    },

    async setI18nLanguages(languages: unknown[], editorLanguage?: string) {
        const values = await saveI18nLanguages(Array.isArray(languages) ? normalizeLanguages(languages) : []);
        const preferredLanguage = typeof editorLanguage === 'string' && values.includes(editorLanguage)
            ? editorLanguage
            : values.includes(currentNexusSettings.editorLanguage)
                ? currentNexusSettings.editorLanguage
                : values[0];

        const value = await saveEditorLanguage(preferredLanguage);
        await refreshI18nComponentsInScene();
        return {
            bundleName: currentNexusSettings.bundleName,
            editorLanguage: value,
            languages: currentI18nLanguages,
        };
    },

    syncCurrentScene() {
        logStep('method:syncCurrentScene');
        scheduleSyncFromCurrentScene();
    },

    async syncOrientation(orientation: unknown) {
        const value = Number(orientation);
        logStep('method:syncOrientation', { orientation, value });
        const saved = await saveCurrentScene(`live ${COMPONENT_NAME} inspector`);
        if (!saved) return;

        await applyNexusSettings({ ...currentNexusSettings, orientation: value }, `Synced from live ${COMPONENT_NAME} inspector`, {
            force: true,
            reloadScene: true,
            refreshSceneWhenUnchanged: true,
        });
    },

    async syncNexusSettings(settings: Partial<NexusSettingsData>) {
        logI18nStep('method:syncNexusSettings', { settings });
        const saved = await saveCurrentScene(`live ${COMPONENT_NAME} inspector`);
        if (!saved) return;

        await applyNexusSettings(updateCurrentNexusSettings(settings), `Synced from live ${COMPONENT_NAME} inspector`, {
            force: true,
            reloadScene: true,
            refreshSceneWhenUnchanged: true,
        });
    },

    queryI18nText(key: string, params?: Record<string, unknown>) {
        if (!key) return '';
        logI18nStep('method:queryI18nText', { key, hasParams: !!params });
        return queryI18nText(key, params);
    },

    queryI18nEditorState() {
        return {
            revision: i18nRevision,
            bundleName: currentNexusSettings.bundleName,
            editorLanguage: currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE,
        };
    },

    parseI18nSpriteAsset(uuid: string) {
        return parseI18nSpriteAsset(String(uuid || ''));
    },

    queryI18nSpriteAsset(bundleName: string, relativePath: string) {
        return queryI18nSpriteAsset(String(bundleName || ''), String(relativePath || ''));
    },

    parseI18nAsset(uuid: string) {
        return parseI18nLocalizedAsset(String(uuid || ''));
    },

    'parse-i18n-asset'(uuid: string) {
        return parseI18nLocalizedAsset(String(uuid || ''));
    },

    queryI18nSpineAsset(bundleName: string, relativePath: string) {
        return queryI18nSpineAsset(String(bundleName || ''), String(relativePath || ''));
    },

    'query-i18n-spine-asset'(bundleName: string, relativePath: string) {
        return queryI18nSpineAsset(String(bundleName || ''), String(relativePath || ''));
    },

    queryI18nDragonBonesAsset(bundleName: string, relativePath: string) {
        return queryI18nDragonBonesAsset(String(bundleName || ''), String(relativePath || ''));
    },

    'query-i18n-dragon-bones-asset'(bundleName: string, relativePath: string) {
        return queryI18nDragonBonesAsset(String(bundleName || ''), String(relativePath || ''));
    },

    queryI18nDragonBonesAtlasAsset(bundleName: string, relativePath: string) {
        return queryI18nDragonBonesAtlasAsset(String(bundleName || ''), String(relativePath || ''));
    },

    'query-i18n-dragon-bones-atlas-asset'(bundleName: string, relativePath: string) {
        return queryI18nDragonBonesAtlasAsset(String(bundleName || ''), String(relativePath || ''));
    },

    onSceneReady() {
        logStep('method:onSceneReady');
        scheduleSyncFromCurrentScene({ refreshSceneWhenUnchanged: true });
    },

    async switchLandscape() {
        await applyDesignResolution(LANDSCAPE, 'Manual landscape switch');
    },

    async switchPortrait() {
        await applyDesignResolution(PORTRAIT, 'Manual portrait switch');
    },
};

/**
 * @en Method Triggered on Extension Startup
 * @zh 扩展启动时触发的方法
 */
export function load() {
    console.log(`[${PACKAGE_NAME}] load ${BUILD_TAG}`);
    addBroadcastListener('multi-open-scene', onSceneOpened);
    addBroadcastListener('multi-scene-focus', onSceneFocused);
    addBroadcastListener('multi-scene-dirty', onSceneDirty);
    void initializeEditorLanguage().finally(() => {
        scheduleSyncFromCurrentScene({ refreshSceneWhenUnchanged: true });
    });
}

/**
 * @en Method triggered when uninstalling the extension
 * @zh 卸载扩展时触发的方法
 */
export function unload() {
    logStep('unload:start');

    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = undefined;
    }

    removeBroadcastListener('multi-open-scene', onSceneOpened);
    removeBroadcastListener('multi-scene-focus', onSceneFocused);
    removeBroadcastListener('multi-scene-dirty', onSceneDirty);
}
