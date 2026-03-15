import { _decorator, Component } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';

const { ccclass } = _decorator;

/** 本地测试用的默认参数，可按需修改 */
const DEFAULT_LOCAL_TOKEN_PARAMS = {
    room_id: 1,
    room_name: '新手房-1',
    game_id: 1,
    score: 10,
    user_id: '1',
    nick_name: 'Alice',
    user_avatar: 'https://p-web.herontest.xin/img/avatar/7.png',
    coin: 10000,
    is_guest: false,
};

@ccclass('ConnectManager')
export class ConnectManager extends Component {

    private _isReconnecting = false;

    onLoad(): void {
        // Nexus.on(GameEvents.NET_CONNECTED, this.onNetConnected, this);
        Nexus.net.setBaseUrl("https://gwm.herondev.xin");
        if (this.isLocal()) {
            this.generateToken((token) => {
                if (token) Nexus.net.setToken(token);
                this.requestConfig();
            });
        } else {
            this.requestConfig();
        }
    }

    onDestroy(): void {
        Nexus.offTarget(this);
    }

    /** 是否本地/测试环境（按需改为从配置或 URL 读取） */
    private isLocal(): boolean {
        return true; // 可改为：Nexus.config?.debug ?? false，或根据 baseUrl 判断
    }

    /**
     * 本地测试时先请求获取 Token，再执行 callback。
     * 非本地环境不要调用此方法。
     */
    private generateToken(callback?: (token: string) => void): void {
        Nexus.net.post<{ code: number, data: { token: string } }>(GameEvents.HTTP_GENERATE_TOKEN as string, DEFAULT_LOCAL_TOKEN_PARAMS)
            .then((res) => {
                console.log("generateToken success", res);
                const token = res?.data?.token ?? '';
                if (callback) callback(token);
            })
            .catch((err) => {
                console.warn('[ConnectManager] generateToken 失败', err);
                if (callback) callback('');
            });
    }

    private requestConfig(): void {
        Nexus.net.get<{ 
            code: number, 
            data: { 
                gate_addr: string,
                token: string,
                game_id: number,
                user_id: string,
                room_id: string,
                voice_channel: string
            } 
        }>(GameEvents.HTTP_GAME_CONFIG as string).then((res) => {
            console.log("config", res);
            // 返回数据格式：{
            //     "code": 0,
            //     "msg": "",
            //     "data": {
            //         "gate_addr": "wss://gwg.herondev.xin/ws",
            //         "agora_app_id": "4d5b5a3bd6634c489bb36018e5d1a324",
            //         "agora_token": "0064d5b5a3bd6634c489bb36018e5d1a324IAA0WjUxrkE3wpirEFcJyJvujRrGiSJSDy/3IcUyiVAwAwmqk7S379yDEAB8ZZADZPm3aQEAAQBk+bdp",
            //         "user_id": "1",
            //         "room_id": "1",
            //         "game_id": 1,
            //         "voice_channel": "room_1_1"
            //     }
            // }

            const gate_addr = res?.data?.gate_addr ?? '';
            const token = res?.data?.token ?? '';
            const game_id = Number(res?.data?.game_id) ?? 0;
            const user_id = Number(res?.data?.user_id) ?? 0;
            const room_id = Number(res?.data?.room_id) ?? 0;
            const voice_channel = res?.data?.voice_channel ?? '';
            this.connectWs(gate_addr, token, game_id, user_id, room_id, voice_channel);
        }).catch((err) => {
            console.log("config请求失败", err);
        });
    }

    /**
     * ws网络开始连接
     */
    private connectWs(gate_addr: string, token: string, game_id: number, user_id: number, room_id: number, voice_channel: string): void {
        //url += `?token=${token}&game_id=${this.game_id}&user_id=${this.user_id}&room_id=${this.room_id}`;
        const url = `${gate_addr}?token=${token}&game_id=${game_id}&user_id=${user_id}&room_id=${room_id}&voice_channel=${voice_channel}`;
        Nexus.net.connectWs(url).then(() => {
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
