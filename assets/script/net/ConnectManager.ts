import {getQueryParam, Nexus} from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';

/** 服务器地址配置 */
const BASE_URL_DEBUG = 'https://gwm.herondev.xin';
const BASE_URL_PROD  = 'https://gwm.herondev.xin'; // TODO: 替换为生产地址

const CONFIG_MAX_RETRY = 5;
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
            room_id: getQueryParam('room_id') || "",
            game_id: getQueryParam('game_id') || 6,
            user_id: getQueryParam('user_id') || '',
            nick_name: 'Alice',
            user_avatar: 'https://p-web.herontest.xin/img/avatar/7.png',
            coin: 10000,
            score: 2000,
            is_guest: false,
            is_robot: false,
            camp_id: 0,
            inviter_user_id: 0,
            invite_code: "",
            is_kol: false,
            is_in_white_list: false,
            register_time: 0,
            app_id : "1001",
        };
        Nexus.net.post<{ code: number, data: { game_token: string } }>(
            GameEvents.HTTP_GENERATE_TOKEN as string,
            DEFAULT_LOCAL_TOKEN_PARAMS,
        ).then((res) => {
            console.log('generateToken success', res);
            callback(res?.data?.game_token ?? '');
        }).catch((err) => {
            console.warn('[ConnectManager] generateToken 失败', err);
            callback('');
        });
    }

    private static requestConfig(retryCount = 0): void {
        Nexus.net.get<{
            code: number,
            data: {gate_addr: string}
        }>(GameEvents.HTTP_GAME_CONFIG as string).then((res) => {
            console.log('config', res);
            const gate_addr       = res?.data?.gate_addr        ?? '';
            const token           = Nexus.data.get<string>('token') ?? '';
            const game_id= getQueryParam('game_id') || "";
            const user_id= getQueryParam('user_id') || "";
            const room_id= getQueryParam('room_id') || "";
            const sign= getQueryParam('sign') ?? '';
            const base_score= getQueryParam('base_score') ?? '2000';
            const is_create_party= getQueryParam('is_create_party') ?? 'false';
            const room_auth= getQueryParam('room_auth') ?? '';
            const party_name= getQueryParam('party_name') ?? '';

            Nexus.data.set('user_id', user_id);
            ConnectManager.connectWs(gate_addr, token, game_id, user_id, room_id, sign, base_score, is_create_party, room_auth, party_name);
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
        game_id: string,
        user_id: string,
        room_id: string,
        sign: string,
        base_score: string,
        is_create_party: string,
        room_auth: string,
        party_name: string,
    ): void {
        const qs = `?token=${token}&game_id=${game_id}&user_id=${user_id}&room_id=${room_id}&sign=${sign}&base_score=${base_score}&is_create_party=${is_create_party}&room_auth=${room_auth}&party_name=${party_name}`;
        const url = `${gate_addr}${qs}`;
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
