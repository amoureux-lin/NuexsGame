import {getQueryParam, Nexus} from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';

/** 服务器地址配置 */
const BASE_URL_DEBUG = 'https://gwm.herondev.xin';
const BASE_URL_PROD  = 'https://gwm.herondev.xin'; // TODO: 替换为生产地址

const CONFIG_MAX_RETRY = 3;
const CONFIG_RETRY_DELAY = 2000;

/**
 * 网络连接管理器（纯工具类，非组件）。
 * 必须在 Nexus.init() 之后调用 init()。
 */
export class ConnectManager {

    /**
     * 初始化网络连接：设置 BaseUrl → 获取 token（debug）→ 请求配置 → 连接 WS。
     * 由 GameLauncher 在框架初始化完成后主动调用。
     */
    static init(): void {
        const isDebug = Nexus.config?.debug ?? false;
        const baseUrl = isDebug ? BASE_URL_DEBUG : BASE_URL_PROD;
        Nexus.net.setBaseUrl(baseUrl);

        if (isDebug) {
            ConnectManager.generateToken((token) => {
                if (token) {
                    Nexus.net.setToken(token);
                    Nexus.data.set('token', token);
                    ConnectManager.requestConfig();
                } else {
                    console.warn('[ConnectManager] generateToken 失败');
                }
            });
        } else {
            ConnectManager.requestConfig();
        }
    }

    private static generateToken(callback: (token: string) => void): void {
        const DEFAULT_LOCAL_TOKEN_PARAMS = {
            room_id: getQueryParam('room_id') || 88,
            room_name: '新手房-1',
            game_id: getQueryParam('game_id') || 6,
            score: 10,
            user_id: getQueryParam('user_id') || '123456',
            nick_name: 'Alice'+getQueryParam('user_id') || '123456',
            user_avatar: 'https://p-web.herontest.xin/img/avatar/7.png',
            coin: 10000,
            is_guest: false,
        };
        Nexus.net.post<{ code: number, data: { token: string } }>(
            GameEvents.HTTP_GENERATE_TOKEN as string,
            DEFAULT_LOCAL_TOKEN_PARAMS,
        ).then((res) => {
            console.log('generateToken success', res);
            callback(res?.data?.token ?? '');
        }).catch((err) => {
            console.warn('[ConnectManager] generateToken 失败', err);
            callback('');
        });
    }

    private static requestConfig(retryCount = 0): void {
        Nexus.net.get<{
            code: number,
            data: {
                gate_addr: string,
                game_id: number,
                user_id: string,
                room_id: string,
                voice_channel: string
            }
        }>(GameEvents.HTTP_GAME_CONFIG as string).then((res) => {
            console.log('config', res);
            const gate_addr = res?.data?.gate_addr ?? '';
            const token = Nexus.data.get<string>('token') ?? '';
            const game_id = Number(res?.data?.game_id) ?? 0;
            const user_id = Number(res?.data?.user_id) ?? 0;
            const room_id = Number(res?.data?.room_id) ?? 0;
            const voice_channel = res?.data?.voice_channel ?? '';
            Nexus.data.set('user_id', user_id);
            ConnectManager.connectWs(gate_addr, token, game_id, user_id, room_id, voice_channel);
        }).catch((err) => {
            console.error('[ConnectManager] config请求失败', err);
            if (retryCount < CONFIG_MAX_RETRY) {
                console.warn(`[ConnectManager] 将在 ${CONFIG_RETRY_DELAY}ms 后重试 (${retryCount + 1}/${CONFIG_MAX_RETRY})`);
                setTimeout(() => ConnectManager.requestConfig(retryCount + 1), CONFIG_RETRY_DELAY);
            } else {
                console.error('[ConnectManager] config请求重试次数耗尽');
            }
        });
    }

    private static connectWs(
        gate_addr: string, token: string,
        game_id: number, user_id: number, room_id: number, voice_channel: string,
    ): void {
        const url = `${gate_addr}?token=${token}&game_id=${game_id}&user_id=${user_id}&room_id=${room_id}&voice_channel=${voice_channel}`;
        Nexus.net.connectWs(url).then(() => {
            console.log('ws连接成功');
            Nexus.toast.show('ws连接成功');
            // Nexus.toast.error('网络异常，请重试');
            // Nexus.toast.success('任务完成', { position: 'bottom' });
        }).catch((err) => {
            console.log('ws连接失败', err);
        });
    }
}
