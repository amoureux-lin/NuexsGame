/**
 * 业务 WS 委托实现：
 * - 16 字节 header + proto/JSON body 编解码
 * - 心跳使用 gateway.proto 的 PingMessage
 * - willSend：追加公共字段（token 等）
 * - willReceive：过滤心跳响应、全局日志
 * - onServerError：错误码统一弹窗处理
 * - 连接状态回调：Loading UI 反馈
 */
import type { DecodedPacket, IWsDelegate, WsSendContext, WsCloseInfo } from 'db://nexus-framework/index';
import { Nexus } from 'db://nexus-framework/index';
import { MessageType } from '../proto/message_type';
import type { PingMessage, PongMessage } from '../proto/gateway';
import { CommonUI } from '../config/UIConfig';
import { ErrorCodeHandler } from './ErrorCodeHandler';
import { ClientTraceReporter, ClientTracePhase } from '../lib/report/ClientTraceReporter';
import type { BaseLoadingView } from '../base/BaseLoadingView';

const HEADER_SIZE = 16;
const HEARTBEAT_RES = MessageType.GATEWAY_PONG_RES;

/** WS 协议委托：16字节头 + Proto/JSON 负载编解码 */
export class WsDelegate implements IWsDelegate {

    // ── Codec ─────────────────────────────────────────────

    encode(ctx: WsSendContext): Uint8Array {
        const encoder = Nexus.proto.getEncoder(ctx.msgType);
        let payload: Uint8Array;
        if (encoder) {
            try {
                payload = encoder(ctx.body);
            } catch (e) {
                console.warn('[WsDelegate] encode failed, fallback JSON', ctx.msgType, e);
                payload = new TextEncoder().encode(JSON.stringify(ctx.body ?? {}));
            }
        } else {
            payload = new TextEncoder().encode(JSON.stringify(ctx.body ?? {}));
        }

        const header = new ArrayBuffer(HEADER_SIZE);
        const view = new DataView(header);
        view.setUint32(0, payload.length, true);
        view.setUint32(4, ctx.msgType, true);
        view.setUint32(8, ctx.requestId, true);
        view.setUint32(12, 0, true); // 客户端发包 errorCode 固定 0

        const result = new Uint8Array(HEADER_SIZE + payload.length);
        result.set(new Uint8Array(header), 0);
        result.set(payload, HEADER_SIZE);
        return result;
    }

    decode(data: Uint8Array | string): DecodedPacket | null {
        // 文本帧：JSON 协议
        if (typeof data === 'string') {
            try {
                const msg = JSON.parse(data);
                const msgType = msg?.cmd ?? msg?.type ?? msg?.msgType;
                if (msgType == null) return null;
                return { msgType, requestId: 0, errorCode: 0, body: msg };
            } catch {
                return null;
            }
        }

        // 二进制帧：16 字节 header + proto/JSON body
        if (data.byteLength < HEADER_SIZE) return null;
        const view = new DataView(data.buffer, data.byteOffset, HEADER_SIZE);
        const length = view.getUint32(0, true);
        const msgType = view.getUint32(4, true);
        const requestId = view.getUint32(8, true);
        const errorCode = view.getUint32(12, true);

        const payload = data.subarray(HEADER_SIZE, HEADER_SIZE + length);
        const decoder = Nexus.proto.getDecoder(msgType);
        let body: unknown;
        if (decoder) {
            try {
                body = decoder(payload);
            } catch (e) {
                console.warn('[WsDelegate] decode failed, fallback JSON', msgType, e);
            }
        }
        if (body === undefined) {
            const json = new TextDecoder().decode(payload);
            try {
                body = JSON.parse(json);
            } catch {
                body = json;
            }
        }

        return { msgType, requestId, errorCode, body };
    }

    heartbeat(): Uint8Array | null {
        const body: PingMessage = {
            timestamp: new Date(),
            clientId: 'game_client_' + (Nexus.data.get<string | number>('user_id') ?? 'client'),
        };
        return this.encode({
            msgType: MessageType.GATEWAY_PING_REQ,
            requestId: 0,
            body,
            extra: {},
        });
    }

    // ── 发包拦截 ───────────────────────────────────────────

    willSend(ctx: WsSendContext): void {
        // 追加 token 等公共字段，encode 时可从 ctx.extra 读取写入 header
        const token = Nexus.data.get<string>('token');
        if (token) ctx.extra.token = token;
    }

