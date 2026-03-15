/**
 * Proto 消息类型映射：运行时一张表，项目启动注册公共、子游戏 Loading 时注册子游戏。
 * 由 getDecoder / getEncoder 查表，供 WS 收发包解码编码用。
 */

export type ProtoDecoder = (bytes: Uint8Array) => unknown;
export type ProtoEncoder = (msg: unknown) => Uint8Array;

/** 单条消息的编解码，与生成脚本产出的 registry 对象项一致 */
export interface MessageMapping {
    decode: ProtoDecoder;
    encode: ProtoEncoder;
    name?: string;
}

export class ProtoManager {
    private static _table: Record<number, MessageMapping> = {};

    /** 项目启动时调用：只注册公共/房间的映射 */
    static registerCommon(registry: Record<number, MessageMapping>): void {
        ProtoManager._table = { ...registry };
        console.log('ProtoManager._table', ProtoManager._table);
    }

    /** 子游戏 Loading 里调用：把该子游戏的映射合并进当前表 */
    static registerSubgame(registry: Record<number, MessageMapping>): void {
        ProtoManager._table = { ...ProtoManager._table, ...registry };
    }

    static getDecoder(msgType: number): ProtoDecoder | undefined {
        return ProtoManager._table[msgType]?.decode;
    }

    static getEncoder(msgType: number): ProtoEncoder | undefined {
        return ProtoManager._table[msgType]?.encode;
    }

    static has(msgType: number): boolean {
        return msgType in ProtoManager._table;
    }
}
