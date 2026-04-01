import {_decorator, Component, Slider} from 'cc';
import {Nexus} from "db://nexus-framework/core/Nexus";

const { ccclass, property } = _decorator;

@ccclass('SettingView')
export class SettingView extends Component {

    @property({type: Slider})
    musicSlider: Slider = null;

    @property({type: Slider})
    sfxSlider: Slider = null;

    onLoad() {
        this.musicSlider.progress = Nexus.audio.getMusicVolume();
        this.sfxSlider.progress = Nexus.audio.getSfxVolume();
    }

    public onSoundSlider(event:any){
        console.log('onSoundSlider',event.progress);
        Nexus.audio.setMusicVolume(event.progress);
    }

    public onSfxSlider(event:any){
        console.log('onSoundSfx',event.progress);
        Nexus.audio.setSfxVolume(event.progress);
    }

    update(deltaTime: number) {
        
    }
}

