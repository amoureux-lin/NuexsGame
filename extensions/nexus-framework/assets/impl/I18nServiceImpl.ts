import { JsonAsset } from 'cc';
import type { NexusConfig } from '../core/NexusConfig';
import { Nexus } from '../core/Nexus';
import { II18nService } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';

/**
 * 基于 JsonAsset 的国际化实现。
 *
 * 语言文件约定：存放于 common Bundle 的 i18n/<lang>.json，
 * 例如 common/assets/i18n/zh_CN.json。
 *
 * 插值格式：{key}，例如 "分数：{score}"，调用 t('ui.score', { score: 100 })
 */
export class I18nServiceImpl extends II18nService {

    private _language     = 'en_US';
    private _translations: Record<string, string> = {};
    private readonly _languages = new Set<string>();

    /** 初始化支持语言列表，并加载默认语言包。 */
    async onBoot(config: NexusConfig): Promise<void> {
        this._languages.clear();
        for (const lang of config.languages) {
            this._languages.add(lang);
        }
        this._language = config.defaultLanguage;
        await this.loadTranslations(this._language);
    }

    /** 翻译 key，并按 {name} 形式替换插值参数。 */
    t(key: string, params?: Record<string, unknown>): string {
        let text = this._translations[key] ?? key;
        if (params) {
            for (const name of Object.keys(params)) {
                text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(params[name]));
            }
        }
        return text;
    }

    /** 切换当前语言并重新加载翻译表。 */
    async switchLanguage(lang: string): Promise<void> {
        if (!this._languages.has(lang)) {
            console.error(`[Nexus] Unsupported language: ${lang}`);
            return;
        }
        this._language = lang;
        await this.loadTranslations(lang);
        Nexus.emit(NexusEvents.LANGUAGE_CHANGED, { language: lang });
    }

    /** 返回当前语言代码。 */
    get language(): string {
        return this._language;
    }

    // ── 私有工具 ─────────────────────────────────────

    /** 从 common Bundle 读取指定语言的翻译 JSON。 */
    private async loadTranslations(lang: string): Promise<void> {
        try {
            const asset = await Nexus.asset.load<JsonAsset>('common', `i18n/${lang}`, JsonAsset);
            this._translations = (asset.json ?? {}) as Record<string, string>;
        } catch (e) {
            console.warn(`[Nexus] Failed to load i18n/${lang}, falling back to key passthrough.`, e);
            this._translations = {};
        }
    }
}
