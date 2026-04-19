import { _decorator, Slider, v3 } from 'cc';
import { Nexus, UIPanel } from 'db://nexus-framework/index';

const { ccclass, property } = _decorator;

@ccclass('SettingView')
export class SettingView extends UIPanel {

    @property({ type: Slider })
    musicSlider: Slider = null!;

    @property({ type: Slider })
    sfxSlider: Slider = null!;

    onShow(): void {
        this.musicSlider.progress = Nexus.audio.getMusicVolume();
        this.sfxSlider.progress = Nexus.audio.getSfxVolume();
    }

    async showAnimation(): Promise<void> {
        this.stopAllTweens();
        const promises: Promise<void>[] = [];

        this.node.setScale(0, 0, 0);
        promises.push(this.trackTween(this.node, 0.1, { scale: v3(1, 1, 1) }, 'backOut'));

        if (this.maskNode) {
            const opacity = this._ensureOpacity(this.maskNode);
            opacity.opacity = 0;
            promises.push(this.trackTween(opacity, 0.2, { opacity: 255 }));
        }

        return Promise.all(promises).then(() => {});
    }

    async hideAnimation(): Promise<void> {
        this.stopAllTweens();
        const promises: Promise<void>[] = [];

        promises.push(this.trackTween(this.node, 0.2, { scale: v3(0, 0, 0) }, 'backIn'));

        if (this.maskNode) {
            const opacity = this._ensureOpacity(this.maskNode);
            promises.push(this.trackTween(opacity, 0.1, { opacity: 0 }));
        }

        return Promise.all(promises).then(() => {});
    }

    public onMusicSlider(event: Slider): void {
        Nexus.audio.setMusicVolume(event.progress);
    }

    public onSfxSlider(event: Slider): void {
        Nexus.audio.setSfxVolume(event.progress);
    }

    public onClickClose(): void {
        console.log(this.panelName)
        this.close();
    }
}
