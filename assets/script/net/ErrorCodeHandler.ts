import {logger, Nexus} from 'db://nexus-framework/index';
import { CommonUI } from '../config/UIConfig';

/** CSV 中 type 字段允许的值 */
type ErrorDisplayType = 'popup' | 'toast' | 'silent';

/**
 * 错误码统一处理器。
 *
 * 数据来源：`Nexus.configs.getCSVRows('errorCodes')`（启动时已加载 error_codes.csv）。
 * 展示规则由 CSV 的 type 列驱动：
 *   popup  — 弹出 Alert 面板（需要用户确认）
 *   toast  — 底部轻提示（自动消失）
 *   silent — 仅打 log，不展示任何 UI（调用方自行 catch 处理）
 *
 * 调用方（WsDelegate / HTTP 拦截器 / wsRequest catch 块）只需：
 *   ErrorCodeHandler.handle(code);
 */
export class ErrorCodeHandler {

    private static _rowMap: Map<string, Record<string, string>> | null = null;

    /**
     * 处理一个服务端错误码。
     * @param code      服务端错误码（number）
     * @param fallback  未在 CSV 中找到时的降级展示方式（默认 'toast'）
     */
    static handle(code: number, fallback: ErrorDisplayType = 'toast'): void {
        const entry = ErrorCodeHandler._getEntry(String(code));
        const type  = (entry?.type as ErrorDisplayType) ?? fallback;
        const msg   = ErrorCodeHandler._resolveMsg(code, entry);

        console.warn('[ErrorCode]', code, type, msg);

        switch (type) {
            case 'popup':
                Nexus.ui.show(CommonUI.ALERT, { content: msg });
                break;
            case 'toast':
                Nexus.toast.error(msg);
                break;
            case 'silent':
            default:
                // 静默：只记录日志，不展示 UI
                logger.error(msg);
                break;
        }
    }

    /**
     * 判断某个错误码是否应该 reject 对应的 wsRequest Promise。
     * silent 类型的错误码通常只是通知，调用方自行决定；其余一律 reject。
     * 默认全部 reject（返回 true）。
     */
    static shouldReject(code: number): boolean {
        const entry = ErrorCodeHandler._getEntry(String(code));
        return (entry?.type as ErrorDisplayType) !== 'silent';
    }

    /** 清除行索引缓存（配置重载后调用）。 */
    static invalidateCache(): void {
        ErrorCodeHandler._rowMap = null;
    }

    // ── 私有 ──────────────────────────────────────────────────────────────────

    private static _getEntry(code: string): Record<string, string> | undefined {
        if (!ErrorCodeHandler._rowMap) {
            ErrorCodeHandler._rowMap = new Map(
                Nexus.configs.getCSVRows('errorCodes').map(r => [r.code, r]),
            );
        }
        return ErrorCodeHandler._rowMap.get(code);
    }

    private static _resolveMsg(code: number, entry: Record<string, string> | undefined): string {
        if (!entry) return `错误码: ${code}`;
        const key = entry.i18nKey;
        // i18n 服务接入后可替换为：Nexus.i18n.t(key)
        // 目前降级展示 i18nKey 本身（便于开发期快速定位）
        return key || `错误码: ${code}`;
    }
}
