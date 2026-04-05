import type { NexusConfig } from '../core/NexusConfig';
import { Nexus } from '../core/Nexus';
import { NexusEvents } from '../NexusEvents';
import { ServiceBase } from '../core/ServiceBase';
import type { DecodedPacket, IWsDelegate, WsConfig, WsSendContext, WsMsgCtx } from '../services/contracts';

interface PendingRequest {
    resolve: (data: unknown) => void;
    reject: (err: unknown) => void;
    timeoutId?: number;
    msgType: number;
}

type WsHandler = (msg: unknown, ctx: WsMsgCtx) => void;
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
        autoReconnect: 3,
        reconnectDelayMs: 1000,
        requestTimeoutMs: 5000,
        heartbeatIntervalMs: 5000,
        receiveTimeoutMs: 5000,
    };

    private _delegate: IWsDelegate | null = null;
    private _connected = false;
    private _lastUrl = '';
    private _autoReconnect = 0;
    private _autoReconnectInitial = 0; // 记录初始配置值，连接成功后重置用
    private _reconnectTimer: number | null = null;
    private _heartbeatTimer: number | null = null;
    private _receiveTimer: number | null = null;
    private _nextRequestId = 1;
    private readonly _pending = new Map<number, PendingRequest>();
    /** 连接中的 Promise，防止并发 connectWs 创建多个 WebSocket */
    private _connectingPromise: Promise<void> | null = null;
    /** 切后台时间戳，用于判断后台时长 */
    private _backgroundAt = 0;

    async onBoot(_config: NexusConfig): Promise<void> {
        Nexus.on(NexusEvents.APP_HIDE, this._onAppHide, this);
        Nexus.on(NexusEvents.APP_SHOW, this._onAppShow, this);
    }

    // ── 初始化 ────────────────────────────────────────────

    initWs(config: WsConfig, delegate: IWsDelegate): void {
        this._config = { ...this._config, ...config };
        this._delegate = delegate;
        this._autoReconnect = config.autoReconnect ?? 0;
        this._autoReconnectInitial = this._autoReconnect;
    }

    isConnected(): boolean {
        return !!this._ws && this._connected && this._ws.readyState === WebSocket.OPEN;
    }

    // ── 连接 ──────────────────────────────────────────────

    connectWs(url: string): Promise<void> {
        this._lastUrl = url;

        // 防止并发连接：已有连接中的 Promise 直接返回
        if (this._connectingPromise) return this._connectingPromise;

        // 已连接且 URL 相同时，不重复创建
        if (this.isConnected() && this._lastUrl === url) return Promise.resolve();

        // 关闭旧连接（如果有）
        if (this._ws) {
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onerror = null;
            this._ws.onclose = null;
            try { this._ws.close(); } catch { /* ignore */ }
            this._ws = null;
            this._connected = false;
        }

        this._connectingPromise = new Promise<void>((resolve, reject) => {
            this._ws = new WebSocket(url);

            this._ws.onopen = () => {
                this._connectingPromise = null;
                this._connected = true;
                this._autoReconnect = this._autoReconnectInitial; // 重置重连次数
                this._delegate?.onConnected?.();
                // 统一抛出框架事件，供 Loading/业务按”已建立连接”推进流程
                Nexus.emit(NexusEvents.NET_CONNECTED);
                this.startHeartbeat();
                this.resetReceiveTimer();
                resolve();
            };

            this._ws.onerror = (e) => {
                this._connectingPromise = null;
                this._connected = false;
                this._delegate?.onConnectError?.(e);
                reject(e);
            };

            this._ws.onclose = () => {
                this._connectingPromise = null;
                console.log('【ws】onclose');
                this._connected = false;
                this.clearTimers();
                Nexus.emit(NexusEvents.NET_DISCONNECTED);
                this.tryReconnect();
            };

            this._ws.onmessage = (e) => {
                this.handleMessage(e).catch((err) => {
                    console.warn('[Nexus] WS message error', err);
                });
            };
        });

        return this._connectingPromise;
    }

    private tryReconnect(): void {
        const mode = this._autoReconnect;
        if (mode === 0) {
            this._delegate?.onDisconnected?.();
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
        console.log('【ws】发送消息',body);
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
        const maxRetry = this._config.requestRetry ?? 0;
        const baseDelay = this._config.requestRetryDelay ?? 1000;
        return this._wsRequestWithRetry<T>(msgType, body, timeoutMs, maxRetry, baseDelay);
    }

    private async _wsRequestWithRetry<T>(
        msgType: number,
        body: unknown,
        timeoutMs: number | undefined,
        maxRetry: number,
        baseDelay: number,
    ): Promise<T> {
        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetry; attempt++) {
            try {
                return await this._wsRequestOnce<T>(msgType, body, timeoutMs);
            } catch (err) {
                lastError = err;
                // 仅超时重试，服务端错误（Error 实例）不重试
                const isTimeout = typeof err === 'string' && err.includes('timeout');
                if (!isTimeout || attempt >= maxRetry) break;

                const delay = baseDelay * Math.pow(2, attempt);
                console.warn(`[Nexus] WS request retry ${attempt + 1}/${maxRetry} in ${delay}ms, msgType: ${msgType}`);
                await new Promise<void>(r => setTimeout(r, delay));

                // 重试前检查连接状态
                if (!this.isConnected()) break;
            }
        }

        return Promise.reject(lastError);
    }

    private _wsRequestOnce<T>(msgType: number, body: unknown, timeoutMs?: number): Promise<T> {
        if (!this._delegate) {
            console.error('[Nexus] initWs required for wsRequest');
            return Promise.reject('[Nexus] initWs required for wsRequest');
        }
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            console.error('[Nexus] WebSocket not connected');
            return Promise.reject('[Nexus] WebSocket not connected');
        }

        const requestId = this._nextRequestId = (this._nextRequestId % 0x7FFFFFFF) + 1;
        return new Promise<T>((resolve, reject) => {
            const ms = timeoutMs ?? this._config.requestTimeoutMs ?? 10000;
            const timeoutId = setTimeout(() => {
                console.error('[Nexus] WS request timeout, requestId:', requestId);
                this.rejectPending(requestId, '[Nexus] WS request timeout');
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

    /** 模拟收到服务端消息，仅供 MockView 测试使用 */
    simulateReceive(cmd: string | number, data: unknown): void {
        this.dispatch(cmd, data);
    }

    private dispatch(cmd: string | number, msg: unknown): void {
        const handlers = this._wsHandlers.get(cmd);
        if (!handlers) return;
        const ctx: WsMsgCtx = {
            isBackground: this._backgroundAt > 0,
            processedAt: Date.now(),
            msgType: cmd,
        };
        for (const { fn } of handlers) {
            try {
                fn(msg, ctx);
            } catch (err) {
                console.error(`[Nexus] WS handler threw for msgType ${String(cmd)}:`, err);
            }
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

    /** 取消所有等待响应的 WS 请求，reject 对应的 Promise。 */
    cancelAllWsRequests(reason = '[Nexus] WS requests cancelled'): void {
        for (const requestId of [...this._pending.keys()]) {
            this.rejectPending(requestId, reason);
        }
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
            console.warn('[Nexus] WS no message for long time, force disconnect');
            this.forceDisconnect();
        }, timeout);
    }

    /**
     * 强制断开连接并立即触发重连流程。
     * 用于收包超时等无法等待 TCP 层自然关闭的场景（如断网时 ws.close() 的 onclose 会延迟数十秒）。
     * 先摘除所有事件处理器，再调用 close()，确保 onclose 姗姗来迟时不会重复触发重连。
     */
    private forceDisconnect(): void {
        if (!this._ws) return;

        // 先摘除处理器，让之后到来的 onclose 变成空操作
        this._ws.onopen = null;
        this._ws.onmessage = null;
        this._ws.onerror = null;
        this._ws.onclose = null;
        try { this._ws.close(); } catch { /* ignore */ }
        this._ws = null;

        this._connected = false;
        this.clearTimers();
        Nexus.emit(NexusEvents.NET_DISCONNECTED);
        this.tryReconnect();
    }

    // ── 前后台切换 ──────────────────────────────────────────

    /** 切后台：暂停心跳和收包超时，防止后台期间误判断连 */
    private _onAppHide(): void {
        this._backgroundAt = Date.now();
        // 暂停心跳（后台发不出去）
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        // 暂停收包超时（后台不执行 JS，回前台后会立即超时误判）
        if (this._receiveTimer !== null) {
            clearTimeout(this._receiveTimer);
            this._receiveTimer = null;
        }
    }

    /** 回前台：检测连接状态，探活或重连 */
    private _onAppShow(): void {
        const backgroundMs = Date.now() - this._backgroundAt;
        this._backgroundAt = 0;

        if (!this._lastUrl) return; // 从未连接过

        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            // 连接看起来还在 → 立即发心跳探活 + 恢复定时器
            this.startHeartbeat();
            this.resetReceiveTimer();
            // 发一次心跳，Pong 回来会自动校准时间
            const hb = this._delegate?.heartbeat();
            if (hb) this._ws.send(hb);
        } else {
            // 连接已断 → 触发重连
            this._connected = false;
            this._autoReconnect = this._autoReconnectInitial;
            this.tryReconnect();
        }
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
        Nexus.off(NexusEvents.APP_HIDE, this._onAppHide, this);
        Nexus.off(NexusEvents.APP_SHOW, this._onAppShow, this);
        this.clearTimers();
        for (const requestId of this._pending.keys()) {
            this.rejectPending(requestId, '[Nexus] WS destroyed');
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
        this._connectingPromise = null;
        this._lastUrl = '';
    }
}
