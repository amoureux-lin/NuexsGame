import { _decorator, Button, Node } from 'cc';
import { Nexus, UIPanel } from 'db://nexus-framework/index';
import { ButtonToggle } from '../components/ButtonToggle';

const { ccclass, property } = _decorator;

/** MenuPanel.onShow() 接受的参数 */
export interface MenuPanelParams {
    /** 是否显示声音开关，默认 true */
    showSound?: boolean;
    /** 是否显示历史记录按钮，默认 true */
    showHistory?: boolean;
    /** 是否显示规则按钮，默认 true */
    showRule?: boolean;
    /** 是否显示牌色切换按钮，默认 true */
    showCardColor?: boolean;
    /** 牌色切换默认状态，true = checked，默认 false */
    cardColorChecked?: boolean;
    /** 点击历史记录 */
    onHistory?: () => void;
    /** 点击规则 */
    onRule?: () => void;
    /** 牌色切换回调，参数为当前是否选中 */
    onCardColor?: (isChecked: boolean) => void;
}

@ccclass('MenuPanel')
export class MenuPanel extends UIPanel {

    @property({ type: ButtonToggle, tooltip: '声音开关按钮' })
    soundToggle: ButtonToggle = null!;

    @property({ type: Node, tooltip: '历史记录按钮' })
    historyBtn: Node = null!;

    @property({ type: Node, tooltip: '规则按钮' })
    ruleBtn: Node = null!;

    @property({ type: ButtonToggle, tooltip: '牌色切换按钮' })
    cardColorToggle: ButtonToggle = null!;

    private _params: MenuPanelParams = {};

    onShow(params?: MenuPanelParams): void {
        this._params = params ?? {};
        const p = this._params;

        // 按 show* 控制按钮显隐（默认全部显示）
        if (this.soundToggle) {
            this.soundToggle.node.active = p.showSound !== false;
            this.soundToggle.isChecked = Nexus.audio.getMusicVolume() === 0;
            this.soundToggle.node.on(Button.EventType.CLICK, this._onSoundToggle, this);
        }
        if (this.historyBtn) {
            this.historyBtn.active = p.showHistory !== false;
            this.historyBtn.on(Button.EventType.CLICK, this._onHistory, this);
        }
        if (this.ruleBtn) {
            this.ruleBtn.active = p.showRule !== false;
            this.ruleBtn.on(Button.EventType.CLICK, this._onRule, this);
        }
        if (this.cardColorToggle) {
            this.cardColorToggle.node.active = p.showCardColor !== false;
            this.cardColorToggle.isChecked = p.cardColorChecked ?? false;
            this.cardColorToggle.node.on(Button.EventType.CLICK, this._onCardColorToggle, this);
        }
    }

    onHide(): void {
        this.soundToggle?.node.off(Button.EventType.CLICK, this._onSoundToggle, this);
        this.historyBtn?.off(Button.EventType.CLICK, this._onHistory, this);
        this.ruleBtn?.off(Button.EventType.CLICK, this._onRule, this);
        this.cardColorToggle?.node.off(Button.EventType.CLICK, this._onCardColorToggle, this);
    }

    private _onSoundToggle(): void {
        const mute = this.soundToggle.isChecked;
        Nexus.audio.setMusicVolume(mute ? 0 : 1);
        Nexus.audio.setSfxVolume(mute ? 0 : 1);
    }

    private _onHistory(): void {
        this._params.onHistory?.();
    }

    private _onRule(): void {
        this._params.onRule?.();
    }

    private _onCardColorToggle(): void {
        this._params.onCardColor?.(this.cardColorToggle.isChecked);
    }

    public onClickClose(): void {
        this.close();
    }
}
