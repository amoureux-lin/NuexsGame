import {logger, Nexus} from 'db://nexus-framework/index';
import { CommonUI } from '../config/UIConfig';
import { WebSDKBridge } from '../lib/websdk/WebSDKBridge';

/** CSV 中 type 字段允许的值 */
type ErrorDisplayType = 'popup' | 'popup_close' | 'recharge' | 'toast' | 'silent';

/**
 * 错误码统一处理器。
 *
 * 数据来源：`Nexus.configs.getCSVRows('errorCodes')`（启动时已加载 error_codes.csv）。
 * 展示规则由 CSV 的 type 列驱动：
 *   toast       — 底部轻提示（自动消失）
 *   popup       — 弹框提示（不关闭游戏）
 *   popup_close — 弹框提示（关闭游戏）
 *   recharge    — 充值专用弹框
 *   silent      — 仅打 log，不展示任何 UI
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
            case 'popup_close':
                Nexus.ui.show(CommonUI.ALERT, { content: msg, onConfirm: () => { WebSDKBridge.getInstance().requestPlatformExit(); } });
                break;
            case 'recharge':
                WebSDKBridge.getInstance().notifyBankrupt();
                break;
            case 'toast':
                Nexus.toast.error(msg);
                break;
            case 'silent':
            default:
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
        const codeStr = String(code);
        const translated = Nexus.i18n.t(codeStr);
        // i18n 找到翻译则使用（translated !== codeStr 说明有匹配）
        if (translated !== codeStr) return translated;
        // 降级：用 CSV 中的 extra 描述
        if (entry?.extra) return entry.extra;
        // 兜底
        return Nexus.i18n.t('error.unknown', { code });
    }
}
