import { sys } from 'cc';
import { Nexus, getQueryParam } from 'db://nexus-framework/index';
import type { ClientTraceReportEnvelope } from './ClientTraceReporter';
import { getResolvedBiHostUrl, getResolvedReportUrl } from '../../config/NetworkConfig';
import { GameEvents } from '../../config/GameEvents';

/**
 * POST 上报到 BI 埋点接口。
 * resolvedUrl 为完整 https URL，HttpServiceImpl 会跳过 baseUrl 拼接直接请求。
 */
export function postClientTraceReport(
    envelope: ClientTraceReportEnvelope,
    url?: string
): void {
    const resolvedUrl = url ?? getResolvedReportUrl();
    const body = {
        report_timestamp: envelope.report_timestamp,
        event_id: envelope.event_id,
        event_name: envelope.event_name,
        user_id: envelope.user_id,
        game_id: envelope.game_id,
        room_id: envelope.room_id,
        trace_id: envelope.trace_id,
        device_info: envelope.device_info,
        data: envelope.data,
    };
    // 本地运行只打印不上报
    const isLocal = typeof location !== 'undefined'
        && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    if (isLocal) {
        console.log('[ClientTrace] 本地环境，仅打印 →', resolvedUrl, 'trace_id:', envelope.trace_id, body);
        return;
    }

    Nexus.net.post(resolvedUrl, body).then(() => {
        console.log('[ClientTrace] 上报成功', envelope.trace_id);
    }).catch((err) => {
        console.warn('[ClientTrace] 上报失败', err);
    });
}

// ── BI 业务事件上报 ───────────────────────────────────────────

/** common 字段结构：与后端约定 */
interface BiEventCommonInfo {
    url: string;
    browser: string;
    browser_version: string;
    os: string;
    device: string;
    source: string;
}

function buildBiEventCommon(): string {
    const info: BiEventCommonInfo = {
        url: typeof location !== 'undefined' ? location.href : '',
        browser: sys.browserType ?? '',
        browser_version: sys.browserVersion ?? '',
        os: sys.os ?? '',
        device: typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : '',
        source: 'game_client',
    };
    return JSON.stringify(info);
}

/**
 * 客户端资源加载完成上报（BI_EVENT_TYPE_GAME_LOAD_COMPLETE）。
 * trace_id 强制来源于 URL 参数 ?trace_id=xxx；URL 上未携带时直接跳过上报。
 */
export function postGameLoadCompleteReport(): void {
    const traceId = getQueryParam('trace_id') ?? '';
    if (!traceId) {
        console.log('[BiEvent] URL 无 trace_id 参数，跳过加载完成上报');
        return;
    }

    const url = getResolvedBiHostUrl() + GameEvents.HTTP_REPORT_BI_EVENT;
    const userId = Number(Nexus.data.get('user_id')) || 0;
    const gameId = Number(getQueryParam('game_id')) || 0;
    const roomId = Number(getQueryParam('room_id')) || 0;

    const body = {
        event_type: 'BI_EVENT_TYPE_GAME_LOAD_COMPLETE',
        user_id: userId,
        trace_id: traceId,
        common: buildBiEventCommon(),
        game_load_complete: {
            game_id: gameId,
            room_id: roomId,
        },
    };

    // 本地运行只打印不上报
    const isLocal = typeof location !== 'undefined'
        && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    if (isLocal) {
        console.log('[BiEvent] 本地环境，仅打印 →', url, body);
        return;
    }

    Nexus.net.post(url, body).then(() => {
        console.log('[BiEvent] 加载完成上报成功 trace_id:', traceId);
    }).catch((err) => {
        console.warn('[BiEvent] 加载完成上报失败', err);
    });
}
