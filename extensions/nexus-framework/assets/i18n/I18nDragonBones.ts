import { _decorator, assetManager, CCObject, Component, dragonBones } from 'cc';
import { EDITOR } from 'cc/env';
import { Nexus } from '../core/Nexus';
import { NexusEvents } from '../NexusEvents';

const { ccclass, property, requireComponent, executeInEditMode } = _decorator;

type ParsedI18nAsset = {
    bundleName: string;
    relativePath: string;
};

type I18nEditorAsset = {
    uuid: string;
};

type EditorI18nState = {
    revision: number;
};

@ccclass('I18nDragonBones')
@requireComponent(dragonBones.ArmatureDisplay)
@executeInEditMode(true)
export class I18nDragonBones extends Component {

    private static _editorRevision = 0;
    private static _lastEditorStateQueryAt = 0;
    private static _editorStateQuerying = false;

    @property({ type: dragonBones.DragonBonesAsset, displayName: '拖拽骨骼' })
    get sourceDragonAsset(): dragonBones.DragonBonesAsset | null {
        return this._sourceDragonAsset;
    }
    set sourceDragonAsset(value: dragonBones.DragonBonesAsset | null) {
        if (this._sourceDragonAsset === value) return;

        this._sourceDragonAsset = value;
        if (EDITOR) {
            void this._syncDragonAssetPath(value).finally(() => {
                this._sourceDragonAsset = null;
            });
        }
        this._apply();
    }

    @property({ type: dragonBones.DragonBonesAtlasAsset, displayName: '拖拽图集' })
    get sourceDragonAtlasAsset(): dragonBones.DragonBonesAtlasAsset | null {
        return this._sourceDragonAtlasAsset;
    }
    set sourceDragonAtlasAsset(value: dragonBones.DragonBonesAtlasAsset | null) {
        if (this._sourceDragonAtlasAsset === value) return;

        this._sourceDragonAtlasAsset = value;
        if (EDITOR) {
            void this._syncDragonAtlasAssetPath(value).finally(() => {
                this._sourceDragonAtlasAsset = null;
            });
        }
        this._apply();
    }

    @property({ displayName: 'Bundle 名称' })
    get bundleName(): string {
        return this._bundleName;
    }
    set bundleName(value: string) {
        if (this._bundleName === value) return;

        this._bundleName = value;
        this._apply();
    }

    @property({ displayName: '骨骼相对路径' })
    get dragonAssetPath(): string {
        return this._dragonAssetPath;
    }
    set dragonAssetPath(value: string) {
        if (this._dragonAssetPath === value) return;

        this._dragonAssetPath = value;
        this._apply();
    }

    @property({ displayName: '图集相对路径' })
    get dragonAtlasAssetPath(): string {
        return this._dragonAtlasAssetPath;
    }
    set dragonAtlasAssetPath(value: string) {
        if (this._dragonAtlasAssetPath === value) return;

        this._dragonAtlasAssetPath = value;
        this._apply();
    }

    @property({ displayName: 'Armature' })
    get armatureName(): string {
        return this._armatureName;
    }
    set armatureName(value: string) {
        if (this._armatureName === value) return;

        this._armatureName = value;
        this._applyCurrentNames();
    }

    @property({ displayName: '动画名' })
    get animationName(): string {
        return this._animationName;
    }
    set animationName(value: string) {
        if (this._animationName === value) return;

        this._animationName = value;
        this._applyCurrentNames();
    }

    private _sourceDragonAsset: dragonBones.DragonBonesAsset | null = null;
    private _sourceDragonAtlasAsset: dragonBones.DragonBonesAtlasAsset | null = null;

    @property({ visible: false })
    private _bundleName = '';

    @property({ visible: false })
    private _dragonAssetPath = '';

    @property({ visible: false })
    private _dragonAtlasAssetPath = '';

    @property({ visible: false })
    private _armatureName = '';

    @property({ visible: false })
    private _animationName = '';

    private _armatureDisplay: dragonBones.ArmatureDisplay | null = null;
    private _applyVersion = 0;
    private _editorApplySignature = '';

    protected onLoad(): void {
        this._armatureDisplay = this.getComponent(dragonBones.ArmatureDisplay);
        if (EDITOR) {
            this._apply();
            return;
        }

        Nexus.on(NexusEvents.LANGUAGE_CHANGED, this._onLanguageChanged, this);
        this._apply();
    }

    protected onDestroy(): void {
        if (EDITOR) return;
        Nexus.off(NexusEvents.LANGUAGE_CHANGED, this._onLanguageChanged, this);
    }

