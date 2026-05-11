import { _decorator, assetManager, Component, Enum, setPropertyEnumType, sp } from 'cc';
import { EDITOR } from 'cc/env';
import { Nexus } from '../core/Nexus';
import { NexusEvents } from '../NexusEvents';

const { ccclass, property, requireComponent, executeInEditMode } = _decorator;
const SpineAnimationOptions = Enum({ Default: 0 });

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

@ccclass('I18nSpine')
@requireComponent(sp.Skeleton)
@executeInEditMode(true)
export class I18nSpine extends Component {

    private static _editorRevision = 0;
    private static _lastEditorStateQueryAt = 0;
    private static _editorStateQuerying = false;

    @property({ type: sp.SkeletonData, displayName: '拖拽 Spine' })
    get sourceSkeletonData(): sp.SkeletonData | null {
        return this._sourceSkeletonData;
    }
    set sourceSkeletonData(value: sp.SkeletonData | null) {
        if (this._sourceSkeletonData === value) return;

        this._sourceSkeletonData = value;
        if (EDITOR) {
            void this._syncPathFromSourceSkeletonData(value).finally(() => {
                this._sourceSkeletonData = null;
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

    @property({ type: Enum(SpineAnimationOptions), displayName: '动画名' })
    get animationIndex(): number {
        return this._animationIndex;
    }
    set animationIndex(value: number) {
        if (this._animationIndex === value) return;

        this._animationIndex = value;
        this._animationName = this._animationNames[value - 1] ?? '';
        this._applyCurrentAnimation();
    }

    @property({ displayName: '当前动画', readonly: true })
    get animationName(): string {
        return this._animationName;
    }
    set animationName(value: string) {
        if (this._animationName === value) return;

        this._animationName = value;
        this._applyCurrentAnimation();
    }

    @property({ displayName: '循环播放' })
    get loop(): boolean {
        return this._loop;
    }
    set loop(value: boolean) {
        if (this._loop === value) return;

        this._loop = value;
        this._applyCurrentAnimation();
    }

    private _sourceSkeletonData: sp.SkeletonData | null = null;

    @property({ visible: false })
    private _bundleName = '';

    @property({ visible: false })
    private _relativePath = '';

    @property({ visible: false })
    private _animationName = '';

    @property({ visible: false })
    private _animationIndex = 0;

    @property({ visible: false })
    private _loop = true;

    private _animationNames: string[] = [];
    private _skeleton: sp.Skeleton | null = null;
    private _applyVersion = 0;
    private _editorApplySignature = '';

    protected onLoad(): void {
        this._skeleton = this.getComponent(sp.Skeleton);
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

        void I18nSpine._syncEditorState();
        if (this._hasSerializedSkeletonDataReference()) {
            this._apply();
            return;
        }

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
        if (!this._skeleton) this._skeleton = this.getComponent(sp.Skeleton);
        if (!this._skeleton) return;

        if (!this._bundleName || !this._relativePath) {
            this._clearSkeletonData();
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
        if (!this._skeleton) return;

        const language = Nexus.i18n.language;
        const path = this._buildRuntimePath();
        try {
            const data = await Nexus.asset.load<sp.SkeletonData>(language, path, sp.SkeletonData);
            if (version !== this._applyVersion || !this._skeleton) return;
            this._setSkeletonData(data);
        } catch (error) {
            console.warn(`[nexus-framework][I18nSpine] Failed to load ${path}.`, error);
            if (version !== this._applyVersion || !this._skeleton) return;
            this._clearSkeletonData();
        }
    }

    private async _applyInEditor(version: number): Promise<void> {
        if (!this._skeleton) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) {
            this._clearSkeletonData();
            return;
        }

        try {
            this._clearSkeletonData();
            const asset = await editor.Message.request(
                'nexus-framework',
                'query-i18n-spine-asset',
                this._bundleName,
                this._relativePath,
            ) as I18nEditorAsset | null;
            if (version !== this._applyVersion || !this._skeleton) return;
            if (!asset?.uuid) {
                this._clearSkeletonData();
                return;
            }

            const data = await loadAnyAsset<sp.SkeletonData>(asset.uuid, sp.SkeletonData);
            if (version !== this._applyVersion || !this._skeleton) return;

            if (data) {
                this._setAnimationNames(readAnimationNames(data));
            }
            this._setSkeletonData(data);
        } catch (error) {
            console.warn('[nexus-framework][I18nSpine] Failed to query editor spine:', error);
            if (version !== this._applyVersion || !this._skeleton) return;
            this._clearSkeletonData();
        }
    }

    private async _syncPathFromSourceSkeletonData(data: sp.SkeletonData | null): Promise<void> {
        this._clearSkeletonData();

        const uuid = readAssetUuid(data);
        if (!uuid) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) return;

        try {
            const result = await editor.Message.request('nexus-framework', 'parse-i18n-asset', uuid) as ParsedI18nAsset | null;
            if (!result) return;

            this._bundleName = result.bundleName;
            this._relativePath = result.relativePath;
            this._apply();
        } catch (error) {
            console.warn('[nexus-framework][I18nSpine] Failed to parse source spine:', error);
        }
    }

    private _setSkeletonData(data: sp.SkeletonData | null): void {
        if (!this._skeleton) this._skeleton = this.getComponent(sp.Skeleton);
        if (!this._skeleton) return;

        const animation = this._animationName || this._skeleton.animation;
        this._skeleton.skeletonData = data;
        if (!this._animationName && data) {
            this._setAnimationNames(readAnimationNames(data));
        }
        const nextAnimation = this._animationName || animation;
        if (data && nextAnimation) {
            this._skeleton.setAnimation(0, nextAnimation, this._loop);
        }
    }

    private _applyCurrentAnimation(): void {
        if (!this._skeleton) this._skeleton = this.getComponent(sp.Skeleton);
        if (this._skeleton?.skeletonData && this._animationName) {
            this._skeleton.setAnimation(0, this._animationName, this._loop);
        }
    }

    private _buildRuntimePath(): string {
        return `${this._bundleName}/${this._relativePath}`;
    }

    private _getEditorApplySignature(): string {
        return `${this._bundleName}|${this._relativePath}|${this._animationName}|${this._loop ? 1 : 0}|${I18nSpine._editorRevision}`;
    }

    private _clearSkeletonData(): void {
        if (!this._skeleton) this._skeleton = this.node.getComponent(sp.Skeleton);
        if (this._skeleton) {
            this._skeleton.skeletonData = null;
        }
    }

    private _setAnimationNames(names: string[]): void {
        this._animationNames = names;
        const animationEnum: Record<string, number> = { Default: 0 };
        names.forEach((name, index) => {
            animationEnum[name] = index + 1;
        });

        const enumType = Enum(animationEnum);
        setPropertyEnumType(this, 'animationIndex', enumType);

        if (!this._animationName && names.length > 0) {
            this._animationName = names[0];
            this._animationIndex = 1;
            return;
        }

        const matchedIndex = names.indexOf(this._animationName);
        this._animationIndex = matchedIndex >= 0 ? matchedIndex + 1 : 0;
    }

    private _hasSerializedSkeletonDataReference(): boolean {
        return false;
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

function readAnimationNames(data: sp.SkeletonData): string[] {
    const animations = (data.skeletonJson as unknown as { animations?: Record<string, unknown> })?.animations;
    if (!animations || typeof animations !== 'object') return [];

    return Object.keys(animations);
}
