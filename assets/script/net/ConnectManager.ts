import {getQueryParam, Nexus} from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';
import { getResolvedHostUrl, isDebugEnv } from '../config/NetworkConfig';
import { ClientTraceReporter, ClientTracePhase } from '../lib/report/ClientTraceReporter';
import { postGameLoadCompleteReport } from '../lib/report/clientTraceReportTransport';

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
        Nexus.net.setBaseUrl(getResolvedHostUrl());
        ClientTraceReporter.getInstance().step(ClientTracePhase.HTTP_INIT, { ok: true });

        // 资源加载完成 → 上报 BI 加载完成事件
        // trace_id 来源于 URL 参数 ?trace_id=xxx，未携带时内部直接跳过
        postGameLoadCompleteReport();

        if (isDebugEnv()) {
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
            let token = getQueryParam('token') || "";
            Nexus.net.setToken(token);
            Nexus.data.set('token', token);
            ConnectManager.requestConfig();
        }
    }

    private static generateToken(callback: (token: string) => void): void {
        const trace = ClientTraceReporter.getInstance();
        const DEFAULT_LOCAL_TOKEN_PARAMS = {
            room_id: getQueryParam('room_id') || "",
            game_id: getQueryParam('game_id') || 5,
            user_id: getQueryParam('user_id') || '',
            nick_name: 'Alice',
            user_avatar: 'https://p-web.herontest.xin/img/avatar/7.png',
            coin: 1000000,
            score: getQueryParam('score') || 2000,
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
        const cmd = GameEvents.HTTP_GENERATE_TOKEN as string;
        trace.step(ClientTracePhase.HTTP_REQ_SEND, {
            detail: cmd,
            meta: { cmd, method: 'POST', params: DEFAULT_LOCAL_TOKEN_PARAMS },
        });
        Nexus.net.post<{ code: number, data: { game_token: string } }>(
            cmd,
            DEFAULT_LOCAL_TOKEN_PARAMS,
        ).then((res) => {
            console.log('generateToken success', res);
            trace.step(ClientTracePhase.HTTP_RSP_OK, {
                ok: true,
                detail: cmd,
                meta: { cmd, code: res?.code, data: res?.data },
            });
            callback(res?.data?.game_token ?? '');
        }).catch((err) => {
            console.warn('[ConnectManager] generateToken 失败', err);
            trace.step(ClientTracePhase.HTTP_ERROR, {
                ok: false,
                detail: `${cmd}: ${err}`,
                meta: { cmd, error: String(err) },
            });
            callback('');
        });
    }

    private static requestConfig(retryCount = 0): void {
        const trace = ClientTraceReporter.getInstance();
        const cmd = GameEvents.HTTP_GAME_CONFIG as string;
        trace.step(ClientTracePhase.HTTP_REQ_SEND, {
            detail: cmd,
            meta: { cmd, method: 'GET' },
        });
        Nexus.net.get<{
            code: number,
            data: {gate_addr: string}
            msg:string
        }>(cmd).then((res) => {
            console.log('config', res);
            if(res.code === 0){
                trace.step(ClientTracePhase.HTTP_RSP_OK, {
                    ok: true,
                    detail: cmd,
                    meta: { cmd, code: res?.code, data: res?.data },
                });
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
            } else {
                trace.step(ClientTracePhase.HTTP_ERROR, {
                    ok: false,
                    detail: `${cmd}: ${res.code}`,
                    meta: { cmd, error: String(res.msg), retryCount },
                });
                if (retryCount < CONFIG_MAX_RETRY) {
                    console.warn(`[ConnectManager] 将在 ${CONFIG_RETRY_DELAY}ms 后重试 (${retryCount + 1}/${CONFIG_MAX_RETRY})`);
                    setTimeout(() => ConnectManager.requestConfig(retryCount + 1), CONFIG_RETRY_DELAY);
                } else {
                    console.error('[ConnectManager] config请求重试次数耗尽');
                }
            }
        }).catch((err) => {
            console.error('[ConnectManager] config请求失败', err);
            trace.step(ClientTracePhase.HTTP_ERROR, {
                ok: false,
                detail: `${cmd}: ${err}`,
                meta: { cmd, error: String(err), retryCount },
            });
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
        // 调试入口：URL 上带 wsUrl 参数时覆盖 gate_addr。不影响 /config 请求与其他启动流程，
        // 仅在真正连接时把 gate 地址替换为指定 ws 地址。用法：?wsUrl=ws://192.168.1.100:8080/ws
        const overrideWsUrl = getQueryParam('wsUrl');
        if (overrideWsUrl) {
            console.log('[ConnectManager] override gate_addr by URL wsUrl:', overrideWsUrl);
            gate_addr = overrideWsUrl;
        }

        const trace = ClientTraceReporter.getInstance();
        const debugSuffix = isDebugEnv() ? '&debug_direct=1' : '';
        const qs = `?token=${token}&game_id=${game_id}&user_id=${user_id}&room_id=${room_id}&sign=${sign}&base_score=${base_score}&is_create_party=${is_create_party}&room_auth=${room_auth}&party_name=${party_name}${debugSuffix}`;
        const url = `${gate_addr}${qs}`;
        trace.step(ClientTracePhase.WS_CONNECT, {
            detail: gate_addr,
            meta: {
                url: gate_addr,
                game_id, user_id, room_id, sign,
                base_score, is_create_party, room_auth, party_name,
                autoReconnect: true,
            },
        });
        Nexus.net.connectWs(url).then(() => {
            console.log('ws连接成功');
        }).catch((err) => {
            console.log('ws连接失败', err);
        });
    }
}