    protected update(): void {
        if (!EDITOR) return;

        void I18nDragonBones._syncEditorState();
        const signature = this._getEditorApplySignature();
        if (signature === this._editorApplySignature) return;

        this._editorApplySignature = signature;
        this._apply();
    }

    refreshEditorPreview(): void {
        this._apply();
    }

    private _onLanguageChanged(): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._armatureDisplay) this._armatureDisplay = this.getComponent(dragonBones.ArmatureDisplay);
        if (!this._armatureDisplay) return;

        if (!this._bundleName || !this._dragonAssetPath || !this._dragonAtlasAssetPath) {
            this._clearDragonBonesAssets();
            return;
        }

        if (EDITOR) {
            this._editorApplySignature = this._getEditorApplySignature();
            void this._applyInEditor(++this._applyVersion);
            return;
        }

        void this._applyAtRuntime(++this._applyVersion);
    }

    private async _applyAtRuntime(version: number): Promise<void> {
        if (!this._armatureDisplay) return;

        const language = Nexus.i18n.language;
        try {
            const [dragonAsset, dragonAtlasAsset] = await Promise.all([
                Nexus.asset.load<dragonBones.DragonBonesAsset>(language, this._buildRuntimePath(this._dragonAssetPath), dragonBones.DragonBonesAsset),
                Nexus.asset.load<dragonBones.DragonBonesAtlasAsset>(language, this._buildRuntimePath(this._dragonAtlasAssetPath), dragonBones.DragonBonesAtlasAsset),
            ]);
            if (version !== this._applyVersion || !this._armatureDisplay) return;
            this._setDragonBonesAssets(dragonAsset, dragonAtlasAsset);
        } catch (error) {
            console.warn('[nexus-framework][I18nDragonBones] Failed to load dragon bones assets.', error);
            if (version !== this._applyVersion || !this._armatureDisplay) return;
            this._clearDragonBonesAssets();
        }
    }

    private async _applyInEditor(version: number): Promise<void> {
        if (!this._armatureDisplay) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) {
            this._clearDragonBonesAssets();
            return;
        }

        try {
            this._clearDragonBonesAssets();
            const [dragonAssetInfo, dragonAtlasAssetInfo] = await Promise.all([
                editor.Message.request('nexus-framework', 'query-i18n-dragon-bones-asset', this._bundleName, this._dragonAssetPath) as Promise<I18nEditorAsset | null>,
                editor.Message.request('nexus-framework', 'query-i18n-dragon-bones-atlas-asset', this._bundleName, this._dragonAtlasAssetPath) as Promise<I18nEditorAsset | null>,
            ]);
            if (version !== this._applyVersion || !this._armatureDisplay) return;
            if (!dragonAssetInfo?.uuid || !dragonAtlasAssetInfo?.uuid) {
                this._clearDragonBonesAssets();
                return;
            }

            const [dragonAsset, dragonAtlasAsset] = await Promise.all([
                loadAnyAsset<dragonBones.DragonBonesAsset>(dragonAssetInfo.uuid, dragonBones.DragonBonesAsset),
                loadAnyAsset<dragonBones.DragonBonesAtlasAsset>(dragonAtlasAssetInfo.uuid, dragonBones.DragonBonesAtlasAsset),
            ]);
            if (version !== this._applyVersion || !this._armatureDisplay) return;
            this._setDragonBonesAssets(
                dragonAsset ? createEditorPreviewDragonBonesAsset(dragonAsset) : null,
                dragonAtlasAsset ? createEditorPreviewDragonBonesAtlasAsset(dragonAtlasAsset) : null,
            );
        } catch (error) {
            console.warn('[nexus-framework][I18nDragonBones] Failed to query editor dragon bones:', error);
            if (version !== this._applyVersion || !this._armatureDisplay) return;
            this._clearDragonBonesAssets();
        }
    }

    private async _syncDragonAssetPath(asset: dragonBones.DragonBonesAsset | null): Promise<void> {
        await this._syncPathFromAsset(asset, (result) => {
            this._bundleName = result.bundleName;
            this._dragonAssetPath = result.relativePath;
        });
    }

    private async _syncDragonAtlasAssetPath(asset: dragonBones.DragonBonesAtlasAsset | null): Promise<void> {
        await this._syncPathFromAsset(asset, (result) => {
            this._bundleName = result.bundleName;
            this._dragonAtlasAssetPath = result.relativePath;
        });
    }

    private async _syncPathFromAsset(asset: unknown, applyResult: (result: ParsedI18nAsset) => void): Promise<void> {
        this._clearDragonBonesAssets();

        const uuid = readAssetUuid(asset);
        if (!uuid) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) return;

        try {
            const result = await editor.Message.request('nexus-framework', 'parse-i18n-asset', uuid) as ParsedI18nAsset | null;
            if (!result) return;

            applyResult(result);
            this._apply();
        } catch (error) {
            console.warn('[nexus-framework][I18nDragonBones] Failed to parse source dragon bones asset:', error);
        }
    }

    private _setDragonBonesAssets(
        dragonAsset: dragonBones.DragonBonesAsset | null,
        dragonAtlasAsset: dragonBones.DragonBonesAtlasAsset | null,
    ): void {
        if (!this._armatureDisplay) this._armatureDisplay = this.getComponent(dragonBones.ArmatureDisplay);
        if (!this._armatureDisplay) return;

        this._armatureDisplay.dragonAsset = dragonAsset;
        this._armatureDisplay.dragonAtlasAsset = dragonAtlasAsset;
        this._applyCurrentNames();
    }

    private _applyCurrentNames(): void {
        if (!this._armatureDisplay) this._armatureDisplay = this.getComponent(dragonBones.ArmatureDisplay);
        if (!this._armatureDisplay) return;

        if (this._armatureName) {
            this._armatureDisplay.armatureName = this._armatureName;
        }
        if (this._animationName) {
            this._armatureDisplay.animationName = this._animationName;
        }
    }

    private _buildRuntimePath(relativePath: string): string {
        return `${this._bundleName}/${relativePath}`;
    }

    private _getEditorApplySignature(): string {
        return [
            this._bundleName,
            this._dragonAssetPath,
            this._dragonAtlasAssetPath,
            this._armatureName,
            this._animationName,
            I18nDragonBones._editorRevision,
        ].join('|');
    }

    private _clearDragonBonesAssets(): void {
        if (!this._armatureDisplay) this._armatureDisplay = this.node.getComponent(dragonBones.ArmatureDisplay);
        if (this._armatureDisplay) {
            this._armatureDisplay.dragonAsset = null;
            this._armatureDisplay.dragonAtlasAsset = null;
        }
    }

    private static async _syncEditorState(): Promise<void> {
        const now = Date.now();
        if (this._editorStateQuerying || now - this._lastEditorStateQueryAt < 200) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) return;

        this._lastEditorStateQueryAt = now;
        this._editorStateQuerying = true;
        try {
            const state = await editor.Message.request('nexus-framework', 'query-i18n-editor-state') as EditorI18nState | null;
            if (state && typeof state.revision === 'number') {
                this._editorRevision = state.revision;
            }
        } catch {
            // Ignore polling failures in editor preview.
        } finally {
            this._editorStateQuerying = false;
        }
    }
}

