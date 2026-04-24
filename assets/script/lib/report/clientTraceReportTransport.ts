import { Nexus } from 'db://nexus-framework/index';
import type { ClientTraceReportEnvelope } from './ClientTraceReporter';
import { getResolvedReportUrl } from '../../config/GameNetworkConfig';

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
        ts: envelope.report_timestamp,
        event_id: envelope.event_id,
        event_name: envelope.event_name,
        user_id: envelope.user_id,
        game_id: envelope.game_id,
        room_id: envelope.room_id,
        trace_id: envelope.trace_id,
        device_info: envelope.device_info,
        data: envelope.data,
    };
    Nexus.net.post(resolvedUrl, body).catch((err) => {
        console.warn('[ClientTrace] 上报失败', err);
    });
}
