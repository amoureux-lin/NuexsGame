import { _decorator, assetManager, CCObject, Component, Sprite, SpriteFrame } from 'cc';
import { EDITOR } from 'cc/env';
import { Nexus } from '../core/Nexus';
import { NexusEvents } from '../NexusEvents';

const { ccclass, property, requireComponent, executeInEditMode } = _decorator;

type ParsedI18nSpriteAsset = {
    bundleName: string;
    relativePath: string;
};

type I18nSpriteAsset = {
    uuid: string;
};

@ccclass('I18nSprite')
@requireComponent(Sprite)
@executeInEditMode(true)
export class I18nSprite extends Component {

    @property({ type: SpriteFrame, displayName: '拖拽图片' })
    get sourceSpriteFrame(): SpriteFrame | null {
        return this._sourceSpriteFrame;
    }
    set sourceSpriteFrame(value: SpriteFrame | null) {
        if (this._sourceSpriteFrame === value) return;

        this._sourceSpriteFrame = value;
        if (EDITOR) {
            void this._syncPathFromSourceSpriteFrame(value).finally(() => {
                this._sourceSpriteFrame = null;
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

    @property({ displayName: '相对路径' })
    get relativePath(): string {
        return this._relativePath;
    }
    set relativePath(value: string) {
        if (this._relativePath === value) return;

        this._relativePath = value;
        this._apply();
    }

    private _sourceSpriteFrame: SpriteFrame | null = null;

    @property({ visible: false })
    private _bundleName = '';

    @property({ visible: false })
    private _relativePath = '';

    private _sprite: Sprite | null = null;
    private _applyVersion = 0;
    private _editorApplySignature = '';

    protected onLoad(): void {
        this._sprite = this.getComponent(Sprite);
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
        if (!this._sprite) this._sprite = this.getComponent(Sprite);
        if (!this._sprite) return;

        if (!this._bundleName || !this._relativePath) {
            this._clearNodeSpriteFrame();
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
        if (!this._sprite) return;

        const language = Nexus.i18n.language;
        const path = this._buildRuntimePath();
        try {
            const spriteFrame = await Nexus.asset.load<SpriteFrame>(language, path, SpriteFrame);
            if (version !== this._applyVersion || !this._sprite) return;
            this._sprite.spriteFrame = spriteFrame;
        } catch (error) {
            console.warn(`[nexus-framework][I18nSprite] Failed to load ${path}.`, error);
            if (version !== this._applyVersion || !this._sprite) return;
            this._sprite.spriteFrame = null;
        }
    }

    private async _applyInEditor(version: number): Promise<void> {
        if (!this._sprite) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) {
            this._clearNodeSpriteFrame();
            return;
        }

        try {
            this._clearNodeSpriteFrame();
            const asset = await editor.Message.request(
                'nexus-framework',
                'query-i18n-sprite-asset',
                this._bundleName,
                this._relativePath,
            ) as I18nSpriteAsset | null;
            if (version !== this._applyVersion || !this._sprite) return;
            if (!asset?.uuid) {
                this._clearNodeSpriteFrame();
                return;
            }

            const spriteFrame = await loadAnySpriteFrame(asset.uuid);
            if (version !== this._applyVersion || !this._sprite) return;
            this._clearNodeSpriteFrame();
            this._sprite.spriteFrame = spriteFrame ? createEditorPreviewSpriteFrame(spriteFrame) : null;
        } catch (error) {
            console.warn('[nexus-framework][I18nSprite] Failed to query editor sprite:', error);
            if (version !== this._applyVersion || !this._sprite) return;
            this._clearNodeSpriteFrame();
        }
    }

    private async _syncPathFromSourceSpriteFrame(spriteFrame: SpriteFrame | null): Promise<void> {
        this._clearNodeSpriteFrame();

        const uuid = readAssetUuid(spriteFrame);
        if (!uuid) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) return;

        try {
            const result = await editor.Message.request(
                'nexus-framework',
                'parse-i18n-sprite-asset',
                uuid,
            ) as ParsedI18nSpriteAsset | null;
            if (!result) return;

            this._bundleName = result.bundleName;
            this._relativePath = result.relativePath;
            this._apply();
        } catch (error) {
            console.warn('[nexus-framework][I18nSprite] Failed to parse source sprite:', error);
        }
    }

    private _buildRuntimePath(): string {
        return `${this._bundleName}/${this._relativePath}/spriteFrame`;
    }

    private _getEditorApplySignature(): string {
        return `${this._bundleName}|${this._relativePath}`;
    }

    private _clearNodeSpriteFrame(): void {
        if (!this._sprite) this._sprite = this.node.getComponent(Sprite);
        if (this._sprite) {
            this._sprite.spriteFrame = null;
        }
    }
}

function readAssetUuid(asset: unknown): string {
    if (!asset || typeof asset !== 'object') return '';

    const record = asset as Record<string, unknown>;
    const uuid = record.uuid ?? record._uuid;
    return typeof uuid === 'string' ? uuid : '';
}

function loadAnySpriteFrame(uuid: string): Promise<SpriteFrame | null> {
    return new Promise((resolve) => {
        assetManager.loadAny({ uuid }, (error: Error | null, asset: SpriteFrame) => {
            if (error) {
                resolve(null);
                return;
            }

            resolve(asset instanceof SpriteFrame ? asset : null);
        });
    });
}

function createEditorPreviewSpriteFrame(source: SpriteFrame): SpriteFrame {
    const preview = source.clone();
    preview.hideFlags = CCObject.Flags.DontSave | CCObject.Flags.EditorOnly;
    return preview;
}
