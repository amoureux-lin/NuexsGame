import { _decorator, Component } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';

const { ccclass } = _decorator;

@ccclass('ReconnectManager')
export class ReconnectManager extends Component {

    private _isReconnecting = false;

    onLoad(): void {
        // Nexus.on(GameEvents.NET_CONNECTED, this.onNetConnected, this);
        // this.connectWs();
    }

    onDestroy(): void {
        Nexus.offTarget(this);
    }

    /**
     * ws网络开始连接
     */
    private connectWs(): void {
        Nexus.net.connectWs("ws://localhost:8080").then(() => {
            console.log("ws连接成功");
        }).catch((err) => {
            console.log("ws连接失败", err);
        });
    }

    private finishReconnecting(): void {
        this._isReconnecting = false;
        Nexus.ui.hideLoading();
    }
}