function readAssetUuid(asset: unknown): string {
    if (!asset || typeof asset !== 'object') return '';

    const record = asset as Record<string, unknown>;
    const uuid = record.uuid ?? record._uuid;
    return typeof uuid === 'string' ? uuid : '';
}

function loadAnyAsset<T>(uuid: string, type: new (...args: any[]) => T): Promise<T | null> {
    return new Promise((resolve) => {
        assetManager.loadAny({ uuid }, (error: Error | null, asset: T) => {
            if (error) {
                resolve(null);
                return;
            }

            resolve(asset instanceof type ? asset : null);
        });
    });
}

function createEditorPreviewDragonBonesAsset(source: dragonBones.DragonBonesAsset): dragonBones.DragonBonesAsset {
    const preview = new dragonBones.DragonBonesAsset(source.name);
    preview.dragonBonesJson = source.dragonBonesJson;
    (preview as unknown as Record<string, unknown>)._dragonBonesJsonData = (source as unknown as Record<string, unknown>)._dragonBonesJsonData;
    preview.hideFlags = CCObject.Flags.DontSave | CCObject.Flags.EditorOnly;
    return preview;
}

function createEditorPreviewDragonBonesAtlasAsset(source: dragonBones.DragonBonesAtlasAsset): dragonBones.DragonBonesAtlasAsset {
    const preview = new dragonBones.DragonBonesAtlasAsset();
    preview.name = source.name;
    preview.atlasJson = source.atlasJson;
    preview.texture = source.texture;
    (preview as unknown as Record<string, unknown>)._atlasJsonData = (source as unknown as Record<string, unknown>)._atlasJsonData;
    preview.hideFlags = CCObject.Flags.DontSave | CCObject.Flags.EditorOnly;
    return preview;
}
