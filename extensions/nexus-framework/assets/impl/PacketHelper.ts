import type { DecodedPacket, IWsDelegate, WsSendContext } from '../services/contracts';

/**
 * 默认 WS 委托实现：16 字节 header（length, msgType, requestId, errorCode）+ JSON body。
 * 业务可继承此类覆写所需方法，或完全自行实现 IWsDelegate。
 */
export class PacketHelper implements IWsDelegate {

    // ── Codec ─────────────────────────────────────────────

    encode(ctx: WsSendContext): Uint8Array {
        const payloadJson = JSON.stringify(ctx.body ?? {});
        const payload = new TextEncoder().encode(payloadJson);

        const header = new ArrayBuffer(16);
        const view = new DataView(header);
        view.setUint32(0, payload.length, true);
        view.setUint32(4, ctx.msgType, true);
        view.setUint32(8, ctx.requestId, true);
        view.setUint32(12, 0, true); // 客户端发包 errorCode 固定 0

        const result = new Uint8Array(16 + payload.length);
        result.set(new Uint8Array(header), 0);
        result.set(payload, 16);
        return result;
    }

    decode(data: Uint8Array | string): DecodedPacket | null {
        // 文本帧：JSON 协议，字段名由业务约定
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

        // 二进制帧：16 字节 header + JSON body
        if (data.byteLength < 16) return null;
        const view = new DataView(data.buffer, data.byteOffset, 16);
        const length = view.getUint32(0, true);
        const msgType = view.getUint32(4, true);
        const requestId = view.getUint32(8, true);
        const errorCode = view.getUint32(12, true);

        const payload = data.subarray(16, 16 + length);
        const json = new TextDecoder().decode(payload);
        let body: unknown = json;
        try {
            body = JSON.parse(json);
        } catch {
            // keep string
        }

        return { msgType, requestId, errorCode, body };
    }

    heartbeat(): Uint8Array | null {
        return null; // 业务子类可覆写
    }
}
