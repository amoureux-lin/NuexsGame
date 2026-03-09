import type { NexusConfig } from '../core/NexusConfig';
import { Nexus } from '../core/Nexus';
import { HttpOptions, HttpResponse, INetService } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';

type WsHandler = (msg: unknown) => void;

/**
 * 基于 XMLHttpRequest + WebSocket 的网络实现。
 *
 * HTTP：
 *   - 支持 GET / POST，自动注入 Authorization Bearer token
 *   - 超时时长取自 NexusConfig.networkTimeout
 *
 * WebSocket：
 *   - connectWs 返回 Promise，连接成功后 resolve
 *   - 消息体约定 { cmd, data } JSON 格式
 *   - 断开时发布 NexusEvents.NET_DISCONNECTED
 */
export class NetServiceImpl extends INetService {

    private _baseUrl = '';
    private _token   = '';
    private _timeout = 10000;
    private _ws: WebSocket | null = null;
    private readonly _wsHandlers = new Map<string | number, Set<WsHandler>>();

    /** 读取并缓存网络超时配置。 */
    async onBoot(config: NexusConfig): Promise<void> {
        this._timeout = config.networkTimeout;
    }

    // ── HTTP ─────────────────────────────────────────

    /** 发起 GET 请求。 */
    async get<T>(path: string, options?: HttpOptions): Promise<HttpResponse<T>> {
        return this.request<T>('GET', path, undefined, options);
    }

    /** 发起 POST 请求。 */
    async post<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
        return this.request<T>('POST', path, body);
    }

    /** 设置后续 HTTP 请求的基础地址。 */
    setBaseUrl(url: string): void {
        this._baseUrl = url.replace(/\/$/, '');
    }

    /** 设置后续请求默认携带的认证 token。 */
    setToken(token: string): void {
        this._token = token;
    }

    // ── WebSocket ─────────────────────────────────────

    /** 建立 WebSocket 连接，并注册默认事件桥接。 */
    connectWs(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this._ws = new WebSocket(url);

            this._ws.onopen = () => {
                Nexus.emit(NexusEvents.NET_CONNECTED);
                resolve();
            };

            this._ws.onerror = (e) => reject(e);

            this._ws.onclose = () => {
                Nexus.emit(NexusEvents.NET_DISCONNECTED);
            };

            this._ws.onmessage = (e) => {
                try {
                    const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                    // 支持 { cmd, data } 和 { type, data } 两种格式
                    const cmd = msg?.cmd ?? msg?.type;
                    if (cmd === undefined) return;
                    const handlers = this._wsHandlers.get(cmd);
                    if (handlers) {
                        for (const fn of handlers) fn(msg);
                    }
                } catch (err) {
                    console.warn('[Nexus] WS message parse error:', err);
                }
            };
        });
    }

    /** 发送一条带 cmd 的 WebSocket 消息。 */
    sendWs(cmd: string | number, data: unknown): void {
        if (this._ws?.readyState !== WebSocket.OPEN) {
            console.warn('[Nexus] WebSocket is not connected');
            return;
        }
        this._ws.send(JSON.stringify({ cmd, data }));
    }

    /** 为指定 cmd 注册 WebSocket 消息处理器。 */
    onWsMsg(cmd: string | number, fn: WsHandler): void {
        if (!this._wsHandlers.has(cmd)) {
            this._wsHandlers.set(cmd, new Set());
        }
        this._wsHandlers.get(cmd)!.add(fn);
    }

    /** 销毁时关闭连接并清空运行时状态。 */
    async onDestroy(): Promise<void> {
        this._ws?.close();
        this._ws = null;
        this._wsHandlers.clear();
        this._baseUrl = '';
        this._token   = '';
    }

    // ── 私有工具 ─────────────────────────────────────

    /** 统一执行 HTTP 请求并返回标准响应结构。 */
    private request<T>(
        method: string,
        path: string,
        body?: unknown,
        options?: HttpOptions,
    ): Promise<HttpResponse<T>> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const url = /^https?:\/\//.test(path) ? path : `${this._baseUrl}${path}`;

            xhr.open(method, url);
            xhr.timeout = options?.timeout ?? this._timeout;

            if (this._token) {
                xhr.setRequestHeader('Authorization', `Bearer ${this._token}`);
            }
            if (options?.headers) {
                for (const key in options.headers) {
                    if (!Object.prototype.hasOwnProperty.call(options.headers, key)) {
                        continue;
                    }

                    xhr.setRequestHeader(key, options.headers[key]);
                }
            }
            if (body !== undefined) {
                xhr.setRequestHeader('Content-Type', 'application/json');
            }

            xhr.onload = () => {
                let data: T;
                try {
                    data = JSON.parse(xhr.responseText);
                } catch {
                    data = xhr.responseText as unknown as T;
                }
                resolve({
                    ok:     xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    data,
                    raw:    xhr.responseText,
                });
            };

            xhr.onerror   = () => reject(new Error(`[Nexus] Network error: ${url}`));
            xhr.ontimeout = () => reject(new Error(`[Nexus] Request timeout: ${url}`));

            xhr.send(body !== undefined ? JSON.stringify(body) : null);
        });
    }
}
