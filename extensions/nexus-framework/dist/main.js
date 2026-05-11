"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const fs_1 = require("fs");
const path_1 = require("path");
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
const LANDSCAPE = {
    fitWidth: false,
    fitHeight: true,
    width: 1334,
    height: 750,
};
const PORTRAIT = {
    fitWidth: true,
    fitHeight: false,
    width: 750,
    height: 1334,
};
let syncTimer;
let currentSceneUuid;
let lastAppliedResolutionKey;
let currentNexusSettings = {
    bundleName: '',
    editorLanguage: DEFAULT_EDITOR_LANGUAGE,
    orientation: 0,
};
let currentI18nLanguages = [DEFAULT_EDITOR_LANGUAGE];
let i18nRevision = 0;
function logStep(step, ...args) {
    if (!DEBUG)
        return;
    console.log(`[${PACKAGE_NAME}][debug] ${step}`, ...args);
}
function logI18nStep(step, ...args) {
    if (!I18N_DEBUG)
        return;
    console.log(`[${PACKAGE_NAME}][i18n] ${step}`, ...args);
}
function resolutionKey(resolution) {
    return `${resolution.width}x${resolution.height}:${resolution.fitWidth ? 1 : 0}:${resolution.fitHeight ? 1 : 0}`;
}
async function softReloadScene(reason) {
    try {
        await Editor.Message.request('scene', 'soft-reload');
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to refresh scene:`, error);
    }
}
async function refreshDesignResolutionInScene(resolution, reason) {
    try {
        await Editor.Message.request('scene', 'execute-scene-script', {
            name: PACKAGE_NAME,
            method: 'refreshDesignResolution',
            args: [resolution],
        });
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to refresh design resolution, fallback to scene reload:`, error);
        await softReloadScene(reason);
    }
}
async function refreshI18nComponentsInScene() {
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
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to refresh i18n labels in scene:`, error);
    }
}
function scheduleRefreshI18nComponentsInScene(delay = 500) {
    setTimeout(() => {
        void refreshI18nComponentsInScene();
    }, delay);
}
function isSameResolution(a, b) {
    if (!a || typeof a !== 'object')
        return false;
    const record = a;
    return !!record.fitWidth === b.fitWidth
        && !!record.fitHeight === b.fitHeight
        && Number(record.width) === b.width
        && Number(record.height) === b.height;
}
async function queryDesignResolution(reason) {
    try {
        const value = await Editor.Message.request('project', 'query-config', 'project', 'general.designResolution');
        logStep('queryDesignResolution:result', { reason, value });
        return value;
    }
    catch (error) {
        logStep('queryDesignResolution:error', { reason, error });
        return undefined;
    }
}
async function saveCurrentScene(reason) {
    logStep('saveCurrentScene:start', { reason, message: SCENE_SAVE_MESSAGE });
    try {
        logStep('saveCurrentScene:request', { reason, message: SCENE_SAVE_MESSAGE });
        const result = await Editor.Message.request('scene', SCENE_SAVE_MESSAGE);
        logStep('saveCurrentScene:result', { reason, message: SCENE_SAVE_MESSAGE, result });
        return true;
    }
    catch (error) {
        logStep('saveCurrentScene:error', { reason, message: SCENE_SAVE_MESSAGE, error });
    }
    console.warn(`[${PACKAGE_NAME}] Failed to save current scene before applying design resolution.`);
    return false;
}
function readDumpValue(dump) {
    if (dump && typeof dump === 'object' && 'value' in dump) {
        return dump.value;
    }
    return dump;
}
function isNexusSettingsComponent(comp) {
    const value = comp.value;
    if (!value || typeof value !== 'object')
        return false;
    const name = readDumpValue(value.name);
    return name === COMPONENT_NAME
        || name === LEGACY_COMPONENT_NAME
        || comp.name === COMPONENT_NAME
        || comp.name === LEGACY_COMPONENT_NAME
        || 'orientation' in value
        || '_orientation' in value;
}
function findNexusSettings(root) {
    var _a, _b;
    if (!root)
        return undefined;
    const comps = (_a = root.__comps__) !== null && _a !== void 0 ? _a : [];
    const matched = comps.find(isNexusSettingsComponent);
    if (matched)
        return matched;
    for (const child of (_b = root.children) !== null && _b !== void 0 ? _b : []) {
        const result = findNexusSettings(child);
        if (result)
            return result;
    }
    return undefined;
}
function settingsFromComponent(comp) {
    var _a, _b, _c, _d;
    const value = comp.value;
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value;
    if (!('orientation' in record) && !('_orientation' in record))
        return undefined;
    const orientation = Number((_b = (_a = readDumpValue(record.orientation)) !== null && _a !== void 0 ? _a : readDumpValue(record._orientation)) !== null && _b !== void 0 ? _b : 0);
    const bundleName = String((_d = (_c = readDumpValue(record.bundleName)) !== null && _c !== void 0 ? _c : readDumpValue(record._bundleName)) !== null && _d !== void 0 ? _d : '');
    return {
        bundleName,
        editorLanguage: currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE,
        orientation,
    };
}
function resolutionFromSettings(settings) {
    return settings.orientation === 1 ? PORTRAIT : LANDSCAPE;
}
function updateCurrentNexusSettings(settings) {
    var _a, _b, _c, _d;
    const previousBundleName = currentNexusSettings.bundleName;
    const previousEditorLanguage = currentNexusSettings.editorLanguage;
    currentNexusSettings = {
        bundleName: (_a = settings.bundleName) !== null && _a !== void 0 ? _a : currentNexusSettings.bundleName,
        editorLanguage: ((_b = settings.editorLanguage) !== null && _b !== void 0 ? _b : currentNexusSettings.editorLanguage) || DEFAULT_EDITOR_LANGUAGE,
        orientation: Number((_d = (_c = settings.orientation) !== null && _c !== void 0 ? _c : currentNexusSettings.orientation) !== null && _d !== void 0 ? _d : 0),
    };
    if (currentNexusSettings.bundleName !== previousBundleName
        || currentNexusSettings.editorLanguage !== previousEditorLanguage) {
        i18nRevision++;
    }
    logI18nStep('settings:update', currentNexusSettings);
    return currentNexusSettings;
}
async function loadEditorLanguage() {
    try {
        const value = await Editor.Profile.getProject(PACKAGE_NAME, EDITOR_LANGUAGE_PROFILE_KEY, 'project');
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    catch (error) {
        logI18nStep('load-editor-language:error', error);
    }
    return DEFAULT_EDITOR_LANGUAGE;
}
async function initializeEditorLanguage() {
    const editorLanguage = await loadEditorLanguage();
    const languages = await loadI18nLanguages();
    currentI18nLanguages = normalizeLanguages([...languages, editorLanguage]);
    const nextEditorLanguage = currentI18nLanguages.includes(editorLanguage) ? editorLanguage : currentI18nLanguages[0];
    updateCurrentNexusSettings({ editorLanguage: nextEditorLanguage });
}
async function saveEditorLanguage(editorLanguage) {
    const value = editorLanguage.trim() || DEFAULT_EDITOR_LANGUAGE;
    if (!currentI18nLanguages.includes(value)) {
        currentI18nLanguages = normalizeLanguages([...currentI18nLanguages, value]);
        await saveI18nLanguages(currentI18nLanguages);
    }
    await Editor.Profile.setProject(PACKAGE_NAME, EDITOR_LANGUAGE_PROFILE_KEY, value, 'project');
    updateCurrentNexusSettings({ editorLanguage: value });
    return value;
}
async function loadI18nLanguages() {
    try {
        const value = await Editor.Profile.getProject(PACKAGE_NAME, I18N_LANGUAGES_PROFILE_KEY, 'project');
        if (Array.isArray(value)) {
            return normalizeLanguages(value);
        }
    }
    catch (error) {
        logI18nStep('load-i18n-languages:error', error);
    }
    return normalizeLanguages(availableEditorLanguages());
}
async function saveI18nLanguages(languages) {
    const values = normalizeLanguages(languages);
    currentI18nLanguages = values;
    await Editor.Profile.setProject(PACKAGE_NAME, I18N_LANGUAGES_PROFILE_KEY, values, 'project');
    return values;
}
async function waitSceneReady(maxRetry = 20) {
    logStep('waitSceneReady:start', { maxRetry });
    for (let i = 0; i < maxRetry; i++) {
        try {
            const ready = await Editor.Message.request('scene', 'query-is-ready');
            logStep('waitSceneReady:query', { retry: i + 1, ready });
            if (ready) {
                logStep('waitSceneReady:ready', { retry: i + 1 });
                return true;
            }
        }
        catch (error) {
            logStep('waitSceneReady:error', { retry: i + 1, error });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}
async function applyDesignResolution(resolution, reason, options = {}) {
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
    }
    else if (!changed) {
        logStep('applyDesignResolution:skip-soft-reload-unchanged', { reason });
    }
    else {
        logStep('applyDesignResolution:skip-soft-reload', { reason });
    }
}
async function applyNexusSettings(settings, reason, options = {}) {
    const next = updateCurrentNexusSettings(settings);
    await applyDesignResolution(resolutionFromSettings(next), reason, options);
    await refreshI18nComponentsInScene();
    scheduleRefreshI18nComponentsInScene();
}
function readJsonFile(file) {
    logStep('readJsonFile:start', { file });
    try {
        const data = JSON.parse((0, fs_1.readFileSync)(file, 'utf8'));
        logStep('readJsonFile:success', { file });
        return data;
    }
    catch (error) {
        logStep('readJsonFile:error', { file, error });
        return undefined;
    }
}
function readI18nFile(bundleName, language) {
    logI18nStep('read-file:start', { bundleName, language });
    const languageNames = languagePathNames(language);
    const candidates = [];
    for (const lang of languageNames) {
        candidates.push(...languageBundleFiles(lang, 'common'));
        if (bundleName) {
            candidates.push(...languageBundleFiles(lang, bundleName));
        }
    }
    const result = {};
    for (const file of unique(candidates)) {
        if (!(0, fs_1.existsSync)(file)) {
            logI18nStep('read-file:missing', { file });
            continue;
        }
        const data = readJsonFile(file);
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
function languagePathNames(language) {
    const names = [language];
    if (language.includes('_'))
        names.push(language.replace(/_/g, '-'));
    if (language.includes('-'))
        names.push(language.replace(/-/g, '_'));
    return unique(names.filter(Boolean));
}
function languageBundleFiles(language, bundleName) {
    const root = (0, path_1.join)(Editor.Project.path, 'assets', 'languages', language, bundleName);
    return [
        `${root}.json`,
        (0, path_1.join)(root, `${language}.json`),
        (0, path_1.join)(root, `${language.replace(/-/g, '_')}.json`),
        (0, path_1.join)(root, 'index.json'),
    ];
}
function availableEditorLanguages() {
    const result = [DEFAULT_EDITOR_LANGUAGE];
    const languageRoot = (0, path_1.join)(Editor.Project.path, 'assets', 'languages');
    if ((0, fs_1.existsSync)(languageRoot)) {
        for (const entry of (0, fs_1.readdirSync)(languageRoot)) {
            const path = (0, path_1.join)(languageRoot, entry);
            if ((0, fs_1.statSync)(path).isDirectory()) {
                result.push(entry);
            }
        }
    }
    return unique(result).sort();
}
function normalizeLanguages(languages) {
    const result = languages
        .map((language) => typeof language === 'string' ? language.trim() : '')
        .filter(Boolean);
    return unique(result.length > 0 ? result : [DEFAULT_EDITOR_LANGUAGE]);
}
function unique(items) {
    return items.filter((item, index) => items.indexOf(item) === index);
}
function formatText(text, params) {
    if (!params)
        return text;
    let result = text;
    for (const key of Object.keys(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(params[key]));
    }
    return result;
}
function queryI18nText(key, params) {
    var _a;
    const language = currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE;
    const bundleName = currentNexusSettings.bundleName || '';
    logI18nStep('query-text:start', { key, bundleName, language, hasParams: !!params });
    const translations = readI18nFile(bundleName, language);
    const result = formatText((_a = translations[key]) !== null && _a !== void 0 ? _a : key, params);
    logI18nStep('query-text:result', { key, result, matched: result !== key });
    return result;
}
async function parseI18nSpriteAsset(uuid) {
    return parseI18nLocalizedAsset(uuid, stripSpritePathDecorations);
}
async function parseI18nLocalizedAsset(uuid, stripPathDecorations = stripI18nAssetPathDecorations) {
    const info = await queryAssetInfo(uuid);
    const infoUrl = info === null || info === void 0 ? void 0 : info.url;
    const infoSource = info === null || info === void 0 ? void 0 : info.source;
    const url = normalizeAssetUrl(typeof infoUrl === 'string' ? infoUrl : typeof infoSource === 'string' ? infoSource : '');
    if (!url)
        return null;
    const parsed = parseI18nAssetUrl(url);
    if (!parsed)
        return null;
    return {
        bundleName: parsed.bundleName,
        relativePath: stripPathDecorations(parsed.relativePath),
    };
}
async function queryI18nSpriteAsset(bundleName, relativePath) {
    const cleanBundleName = String(bundleName || '').trim();
    const cleanRelativePath = stripSpritePathDecorations(String(relativePath || '').trim());
    if (!cleanBundleName || !cleanRelativePath)
        return null;
    const languages = languagePathNames(currentNexusSettings.editorLanguage || DEFAULT_EDITOR_LANGUAGE);
    for (const language of languages) {
        const result = await queryI18nSpriteAssetByLanguage(language, cleanBundleName, cleanRelativePath);
        if (result)
            return result;
    }
    return null;
}
async function queryI18nSpineAsset(bundleName, relativePath) {
    return queryI18nAsset(bundleName, relativePath, I18N_SPINE_EXTENSIONS, findAssetUuid);
}
async function queryI18nDragonBonesAsset(bundleName, relativePath) {
    return queryI18nAsset(bundleName, relativePath, I18N_DRAGON_BONES_ASSET_EXTENSIONS, findAssetUuid);
}
async function queryI18nDragonBonesAtlasAsset(bundleName, relativePath) {
    return queryI18nAsset(bundleName, relativePath, I18N_DRAGON_BONES_ATLAS_EXTENSIONS, findAssetUuid);
}
async function queryI18nAsset(bundleName, relativePath, extensions, findUuid) {
    const cleanBundleName = String(bundleName || '').trim();
    const cleanRelativePath = stripI18nAssetPathDecorations(String(relativePath || '').trim());
    if (!cleanBundleName || !cleanRelativePath)
        return null;
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
async function queryI18nSpriteAssetByLanguage(language, bundleName, relativePath) {
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
async function queryAssetInfo(urlOrUuidOrPath) {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', urlOrUuidOrPath);
    }
    catch (error) {
        logStep('queryAssetInfo:error', { urlOrUuidOrPath, error });
        return null;
    }
}
function findSpriteFrameUuid(info) {
    if (!info)
        return '';
    if (info.type === 'cc.SpriteFrame' || info.importer === 'sprite-frame' || info.name === 'spriteFrame') {
        return typeof info.uuid === 'string' ? info.uuid : '';
    }
    const subAssets = info.subAssets;
    if (!subAssets || typeof subAssets !== 'object')
        return '';
    for (const subAsset of Object.values(subAssets)) {
        if (!subAsset || typeof subAsset !== 'object')
            continue;
        const record = subAsset;
        if (record.importer === 'sprite-frame' || record.name === 'spriteFrame' || record.type === 'cc.SpriteFrame') {
            return typeof record.uuid === 'string' ? record.uuid : '';
        }
    }
    return '';
}
function findAssetUuid(info) {
    return typeof (info === null || info === void 0 ? void 0 : info.uuid) === 'string' ? info.uuid : '';
}
function normalizeAssetUrl(url) {
    return url.replace(/\/spriteFrame$/, '');
}
function parseI18nAssetUrl(url) {
    const match = normalizeAssetUrl(url).match(/^db:\/\/assets\/languages\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match)
        return null;
    return {
        language: match[1],
        bundleName: match[2],
        relativePath: stripSpritePathDecorations(match[3]),
    };
}
function stripSpritePathDecorations(path) {
    return path
        .replace(/\/spriteFrame$/, '')
        .replace(/\.(png|jpg|jpeg|webp)$/i, '');
}
function stripI18nAssetPathDecorations(path) {
    return path
        .replace(/\/spriteFrame$/, '')
        .replace(/\.(png|jpg|jpeg|webp|skel|json|atlas)$/i, '');
}
function walkFiles(root, matcher) {
    if (!(0, fs_1.existsSync)(root)) {
        logStep('walkFiles:missing-root', { root });
        return [];
    }
    const result = [];
    for (const entry of (0, fs_1.readdirSync)(root)) {
        const file = (0, path_1.join)(root, entry);
        const stat = (0, fs_1.statSync)(file);
        if (stat.isDirectory()) {
            result.push(...walkFiles(file, matcher));
        }
        else if (matcher(file)) {
            result.push(file);
        }
    }
    return result;
}
function readCurrentSceneUuid() {
    if (currentSceneUuid) {
        logStep('readCurrentSceneUuid:from-broadcast', { uuid: currentSceneUuid });
        return currentSceneUuid;
    }
    const settingsPath = (0, path_1.join)(Editor.Project.path, SCENE_SETTINGS_PATH);
    logStep('readCurrentSceneUuid:from-settings:start', { settingsPath });
    const settings = readJsonFile(settingsPath);
    const uuid = settings === null || settings === void 0 ? void 0 : settings['current-scene'];
    const result = typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined;
    logStep('readCurrentSceneUuid:from-settings:result', { uuid: result });
    return result;
}
function findScenePathByUuid(uuid) {
    const assetsRoot = (0, path_1.join)(Editor.Project.path, 'assets');
    logStep('findScenePathByUuid:start', { uuid, assetsRoot });
    const sceneMetas = walkFiles(assetsRoot, (file) => file.endsWith('.scene.meta'));
    logStep('findScenePathByUuid:metas-found', { count: sceneMetas.length });
    for (const metaPath of sceneMetas) {
        const meta = readJsonFile(metaPath);
        if ((meta === null || meta === void 0 ? void 0 : meta.uuid) === uuid) {
            const scenePath = metaPath.replace(/\.meta$/, '');
            logStep('findScenePathByUuid:matched-meta', { metaPath, scenePath, exists: (0, fs_1.existsSync)(scenePath) });
            return (0, fs_1.existsSync)(scenePath) ? scenePath : undefined;
        }
    }
    logStep('findScenePathByUuid:not-found', { uuid });
    return undefined;
}
function findScenePathByRootName(rootName) {
    const assetsRoot = (0, path_1.join)(Editor.Project.path, 'assets');
    logStep('findScenePathByRootName:start', { rootName, assetsRoot });
    const sceneMetas = walkFiles(assetsRoot, (file) => file.endsWith('.scene.meta'));
    logStep('findScenePathByRootName:metas-found', { count: sceneMetas.length });
    for (const metaPath of sceneMetas) {
        const scenePath = metaPath.replace(/\.meta$/, '');
        const sceneName = (0, path_1.basename)(scenePath, '.scene');
        if (sceneName === rootName) {
            logStep('findScenePathByRootName:matched-file-name', { sceneName, metaPath, scenePath, exists: (0, fs_1.existsSync)(scenePath) });
            return (0, fs_1.existsSync)(scenePath) ? scenePath : undefined;
        }
    }
    logStep('findScenePathByRootName:not-found', { rootName });
    return undefined;
}
function findSettingsInSerializedScene(sceneData, path = '$') {
    if (Array.isArray(sceneData)) {
        for (let i = 0; i < sceneData.length; i++) {
            const result = findSettingsInSerializedScene(sceneData[i], `${path}[${i}]`);
            if (result !== undefined)
                return result;
        }
        return undefined;
    }
    if (!sceneData || typeof sceneData !== 'object')
        return undefined;
    const record = sceneData;
    if (typeof record.orientation === 'number'
        || typeof record._orientation === 'number') {
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
        if (result !== undefined)
            return result;
    }
    return undefined;
}
function settingsFromCurrentSceneAsset() {
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
function settingsFromScenePath(scenePath, reason) {
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
async function syncFromCurrentScene(options = {}) {
    var _a, _b, _c, _d;
    logStep('syncFromCurrentScene:start', { currentSceneUuid });
    const ready = await waitSceneReady();
    if (!ready) {
        console.warn(`[${PACKAGE_NAME}] Scene is not ready, skip resolution sync.`);
        return;
    }
    const tree = await Editor.Message.request('scene', 'query-node-tree');
    const rootName = readDumpValue(tree === null || tree === void 0 ? void 0 : tree.name);
    logStep('syncFromCurrentScene:query-node-tree-result', {
        hasTree: !!tree,
        rootName,
        childCount: (_b = (_a = tree === null || tree === void 0 ? void 0 : tree.children) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
        compCount: (_d = (_c = tree === null || tree === void 0 ? void 0 : tree.__comps__) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0,
    });
    const comp = findNexusSettings(tree);
    if (comp) {
        const settings = settingsFromComponent(comp);
        if (settings) {
            await applyNexusSettings(settings, `Synced from live ${COMPONENT_NAME}`, options);
            return;
        }
        console.warn(`[${PACKAGE_NAME}] Invalid live ${COMPONENT_NAME} component data.`);
    }
    else {
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
function scheduleSyncFromCurrentScene(options = {}) {
    logStep('scheduleSyncFromCurrentScene', { hadPendingTimer: !!syncTimer, currentSceneUuid });
    if (syncTimer)
        clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = undefined;
        void syncFromCurrentScene(options).catch((error) => {
            console.error(`[${PACKAGE_NAME}] Sync failed:`, error);
        });
    }, 300);
}
function addBroadcastListener(message, handler) {
    var _a;
    const protectedMessage = Editor.Message.__protected__;
    (_a = protectedMessage === null || protectedMessage === void 0 ? void 0 : protectedMessage.addBroadcastListener) === null || _a === void 0 ? void 0 : _a.call(protectedMessage, message, handler);
}
function removeBroadcastListener(message, handler) {
    var _a;
    const protectedMessage = Editor.Message.__protected__;
    (_a = protectedMessage === null || protectedMessage === void 0 ? void 0 : protectedMessage.removeBroadcastListener) === null || _a === void 0 ? void 0 : _a.call(protectedMessage, message, handler);
}
function updateCurrentSceneUuid(args) {
    logStep('updateCurrentSceneUuid:args', args);
    const uuid = args.find((arg) => typeof arg === 'string' && /^[0-9a-f-]{32,36}$/i.test(arg));
    if (typeof uuid === 'string') {
        currentSceneUuid = uuid;
        logStep('updateCurrentSceneUuid:matched', { uuid });
    }
    else {
        logStep('updateCurrentSceneUuid:not-matched');
    }
}
const onSceneOpened = (...args) => {
    logStep('event:multi-open-scene', args);
    updateCurrentSceneUuid(args);
    scheduleSyncFromCurrentScene({ refreshSceneWhenUnchanged: true });
};
const onSceneFocused = (...args) => {
    logStep('event:multi-scene-focus', args);
    updateCurrentSceneUuid(args);
    scheduleSyncFromCurrentScene({ refreshSceneWhenUnchanged: true });
};
const onSceneDirty = (...args) => {
    logStep('event:multi-scene-dirty', args);
    updateCurrentSceneUuid(args);
    scheduleSyncFromCurrentScene();
};
exports.methods = {
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
    async setEditorLanguage(editorLanguage) {
        const value = await saveEditorLanguage(String(editorLanguage || ''));
        await refreshI18nComponentsInScene();
        return {
            bundleName: currentNexusSettings.bundleName,
            editorLanguage: value,
            languages: currentI18nLanguages,
        };
    },
    async setI18nLanguages(languages, editorLanguage) {
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
    async syncOrientation(orientation) {
        const value = Number(orientation);
        logStep('method:syncOrientation', { orientation, value });
        const saved = await saveCurrentScene(`live ${COMPONENT_NAME} inspector`);
        if (!saved)
            return;
        await applyNexusSettings(Object.assign(Object.assign({}, currentNexusSettings), { orientation: value }), `Synced from live ${COMPONENT_NAME} inspector`, {
            force: true,
            reloadScene: true,
            refreshSceneWhenUnchanged: true,
        });
    },
    async syncNexusSettings(settings) {
        logI18nStep('method:syncNexusSettings', { settings });
        const saved = await saveCurrentScene(`live ${COMPONENT_NAME} inspector`);
        if (!saved)
            return;
        await applyNexusSettings(updateCurrentNexusSettings(settings), `Synced from live ${COMPONENT_NAME} inspector`, {
            force: true,
            reloadScene: true,
            refreshSceneWhenUnchanged: true,
        });
    },
    queryI18nText(key, params) {
        if (!key)
            return '';
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
    parseI18nSpriteAsset(uuid) {
        return parseI18nSpriteAsset(String(uuid || ''));
    },
    queryI18nSpriteAsset(bundleName, relativePath) {
        return queryI18nSpriteAsset(String(bundleName || ''), String(relativePath || ''));
    },
    parseI18nAsset(uuid) {
        return parseI18nLocalizedAsset(String(uuid || ''));
    },
    'parse-i18n-asset'(uuid) {
        return parseI18nLocalizedAsset(String(uuid || ''));
    },
    queryI18nSpineAsset(bundleName, relativePath) {
        return queryI18nSpineAsset(String(bundleName || ''), String(relativePath || ''));
    },
    'query-i18n-spine-asset'(bundleName, relativePath) {
        return queryI18nSpineAsset(String(bundleName || ''), String(relativePath || ''));
    },
    queryI18nDragonBonesAsset(bundleName, relativePath) {
        return queryI18nDragonBonesAsset(String(bundleName || ''), String(relativePath || ''));
    },
    'query-i18n-dragon-bones-asset'(bundleName, relativePath) {
        return queryI18nDragonBonesAsset(String(bundleName || ''), String(relativePath || ''));
    },
    queryI18nDragonBonesAtlasAsset(bundleName, relativePath) {
        return queryI18nDragonBonesAtlasAsset(String(bundleName || ''), String(relativePath || ''));
    },
    'query-i18n-dragon-bones-atlas-asset'(bundleName, relativePath) {
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
function load() {
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
function unload() {
    logStep('unload:start');
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = undefined;
    }
    removeBroadcastListener('multi-open-scene', onSceneOpened);
    removeBroadcastListener('multi-scene-focus', onSceneFocused);
    removeBroadcastListener('multi-scene-dirty', onSceneDirty);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQXlpQ0Esb0JBUUM7QUFNRCx3QkFXQztBQWxrQ0QsMkJBQXFFO0FBQ3JFLCtCQUFzQztBQW1DdEMsTUFBTSxZQUFZLEdBQUcsaUJBQWlCLENBQUM7QUFDdkMsTUFBTSxjQUFjLEdBQUcsZUFBZSxDQUFDO0FBQ3ZDLE1BQU0scUJBQXFCLEdBQUcsaUJBQWlCLENBQUM7QUFDaEQsTUFBTSxtQkFBbUIsR0FBRyxpQ0FBaUMsQ0FBQztBQUM5RCxNQUFNLFNBQVMsR0FBRyx1Q0FBdUMsQ0FBQztBQUMxRCxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUM7QUFDcEIsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDO0FBQ3pCLE1BQU0sa0JBQWtCLEdBQUcsWUFBWSxDQUFDO0FBQ3hDLE1BQU0sdUJBQXVCLEdBQUcsT0FBTyxDQUFDO0FBQ3hDLE1BQU0sMkJBQTJCLEdBQUcscUJBQXFCLENBQUM7QUFDMUQsTUFBTSwwQkFBMEIsR0FBRyxnQkFBZ0IsQ0FBQztBQUNwRCxNQUFNLHNCQUFzQixHQUFHLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDbEUsTUFBTSxxQkFBcUIsR0FBRyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztBQUNqRCxNQUFNLGtDQUFrQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDckQsTUFBTSxrQ0FBa0MsR0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztBQUUvRCxNQUFNLFNBQVMsR0FBcUI7SUFDaEMsUUFBUSxFQUFFLEtBQUs7SUFDZixTQUFTLEVBQUUsSUFBSTtJQUNmLEtBQUssRUFBRSxJQUFJO0lBQ1gsTUFBTSxFQUFFLEdBQUc7Q0FDZCxDQUFDO0FBRUYsTUFBTSxRQUFRLEdBQXFCO0lBQy9CLFFBQVEsRUFBRSxJQUFJO0lB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YSxDQUFDLENBQUM7SUFDM0QsdUJBQXVCLENBQUMsbUJBQW1CLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDN0QsdUJBQXVCLENBQUMsbUJBQW1CLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDL0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGV4aXN0c1N5bmMsIHJlYWRkaXJTeW5jLCByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gfSBmcm9tICdwYXRoJztcblxudHlwZSBEZXNpZ25SZXNvbHV0aW9uID0ge1xuICAgIGZpdFdpZHRoOiBib29sZWFuO1xuICAgIGZpdEhlaWdodDogYm9vbGVhbjtcbiAgICB3aWR0aDogbnVtYmVyO1xuICAgIGhlaWdodDogbnVtYmVyO1xufTtcblxudHlwZSBOZXh1c1NldHRpbmdzRGF0YSA9IHtcbiAgICBidW5kbGVOYW1lOiBzdHJpbmc7XG4gICAgZWRpdG9yTGFuZ3VhZ2U6IHN0cmluZztcbiAgICBvcmllbnRhdGlvbjogbnVtYmVyO1xufTtcblxudHlwZSBBcHBseURlc2lnblJlc29sdXRpb25PcHRpb25zID0ge1xuICAgIGZvcmNlPzogYm9vbGVhbjtcbiAgICByZWxvYWRTY2VuZT86IGJvb2xlYW47XG4gICAgcmVmcmVzaFNjZW5lV2hlblVuY2hhbmdlZD86IGJvb2xlYW47XG59O1xuXG50eXBlIER1bXBQcm9wZXJ0eSA9IHtcbiAgICB2YWx1ZT86IHVua25vd247XG4gICAgbmFtZT86IHN0cmluZztcbiAgICBkaXNwbGF5TmFtZT86IHN0cmluZztcbiAgICB0eXBlPzogc3RyaW5nO1xuICAgIFtrZXk6IHN0cmluZ106IHVua25vd247XG59O1xuXG50eXBlIER1bXBOb2RlID0ge1xuICAgIG5hbWU/OiBEdW1wUHJvcGVydHk7XG4gICAgY2hpbGRyZW4/OiBEdW1wTm9kZVtdO1xuICAgIF9fY29tcHNfXz86IER1bXBQcm9wZXJ0eVtdO1xufTtcblxuY29uc3QgUEFDS0FHRV9OQU1FID0gJ25leHVzLWZyYW1ld29yayc7XG5jb25zdCBDT01QT05FTlRfTkFNRSA9ICdOZXh1c1NldHRpbmdzJztcbmNvbnN0IExFR0FDWV9DT01QT05FTlRfTkFNRSA9ICdTY2VuZVJlc29sdXRpb24nO1xuY29uc3QgU0NFTkVfU0VUVElOR1NfUEFUSCA9ICdzZXR0aW5ncy92Mi9wYWNrYWdlcy9zY2VuZS5qc29uJztcbmNvbnN0IEJVSUxEX1RBRyA9ICcyMDI2LTA1LTA2LWVkaXQtbW9kZS1vcmllbnRhdGlvbi1zeW5jJztcbmNvbnN0IERFQlVHID0gZmFsc2U7XG5jb25zdCBJMThOX0RFQlVHID0gZmFsc2U7XG5jb25zdCBTQ0VORV9TQVZFX01FU1NBR0UgPSAnc2F2ZS1zY2VuZSc7XG5jb25zdCBERUZBVUxUX0VESVRPUl9MQU5HVUFHRSA9ICd6aF9DTic7XG5jb25zdCBFRElUT1JfTEFOR1VBR0VfUFJPRklMRV9LRVkgPSAnaTE4bi5lZGl0b3JMYW5ndWFnZSc7XG5jb25zdCBJMThOX0xBTkdVQUdFU19QUk9GSUxFX0tFWSA9ICdpMThuLmxhbmd1YWdlcyc7XG5jb25zdCBJMThOX1NQUklURV9FWFRFTlNJT05TID0gWycucG5nJywgJy5qcGcnLCAnLmpwZWcnLCAnLndlYnAnXTtcbmNvbnN0IEkxOE5fU1BJTkVfRVhURU5TSU9OUyA9IFsnLnNrZWwnLCAnLmpzb24nXTtcbmNvbnN0IEkxOE5fRFJBR09OX0JPTkVTX0FTU0VUX0VYVEVOU0lPTlMgPSBbJy5qc29uJ107XG5jb25zdCBJMThOX0RSQUdPTl9CT05FU19BVExBU19FWFRFTlNJT05TID0gWycuanNvbicsICcuYXRsYXMnXTtcblxuY29uc3QgTEFORFNDQVBFOiBEZXNpZ25SZXNvbHV0aW9uID0ge1xuICAgIGZpdFdpZHRoOiBmYWxzZSxcbiAgICBmaXRIZWlnaHQ6IHRydWUsXG4gICAgd2lkdGg6IDEzMzQsXG4gICAgaGVpZ2h0OiA3NTAsXG59O1xuXG5jb25zdCBQT1JUUkFJVDogRGVzaWduUmVzb2x1dGlvbiA9IHtcbiAgICBmaXRXaWR0aDogdHJ1ZSxcbiAgICBmaXRIZWlnaHQ6IGZhbHNlLFxuICAgIHdpZHRoOiA3NTAsXG4gICAgaGVpZ2h0OiAxMzM0LFxufTtcblxubGV0IHN5bmNUaW1lcjogTm9kZUpTLlRpbWVvdXQgfCB1bmRlZmluZWQ7XG5sZXQgY3VycmVudFNjZW5lVXVpZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xubGV0IGxhc3RBcHBsaWVkUmVzb2x1dGlvbktleTogc3RyaW5nIHwgdW5kZWZpbmVkO1xubGV0IGN1cnJlbnROZXh1c1NldHRpbmdzOiBOZXh1c1NldHRpbmdzRGF0YSA9IHtcbiAgICBidW5kbGVOYW1lOiAnJyxcbiAgICBlZGl0b3JMYW5ndWFnZTogREVGQVVMVF9FRElUT1JfTEFOR1VBR0UsXG4gICAgb3JpZW50YXRpb246IDAsXG59O1xubGV0IGN1cnJlbnRJMThuTGFuZ3VhZ2VzOiBzdHJpbmdbXSA9IFtERUZBVUxUX0VESVRPUl9MQU5HVUFHRV07XG5sZXQgaTE4blJldmlzaW9uID0gMDtcblxuZnVuY3Rpb24gbG9nU3RlcChzdGVwOiBzdHJpbmcsIC4uLmFyZ3M6IHVua25vd25bXSk6IHZvaWQge1xuICAgIGlmICghREVCVUcpIHJldHVybjtcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV1bZGVidWddICR7c3RlcH1gLCAuLi5hcmdzKTtcbn1cblxuZnVuY3Rpb24gbG9nSTE4blN0ZXAoc3RlcDogc3RyaW5nLCAuLi5hcmdzOiB1bmtub3duW10pOiB2b2lkIHtcbiAgICBpZiAoIUkxOE5fREVCVUcpIHJldHVybjtcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV1baTE4bl0gJHtzdGVwfWAsIC4uLmFyZ3MpO1xufVxuXG5mdW5jdGlvbiByZXNvbHV0aW9uS2V5KHJlc29sdXRpb246IERlc2lnblJlc29sdXRpb24pOiBzdHJpbmcge1xuICAgIHJldHVybiBgJHtyZXNvbHV0aW9uLndpZHRofXgke3Jlc29sdXRpb24uaGVpZ2h0fToke3Jlc29sdXRpb24uZml0V2lkdGggPyAxIDogMH06JHtyZXNvbHV0aW9uLmZpdEhlaWdodCA/IDEgOiAwfWA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNvZnRSZWxvYWRTY2VuZShyZWFzb246IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NvZnQtcmVsb2FkJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gcmVmcmVzaCBzY2VuZTpgLCBlcnJvcik7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoRGVzaWduUmVzb2x1dGlvbkluU2NlbmUocmVzb2x1dGlvbjogRGVzaWduUmVzb2x1dGlvbiwgcmVhc29uOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdleGVjdXRlLXNjZW5lLXNjcmlwdCcsIHtcbiAgICAgICAgICAgIG5hbWU6IFBBQ0tBR0VfTkFNRSxcbiAgICAgICAgICAgIG1ldGhvZDogJ3JlZnJlc2hEZXNpZ25SZXNvbHV0aW9uJyxcbiAgICAgICAgICAgIGFyZ3M6IFtyZXNvbHV0aW9uXSxcbiAgICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gcmVmcmVzaCBkZXNpZ24gcmVzb2x1dGlvbiwgZmFsbGJhY2sgdG8gc2NlbmUgcmVsb2FkOmAsIGVycm9yKTtcbiAgICAgICAgYXdhaXQgc29mdFJlbG9hZFNjZW5lKHJlYXNvbik7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoSTE4bkNvbXBvbmVudHNJblNjZW5lKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGxhbmd1YWdlID0gY3VycmVudE5leHVzU2V0dGluZ3MuZWRpdG9yTGFuZ3VhZ2UgfHwgREVGQVVMVF9FRElUT1JfTEFOR1VBR0U7XG4gICAgICAgIGNvbnN0IGJ1bmRsZU5hbWUgPSBjdXJyZW50TmV4dXNTZXR0aW5ncy5idW5kbGVOYW1lIHx8ICcnO1xuICAgICAgICBsb2dJMThuU3RlcCgncmVmcmVzaC1zY2VuZTpzdGFydCcsIHsgYnVuZGxlTmFtZSwgbGFuZ3VhZ2UgfSk7XG4gICAgICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IHJlYWRJMThuRmlsZShidW5kbGVOYW1lLCBsYW5ndWFnZSk7XG4gICAgICAgIGxvZ0kxOG5TdGVwKCdyZWZyZXNoLXNjZW5lOnRyYW5zbGF0aW9ucy1yZWFkeScsIHtcbiAgICAgICAgICAgIGJ1bmRsZU5hbWUsXG4gICAgICAgICAgICBsYW5ndWFnZSxcbiAgICAgICAgICAgIGNvdW50OiBPYmplY3Qua2V5cyh0cmFuc2xhdGlvbnMpLmxlbmd0aCxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2V4ZWN1dGUtc2NlbmUtc2NyaXB0Jywge1xuICAgICAgICAgICAgbmFtZTogUEFDS0FHRV9OQU1FLFxuICAgICAgICAgICAgbWV0aG9kOiAncmVmcmVzaEkxOG5Db21wb25lbnRzJyxcbiAgICAgICAgICAgIGFyZ3M6IFt0cmFuc2xhdGlvbnNdLFxuICAgICAgICB9KTtcbiAgICAgICAgbG9nSTE4blN0ZXAoJ3JlZnJlc2gtc2NlbmU6ZG9uZScsIHsgYnVuZGxlTmFtZSwgbGFuZ3VhZ2UgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gcmVmcmVzaCBpMThuIGxhYmVscyBpbiBzY2VuZTpgLCBlcnJvcik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzY2hlZHVsZVJlZnJlc2hJMThuQ29tcG9uZW50c0luU2NlbmUoZGVsYXkgPSA1MDApOiB2b2lkIHtcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdm9pZCByZWZyZXNoSTE4bkNvbXBvbmVudHNJblNjZW5lKCk7XG4gICAgfSwgZGVsYXkpO1xufVxuXG5mdW5jdGlvbiBpc1NhbWVSZXNvbHV0aW9uKGE6IHVua25vd24sIGI6IERlc2lnblJlc29sdXRpb24pOiBib29sZWFuIHtcbiAgICBpZiAoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG5cbiAgICBjb25zdCByZWNvcmQgPSBhIGFzIFBhcnRpYWw8RGVzaWduUmVzb2x1dGlvbj47XG4gICAgcmV0dXJuICEhcmVjb3JkLmZpdFdpZHRoID09PSBiLmZpdFdpZHRoXG4gICAgICAgICYmICEhcmVjb3JkLmZpdEhlaWdodCA9PT0gYi5maXRIZWlnaHRcbiAgICAgICAgJiYgTnVtYmVyKHJlY29yZC53aWR0aCkgPT09IGIud2lkdGhcbiAgICAgICAgJiYgTnVtYmVyKHJlY29yZC5oZWlnaHQpID09PSBiLmhlaWdodDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcXVlcnlEZXNpZ25SZXNvbHV0aW9uKHJlYXNvbjogc3RyaW5nKTogUHJvbWlzZTx1bmtub3duPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdwcm9qZWN0JywgJ3F1ZXJ5LWNvbmZpZycsICdwcm9qZWN0JywgJ2dlbmVyYWwuZGVzaWduUmVzb2x1dGlvbicpO1xuICAgICAgICBsb2dTdGVwKCdxdWVyeURlc2lnblJlc29sdXRpb246cmVzdWx0JywgeyByZWFzb24sIHZhbHVlIH0pO1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nU3RlcCgncXVlcnlEZXNpZ25SZXNvbHV0aW9uOmVycm9yJywgeyByZWFzb24sIGVycm9yIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gc2F2ZUN1cnJlbnRTY2VuZShyZWFzb246IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGxvZ1N0ZXAoJ3NhdmVDdXJyZW50U2NlbmU6c3RhcnQnLCB7IHJlYXNvbiwgbWVzc2FnZTogU0NFTkVfU0FWRV9NRVNTQUdFIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgbG9nU3RlcCgnc2F2ZUN1cnJlbnRTY2VuZTpyZXF1ZXN0JywgeyByZWFzb24sIG1lc3NhZ2U6IFNDRU5FX1NBVkVfTUVTU0FHRSB9KTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCBTQ0VORV9TQVZFX01FU1NBR0UpO1xuICAgICAgICBsb2dTdGVwKCdzYXZlQ3VycmVudFNjZW5lOnJlc3VsdCcsIHsgcmVhc29uLCBtZXNzYWdlOiBTQ0VORV9TQVZFX01FU1NBR0UsIHJlc3VsdCB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nU3RlcCgnc2F2ZUN1cnJlbnRTY2VuZTplcnJvcicsIHsgcmVhc29uLCBtZXNzYWdlOiBTQ0VORV9TQVZFX01FU1NBR0UsIGVycm9yIH0pO1xuICAgIH1cblxuICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHNhdmUgY3VycmVudCBzY2VuZSBiZWZvcmUgYXBwbHlpbmcgZGVzaWduIHJlc29sdXRpb24uYCk7XG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiByZWFkRHVtcFZhbHVlPFQgPSB1bmtub3duPihkdW1wOiB1bmtub3duKTogVCB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKGR1bXAgJiYgdHlwZW9mIGR1bXAgPT09ICdvYmplY3QnICYmICd2YWx1ZScgaW4gZHVtcCkge1xuICAgICAgICByZXR1cm4gKGR1bXAgYXMgeyB2YWx1ZT86IFQgfSkudmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGR1bXAgYXMgVCB8IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNOZXh1c1NldHRpbmdzQ29tcG9uZW50KGNvbXA6IER1bXBQcm9wZXJ0eSk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHZhbHVlID0gY29tcC52YWx1ZTtcbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IG5hbWUgPSByZWFkRHVtcFZhbHVlKCh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikubmFtZSk7XG4gICAgcmV0dXJuIG5hbWUgPT09IENPTVBPTkVOVF9OQU1FXG4gICAgICAgIHx8IG5hbWUgPT09IExFR0FDWV9DT01QT05FTlRfTkFNRVxuICAgICAgICB8fCBjb21wLm5hbWUgPT09IENPTVBPTkVOVF9OQU1FXG4gICAgICAgIHx8IGNvbXAubmFtZSA9PT0gTEVHQUNZX0NPTVBPTkVOVF9OQU1FXG4gICAgICAgIHx8ICdvcmllbnRhdGlvbicgaW4gdmFsdWVcbiAgICAgICAgfHwgJ19vcmllbnRhdGlvbicgaW4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGZpbmROZXh1c1NldHRpbmdzKHJvb3Q6IER1bXBOb2RlIHwgdW5kZWZpbmVkKTogRHVtcFByb3BlcnR5IHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIXJvb3QpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBjb21wcyA9IHJvb3QuX19jb21wc19fID8/IFtdO1xuICAgIGNvbnN0IG1hdGNoZWQgPSBjb21wcy5maW5kKGlzTmV4dXNTZXR0aW5nc0NvbXBvbmVudCk7XG4gICAgaWYgKG1hdGNoZWQpIHJldHVybiBtYXRjaGVkO1xuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiByb290LmNoaWxkcmVuID8/IFtdKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmROZXh1c1NldHRpbmdzKGNoaWxkKTtcbiAgICAgICAgaWYgKHJlc3VsdCkgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBzZXR0aW5nc0Zyb21Db21wb25lbnQoY29tcDogRHVtcFByb3BlcnR5KTogTmV4dXNTZXR0aW5nc0RhdGEgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHZhbHVlID0gY29tcC52YWx1ZTtcbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCByZWNvcmQgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoISgnb3JpZW50YXRpb24nIGluIHJlY29yZCkgJiYgISgnX29yaWVudGF0aW9uJyBpbiByZWNvcmQpKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgY29uc3Qgb3JpZW50YXRpb24gPSBOdW1iZXIocmVhZER1bXBWYWx1ZShyZWNvcmQub3JpZW50YXRpb24pID8/IHJlYWREdW1wVmFsdWUocmVjb3JkLl9vcmllbnRhdGlvbikgPz8gMCk7XG4gICAgY29uc3QgYnVuZGxlTmFtZSA9IFN0cmluZyhyZWFkRHVtcFZhbHVlKHJlY29yZC5idW5kbGVOYW1lKSA/PyByZWFkRHVtcFZhbHVlKHJlY29yZC5fYnVuZGxlTmFtZSkgPz8gJycpO1xuICAgIHJldHVybiB7XG4gICAgICAgIGJ1bmRsZU5hbWUsXG4gICAgICAgIGVkaXRvckxhbmd1YWdlOiBjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSB8fCBERUZBVUxUX0VESVRPUl9MQU5HVUFHRSxcbiAgICAgICAgb3JpZW50YXRpb24sXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x1dGlvbkZyb21TZXR0aW5ncyhzZXR0aW5nczogTmV4dXNTZXR0aW5nc0RhdGEpOiBEZXNpZ25SZXNvbHV0aW9uIHtcbiAgICByZXR1cm4gc2V0dGluZ3Mub3JpZW50YXRpb24gPT09IDEgPyBQT1JUUkFJVCA6IExBTkRTQ0FQRTtcbn1cblxuZnVuY3Rpb24gdXBkYXRlQ3VycmVudE5leHVzU2V0dGluZ3Moc2V0dGluZ3M6IFBhcnRpYWw8TmV4dXNTZXR0aW5nc0RhdGE+KTogTmV4dXNTZXR0aW5nc0RhdGEge1xuICAgIGNvbnN0IHByZXZpb3VzQnVuZGxlTmFtZSA9IGN1cnJlbnROZXh1c1NldHRpbmdzLmJ1bmRsZU5hbWU7XG4gICAgY29uc3QgcHJldmlvdXNFZGl0b3JMYW5ndWFnZSA9IGN1cnJlbnROZXh1c1NldHRpbmdzLmVkaXRvckxhbmd1YWdlO1xuXG4gICAgY3VycmVudE5leHVzU2V0dGluZ3MgPSB7XG4gICAgICAgIGJ1bmRsZU5hbWU6IHNldHRpbmdzLmJ1bmRsZU5hbWUgPz8gY3VycmVudE5leHVzU2V0dGluZ3MuYnVuZGxlTmFtZSxcbiAgICAgICAgZWRpdG9yTGFuZ3VhZ2U6IChzZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSA/PyBjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSkgfHwgREVGQVVMVF9FRElUT1JfTEFOR1VBR0UsXG4gICAgICAgIG9yaWVudGF0aW9uOiBOdW1iZXIoc2V0dGluZ3Mub3JpZW50YXRpb24gPz8gY3VycmVudE5leHVzU2V0dGluZ3Mub3JpZW50YXRpb24gPz8gMCksXG4gICAgfTtcbiAgICBpZiAoXG4gICAgICAgIGN1cnJlbnROZXh1c1NldHRpbmdzLmJ1bmRsZU5hbWUgIT09IHByZXZpb3VzQnVuZGxlTmFtZVxuICAgICAgICB8fCBjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSAhPT0gcHJldmlvdXNFZGl0b3JMYW5ndWFnZVxuICAgICkge1xuICAgICAgICBpMThuUmV2aXNpb24rKztcbiAgICB9XG4gICAgbG9nSTE4blN0ZXAoJ3NldHRpbmdzOnVwZGF0ZScsIGN1cnJlbnROZXh1c1NldHRpbmdzKTtcbiAgICByZXR1cm4gY3VycmVudE5leHVzU2V0dGluZ3M7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRFZGl0b3JMYW5ndWFnZSgpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gYXdhaXQgRWRpdG9yLlByb2ZpbGUuZ2V0UHJvamVjdChQQUNLQUdFX05BTUUsIEVESVRPUl9MQU5HVUFHRV9QUk9GSUxFX0tFWSwgJ3Byb2plY3QnKTtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUudHJpbSgpKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWUudHJpbSgpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nSTE4blN0ZXAoJ2xvYWQtZWRpdG9yLWxhbmd1YWdlOmVycm9yJywgZXJyb3IpO1xuICAgIH1cblxuICAgIHJldHVybiBERUZBVUxUX0VESVRPUl9MQU5HVUFHRTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUVkaXRvckxhbmd1YWdlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGVkaXRvckxhbmd1YWdlID0gYXdhaXQgbG9hZEVkaXRvckxhbmd1YWdlKCk7XG4gICAgY29uc3QgbGFuZ3VhZ2VzID0gYXdhaXQgbG9hZEkxOG5MYW5ndWFnZXMoKTtcbiAgICBjdXJyZW50STE4bkxhbmd1YWdlcyA9IG5vcm1hbGl6ZUxhbmd1YWdlcyhbLi4ubGFuZ3VhZ2VzLCBlZGl0b3JMYW5ndWFnZV0pO1xuICAgIGNvbnN0IG5leHRFZGl0b3JMYW5ndWFnZSA9IGN1cnJlbnRJMThuTGFuZ3VhZ2VzLmluY2x1ZGVzKGVkaXRvckxhbmd1YWdlKSA/IGVkaXRvckxhbmd1YWdlIDogY3VycmVudEkxOG5MYW5ndWFnZXNbMF07XG4gICAgdXBkYXRlQ3VycmVudE5leHVzU2V0dGluZ3MoeyBlZGl0b3JMYW5ndWFnZTogbmV4dEVkaXRvckxhbmd1YWdlIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzYXZlRWRpdG9yTGFuZ3VhZ2UoZWRpdG9yTGFuZ3VhZ2U6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgdmFsdWUgPSBlZGl0b3JMYW5ndWFnZS50cmltKCkgfHwgREVGQVVMVF9FRElUT1JfTEFOR1VBR0U7XG4gICAgaWYgKCFjdXJyZW50STE4bkxhbmd1YWdlcy5pbmNsdWRlcyh2YWx1ZSkpIHtcbiAgICAgICAgY3VycmVudEkxOG5MYW5ndWFnZXMgPSBub3JtYWxpemVMYW5ndWFnZXMoWy4uLmN1cnJlbnRJMThuTGFuZ3VhZ2VzLCB2YWx1ZV0pO1xuICAgICAgICBhd2FpdCBzYXZlSTE4bkxhbmd1YWdlcyhjdXJyZW50STE4bkxhbmd1YWdlcyk7XG4gICAgfVxuXG4gICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsIEVESVRPUl9MQU5HVUFHRV9QUk9GSUxFX0tFWSwgdmFsdWUsICdwcm9qZWN0Jyk7XG4gICAgdXBkYXRlQ3VycmVudE5leHVzU2V0dGluZ3MoeyBlZGl0b3JMYW5ndWFnZTogdmFsdWUgfSk7XG4gICAgcmV0dXJuIHZhbHVlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkSTE4bkxhbmd1YWdlcygpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBhd2FpdCBFZGl0b3IuUHJvZmlsZS5nZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgSTE4Tl9MQU5HVUFHRVNfUFJPRklMRV9LRVksICdwcm9qZWN0Jyk7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZUxhbmd1YWdlcyh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dJMThuU3RlcCgnbG9hZC1pMThuLWxhbmd1YWdlczplcnJvcicsIGVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplTGFuZ3VhZ2VzKGF2YWlsYWJsZUVkaXRvckxhbmd1YWdlcygpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2F2ZUkxOG5MYW5ndWFnZXMobGFuZ3VhZ2VzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCB2YWx1ZXMgPSBub3JtYWxpemVMYW5ndWFnZXMobGFuZ3VhZ2VzKTtcbiAgICBjdXJyZW50STE4bkxhbmd1YWdlcyA9IHZhbHVlcztcbiAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgSTE4Tl9MQU5HVUFHRVNfUFJPRklMRV9LRVksIHZhbHVlcywgJ3Byb2plY3QnKTtcbiAgICByZXR1cm4gdmFsdWVzO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3YWl0U2NlbmVSZWFkeShtYXhSZXRyeSA9IDIwKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbG9nU3RlcCgnd2FpdFNjZW5lUmVhZHk6c3RhcnQnLCB7IG1heFJldHJ5IH0pO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXhSZXRyeTsgaSsrKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZWFkeSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWlzLXJlYWR5Jyk7XG4gICAgICAgICAgICBsb2dTdGVwKCd3YWl0U2NlbmVSZWFkeTpxdWVyeScsIHsgcmV0cnk6IGkgKyAxLCByZWFkeSB9KTtcbiAgICAgICAgICAgIGlmIChyZWFkeSkge1xuICAgICAgICAgICAgICAgIGxvZ1N0ZXAoJ3dhaXRTY2VuZVJlYWR5OnJlYWR5JywgeyByZXRyeTogaSArIDEgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dTdGVwKCd3YWl0U2NlbmVSZWFkeTplcnJvcicsIHsgcmV0cnk6IGkgKyAxLCBlcnJvciB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYXBwbHlEZXNpZ25SZXNvbHV0aW9uKFxuICAgIHJlc29sdXRpb246IERlc2lnblJlc29sdXRpb24sXG4gICAgcmVhc29uOiBzdHJpbmcsXG4gICAgb3B0aW9uczogQXBwbHlEZXNpZ25SZXNvbHV0aW9uT3B0aW9ucyA9IHt9LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbG9nU3RlcCgnYXBwbHlEZXNpZ25SZXNvbHV0aW9uOnJlcXVlc3QnLCB7IHJlYXNvbiwgcmVzb2x1dGlvbiwgb3B0aW9ucyB9KTtcblxuICAgIGNvbnN0IGtleSA9IHJlc29sdXRpb25LZXkocmVzb2x1dGlvbik7XG4gICAgaWYgKCFvcHRpb25zLmZvcmNlICYmIGxhc3RBcHBsaWVkUmVzb2x1dGlvbktleSA9PT0ga2V5KSB7XG4gICAgICAgIGxvZ1N0ZXAoJ2FwcGx5RGVzaWduUmVzb2x1dGlvbjpkdXBsaWNhdGUtc3RpbGwtYXBwbHknLCB7IHJlYXNvbiwgcmVzb2x1dGlvbiB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBiZWZvcmUgPSBhd2FpdCBxdWVyeURlc2lnblJlc29sdXRpb24oYCR7cmVhc29ufTpiZWZvcmVgKTtcbiAgICBjb25zdCBjaGFuZ2VkID0gIWlzU2FtZVJlc29sdXRpb24oYmVmb3JlLCByZXNvbHV0aW9uKTtcbiAgICBsb2dTdGVwKCdhcHBseURlc2lnblJlc29sdXRpb246Y2hhbmdlLWNoZWNrJywgeyByZWFzb24sIGJlZm9yZSwgcmVzb2x1dGlvbiwgY2hhbmdlZCB9KTtcblxuICAgIGlmICghb3B0aW9ucy5mb3JjZSAmJiAhY2hhbmdlZCkge1xuICAgICAgICBsYXN0QXBwbGllZFJlc29sdXRpb25LZXkgPSBrZXk7XG4gICAgICAgIGxvZ1N0ZXAoJ2FwcGx5RGVzaWduUmVzb2x1dGlvbjpza2lwLXVuY2hhbmdlZCcsIHsgcmVhc29uLCByZXNvbHV0aW9uIH0pO1xuICAgICAgICBpZiAob3B0aW9ucy5yZWZyZXNoU2NlbmVXaGVuVW5jaGFuZ2VkICYmIG9wdGlvbnMucmVsb2FkU2NlbmUgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBhd2FpdCByZWZyZXNoRGVzaWduUmVzb2x1dGlvbkluU2NlbmUocmVzb2x1dGlvbiwgJ3VuY2hhbmdlZC1yZXNvbHV0aW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG9rID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgncHJvamVjdCcsICdzZXQtY29uZmlnJywgJ3Byb2plY3QnLCAnZ2VuZXJhbC5kZXNpZ25SZXNvbHV0aW9uJywgcmVzb2x1dGlvbik7XG4gICAgbG9nU3RlcCgnYXBwbHlEZXNpZ25SZXNvbHV0aW9uOnJlc3VsdCcsIHsgcmVhc29uLCByZXNvbHV0aW9uLCBvayB9KTtcblxuICAgIGlmICghb2spIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYXBwbHkgZGVzaWduIHJlc29sdXRpb24uYCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsYXN0QXBwbGllZFJlc29sdXRpb25LZXkgPSBrZXk7XG4gICAgYXdhaXQgcXVlcnlEZXNpZ25SZXNvbHV0aW9uKGAke3JlYXNvbn06YWZ0ZXJgKTtcblxuICAgIGlmIChvcHRpb25zLnJlbG9hZFNjZW5lICE9PSBmYWxzZSAmJiAoY2hhbmdlZCB8fCBvcHRpb25zLnJlZnJlc2hTY2VuZVdoZW5VbmNoYW5nZWQpKSB7XG4gICAgICAgIGF3YWl0IHJlZnJlc2hEZXNpZ25SZXNvbHV0aW9uSW5TY2VuZShyZXNvbHV0aW9uLCAnYXBwbGllZC1yZXNvbHV0aW9uJyk7XG4gICAgfSBlbHNlIGlmICghY2hhbmdlZCkge1xuICAgICAgICBsb2dTdGVwKCdhcHBseURlc2lnblJlc29sdXRpb246c2tpcC1zb2Z0LXJlbG9hZC11bmNoYW5nZWQnLCB7IHJlYXNvbiB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2dTdGVwKCdhcHBseURlc2lnblJlc29sdXRpb246c2tpcC1zb2Z0LXJlbG9hZCcsIHsgcmVhc29uIH0pO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXBwbHlOZXh1c1NldHRpbmdzKHNldHRpbmdzOiBOZXh1c1NldHRpbmdzRGF0YSwgcmVhc29uOiBzdHJpbmcsIG9wdGlvbnM6IEFwcGx5RGVzaWduUmVzb2x1dGlvbk9wdGlvbnMgPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5leHQgPSB1cGRhdGVDdXJyZW50TmV4dXNTZXR0aW5ncyhzZXR0aW5ncyk7XG4gICAgYXdhaXQgYXBwbHlEZXNpZ25SZXNvbHV0aW9uKHJlc29sdXRpb25Gcm9tU2V0dGluZ3MobmV4dCksIHJlYXNvbiwgb3B0aW9ucyk7XG4gICAgYXdhaXQgcmVmcmVzaEkxOG5Db21wb25lbnRzSW5TY2VuZSgpO1xuICAgIHNjaGVkdWxlUmVmcmVzaEkxOG5Db21wb25lbnRzSW5TY2VuZSgpO1xufVxuXG5mdW5jdGlvbiByZWFkSnNvbkZpbGU8VCA9IHVua25vd24+KGZpbGU6IHN0cmluZyk6IFQgfCB1bmRlZmluZWQge1xuICAgIGxvZ1N0ZXAoJ3JlYWRKc29uRmlsZTpzdGFydCcsIHsgZmlsZSB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhmaWxlLCAndXRmOCcpKSBhcyBUO1xuICAgICAgICBsb2dTdGVwKCdyZWFkSnNvbkZpbGU6c3VjY2VzcycsIHsgZmlsZSB9KTtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nU3RlcCgncmVhZEpzb25GaWxlOmVycm9yJywgeyBmaWxlLCBlcnJvciB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlYWRJMThuRmlsZShidW5kbGVOYW1lOiBzdHJpbmcsIGxhbmd1YWdlOiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBsb2dJMThuU3RlcCgncmVhZC1maWxlOnN0YXJ0JywgeyBidW5kbGVOYW1lLCBsYW5ndWFnZSB9KTtcbiAgICBjb25zdCBsYW5ndWFnZU5hbWVzID0gbGFuZ3VhZ2VQYXRoTmFtZXMobGFuZ3VhZ2UpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGxhbmcgb2YgbGFuZ3VhZ2VOYW1lcykge1xuICAgICAgICBjYW5kaWRhdGVzLnB1c2goLi4ubGFuZ3VhZ2VCdW5kbGVGaWxlcyhsYW5nLCAnY29tbW9uJykpO1xuICAgICAgICBpZiAoYnVuZGxlTmFtZSkge1xuICAgICAgICAgICAgY2FuZGlkYXRlcy5wdXNoKC4uLmxhbmd1YWdlQnVuZGxlRmlsZXMobGFuZywgYnVuZGxlTmFtZSkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHVuaXF1ZShjYW5kaWRhdGVzKSkge1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZmlsZSkpIHtcbiAgICAgICAgICAgIGxvZ0kxOG5TdGVwKCdyZWFkLWZpbGU6bWlzc2luZycsIHsgZmlsZSB9KTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGF0YSA9IHJlYWRKc29uRmlsZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4oZmlsZSk7XG4gICAgICAgIGlmICghZGF0YSkge1xuICAgICAgICAgICAgbG9nSTE4blN0ZXAoJ3JlYWQtZmlsZTppbnZhbGlkLWpzb24nLCB7IGZpbGUgfSk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBjb3VudCA9IDA7XG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEpKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgY291bnQrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsb2dJMThuU3RlcCgncmVhZC1maWxlOmxvYWRlZCcsIHsgZmlsZSwgY291bnQgfSk7XG4gICAgfVxuICAgIGxvZ0kxOG5TdGVwKCdyZWFkLWZpbGU6ZG9uZScsIHsgYnVuZGxlTmFtZSwgbGFuZ3VhZ2UsIGNvdW50OiBPYmplY3Qua2V5cyhyZXN1bHQpLmxlbmd0aCB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBsYW5ndWFnZVBhdGhOYW1lcyhsYW5ndWFnZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IG5hbWVzID0gW2xhbmd1YWdlXTtcbiAgICBpZiAobGFuZ3VhZ2UuaW5jbHVkZXMoJ18nKSkgbmFtZXMucHVzaChsYW5ndWFnZS5yZXBsYWNlKC9fL2csICctJykpO1xuICAgIGlmIChsYW5ndWFnZS5pbmNsdWRlcygnLScpKSBuYW1lcy5wdXNoKGxhbmd1YWdlLnJlcGxhY2UoLy0vZywgJ18nKSk7XG4gICAgcmV0dXJuIHVuaXF1ZShuYW1lcy5maWx0ZXIoQm9vbGVhbikpO1xufVxuXG5mdW5jdGlvbiBsYW5ndWFnZUJ1bmRsZUZpbGVzKGxhbmd1YWdlOiBzdHJpbmcsIGJ1bmRsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByb290ID0gam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnYXNzZXRzJywgJ2xhbmd1YWdlcycsIGxhbmd1YWdlLCBidW5kbGVOYW1lKTtcbiAgICByZXR1cm4gW1xuICAgICAgICBgJHtyb290fS5qc29uYCxcbiAgICAgICAgam9pbihyb290LCBgJHtsYW5ndWFnZX0uanNvbmApLFxuICAgICAgICBqb2luKHJvb3QsIGAke2xhbmd1YWdlLnJlcGxhY2UoLy0vZywgJ18nKX0uanNvbmApLFxuICAgICAgICBqb2luKHJvb3QsICdpbmRleC5qc29uJyksXG4gICAgXTtcbn1cblxuZnVuY3Rpb24gYXZhaWxhYmxlRWRpdG9yTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXN1bHQgPSBbREVGQVVMVF9FRElUT1JfTEFOR1VBR0VdO1xuICAgIGNvbnN0IGxhbmd1YWdlUm9vdCA9IGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ2Fzc2V0cycsICdsYW5ndWFnZXMnKTtcbiAgICBpZiAoZXhpc3RzU3luYyhsYW5ndWFnZVJvb3QpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVhZGRpclN5bmMobGFuZ3VhZ2VSb290KSkge1xuICAgICAgICAgICAgY29uc3QgcGF0aCA9IGpvaW4obGFuZ3VhZ2VSb290LCBlbnRyeSk7XG4gICAgICAgICAgICBpZiAoc3RhdFN5bmMocGF0aCkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmlxdWUocmVzdWx0KS5zb3J0KCk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlcyhsYW5ndWFnZXM6IHVua25vd25bXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXN1bHQgPSBsYW5ndWFnZXNcbiAgICAgICAgLm1hcCgobGFuZ3VhZ2UpID0+IHR5cGVvZiBsYW5ndWFnZSA9PT0gJ3N0cmluZycgPyBsYW5ndWFnZS50cmltKCkgOiAnJylcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICByZXR1cm4gdW5pcXVlKHJlc3VsdC5sZW5ndGggPiAwID8gcmVzdWx0IDogW0RFRkFVTFRfRURJVE9SX0xBTkdVQUdFXSk7XG59XG5cbmZ1bmN0aW9uIHVuaXF1ZTxUPihpdGVtczogVFtdKTogVFtdIHtcbiAgICByZXR1cm4gaXRlbXMuZmlsdGVyKChpdGVtLCBpbmRleCkgPT4gaXRlbXMuaW5kZXhPZihpdGVtKSA9PT0gaW5kZXgpO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRUZXh0KHRleHQ6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcge1xuICAgIGlmICghcGFyYW1zKSByZXR1cm4gdGV4dDtcblxuICAgIGxldCByZXN1bHQgPSB0ZXh0O1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHBhcmFtcykpIHtcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0LnJlcGxhY2UobmV3IFJlZ0V4cChgXFxcXHske2tleX1cXFxcfWAsICdnJyksIFN0cmluZyhwYXJhbXNba2V5XSkpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBxdWVyeUkxOG5UZXh0KGtleTogc3RyaW5nLCBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHN0cmluZyB7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSB8fCBERUZBVUxUX0VESVRPUl9MQU5HVUFHRTtcbiAgICBjb25zdCBidW5kbGVOYW1lID0gY3VycmVudE5leHVzU2V0dGluZ3MuYnVuZGxlTmFtZSB8fCAnJztcbiAgICBsb2dJMThuU3RlcCgncXVlcnktdGV4dDpzdGFydCcsIHsga2V5LCBidW5kbGVOYW1lLCBsYW5ndWFnZSwgaGFzUGFyYW1zOiAhIXBhcmFtcyB9KTtcbiAgICBjb25zdCB0cmFuc2xhdGlvbnMgPSByZWFkSTE4bkZpbGUoYnVuZGxlTmFtZSwgbGFuZ3VhZ2UpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGZvcm1hdFRleHQodHJhbnNsYXRpb25zW2tleV0gPz8ga2V5LCBwYXJhbXMpO1xuICAgIGxvZ0kxOG5TdGVwKCdxdWVyeS10ZXh0OnJlc3VsdCcsIHsga2V5LCByZXN1bHQsIG1hdGNoZWQ6IHJlc3VsdCAhPT0ga2V5IH0pO1xuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHBhcnNlSTE4blNwcml0ZUFzc2V0KHV1aWQ6IHN0cmluZyk6IFByb21pc2U8eyBidW5kbGVOYW1lOiBzdHJpbmc7IHJlbGF0aXZlUGF0aDogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgcmV0dXJuIHBhcnNlSTE4bkxvY2FsaXplZEFzc2V0KHV1aWQsIHN0cmlwU3ByaXRlUGF0aERlY29yYXRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcGFyc2VJMThuTG9jYWxpemVkQXNzZXQoXG4gICAgdXVpZDogc3RyaW5nLFxuICAgIHN0cmlwUGF0aERlY29yYXRpb25zOiAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgPSBzdHJpcEkxOG5Bc3NldFBhdGhEZWNvcmF0aW9ucyxcbik6IFByb21pc2U8eyBidW5kbGVOYW1lOiBzdHJpbmc7IHJlbGF0aXZlUGF0aDogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IHF1ZXJ5QXNzZXRJbmZvKHV1aWQpO1xuICAgIGNvbnN0IGluZm9VcmwgPSBpbmZvPy51cmw7XG4gICAgY29uc3QgaW5mb1NvdXJjZSA9IGluZm8/LnNvdXJjZTtcbiAgICBjb25zdCB1cmwgPSBub3JtYWxpemVBc3NldFVybChcbiAgICAgICAgdHlwZW9mIGluZm9VcmwgPT09ICdzdHJpbmcnID8gaW5mb1VybCA6IHR5cGVvZiBpbmZvU291cmNlID09PSAnc3RyaW5nJyA/IGluZm9Tb3VyY2UgOiAnJyxcbiAgICApO1xuICAgIGlmICghdXJsKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlSTE4bkFzc2V0VXJsKHVybCk7XG4gICAgaWYgKCFwYXJzZWQpIHJldHVybiBudWxsO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYnVuZGxlTmFtZTogcGFyc2VkLmJ1bmRsZU5hbWUsXG4gICAgICAgIHJlbGF0aXZlUGF0aDogc3RyaXBQYXRoRGVjb3JhdGlvbnMocGFyc2VkLnJlbGF0aXZlUGF0aCksXG4gICAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcXVlcnlJMThuU3ByaXRlQXNzZXQoYnVuZGxlTmFtZTogc3RyaW5nLCByZWxhdGl2ZVBhdGg6IHN0cmluZyk6IFByb21pc2U8eyB1dWlkOiBzdHJpbmc7IHVybDogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgY29uc3QgY2xlYW5CdW5kbGVOYW1lID0gU3RyaW5nKGJ1bmRsZU5hbWUgfHwgJycpLnRyaW0oKTtcbiAgICBjb25zdCBjbGVhblJlbGF0aXZlUGF0aCA9IHN0cmlwU3ByaXRlUGF0aERlY29yYXRpb25zKFN0cmluZyhyZWxhdGl2ZVBhdGggfHwgJycpLnRyaW0oKSk7XG4gICAgaWYgKCFjbGVhbkJ1bmRsZU5hbWUgfHwgIWNsZWFuUmVsYXRpdmVQYXRoKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IGxhbmd1YWdlcyA9IGxhbmd1YWdlUGF0aE5hbWVzKGN1cnJlbnROZXh1c1NldHRpbmdzLmVkaXRvckxhbmd1YWdlIHx8IERFRkFVTFRfRURJVE9SX0xBTkdVQUdFKTtcbiAgICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIGxhbmd1YWdlcykge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWVyeUkxOG5TcHJpdGVBc3NldEJ5TGFuZ3VhZ2UobGFuZ3VhZ2UsIGNsZWFuQnVuZGxlTmFtZSwgY2xlYW5SZWxhdGl2ZVBhdGgpO1xuICAgICAgICBpZiAocmVzdWx0KSByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBxdWVyeUkxOG5TcGluZUFzc2V0KGJ1bmRsZU5hbWU6IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHsgdXVpZDogc3RyaW5nOyB1cmw6IHN0cmluZyB9IHwgbnVsbD4ge1xuICAgIHJldHVybiBxdWVyeUkxOG5Bc3NldChidW5kbGVOYW1lLCByZWxhdGl2ZVBhdGgsIEkxOE5fU1BJTkVfRVhURU5TSU9OUywgZmluZEFzc2V0VXVpZCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5STE4bkRyYWdvbkJvbmVzQXNzZXQoYnVuZGxlTmFtZTogc3RyaW5nLCByZWxhdGl2ZVBhdGg6IHN0cmluZyk6IFByb21pc2U8eyB1dWlkOiBzdHJpbmc7IHVybDogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgcmV0dXJuIHF1ZXJ5STE4bkFzc2V0KGJ1bmRsZU5hbWUsIHJlbGF0aXZlUGF0aCwgSTE4Tl9EUkFHT05fQk9ORVNfQVNTRVRfRVhURU5TSU9OUywgZmluZEFzc2V0VXVpZCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5STE4bkRyYWdvbkJvbmVzQXRsYXNBc3NldChidW5kbGVOYW1lOiBzdHJpbmcsIHJlbGF0aXZlUGF0aDogc3RyaW5nKTogUHJvbWlzZTx7IHV1aWQ6IHN0cmluZzsgdXJsOiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgICByZXR1cm4gcXVlcnlJMThuQXNzZXQoYnVuZGxlTmFtZSwgcmVsYXRpdmVQYXRoLCBJMThOX0RSQUdPTl9CT05FU19BVExBU19FWFRFTlNJT05TLCBmaW5kQXNzZXRVdWlkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcXVlcnlJMThuQXNzZXQoXG4gICAgYnVuZGxlTmFtZTogc3RyaW5nLFxuICAgIHJlbGF0aXZlUGF0aDogc3RyaW5nLFxuICAgIGV4dGVuc2lvbnM6IHN0cmluZ1tdLFxuICAgIGZpbmRVdWlkOiAoaW5mbzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKSA9PiBzdHJpbmcsXG4pOiBQcm9taXNlPHsgdXVpZDogc3RyaW5nOyB1cmw6IHN0cmluZyB9IHwgbnVsbD4ge1xuICAgIGNvbnN0IGNsZWFuQnVuZGxlTmFtZSA9IFN0cmluZyhidW5kbGVOYW1lIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgY2xlYW5SZWxhdGl2ZVBhdGggPSBzdHJpcEkxOG5Bc3NldFBhdGhEZWNvcmF0aW9ucyhTdHJpbmcocmVsYXRpdmVQYXRoIHx8ICcnKS50cmltKCkpO1xuICAgIGlmICghY2xlYW5CdW5kbGVOYW1lIHx8ICFjbGVhblJlbGF0aXZlUGF0aCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBsYW5ndWFnZXMgPSBsYW5ndWFnZVBhdGhOYW1lcyhjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSB8fCBERUZBVUxUX0VESVRPUl9MQU5HVUFHRSk7XG4gICAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBsYW5ndWFnZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBleHQgb2YgZXh0ZW5zaW9ucykge1xuICAgICAgICAgICAgY29uc3QgYXNzZXRVcmwgPSBgZGI6Ly9hc3NldHMvbGFuZ3VhZ2VzLyR7bGFuZ3VhZ2V9LyR7Y2xlYW5CdW5kbGVOYW1lfS8ke2NsZWFuUmVsYXRpdmVQYXRofSR7ZXh0fWA7XG4gICAgICAgICAgICBjb25zdCBpbmZvID0gYXdhaXQgcXVlcnlBc3NldEluZm8oYXNzZXRVcmwpO1xuICAgICAgICAgICAgY29uc3QgdXVpZCA9IGZpbmRVdWlkKGluZm8pO1xuICAgICAgICAgICAgaWYgKHV1aWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4geyB1dWlkLCB1cmw6IGFzc2V0VXJsIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcXVlcnlJMThuU3ByaXRlQXNzZXRCeUxhbmd1YWdlKFxuICAgIGxhbmd1YWdlOiBzdHJpbmcsXG4gICAgYnVuZGxlTmFtZTogc3RyaW5nLFxuICAgIHJlbGF0aXZlUGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTx7IHV1aWQ6IHN0cmluZzsgdXJsOiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgICBmb3IgKGNvbnN0IGV4dCBvZiBJMThOX1NQUklURV9FWFRFTlNJT05TKSB7XG4gICAgICAgIGNvbnN0IGFzc2V0VXJsID0gYGRiOi8vYXNzZXRzL2xhbmd1YWdlcy8ke2xhbmd1YWdlfS8ke2J1bmRsZU5hbWV9LyR7cmVsYXRpdmVQYXRofSR7ZXh0fWA7XG4gICAgICAgIGNvbnN0IGluZm8gPSBhd2FpdCBxdWVyeUFzc2V0SW5mbyhhc3NldFVybCk7XG4gICAgICAgIGNvbnN0IHV1aWQgPSBmaW5kU3ByaXRlRnJhbWVVdWlkKGluZm8pO1xuICAgICAgICBpZiAodXVpZCkge1xuICAgICAgICAgICAgcmV0dXJuIHsgdXVpZCwgdXJsOiBhc3NldFVybCB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5QXNzZXRJbmZvKHVybE9yVXVpZE9yUGF0aDogc3RyaW5nKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIHVybE9yVXVpZE9yUGF0aCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ1N0ZXAoJ3F1ZXJ5QXNzZXRJbmZvOmVycm9yJywgeyB1cmxPclV1aWRPclBhdGgsIGVycm9yIH0pO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZpbmRTcHJpdGVGcmFtZVV1aWQoaW5mbzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKTogc3RyaW5nIHtcbiAgICBpZiAoIWluZm8pIHJldHVybiAnJztcblxuICAgIGlmIChpbmZvLnR5cGUgPT09ICdjYy5TcHJpdGVGcmFtZScgfHwgaW5mby5pbXBvcnRlciA9PT0gJ3Nwcml0ZS1mcmFtZScgfHwgaW5mby5uYW1lID09PSAnc3ByaXRlRnJhbWUnKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgaW5mby51dWlkID09PSAnc3RyaW5nJyA/IGluZm8udXVpZCA6ICcnO1xuICAgIH1cblxuICAgIGNvbnN0IHN1YkFzc2V0cyA9IGluZm8uc3ViQXNzZXRzO1xuICAgIGlmICghc3ViQXNzZXRzIHx8IHR5cGVvZiBzdWJBc3NldHMgIT09ICdvYmplY3QnKSByZXR1cm4gJyc7XG5cbiAgICBmb3IgKGNvbnN0IHN1YkFzc2V0IG9mIE9iamVjdC52YWx1ZXMoc3ViQXNzZXRzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgICBpZiAoIXN1YkFzc2V0IHx8IHR5cGVvZiBzdWJBc3NldCAhPT0gJ29iamVjdCcpIGNvbnRpbnVlO1xuXG4gICAgICAgIGNvbnN0IHJlY29yZCA9IHN1YkFzc2V0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBpZiAocmVjb3JkLmltcG9ydGVyID09PSAnc3ByaXRlLWZyYW1lJyB8fCByZWNvcmQubmFtZSA9PT0gJ3Nwcml0ZUZyYW1lJyB8fCByZWNvcmQudHlwZSA9PT0gJ2NjLlNwcml0ZUZyYW1lJykge1xuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiByZWNvcmQudXVpZCA9PT0gJ3N0cmluZycgPyByZWNvcmQudXVpZCA6ICcnO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuICcnO1xufVxuXG5mdW5jdGlvbiBmaW5kQXNzZXRVdWlkKGluZm86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHR5cGVvZiBpbmZvPy51dWlkID09PSAnc3RyaW5nJyA/IGluZm8udXVpZCA6ICcnO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVBc3NldFVybCh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHVybC5yZXBsYWNlKC9cXC9zcHJpdGVGcmFtZSQvLCAnJyk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSTE4bkFzc2V0VXJsKHVybDogc3RyaW5nKTogeyBsYW5ndWFnZTogc3RyaW5nOyBidW5kbGVOYW1lOiBzdHJpbmc7IHJlbGF0aXZlUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgICBjb25zdCBtYXRjaCA9IG5vcm1hbGl6ZUFzc2V0VXJsKHVybCkubWF0Y2goL15kYjpcXC9cXC9hc3NldHNcXC9sYW5ndWFnZXNcXC8oW14vXSspXFwvKFteL10rKVxcLyguKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBsYW5ndWFnZTogbWF0Y2hbMV0sXG4gICAgICAgIGJ1bmRsZU5hbWU6IG1hdGNoWzJdLFxuICAgICAgICByZWxhdGl2ZVBhdGg6IHN0cmlwU3ByaXRlUGF0aERlY29yYXRpb25zKG1hdGNoWzNdKSxcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBzdHJpcFNwcml0ZVBhdGhEZWNvcmF0aW9ucyhwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBwYXRoXG4gICAgICAgIC5yZXBsYWNlKC9cXC9zcHJpdGVGcmFtZSQvLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL1xcLihwbmd8anBnfGpwZWd8d2VicCkkL2ksICcnKTtcbn1cblxuZnVuY3Rpb24gc3RyaXBJMThuQXNzZXRQYXRoRGVjb3JhdGlvbnMocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gcGF0aFxuICAgICAgICAucmVwbGFjZSgvXFwvc3ByaXRlRnJhbWUkLywgJycpXG4gICAgICAgIC5yZXBsYWNlKC9cXC4ocG5nfGpwZ3xqcGVnfHdlYnB8c2tlbHxqc29ufGF0bGFzKSQvaSwgJycpO1xufVxuXG5mdW5jdGlvbiB3YWxrRmlsZXMocm9vdDogc3RyaW5nLCBtYXRjaGVyOiAoZmlsZTogc3RyaW5nKSA9PiBib29sZWFuKTogc3RyaW5nW10ge1xuICAgIGlmICghZXhpc3RzU3luYyhyb290KSkge1xuICAgICAgICBsb2dTdGVwKCd3YWxrRmlsZXM6bWlzc2luZy1yb290JywgeyByb290IH0pO1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0OiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVhZGRpclN5bmMocm9vdCkpIHtcbiAgICAgICAgY29uc3QgZmlsZSA9IGpvaW4ocm9vdCwgZW50cnkpO1xuICAgICAgICBjb25zdCBzdGF0ID0gc3RhdFN5bmMoZmlsZSk7XG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKC4uLndhbGtGaWxlcyhmaWxlLCBtYXRjaGVyKSk7XG4gICAgICAgIH0gZWxzZSBpZiAobWF0Y2hlcihmaWxlKSkge1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goZmlsZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiByZWFkQ3VycmVudFNjZW5lVXVpZCgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGlmIChjdXJyZW50U2NlbmVVdWlkKSB7XG4gICAgICAgIGxvZ1N0ZXAoJ3JlYWRDdXJyZW50U2NlbmVVdWlkOmZyb20tYnJvYWRjYXN0JywgeyB1dWlkOiBjdXJyZW50U2NlbmVVdWlkIH0pO1xuICAgICAgICByZXR1cm4gY3VycmVudFNjZW5lVXVpZDtcbiAgICB9XG5cbiAgICBjb25zdCBzZXR0aW5nc1BhdGggPSBqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsIFNDRU5FX1NFVFRJTkdTX1BBVEgpO1xuICAgIGxvZ1N0ZXAoJ3JlYWRDdXJyZW50U2NlbmVVdWlkOmZyb20tc2V0dGluZ3M6c3RhcnQnLCB7IHNldHRpbmdzUGF0aCB9KTtcblxuICAgIGNvbnN0IHNldHRpbmdzID0gcmVhZEpzb25GaWxlPFJlY29yZDxzdHJpbmcsIHVua25vd24+PihzZXR0aW5nc1BhdGgpO1xuICAgIGNvbnN0IHV1aWQgPSBzZXR0aW5ncz8uWydjdXJyZW50LXNjZW5lJ107XG4gICAgY29uc3QgcmVzdWx0ID0gdHlwZW9mIHV1aWQgPT09ICdzdHJpbmcnICYmIHV1aWQubGVuZ3RoID4gMCA/IHV1aWQgOiB1bmRlZmluZWQ7XG4gICAgbG9nU3RlcCgncmVhZEN1cnJlbnRTY2VuZVV1aWQ6ZnJvbS1zZXR0aW5nczpyZXN1bHQnLCB7IHV1aWQ6IHJlc3VsdCB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmaW5kU2NlbmVQYXRoQnlVdWlkKHV1aWQ6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgYXNzZXRzUm9vdCA9IGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ2Fzc2V0cycpO1xuICAgIGxvZ1N0ZXAoJ2ZpbmRTY2VuZVBhdGhCeVV1aWQ6c3RhcnQnLCB7IHV1aWQsIGFzc2V0c1Jvb3QgfSk7XG5cbiAgICBjb25zdCBzY2VuZU1ldGFzID0gd2Fsa0ZpbGVzKGFzc2V0c1Jvb3QsIChmaWxlKSA9PiBmaWxlLmVuZHNXaXRoKCcuc2NlbmUubWV0YScpKTtcbiAgICBsb2dTdGVwKCdmaW5kU2NlbmVQYXRoQnlVdWlkOm1ldGFzLWZvdW5kJywgeyBjb3VudDogc2NlbmVNZXRhcy5sZW5ndGggfSk7XG5cbiAgICBmb3IgKGNvbnN0IG1ldGFQYXRoIG9mIHNjZW5lTWV0YXMpIHtcbiAgICAgICAgY29uc3QgbWV0YSA9IHJlYWRKc29uRmlsZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4obWV0YVBhdGgpO1xuICAgICAgICBpZiAobWV0YT8udXVpZCA9PT0gdXVpZCkge1xuICAgICAgICAgICAgY29uc3Qgc2NlbmVQYXRoID0gbWV0YVBhdGgucmVwbGFjZSgvXFwubWV0YSQvLCAnJyk7XG4gICAgICAgICAgICBsb2dTdGVwKCdmaW5kU2NlbmVQYXRoQnlVdWlkOm1hdGNoZWQtbWV0YScsIHsgbWV0YVBhdGgsIHNjZW5lUGF0aCwgZXhpc3RzOiBleGlzdHNTeW5jKHNjZW5lUGF0aCkgfSk7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3RzU3luYyhzY2VuZVBhdGgpID8gc2NlbmVQYXRoIDogdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9nU3RlcCgnZmluZFNjZW5lUGF0aEJ5VXVpZDpub3QtZm91bmQnLCB7IHV1aWQgfSk7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gZmluZFNjZW5lUGF0aEJ5Um9vdE5hbWUocm9vdE5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgYXNzZXRzUm9vdCA9IGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ2Fzc2V0cycpO1xuICAgIGxvZ1N0ZXAoJ2ZpbmRTY2VuZVBhdGhCeVJvb3ROYW1lOnN0YXJ0JywgeyByb290TmFtZSwgYXNzZXRzUm9vdCB9KTtcblxuICAgIGNvbnN0IHNjZW5lTWV0YXMgPSB3YWxrRmlsZXMoYXNzZXRzUm9vdCwgKGZpbGUpID0+IGZpbGUuZW5kc1dpdGgoJy5zY2VuZS5tZXRhJykpO1xuICAgIGxvZ1N0ZXAoJ2ZpbmRTY2VuZVBhdGhCeVJvb3ROYW1lOm1ldGFzLWZvdW5kJywgeyBjb3VudDogc2NlbmVNZXRhcy5sZW5ndGggfSk7XG5cbiAgICBmb3IgKGNvbnN0IG1ldGFQYXRoIG9mIHNjZW5lTWV0YXMpIHtcbiAgICAgICAgY29uc3Qgc2NlbmVQYXRoID0gbWV0YVBhdGgucmVwbGFjZSgvXFwubWV0YSQvLCAnJyk7XG4gICAgICAgIGNvbnN0IHNjZW5lTmFtZSA9IGJhc2VuYW1lKHNjZW5lUGF0aCwgJy5zY2VuZScpO1xuICAgICAgICBpZiAoc2NlbmVOYW1lID09PSByb290TmFtZSkge1xuICAgICAgICAgICAgbG9nU3RlcCgnZmluZFNjZW5lUGF0aEJ5Um9vdE5hbWU6bWF0Y2hlZC1maWxlLW5hbWUnLCB7IHNjZW5lTmFtZSwgbWV0YVBhdGgsIHNjZW5lUGF0aCwgZXhpc3RzOiBleGlzdHNTeW5jKHNjZW5lUGF0aCkgfSk7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3RzU3luYyhzY2VuZVBhdGgpID8gc2NlbmVQYXRoIDogdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgbG9nU3RlcCgnZmluZFNjZW5lUGF0aEJ5Um9vdE5hbWU6bm90LWZvdW5kJywgeyByb290TmFtZSB9KTtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBmaW5kU2V0dGluZ3NJblNlcmlhbGl6ZWRTY2VuZShzY2VuZURhdGE6IHVua25vd24sIHBhdGggPSAnJCcpOiBOZXh1c1NldHRpbmdzRGF0YSB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc2NlbmVEYXRhKSkge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNjZW5lRGF0YS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZFNldHRpbmdzSW5TZXJpYWxpemVkU2NlbmUoc2NlbmVEYXRhW2ldLCBgJHtwYXRofVske2l9XWApO1xuICAgICAgICAgICAgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKCFzY2VuZURhdGEgfHwgdHlwZW9mIHNjZW5lRGF0YSAhPT0gJ29iamVjdCcpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCByZWNvcmQgPSBzY2VuZURhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKFxuICAgICAgICB0eXBlb2YgcmVjb3JkLm9yaWVudGF0aW9uID09PSAnbnVtYmVyJ1xuICAgICAgICB8fCB0eXBlb2YgcmVjb3JkLl9vcmllbnRhdGlvbiA9PT0gJ251bWJlcidcbiAgICApIHtcbiAgICAgICAgY29uc3Qgb3JpZW50YXRpb24gPSB0eXBlb2YgcmVjb3JkLm9yaWVudGF0aW9uID09PSAnbnVtYmVyJyA/IHJlY29yZC5vcmllbnRhdGlvbiA6IHJlY29yZC5fb3JpZW50YXRpb247XG4gICAgICAgIGNvbnN0IGJ1bmRsZU5hbWUgPSB0eXBlb2YgcmVjb3JkLmJ1bmRsZU5hbWUgPT09ICdzdHJpbmcnID8gcmVjb3JkLmJ1bmRsZU5hbWUgOiByZWNvcmQuX2J1bmRsZU5hbWU7XG4gICAgICAgIGNvbnN0IHNldHRpbmdzID0ge1xuICAgICAgICAgICAgYnVuZGxlTmFtZTogdHlwZW9mIGJ1bmRsZU5hbWUgPT09ICdzdHJpbmcnID8gYnVuZGxlTmFtZSA6ICcnLFxuICAgICAgICAgICAgZWRpdG9yTGFuZ3VhZ2U6IGN1cnJlbnROZXh1c1NldHRpbmdzLmVkaXRvckxhbmd1YWdlIHx8IERFRkFVTFRfRURJVE9SX0xBTkdVQUdFLFxuICAgICAgICAgICAgb3JpZW50YXRpb246IHR5cGVvZiBvcmllbnRhdGlvbiA9PT0gJ251bWJlcicgPyBvcmllbnRhdGlvbiA6IDAsXG4gICAgICAgIH07XG4gICAgICAgIGxvZ1N0ZXAoJ2ZpbmRTZXR0aW5nc0luU2VyaWFsaXplZFNjZW5lOmhpdCcsIHsgcGF0aCwgc2V0dGluZ3MsIHR5cGU6IHJlY29yZC5fX3R5cGVfXyB9KTtcbiAgICAgICAgcmV0dXJuIHNldHRpbmdzO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlY29yZCkpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZFNldHRpbmdzSW5TZXJpYWxpemVkU2NlbmUodmFsdWUsIGAke3BhdGh9LiR7a2V5fWApO1xuICAgICAgICBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gc2V0dGluZ3NGcm9tQ3VycmVudFNjZW5lQXNzZXQoKTogTmV4dXNTZXR0aW5nc0RhdGEgfCB1bmRlZmluZWQge1xuICAgIGxvZ1N0ZXAoJ3NldHRpbmdzRnJvbUN1cnJlbnRTY2VuZUFzc2V0OnN0YXJ0Jyk7XG5cbiAgICBjb25zdCB1dWlkID0gcmVhZEN1cnJlbnRTY2VuZVV1aWQoKTtcbiAgICBpZiAoIXV1aWQpIHtcbiAgICAgICAgbG9nU3RlcCgnc2V0dGluZ3NGcm9tQ3VycmVudFNjZW5lQXNzZXQ6bm8tY3VycmVudC11dWlkJyk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NlbmVQYXRoID0gZmluZFNjZW5lUGF0aEJ5VXVpZCh1dWlkKTtcbiAgICBpZiAoIXNjZW5lUGF0aCkge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENvdWxkIG5vdCBmaW5kIHNjZW5lIGZpbGUgZm9yIHV1aWQ6ICR7dXVpZH1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBzY2VuZURhdGEgPSByZWFkSnNvbkZpbGUoc2NlbmVQYXRoKTtcbiAgICBpZiAoIXNjZW5lRGF0YSkge1xuICAgICAgICBsb2dTdGVwKCdzZXR0aW5nc0Zyb21DdXJyZW50U2NlbmVBc3NldDpuby1zY2VuZS1kYXRhJywgeyBzY2VuZVBhdGggfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3Qgc2V0dGluZ3MgPSBmaW5kU2V0dGluZ3NJblNlcmlhbGl6ZWRTY2VuZShzY2VuZURhdGEpO1xuICAgIGlmICghc2V0dGluZ3MpIHtcbiAgICAgICAgbG9nU3RlcCgnc2V0dGluZ3NGcm9tQ3VycmVudFNjZW5lQXNzZXQ6bm8tY29tcG9uZW50JywgeyBzY2VuZVBhdGggfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgbG9nU3RlcCgnc2V0dGluZ3NGcm9tQ3VycmVudFNjZW5lQXNzZXQ6cmVzb2x2ZWQnLCB7IHV1aWQsIHNjZW5lUGF0aCwgc2V0dGluZ3MgfSk7XG4gICAgcmV0dXJuIHNldHRpbmdzO1xufVxuXG5mdW5jdGlvbiBzZXR0aW5nc0Zyb21TY2VuZVBhdGgoc2NlbmVQYXRoOiBzdHJpbmcsIHJlYXNvbjogc3RyaW5nKTogTmV4dXNTZXR0aW5nc0RhdGEgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHNjZW5lRGF0YSA9IHJlYWRKc29uRmlsZShzY2VuZVBhdGgpO1xuICAgIGlmICghc2NlbmVEYXRhKSB7XG4gICAgICAgIGxvZ1N0ZXAoJ3NldHRpbmdzRnJvbVNjZW5lUGF0aDpuby1zY2VuZS1kYXRhJywgeyBzY2VuZVBhdGgsIHJlYXNvbiB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBzZXR0aW5ncyA9IGZpbmRTZXR0aW5nc0luU2VyaWFsaXplZFNjZW5lKHNjZW5lRGF0YSk7XG4gICAgaWYgKCFzZXR0aW5ncykge1xuICAgICAgICBsb2dTdGVwKCdzZXR0aW5nc0Zyb21TY2VuZVBhdGg6bm8tY29tcG9uZW50JywgeyBzY2VuZVBhdGgsIHJlYXNvbiB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBsb2dTdGVwKCdzZXR0aW5nc0Zyb21TY2VuZVBhdGg6cmVzb2x2ZWQnLCB7IHJlYXNvbiwgc2NlbmVQYXRoLCBzZXR0aW5ncyB9KTtcbiAgICByZXR1cm4gc2V0dGluZ3M7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN5bmNGcm9tQ3VycmVudFNjZW5lKG9wdGlvbnM6IEFwcGx5RGVzaWduUmVzb2x1dGlvbk9wdGlvbnMgPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxvZ1N0ZXAoJ3N5bmNGcm9tQ3VycmVudFNjZW5lOnN0YXJ0JywgeyBjdXJyZW50U2NlbmVVdWlkIH0pO1xuXG4gICAgY29uc3QgcmVhZHkgPSBhd2FpdCB3YWl0U2NlbmVSZWFkeSgpO1xuICAgIGlmICghcmVhZHkpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBTY2VuZSBpcyBub3QgcmVhZHksIHNraXAgcmVzb2x1dGlvbiBzeW5jLmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdHJlZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScpIGFzIHVua25vd24gYXMgRHVtcE5vZGUgfCB1bmRlZmluZWQ7XG4gICAgY29uc3Qgcm9vdE5hbWUgPSByZWFkRHVtcFZhbHVlPHN0cmluZz4odHJlZT8ubmFtZSk7XG4gICAgbG9nU3RlcCgnc3luY0Zyb21DdXJyZW50U2NlbmU6cXVlcnktbm9kZS10cmVlLXJlc3VsdCcsIHtcbiAgICAgICAgaGFzVHJlZTogISF0cmVlLFxuICAgICAgICByb290TmFtZSxcbiAgICAgICAgY2hpbGRDb3VudDogdHJlZT8uY2hpbGRyZW4/Lmxlbmd0aCA/PyAwLFxuICAgICAgICBjb21wQ291bnQ6IHRyZWU/Ll9fY29tcHNfXz8ubGVuZ3RoID8/IDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb21wID0gZmluZE5leHVzU2V0dGluZ3ModHJlZSk7XG4gICAgaWYgKGNvbXApIHtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSBzZXR0aW5nc0Zyb21Db21wb25lbnQoY29tcCk7XG4gICAgICAgIGlmIChzZXR0aW5ncykge1xuICAgICAgICAgICAgYXdhaXQgYXBwbHlOZXh1c1NldHRpbmdzKHNldHRpbmdzLCBgU3luY2VkIGZyb20gbGl2ZSAke0NPTVBPTkVOVF9OQU1FfWAsIG9wdGlvbnMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBJbnZhbGlkIGxpdmUgJHtDT01QT05FTlRfTkFNRX0gY29tcG9uZW50IGRhdGEuYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9nU3RlcCgnc3luY0Zyb21DdXJyZW50U2NlbmU6bm8tbGl2ZS1jb21wb25lbnQnKTtcbiAgICB9XG5cbiAgICBpZiAocm9vdE5hbWUpIHtcbiAgICAgICAgY29uc3Qgc2NlbmVQYXRoID0gZmluZFNjZW5lUGF0aEJ5Um9vdE5hbWUocm9vdE5hbWUpO1xuICAgICAgICBpZiAoc2NlbmVQYXRoKSB7XG4gICAgICAgICAgICBjb25zdCBzZXR0aW5nc0Zyb21Sb290TmFtZSA9IHNldHRpbmdzRnJvbVNjZW5lUGF0aChzY2VuZVBhdGgsIGByb290TmFtZT0ke3Jvb3ROYW1lfWApO1xuICAgICAgICAgICAgaWYgKHNldHRpbmdzRnJvbVJvb3ROYW1lKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgYXBwbHlOZXh1c1NldHRpbmdzKHNldHRpbmdzRnJvbVJvb3ROYW1lLCBgU3luY2VkIGZyb20gJHtDT01QT05FTlRfTkFNRX0gc2NlbmUgYXNzZXQgYnkgcm9vdCBuYW1lYCwgb3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2V0dGluZ3NGcm9tQXNzZXQgPSBzZXR0aW5nc0Zyb21DdXJyZW50U2NlbmVBc3NldCgpO1xuICAgIGlmIChzZXR0aW5nc0Zyb21Bc3NldCkge1xuICAgICAgICBhd2FpdCBhcHBseU5leHVzU2V0dGluZ3Moc2V0dGluZ3NGcm9tQXNzZXQsIGBTeW5jZWQgZnJvbSAke0NPTVBPTkVOVF9OQU1FfSBzY2VuZSBhc3NldGAsIG9wdGlvbnMpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbG9nU3RlcCgnc3luY0Zyb21DdXJyZW50U2NlbmU6bm8tY29tcG9uZW50Jyk7XG59XG5cbmZ1bmN0aW9uIHNjaGVkdWxlU3luY0Zyb21DdXJyZW50U2NlbmUob3B0aW9uczogQXBwbHlEZXNpZ25SZXNvbHV0aW9uT3B0aW9ucyA9IHt9KTogdm9pZCB7XG4gICAgbG9nU3RlcCgnc2NoZWR1bGVTeW5jRnJvbUN1cnJlbnRTY2VuZScsIHsgaGFkUGVuZGluZ1RpbWVyOiAhIXN5bmNUaW1lciwgY3VycmVudFNjZW5lVXVpZCB9KTtcblxuICAgIGlmIChzeW5jVGltZXIpIGNsZWFyVGltZW91dChzeW5jVGltZXIpO1xuICAgIHN5bmNUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBzeW5jVGltZXIgPSB1bmRlZmluZWQ7XG4gICAgICAgIHZvaWQgc3luY0Zyb21DdXJyZW50U2NlbmUob3B0aW9ucykuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbJHtQQUNLQUdFX05BTUV9XSBTeW5jIGZhaWxlZDpgLCBlcnJvcik7XG4gICAgICAgIH0pO1xuICAgIH0sIDMwMCk7XG59XG5cbmZ1bmN0aW9uIGFkZEJyb2FkY2FzdExpc3RlbmVyKG1lc3NhZ2U6IHN0cmluZywgaGFuZGxlcjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIGNvbnN0IHByb3RlY3RlZE1lc3NhZ2UgPSAoRWRpdG9yLk1lc3NhZ2UgYXMgdW5rbm93biBhcyB7XG4gICAgICAgIF9fcHJvdGVjdGVkX18/OiB7XG4gICAgICAgICAgICBhZGRCcm9hZGNhc3RMaXN0ZW5lcj86IChtZXNzYWdlOiBzdHJpbmcsIGZ1bmM6IEZ1bmN0aW9uKSA9PiB2b2lkO1xuICAgICAgICB9O1xuICAgIH0pLl9fcHJvdGVjdGVkX187XG5cbiAgICBwcm90ZWN0ZWRNZXNzYWdlPy5hZGRCcm9hZGNhc3RMaXN0ZW5lcj8uKG1lc3NhZ2UsIGhhbmRsZXIpO1xufVxuXG5mdW5jdGlvbiByZW1vdmVCcm9hZGNhc3RMaXN0ZW5lcihtZXNzYWdlOiBzdHJpbmcsIGhhbmRsZXI6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHZvaWQpOiB2b2lkIHtcbiAgICBjb25zdCBwcm90ZWN0ZWRNZXNzYWdlID0gKEVkaXRvci5NZXNzYWdlIGFzIHVua25vd24gYXMge1xuICAgICAgICBfX3Byb3RlY3RlZF9fPzoge1xuICAgICAgICAgICAgcmVtb3ZlQnJvYWRjYXN0TGlzdGVuZXI/OiAobWVzc2FnZTogc3RyaW5nLCBmdW5jOiBGdW5jdGlvbikgPT4gdm9pZDtcbiAgICAgICAgfTtcbiAgICB9KS5fX3Byb3RlY3RlZF9fO1xuXG4gICAgcHJvdGVjdGVkTWVzc2FnZT8ucmVtb3ZlQnJvYWRjYXN0TGlzdGVuZXI/LihtZXNzYWdlLCBoYW5kbGVyKTtcbn1cblxuZnVuY3Rpb24gdXBkYXRlQ3VycmVudFNjZW5lVXVpZChhcmdzOiB1bmtub3duW10pOiB2b2lkIHtcbiAgICBsb2dTdGVwKCd1cGRhdGVDdXJyZW50U2NlbmVVdWlkOmFyZ3MnLCBhcmdzKTtcblxuICAgIGNvbnN0IHV1aWQgPSBhcmdzLmZpbmQoKGFyZykgPT4gdHlwZW9mIGFyZyA9PT0gJ3N0cmluZycgJiYgL15bMC05YS1mLV17MzIsMzZ9JC9pLnRlc3QoYXJnKSk7XG4gICAgaWYgKHR5cGVvZiB1dWlkID09PSAnc3RyaW5nJykge1xuICAgICAgICBjdXJyZW50U2NlbmVVdWlkID0gdXVpZDtcbiAgICAgICAgbG9nU3RlcCgndXBkYXRlQ3VycmVudFNjZW5lVXVpZDptYXRjaGVkJywgeyB1dWlkIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ1N0ZXAoJ3VwZGF0ZUN1cnJlbnRTY2VuZVV1aWQ6bm90LW1hdGNoZWQnKTtcbiAgICB9XG59XG5cbmNvbnN0IG9uU2NlbmVPcGVuZWQgPSAoLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgbG9nU3RlcCgnZXZlbnQ6bXVsdGktb3Blbi1zY2VuZScsIGFyZ3MpO1xuICAgIHVwZGF0ZUN1cnJlbnRTY2VuZVV1aWQoYXJncyk7XG4gICAgc2NoZWR1bGVTeW5jRnJvbUN1cnJlbnRTY2VuZSh7IHJlZnJlc2hTY2VuZVdoZW5VbmNoYW5nZWQ6IHRydWUgfSk7XG59O1xuXG5jb25zdCBvblNjZW5lRm9jdXNlZCA9ICguLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICBsb2dTdGVwKCdldmVudDptdWx0aS1zY2VuZS1mb2N1cycsIGFyZ3MpO1xuICAgIHVwZGF0ZUN1cnJlbnRTY2VuZVV1aWQoYXJncyk7XG4gICAgc2NoZWR1bGVTeW5jRnJvbUN1cnJlbnRTY2VuZSh7IHJlZnJlc2hTY2VuZVdoZW5VbmNoYW5nZWQ6IHRydWUgfSk7XG59O1xuXG5jb25zdCBvblNjZW5lRGlydHkgPSAoLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgbG9nU3RlcCgnZXZlbnQ6bXVsdGktc2NlbmUtZGlydHknLCBhcmdzKTtcbiAgICB1cGRhdGVDdXJyZW50U2NlbmVVdWlkKGFyZ3MpO1xuICAgIHNjaGVkdWxlU3luY0Zyb21DdXJyZW50U2NlbmUoKTtcbn07XG5cbmV4cG9ydCBjb25zdCBtZXRob2RzOiB7IFtrZXk6IHN0cmluZ106ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55IH0gPSB7XG4gICAgc2hvd0xvZygpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05leHVzIEZyYW1ld29yaycpO1xuICAgIH0sXG5cbiAgICBhc3luYyBvcGVuSTE4blBhbmVsKCkge1xuICAgICAgICBhd2FpdCBFZGl0b3IuUGFuZWwub3BlbihgJHtQQUNLQUdFX05BTUV9LmkxOG5gKTtcbiAgICB9LFxuXG4gICAgcXVlcnlJMThuUGFuZWxTdGF0ZSgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGJ1bmRsZU5hbWU6IGN1cnJlbnROZXh1c1NldHRpbmdzLmJ1bmRsZU5hbWUsXG4gICAgICAgICAgICBlZGl0b3JMYW5ndWFnZTogY3VycmVudE5leHVzU2V0dGluZ3MuZWRpdG9yTGFuZ3VhZ2UgfHwgREVGQVVMVF9FRElUT1JfTEFOR1VBR0UsXG4gICAgICAgICAgICBsYW5ndWFnZXM6IGN1cnJlbnRJMThuTGFuZ3VhZ2VzLFxuICAgICAgICB9O1xuICAgIH0sXG5cbiAgICBhc3luYyBzZXRFZGl0b3JMYW5ndWFnZShlZGl0b3JMYW5ndWFnZTogc3RyaW5nKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gYXdhaXQgc2F2ZUVkaXRvckxhbmd1YWdlKFN0cmluZyhlZGl0b3JMYW5ndWFnZSB8fCAnJykpO1xuICAgICAgICBhd2FpdCByZWZyZXNoSTE4bkNvbXBvbmVudHNJblNjZW5lKCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBidW5kbGVOYW1lOiBjdXJyZW50TmV4dXNTZXR0aW5ncy5idW5kbGVOYW1lLFxuICAgICAgICAgICAgZWRpdG9yTGFuZ3VhZ2U6IHZhbHVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2VzOiBjdXJyZW50STE4bkxhbmd1YWdlcyxcbiAgICAgICAgfTtcbiAgICB9LFxuXG4gICAgYXN5bmMgc2V0STE4bkxhbmd1YWdlcyhsYW5ndWFnZXM6IHVua25vd25bXSwgZWRpdG9yTGFuZ3VhZ2U/OiBzdHJpbmcpIHtcbiAgICAgICAgY29uc3QgdmFsdWVzID0gYXdhaXQgc2F2ZUkxOG5MYW5ndWFnZXMoQXJyYXkuaXNBcnJheShsYW5ndWFnZXMpID8gbm9ybWFsaXplTGFuZ3VhZ2VzKGxhbmd1YWdlcykgOiBbXSk7XG4gICAgICAgIGNvbnN0IHByZWZlcnJlZExhbmd1YWdlID0gdHlwZW9mIGVkaXRvckxhbmd1YWdlID09PSAnc3RyaW5nJyAmJiB2YWx1ZXMuaW5jbHVkZXMoZWRpdG9yTGFuZ3VhZ2UpXG4gICAgICAgICAgICA/IGVkaXRvckxhbmd1YWdlXG4gICAgICAgICAgICA6IHZhbHVlcy5pbmNsdWRlcyhjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSlcbiAgICAgICAgICAgICAgICA/IGN1cnJlbnROZXh1c1NldHRpbmdzLmVkaXRvckxhbmd1YWdlXG4gICAgICAgICAgICAgICAgOiB2YWx1ZXNbMF07XG5cbiAgICAgICAgY29uc3QgdmFsdWUgPSBhd2FpdCBzYXZlRWRpdG9yTGFuZ3VhZ2UocHJlZmVycmVkTGFuZ3VhZ2UpO1xuICAgICAgICBhd2FpdCByZWZyZXNoSTE4bkNvbXBvbmVudHNJblNjZW5lKCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBidW5kbGVOYW1lOiBjdXJyZW50TmV4dXNTZXR0aW5ncy5idW5kbGVOYW1lLFxuICAgICAgICAgICAgZWRpdG9yTGFuZ3VhZ2U6IHZhbHVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2VzOiBjdXJyZW50STE4bkxhbmd1YWdlcyxcbiAgICAgICAgfTtcbiAgICB9LFxuXG4gICAgc3luY0N1cnJlbnRTY2VuZSgpIHtcbiAgICAgICAgbG9nU3RlcCgnbWV0aG9kOnN5bmNDdXJyZW50U2NlbmUnKTtcbiAgICAgICAgc2NoZWR1bGVTeW5jRnJvbUN1cnJlbnRTY2VuZSgpO1xuICAgIH0sXG5cbiAgICBhc3luYyBzeW5jT3JpZW50YXRpb24ob3JpZW50YXRpb246IHVua25vd24pIHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBOdW1iZXIob3JpZW50YXRpb24pO1xuICAgICAgICBsb2dTdGVwKCdtZXRob2Q6c3luY09yaWVudGF0aW9uJywgeyBvcmllbnRhdGlvbiwgdmFsdWUgfSk7XG4gICAgICAgIGNvbnN0IHNhdmVkID0gYXdhaXQgc2F2ZUN1cnJlbnRTY2VuZShgbGl2ZSAke0NPTVBPTkVOVF9OQU1FfSBpbnNwZWN0b3JgKTtcbiAgICAgICAgaWYgKCFzYXZlZCkgcmV0dXJuO1xuXG4gICAgICAgIGF3YWl0IGFwcGx5TmV4dXNTZXR0aW5ncyh7IC4uLmN1cnJlbnROZXh1c1NldHRpbmdzLCBvcmllbnRhdGlvbjogdmFsdWUgfSwgYFN5bmNlZCBmcm9tIGxpdmUgJHtDT01QT05FTlRfTkFNRX0gaW5zcGVjdG9yYCwge1xuICAgICAgICAgICAgZm9yY2U6IHRydWUsXG4gICAgICAgICAgICByZWxvYWRTY2VuZTogdHJ1ZSxcbiAgICAgICAgICAgIHJlZnJlc2hTY2VuZVdoZW5VbmNoYW5nZWQ6IHRydWUsXG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBhc3luYyBzeW5jTmV4dXNTZXR0aW5ncyhzZXR0aW5nczogUGFydGlhbDxOZXh1c1NldHRpbmdzRGF0YT4pIHtcbiAgICAgICAgbG9nSTE4blN0ZXAoJ21ldGhvZDpzeW5jTmV4dXNTZXR0aW5ncycsIHsgc2V0dGluZ3MgfSk7XG4gICAgICAgIGNvbnN0IHNhdmVkID0gYXdhaXQgc2F2ZUN1cnJlbnRTY2VuZShgbGl2ZSAke0NPTVBPTkVOVF9OQU1FfSBpbnNwZWN0b3JgKTtcbiAgICAgICAgaWYgKCFzYXZlZCkgcmV0dXJuO1xuXG4gICAgICAgIGF3YWl0IGFwcGx5TmV4dXNTZXR0aW5ncyh1cGRhdGVDdXJyZW50TmV4dXNTZXR0aW5ncyhzZXR0aW5ncyksIGBTeW5jZWQgZnJvbSBsaXZlICR7Q09NUE9ORU5UX05BTUV9IGluc3BlY3RvcmAsIHtcbiAgICAgICAgICAgIGZvcmNlOiB0cnVlLFxuICAgICAgICAgICAgcmVsb2FkU2NlbmU6IHRydWUsXG4gICAgICAgICAgICByZWZyZXNoU2NlbmVXaGVuVW5jaGFuZ2VkOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcXVlcnlJMThuVGV4dChrZXk6IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgICAgICAgaWYgKCFrZXkpIHJldHVybiAnJztcbiAgICAgICAgbG9nSTE4blN0ZXAoJ21ldGhvZDpxdWVyeUkxOG5UZXh0JywgeyBrZXksIGhhc1BhcmFtczogISFwYXJhbXMgfSk7XG4gICAgICAgIHJldHVybiBxdWVyeUkxOG5UZXh0KGtleSwgcGFyYW1zKTtcbiAgICB9LFxuXG4gICAgcXVlcnlJMThuRWRpdG9yU3RhdGUoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXZpc2lvbjogaTE4blJldmlzaW9uLFxuICAgICAgICAgICAgYnVuZGxlTmFtZTogY3VycmVudE5leHVzU2V0dGluZ3MuYnVuZGxlTmFtZSxcbiAgICAgICAgICAgIGVkaXRvckxhbmd1YWdlOiBjdXJyZW50TmV4dXNTZXR0aW5ncy5lZGl0b3JMYW5ndWFnZSB8fCBERUZBVUxUX0VESVRPUl9MQU5HVUFHRSxcbiAgICAgICAgfTtcbiAgICB9LFxuXG4gICAgcGFyc2VJMThuU3ByaXRlQXNzZXQodXVpZDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBwYXJzZUkxOG5TcHJpdGVBc3NldChTdHJpbmcodXVpZCB8fCAnJykpO1xuICAgIH0sXG5cbiAgICBxdWVyeUkxOG5TcHJpdGVBc3NldChidW5kbGVOYW1lOiBzdHJpbmcsIHJlbGF0aXZlUGF0aDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBxdWVyeUkxOG5TcHJpdGVBc3NldChTdHJpbmcoYnVuZGxlTmFtZSB8fCAnJyksIFN0cmluZyhyZWxhdGl2ZVBhdGggfHwgJycpKTtcbiAgICB9LFxuXG4gICAgcGFyc2VJMThuQXNzZXQodXVpZDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBwYXJzZUkxOG5Mb2NhbGl6ZWRBc3NldChTdHJpbmcodXVpZCB8fCAnJykpO1xuICAgIH0sXG5cbiAgICAncGFyc2UtaTE4bi1hc3NldCcodXVpZDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBwYXJzZUkxOG5Mb2NhbGl6ZWRBc3NldChTdHJpbmcodXVpZCB8fCAnJykpO1xuICAgIH0sXG5cbiAgICBxdWVyeUkxOG5TcGluZUFzc2V0KGJ1bmRsZU5hbWU6IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHF1ZXJ5STE4blNwaW5lQXNzZXQoU3RyaW5nKGJ1bmRsZU5hbWUgfHwgJycpLCBTdHJpbmcocmVsYXRpdmVQYXRoIHx8ICcnKSk7XG4gICAgfSxcblxuICAgICdxdWVyeS1pMThuLXNwaW5lLWFzc2V0JyhidW5kbGVOYW1lOiBzdHJpbmcsIHJlbGF0aXZlUGF0aDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBxdWVyeUkxOG5TcGluZUFzc2V0KFN0cmluZyhidW5kbGVOYW1lIHx8ICcnKSwgU3RyaW5nKHJlbGF0aXZlUGF0aCB8fCAnJykpO1xuICAgIH0sXG5cbiAgICBxdWVyeUkxOG5EcmFnb25Cb25lc0Fzc2V0KGJ1bmRsZU5hbWU6IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHF1ZXJ5STE4bkRyYWdvbkJvbmVzQXNzZXQoU3RyaW5nKGJ1bmRsZU5hbWUgfHwgJycpLCBTdHJpbmcocmVsYXRpdmVQYXRoIHx8ICcnKSk7XG4gICAgfSxcblxuICAgICdxdWVyeS1pMThuLWRyYWdvbi1ib25lcy1hc3NldCcoYnVuZGxlTmFtZTogc3RyaW5nLCByZWxhdGl2ZVBhdGg6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gcXVlcnlJMThuRHJhZ29uQm9uZXNBc3NldChTdHJpbmcoYnVuZGxlTmFtZSB8fCAnJyksIFN0cmluZyhyZWxhdGl2ZVBhdGggfHwgJycpKTtcbiAgICB9LFxuXG4gICAgcXVlcnlJMThuRHJhZ29uQm9uZXNBdGxhc0Fzc2V0KGJ1bmRsZU5hbWU6IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHF1ZXJ5STE4bkRyYWdvbkJvbmVzQXRsYXNBc3NldChTdHJpbmcoYnVuZGxlTmFtZSB8fCAnJyksIFN0cmluZyhyZWxhdGl2ZVBhdGggfHwgJycpKTtcbiAgICB9LFxuXG4gICAgJ3F1ZXJ5LWkxOG4tZHJhZ29uLWJvbmVzLWF0bGFzLWFzc2V0JyhidW5kbGVOYW1lOiBzdHJpbmcsIHJlbGF0aXZlUGF0aDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBxdWVyeUkxOG5EcmFnb25Cb25lc0F0bGFzQXNzZXQoU3RyaW5nKGJ1bmRsZU5hbWUgfHwgJycpLCBTdHJpbmcocmVsYXRpdmVQYXRoIHx8ICcnKSk7XG4gICAgfSxcblxuICAgIG9uU2NlbmVSZWFkeSgpIHtcbiAgICAgICAgbG9nU3RlcCgnbWV0aG9kOm9uU2NlbmVSZWFkeScpO1xuICAgICAgICBzY2hlZHVsZVN5bmNGcm9tQ3VycmVudFNjZW5lKHsgcmVmcmVzaFNjZW5lV2hlblVuY2hhbmdlZDogdHJ1ZSB9KTtcbiAgICB9LFxuXG4gICAgYXN5bmMgc3dpdGNoTGFuZHNjYXBlKCkge1xuICAgICAgICBhd2FpdCBhcHBseURlc2lnblJlc29sdXRpb24oTEFORFNDQVBFLCAnTWFudWFsIGxhbmRzY2FwZSBzd2l0Y2gnKTtcbiAgICB9LFxuXG4gICAgYXN5bmMgc3dpdGNoUG9ydHJhaXQoKSB7XG4gICAgICAgIGF3YWl0IGFwcGx5RGVzaWduUmVzb2x1dGlvbihQT1JUUkFJVCwgJ01hbnVhbCBwb3J0cmFpdCBzd2l0Y2gnKTtcbiAgICB9LFxufTtcblxuLyoqXG4gKiBAZW4gTWV0aG9kIFRyaWdnZXJlZCBvbiBFeHRlbnNpb24gU3RhcnR1cFxuICogQHpoIOaJqeWxleWQr+WKqOaXtuinpuWPkeeahOaWueazlVxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpIHtcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gbG9hZCAke0JVSUxEX1RBR31gKTtcbiAgICBhZGRCcm9hZGNhc3RMaXN0ZW5lcignbXVsdGktb3Blbi1zY2VuZScsIG9uU2NlbmVPcGVuZWQpO1xuICAgIGFkZEJyb2FkY2FzdExpc3RlbmVyKCdtdWx0aS1zY2VuZS1mb2N1cycsIG9uU2NlbmVGb2N1c2VkKTtcbiAgICBhZGRCcm9hZGNhc3RMaXN0ZW5lcignbXVsdGktc2NlbmUtZGlydHknLCBvblNjZW5lRGlydHkpO1xuICAgIHZvaWQgaW5pdGlhbGl6ZUVkaXRvckxhbmd1YWdlKCkuZmluYWxseSgoKSA9PiB7XG4gICAgICAgIHNjaGVkdWxlU3luY0Zyb21DdXJyZW50U2NlbmUoeyByZWZyZXNoU2NlbmVXaGVuVW5jaGFuZ2VkOiB0cnVlIH0pO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIEBlbiBNZXRob2QgdHJpZ2dlcmVkIHdoZW4gdW5pbnN0YWxsaW5nIHRoZSBleHRlbnNpb25cbiAqIEB6aCDljbjovb3mianlsZXml7bop6blj5HnmoTmlrnms5VcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpIHtcbiAgICBsb2dTdGVwKCd1bmxvYWQ6c3RhcnQnKTtcblxuICAgIGlmIChzeW5jVGltZXIpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHN5bmNUaW1lcik7XG4gICAgICAgIHN5bmNUaW1lciA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZW1vdmVCcm9hZGNhc3RMaXN0ZW5lcignbXVsdGktb3Blbi1zY2VuZScsIG9uU2NlbmVPcGVuZWQpO1xuICAgIHJlbW92ZUJyb2FkY2FzdExpc3RlbmVyKCdtdWx0aS1zY2VuZS1mb2N1cycsIG9uU2NlbmVGb2N1c2VkKTtcbiAgICByZW1vdmVCcm9hZGNhc3RMaXN0ZW5lcignbXVsdGktc2NlbmUtZGlydHknLCBvblNjZW5lRGlydHkpO1xufVxuIl19