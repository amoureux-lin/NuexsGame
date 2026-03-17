import type { NexusConfig } from '../core/NexusConfig';
import { Nexus } from '../core/Nexus';
import { NexusEvents } from '../NexusEvents';
import { ServiceBase } from '../core/ServiceBase';
import type { DecodedPacket, IWsDelegate, WsConfig, WsSendContext } from '../services/contracts';

interface PendingRequest {
    resolve: (data: unknown) => void;
    reject: (err: unknown) => void;
    timeoutId?: number;
    msgType: number;
}

type WsHandler = (msg: unknown) => void;
interface WsHandlerEntry {
    fn: WsHandler;
    target?: object;
}

/**
 * 纯 WebSocket 实现：连接、心跳、收包超时、自动重连、requestId 队列。
 * 所有协议细节（编解码、拦截、状态 UI）均委托给 IWsDelegate。
 */
export class WsServiceImpl extends ServiceBase {
    private _ws: WebSocket | null = null;
    private readonly _wsHandlers = new Map<string | number, Set<WsHandlerEntry>>();

    private _config: WsConfig = {
        autoReconnect: 0,
        reconnectDelayMs: 2000,
        requestTimeoutMs: 10000,
        heartbeatIntervalMs: 5000,
        receiveTimeoutMs: 60000,
    };

    private _delegate: IWsDelegate | null = null;
    private _connected = false;
    private _lastUrl = '';
    private _autoReconnect = 0;
    private _reconnectTimer: number | null = null;
    private _heartbeatTimer: number | null = null;
    private _receiveTimer: number | null = null;
    private _nextRequestId = 1;
    private readonly _pending = new Map<number, PendingRequest>();

    async onBoot(_config: NexusConfig): Promise<void> {}

    // ── 初始化 ────────────────────────────────────────────

    initWs(config: WsConfig, delegate: IWsDelegate): void {
        this._config = { ...this._config, ...config };
        this._delegate = delegate;
        this._autoReconnect = config.autoReconnect ?? 0;
    }

    isConnected(): boolean {
        return !!this._ws && this._connected && this._ws.readyState === WebSocket.OPEN;
    }

    // ── 连接 ──────────────────────────────────────────────

    connectWs(url: string): Promise<void> {
        this._lastUrl = url;
        return new Promise((resolve, reject) => {
            this._ws = new WebSocket(url);

            this._ws.onopen = () => {
                this._connected = true;
                Nexus.emit(NexusEvents.NET_CONNECTED);
                this._delegate?.onConnected?.();
                this.startHeartbeat();
                this.resetReceiveTimer();
                resolve();
            };

            this._ws.onerror = (e) => {
                this._connected = false;
                this._delegate?.onConnectError?.(e);
                reject(e);
            };

            this._ws.onclose = () => {
                this._connected = false;
                this.clearTimers();
                Nexus.emit(NexusEvents.NET_DISCONNECTED);
                this._delegate?.onDisconnected?.();
                this.tryReconnect();
            };

            this._ws.onmessage = (e) => {
                this.handleMessage(e).catch((err) => {
                    console.warn('[Nexus] WS message error', err);
                });
            };
        });
    }

    private tryReconnect(): void {
        const mode = this._autoReconnect;
        if (mode === 0) {
            this._delegate?.onReconnecting?.(0);
            return;
        }
        this._delegate?.onReconnecting?.(mode);
        const delay = this._config.reconnectDelayMs ?? 2000;
        this._reconnectTimer = setTimeout(() => {
            if (this._lastUrl) {
                if (this._autoReconnect > 0) this._autoReconnect--;
                this.connectWs(this._lastUrl).catch((err) => {
                    console.warn('[Nexus] WS reconnect failed', err);
                });
            }
        }, delay);
    }

    // ── 发送 ──────────────────────────────────────────────

