import { _decorator, Component, Enum } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode } = _decorator;

const PACKAGE_NAME = 'nexus-framework';

export enum SceneOrientation {
    Landscape = 0,
    Portrait = 1,
}

@ccclass('NexusSettings')
@executeInEditMode(true)
export class NexusSettings extends Component {
    @property({ displayName: 'Bundle 名称' })
    get bundleName(): string {
        return this._bundleName;
    }
    set bundleName(value: string) {
        if (this._bundleName === value) return;

        this._bundleName = value;
        this.notifyEditorSettingsChanged();
    }

    @property({
        type: Enum(SceneOrientation),
        displayName: '场景方向',
    })
    get orientation(): SceneOrientation {
        return this._orientation;
    }
    set orientation(value: SceneOrientation) {
        if (this._orientation === value) return;

        this._orientation = value;
        this.notifyEditorSettingsChanged();
    }

    @property({ visible: false })
    private _bundleName = '';

    @property({ visible: false })
    private _orientation: SceneOrientation = SceneOrientation.Landscape;

    private notifyEditorSettingsChanged(): void {
        if (!EDITOR) return;

        const editor = (globalThis as { Editor?: any }).Editor;
        if (!editor?.Message?.send) {
            return;
        }

        editor.Message.send(PACKAGE_NAME, 'sync-nexus-settings', {
            bundleName: this._bundleName,
            orientation: Number(this._orientation),
        });
    }
}
