/**
 * 客户端进游戏等关键链路的结构化轨迹采集与上报（骨架）。
 * 在各阶段调用 step / fail；具体上报实现由 setReportHandler 注入。
 */

import { Nexus } from 'db://nexus-framework/index';

/** 建议与后端约定：阶段名用稳定枚举，便于统计 */
export const ClientTracePhase = {
    SESSION_START: 'session_start', //会话开始
    HTTP_INIT: 'http_init', //HTTP初始化
    /** HTTP 请求失败（业务码非 0 / 网络错误等，见 fail 或 step.detail） */
    HTTP_ERROR: 'http_error',
    LOAD_RESOURCE: 'load_resource', //加载资源
    WS_CONNECT: 'ws_connect', //WebSocket连接
    /** 底层 WebSocket onclose（含 code / reason，见 step.detail） */
    WS_CLOSE: 'ws_close',
    /** WS 已发出请求（cmd 见 step.detail） */
    WS_REQ_SEND: 'ws_req_send',
    /** WS 收到包头合法且业务分发成功的响应（cmd 见 step.detail） */
    WS_RSP_OK: 'ws_rsp_ok',
    /** 包头 errorCode !== 0（错误码见 step.detail） */
    WS_HEADER_ERROR: 'ws_header_error',
    /** 断线且不再自动重连（终态：重连耗尽 / 未开启重连 / 主动拒绝等，见 detail） */
    WS_GIVE_UP: 'ws_give_up',
    JOIN_ROOM: 'join_room', //加入房间
    ENTER_SCENE: 'enter_scene', //进入场景
} as const;

export type ClientTracePhaseKey = (typeof ClientTracePhase)[keyof typeof ClientTracePhase];

export interface ClientTraceStep {
    phase: string;
    offset_ms: number;
    ok?: boolean;
    detail?: string;
}

export interface ClientTerminalError {
    category: string;
    code?: string;
    message?: string;
    last_successful_phase?: string;
}

const MAX_STEPS = 30;

export type ClientTraceReportHandler = (envelope: ClientTraceReportEnvelope) => void;

/** 与约定对齐的外层结构；device_info / data 为 JSON 字符串 */
export interface ClientTraceReportEnvelope {
    report_timestamp: number;
    event_id: number;
    event_name: string;
    user_id: number;
    game_id: number;
    room_id: string | number;
    trace_id: string;
    device_info: string;
    data: string;
}

export class ClientTraceReporter {
    private static _instance: ClientTraceReporter | null = null;

    public static getInstance(): ClientTraceReporter {
        if (!this._instance) {
            this._instance = new ClientTraceReporter();
        }
        return this._instance;
    }

    private traceId = '';
    private startedAt = 0;
    private steps: ClientTraceStep[] = [];
    private reportHandler: ClientTraceReportHandler | null = null;

    /** 默认事件，可按业务替换 */
    public eventId = 1001;
    public eventName = 'client_trace';

    private constructor() {}

    /** 由上层注入：HTTP、postMessage 或壳子上报 */
    public setReportHandler(handler: ClientTraceReportHandler | null): void {
        this.reportHandler = handler;
    }

    public startSession(): void {
        this.traceId = this._genTraceId();
        this.startedAt = Date.now();
        this.steps = [];
        this.step(ClientTracePhase.SESSION_START, { ok: true });
    }

    public getTraceId(): string {
        return this.traceId;
    }

    public step(phase: string, extra?: { ok?: boolean; detail?: string }): void {
        if (!this.traceId) {
            this.startSession();
        }
        if (this.steps.length >= MAX_STEPS) {
            return;
        }
        const offset_ms = this.startedAt ? Date.now() - this.startedAt : 0;
        this.steps.push({
            phase,
            offset_ms,
            ok: extra?.ok,
            detail: extra?.detail ? this._truncate(extra.detail, 256) : undefined,
        });
    }

    public succeed(): void {
        const payload = {
            flow: 'enter_game',
            steps: this.steps,
        };
        const envelope = this._buildEnvelope(payload);
        this.reportHandler?.(envelope);
        this._reset();
    }

    public fail(terminal: ClientTerminalError): void {
        const lastOk = [...this.steps].reverse().find((s) => s.ok !== false);
        const payload = {
            flow: 'enter_game',
            steps: this.steps,
            terminal_error: {
                ...terminal,
                last_successful_phase: terminal.last_successful_phase ?? lastOk?.phase,
            },
        };
        const envelope = this._buildEnvelope(payload);
        this.reportHandler?.(envelope);
        this._reset();
    }

    private _reset(): void {
        this.traceId = '';
        this.startedAt = 0;
        this.steps = [];
    }

    private _buildEnvelope(dataObj: object): ClientTraceReportEnvelope {
        return {
            report_timestamp: Date.now(),
            event_id: this.eventId,
            event_name: this.eventName,
            user_id: Number(Nexus.data.get('user_id')) || 0,
            game_id: Number(Nexus.data.get('game_id')) || 0,
            room_id: Nexus.data.get<string | number>('room_id') ?? '',
            trace_id: this.traceId,
            device_info: JSON.stringify(Nexus.data.get('client_device_info') ?? {}),
            data: JSON.stringify(dataObj),
        };
    }

    /** 在 fail / succeed 前写入设备信息，会随 envelope 一起上报 */
    public setDeviceInfoForNextReport(info: object): void {
        Nexus.data.set('client_device_info', info);
    }

    private _genTraceId(): string {
        return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    private _truncate(s: string, max: number): string {
        return s.length <= max ? s : `${s.slice(0, max)}…`;
    }
}