    /**
     * 统一发包入口：构造 WsSendContext → willSend（追加公共字段）→ encode → ws.send
     */
    private buildAndSend(msgType: number, body: unknown, requestId: number): void {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            console.warn('[Nexus] WebSocket is not connected');
            return;
        }
        const ctx: WsSendContext = { msgType, requestId, body, extra: {} };
        this._delegate?.willSend?.(ctx);
        const packet = this._delegate
            ? this._delegate.encode(ctx)
            : new TextEncoder().encode(JSON.stringify({ cmd: msgType, data: ctx.body }));
        this._ws.send(packet);
    }

    sendWs(cmd: string | number, data: unknown): void {
        console.log('【ws】发送单向消息：', cmd, 'data:', data);
        this.buildAndSend(Number(cmd), data, 0);
    }

    wsRequest<T = unknown>(msgType: number, body: unknown, timeoutMs?: number): Promise<T> {
        if (!this._delegate) {
            return Promise.reject(new Error('[Nexus] initWs required for wsRequest'));
        }
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('[Nexus] WebSocket not connected'));
        }

        const requestId = this._nextRequestId++;
        return new Promise<T>((resolve, reject) => {
            const ms = timeoutMs ?? this._config.requestTimeoutMs ?? 10000;
            const timeoutId = setTimeout(() => {
                this.rejectPending(requestId, new Error('[Nexus] WS request timeout'));
            }, ms);
            this._pending.set(requestId, { resolve, reject, timeoutId, msgType });
            this.buildAndSend(msgType, body, requestId);
        });
    }

    // ── 收包 ──────────────────────────────────────────────

    /**
     * 原始消息入口：Blob/ArrayBuffer/string 统一转换后交给 delegate.decode
     */
    private async handleMessage(e: MessageEvent): Promise<void> {
        let data: Uint8Array | string;
        if (e.data instanceof Blob) {
            data = new Uint8Array(await e.data.arrayBuffer());
        } else if (e.data instanceof ArrayBuffer) {
            data = new Uint8Array(e.data);
        } else {
            data = e.data as string;
        }

        const pkt = this._delegate?.decode(data) ?? null;
        if (pkt) this.handleDecoded(pkt);
        this.resetReceiveTimer();
    }

    /**
     * 收包链：willReceive（业务全权处理）→ resolvePending + dispatch
     *
     * willReceive 返回语义：
     *   true  → 静默拦截（心跳、系统消息等），不 dispatch 也不 reject
     *   Error → 拦截并 reject 对应的 wsRequest Promise（服务端错误码等）
     *   void  → 继续正常流程
     */
    private handleDecoded(pkt: DecodedPacket): void {
        const result = this._delegate?.willReceive?.(pkt);

        if (result instanceof Error) {
            this.rejectPending(pkt.requestId, result);
            return;
        }
        if (result === true) {
            return;
        }

        this.resolvePending(pkt.requestId, pkt.body);
        this.dispatch(pkt.msgType, pkt.body);
    }

    // ── 分发 ──────────────────────────────────────────────

    private dispatch(cmd: string | number, msg: unknown): void {
        const handlers = this._wsHandlers.get(cmd);
        if (handlers) {
            for (const { fn } of handlers) fn(msg);
        }
    }

    // ── Pending 管理 ──────────────────────────────────────

    private resolvePending(requestId: number, data: unknown): boolean {
        if (requestId === 0) return false;
        const pending = this._pending.get(requestId);
        if (!pending) return false;
        this._pending.delete(requestId);
        if (pending.timeoutId !== undefined) clearTimeout(pending.timeoutId);
        pending.resolve(data);
        return true;
    }

    private rejectPending(requestId: number, err: unknown): boolean {
        if (requestId === 0) return false;
        const pending = this._pending.get(requestId);
        if (!pending) return false;
        this._pending.delete(requestId);
        if (pending.timeoutId !== undefined) clearTimeout(pending.timeoutId);
        pending.reject(err);
        return true;
    }

    // ── 监听 ──────────────────────────────────────────────

    onWsMsg(cmd: string | number, fn: WsHandler, target?: object): void {
        if (!this._wsHandlers.has(cmd)) {
            this._wsHandlers.set(cmd, new Set());
        }
        this._wsHandlers.get(cmd)!.add({ fn, target });
    }

    offWsMsg(cmd: string | number, fn: WsHandler): void {
        const handlers = this._wsHandlers.get(cmd);
        if (!handlers) return;
        for (const entry of handlers) {
            if (entry.fn === fn) {
                handlers.delete(entry);
                break;
            }
        }
        if (handlers.size === 0) this._wsHandlers.delete(cmd);
    }

    offWsMsgByTarget(target: object): void {
        for (const [cmd, handlers] of this._wsHandlers.entries()) {
            const toRemove: WsHandlerEntry[] = [];
            for (const entry of handlers) {
                if (entry.target === target) toRemove.push(entry);
            }
            for (const entry of toRemove) handlers.delete(entry);
            if (handlers.size === 0) this._wsHandlers.delete(cmd);
        }
    }

    // ── 心跳 / 收包超时 ───────────────────────────────────

    private startHeartbeat(): void {
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        const interval = this._config.heartbeatIntervalMs ?? 5000;
        if (interval <= 0 || !this._delegate) return;

        this._heartbeatTimer = setInterval(() => {
            if (!this.isConnected()) return;
            const hb = this._delegate!.heartbeat();
            if (hb) this._ws?.send(hb);
        }, interval);
    }

    private resetReceiveTimer(): void {
        if (this._receiveTimer !== null) {
            clearTimeout(this._receiveTimer);
            this._receiveTimer = null;
        }
        const timeout = this._config.receiveTimeoutMs ?? 60000;
        if (timeout <= 0) return;

        this._receiveTimer = setTimeout(() => {
            console.warn('[Nexus] WS no message for long time, close');
            this._ws?.close();
        }, timeout);
    }

    private clearTimers(): void {
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this._receiveTimer !== null) {
            clearTimeout(this._receiveTimer);
            this._receiveTimer = null;
        }
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    async onDestroy(): Promise<void> {
        this.clearTimers();
        for (const requestId of this._pending.keys()) {
            this.rejectPending(requestId, new Error('[Nexus] WS destroyed'));
        }
        this._wsHandlers.clear();
        if (this._ws) {
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onerror = null;
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
        this._connected = false;
        this._lastUrl = '';
    }
}
