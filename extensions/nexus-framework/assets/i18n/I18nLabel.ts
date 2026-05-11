import { _decorator, Component, Label } from 'cc';
import { EDITOR } from 'cc/env';
import { Nexus } from '../core/Nexus';
import { NexusEvents } from '../NexusEvents';

const { ccclass, property, requireComponent, executeInEditMode } = _decorator;

type EditorI18nState = {
    revision: number;
};

/**
 * I18nLabel -- 多语言 Label 组件
 *
 * 挂到含 Label 的节点上，Inspector 中填入翻译 key，
 * 运行时自动翻译，切换语言时自动刷新。
 *
 * 用法：
 *   - key: "menu.sound"
 *   - 支持插值参数：代码中调用 setParams({ score: 100 })
 *   - 编辑器中 key 变更时预览显示当前 NexusSettings 对应的翻译值
 */
@ccclass('I18nLabel')
@requireComponent(Label)
@executeInEditMode(true)
export class I18nLabel extends Component {

    private static _editorRevision = 0;
    private static _lastEditorStateQueryAt = 0;
    private static _editorStateQuerying = false;

    @property({ tooltip: '翻译 key，对应 i18n JSON 中的字段名' })
    get key(): string { return this._key; }
    set key(v: string) {
        this._key = v;
        this._apply();
    }
    @property
    private _key: string = '';

    private _params: Record<string, unknown> = {};
    private _label: Label | null = null;
    private _applyVersion = 0;
    private _editorApplySignature = '';

    protected onLoad(): void {
        this._label = this.getComponent(Label);
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

        void I18nLabel._syncEditorState();
        const signature = this._getEditorApplySignature();
        if (signature === this._editorApplySignature) return;

        this._editorApplySignature = signature;
        this._apply();
    }

    /** 设置插值参数并立即刷新 */
    setParams(params: Record<string, unknown>): void {
        this._params = params;
        this._apply();
    }

    refreshEditorPreview(): void {
        this._apply();
    }

    private _onLanguageChanged(): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._label) this._label = this.getComponent(Label);
        if (!this._label || !this._key) return;

        if (EDITOR) {
            this._editorApplySignature = this._getEditorApplySignature();
            void this._applyInEditor(++this._applyVersion);
            return;
        }

        const params = Object.keys(this._params).length > 0 ? this._params : undefined;
        this._label.string = Nexus.i18n.t(this._key, params);
    }

    private async _applyInEditor(version: number): Promise<void> {
        if (!this._label || !this._key) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.request) {
            this._label.string = this._key;
            return;
        }

        try {
            const params = Object.keys(this._params).length > 0 ? this._params : undefined;
            const text = await editor.Message.request('nexus-framework', 'query-i18n-text', this._key, params);
            if (version !== this._applyVersion || !this._label) return;
            this._label.string = typeof text === 'string' && text ? text : this._key;
        } catch (error) {
            console.warn('[nexus-framework][I18nLabel] Failed to query editor i18n text:', error);
            if (version !== this._applyVersion || !this._label) return;
            this._label.string = this._key;
        }
    }

    private _getEditorApplySignature(): string {
        return `${this._key}|${JSON.stringify(this._params)}|${I18nLabel._editorRevision}`;
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
