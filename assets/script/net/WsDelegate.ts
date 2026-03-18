/**
 * 业务 WS 委托实现：
 * - 16 字节 header + proto/JSON body 编解码
 * - 心跳使用 gateway.proto 的 PingMessage
 * - willSend：追加公共字段（token 等）
 * - willReceive：过滤心跳响应、全局日志
 * - onServerError：错误码统一弹窗处理
 * - 连接状态回调：Loading UI 反馈
 */
import type { DecodedPacket, IWsDelegate, WsSendContext } from 'db://nexus-framework/index';
import { Nexus } from 'db://nexus-framework/index';
import { MessageType } from '../proto/message_type';
import type { PingMessage } from '../proto/gateway';
import { CommonUI } from '../config/UIConfig';

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
        // 过滤心跳响应，不分发给业务
        if (pkt.msgType === HEARTBEAT_RES) {
            console.log('【ws】心跳响应：', pkt);
            return true;
        }

        // 服务端错误码：业务决定什么是错误、如何展示
        if ((pkt.errorCode ?? 0) !== 0) {
            console.warn('[WsDelegate] 服务端错误码：', pkt.errorCode, pkt);
            Nexus.ui.show(CommonUI.ALERT, { message: `错误码: ${pkt.errorCode}` });
            return new Error(`Server error: ${pkt.errorCode}`);
        }

        console.log('【ws】收到消息：', pkt.msgType, pkt);
    }

    // ── 连接状态 ───────────────────────────────────────────

    onConnected(): void {
        console.log('【ws】连接成功');
        Nexus.ui.hideLoading();
    }

    onDisconnected(): void {
        console.log('【ws】连接断开，重连次数耗尽');
        Nexus.ui.hideLoading();
        Nexus.ui.show(CommonUI.ALERT, {
            content: '连接断开',
            showIcon: true,
            confirmText: '知道了',
        });
    }

    onReconnecting(attemptsLeft: number): void {
        console.log(`重连中，剩余 ${attemptsLeft} 次`);
        Nexus.ui.showLoading(`重连中，剩余 ${attemptsLeft} 次`)
    }

    onConnectError(error: unknown): void {
        console.warn('[WsDelegate] 连接错误：', error);
    }
}
