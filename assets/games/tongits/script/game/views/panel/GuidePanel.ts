import { _decorator, Component, Label } from 'cc';
import {Nexus} from "db://nexus-framework/core/Nexus";
const { ccclass, property } = _decorator;

@ccclass('GuidePanel')
export class GuidePanel extends Component {

    @property({ type: Label, tooltip: '倒计时' })
    countDownLabel: Label = null!;

    private _remain = 5;

    private _onCountdownTick = () => {
        this._remain--;
        if (this._remain <= 0) {
            this.clearCountdown();
            this.hide();
            return;
        }
        this.setCountdown(this._remain);
    };

    protected onDestroy(): void {
        this.clearCountdown();
    }

    /** 从 5 开始每秒减一，计满 5s 后自动 hide */
    startCountdown() {
        this.clearCountdown();
        this._remain = 5;
        this.setCountdown(this._remain);
        this.schedule(this._onCountdownTick, 1);
    }

    clearCountdown() {
        this.unschedule(this._onCountdownTick);
    }

    setCountdown(count: number) {
        this._remain = count;
        if (this.countDownLabel?.isValid) {
            this.countDownLabel.string = `(${this._remain}s)`;
        }
    }

    hide() {
        Nexus.storage.set("guid",true);
        this.clearCountdown();
        this.node.active = false;
    }

    show() {
        this.startCountdown();
        this.node.active = true;
    }

    clickStart() {
        this.clearCountdown();
        this.hide();
    }

    clickClose() {
        this.clearCountdown();
        this.hide();
    }
}
