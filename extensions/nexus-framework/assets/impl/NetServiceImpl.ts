import type { NexusConfig } from '../core/NexusConfig';
import { HttpOptions, INetService, IWsDelegate, WsConfig, WsMsgCtx } from '../services/contracts';
import { HttpServiceImpl } from './HttpServiceImpl';
import { WsServiceImpl } from './WsServiceImpl';

/**
 * 网络服务门面：组合 HTTP + WebSocket 两个实现，对外保持 INetService 单一入口。
 */
export class NetServiceImpl extends INetService {
    private readonly _http = new HttpServiceImpl();
    private readonly _ws = new WsServiceImpl();

    async onBoot(config: NexusConfig): Promise<void> {
        await this._http.onBoot(config);
        await this._ws.onBoot(config);
    }

    // ── HTTP ─────────────────────────────────────────

    async get<T>(path: string, options?: HttpOptions): Promise<T> {
        return this._http.get<T>(path, options);
    }

    async post<T>(path: string, body?: unknown): Promise<T> {
        return this._http.post<T>(path, body);
    }

    setBaseUrl(url: string): void {
        this._http.setBaseUrl(url);
    }

    setToken(token: string): void {
        this._http.setToken(token);
    }

    // ── WebSocket ─────────────────────────────────────

    connectWs(url: string): Promise<void> {
        return this._ws.connectWs(url);
    }

    sendWs(cmd: string | number, data: unknown): void {
        this._ws.sendWs(cmd, data);
    }

    onWsMsg(cmd: string | number, fn: (msg: unknown, ctx: WsMsgCtx) => void, target?: object): void {
        this._ws.onWsMsg(cmd, fn, target);
    }

    offWsMsg(cmd: string | number, fn: (msg: unknown, ctx: WsMsgCtx) => void): void {
        this._ws.offWsMsg(cmd, fn);
    }

    offWsMsgByTarget(target: object): void {
        this._ws.offWsMsgByTarget(target);
    }

    initWs(config: WsConfig, delegate: IWsDelegate): void {
        this._ws.initWs(config, delegate);
    }

    wsRequest<T = unknown>(msgType: number, body: unknown, timeoutMs?: number): Promise<T> {
        return this._ws.wsRequest<T>(msgType, body, timeoutMs);
    }

    isConnected(): boolean {
        return this._ws.isConnected();
    }

    cancelAllHttpRequests(): void {
        this._http.cancelAllHttpRequests();
    }

    cancelAllWsRequests(reason?: string): void {
        this._ws.cancelAllWsRequests(reason);
    }

    async onDestroy(): Promise<void> {
        await this._http.onDestroy();
        await this._ws.onDestroy();
    }
}