    // ── 收包拦截 ───────────────────────────────────────────

    willReceive(pkt: DecodedPacket): true | Error | void {
        // 过滤心跳响应：校准服务端时间，不分发给业务
        if (pkt.msgType === HEARTBEAT_RES) {
            const pong = pkt.body as PongMessage;
            if (pong?.timestamp) {
                const serverTimeSec = Math.floor(new Date(pong.timestamp).getTime() / 1000);
                const rttMs = pong.roundTripTimeMs ?? 0;
                Nexus.time.calibrate(serverTimeSec, rttMs);
            }
            return true;
        }

        // 服务端错误码：交由 ErrorCodeHandler 按 CSV 配置决定展示方式
        if ((pkt.errorCode ?? 0) !== 0) {
            const code = pkt.errorCode!;
            ErrorCodeHandler.handle(code);
            // 带 requestId 的包是某个 wsRequest 的响应；即使错误展示类型是 silent，
            // 也必须 reject，避免空 RES 被当作成功结果继续更新本地 Model。
            if (pkt.requestId) return new Error(`server:${code}`);
            return ErrorCodeHandler.shouldReject(code)
                ? new Error(`server:${code}`)
                : true;
        }

        console.log('【ws】收到消息：', pkt.msgType, pkt);
    }

    // ── 连接状态 ───────────────────────────────────────────

    onConnected(): void {
        console.log('【ws】连接成功');
        ClientTraceReporter.getInstance().step(ClientTracePhase.WS_CONNECT, { ok: true });
        // 游戏中重连成功才隐藏 netLoading；进房阶段由 BaseLoadingView 覆盖
        if (!Nexus.data.get('_entering')) {
            Nexus.ui.hideLoading();
        }
    }

    onDisconnected(closeInfo?: WsCloseInfo): void {
        console.log('【ws】连接断开，重连次数耗尽');
        const closeMeta = closeInfo ? { code: closeInfo.code, reason: closeInfo.reason, wasClean: closeInfo.wasClean } : undefined;
        const trace = ClientTraceReporter.getInstance();
        trace.step(ClientTracePhase.WS_GIVE_UP, {
            ok: false,
            detail: 'reconnect_exhausted',
            meta: closeMeta,
        });
        trace.fail({
            category: 'ws_disconnect',
            code: String(closeInfo?.code ?? 'unknown'),
            message: closeInfo?.reason || '重连次数耗尽',
            meta: closeMeta,
        });
        if (Nexus.data.get('_entering')) {
            // 进房阶段：更新 loading 文字为连接失败
            const loadingView = Nexus.data.get<BaseLoadingView>('_loadingView');
            loadingView?.setTip(Nexus.i18n.t('loading.connect_failed'));
        } else {
            // 游戏中断线：隐藏 netLoading
            Nexus.ui.hideLoading();
        }
        Nexus.ui.show(CommonUI.ALERT, {
            content: Nexus.i18n.t('loading.disconnect'),
            showIcon: true,
            confirmText: Nexus.i18n.t('common.confirm'),
        });
    }

    onReconnecting(attemptsLeft: number, closeInfo?: WsCloseInfo): void {
        console.log(`重连中，剩余 ${attemptsLeft} 次`);
        const closeMeta = closeInfo ? { code: closeInfo.code, reason: closeInfo.reason, wasClean: closeInfo.wasClean } : undefined;
        ClientTraceReporter.getInstance().step(ClientTracePhase.WS_CLOSE, {
            ok: false,
            detail: `reconnecting, left: ${attemptsLeft}`,
            meta: closeMeta,
        });
        const tip = Nexus.i18n.t('loading.reconnecting', { left: attemptsLeft });
        if (Nexus.data.get('_entering')) {
            // 进房阶段：只更新 BaseLoadingView 文字，不弹 netLoading
            const loadingView = Nexus.data.get<BaseLoadingView>('_loadingView');
            loadingView?.setTip(tip);
        } else {
            // 游戏中：弹 netLoading
            Nexus.ui.showLoading(tip);
        }
    }

    onConnectError(error: unknown): void {
        console.warn('[WsDelegate] 连接错误：', error);
        ClientTraceReporter.getInstance().step(ClientTracePhase.WS_CLOSE, { ok: false, detail: String(error) });
    }
}
