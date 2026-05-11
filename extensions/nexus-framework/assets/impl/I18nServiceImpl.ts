import { JsonAsset } from 'cc';
import type { NexusConfig } from '../core/NexusConfig';
import { Nexus } from '../core/Nexus';
import { II18nService } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';
import { getQueryParam } from '../utils/url';

/**
 * 基于 JsonAsset 的国际化实现。
 *
 * 语言文件约定：每种语言是一个独立 Bundle。
 * - assets/languages/{lang}/common/{lang}.json
 * - assets/languages/{lang}/{bundleName}/{lang}.json
 *
 * 插值格式：{key}，例如 "分数：{score}"，调用 t('ui.score', { score: 100 })
 */
export class I18nServiceImpl extends II18nService {

    private _language     = 'en_US';
    private _translations: Record<string, string> = {};
    private _commonTranslations: Record<string, string> = {};
    private _activeBundleName = '';
    private _activeBundleTranslations: Record<string, string> = {};
    private readonly _languages = new Set<string>();

    /** 初始化支持语言列表，并加载默认语言包。 */
    async onBoot(config: NexusConfig): Promise<void> {
        this._languages.clear();
        for (const lang of config.languages) {
            this._languages.add(lang);
        }
        this._language = this.resolveInitialLanguage(config);
        await this.reloadTranslations();
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
        await this.reloadTranslations();
        Nexus.emit(NexusEvents.LANGUAGE_CHANGED, { language: lang });
    }

    /** 加载公共翻译表。 */
    async loadCommonTranslations(): Promise<void> {
        this._commonTranslations = await this.loadTranslationsForBundle(this._language, 'common');
        this.rebuildTranslations();
    }

    /** 加载指定业务 bundle 的翻译表，并替换当前业务翻译缓存。 */
    async loadBundleTranslations(bundleName: string): Promise<void> {
        const name = bundleName.trim();
        if (!name) return;
        if (name === 'common') {
            this._activeBundleName = '';
            this._activeBundleTranslations = {};
            await this.loadCommonTranslations();
            return;
        }

        this._activeBundleName = name;
        this._activeBundleTranslations = await this.loadTranslationsForBundle(this._language, name);
        this.rebuildTranslations();
    }

    /** 返回当前语言代码。 */
    get language(): string {
        return this._language;
    }

    // ── 私有工具 ─────────────────────────────────────

    /** 从语言 Bundle 读取 common 和当前业务 bundle 的翻译 JSON。 */
    private async reloadTranslations(): Promise<void> {
        const lang = this._language;
        this._commonTranslations = await this.loadTranslationsForBundle(lang, 'common');
        this._activeBundleTranslations = this._activeBundleName
            ? await this.loadTranslationsForBundle(lang, this._activeBundleName)
            : {};

        this.rebuildTranslations();
    }

    private rebuildTranslations(): void {
        const next: Record<string, string> = {};
        Object.assign(next, this._commonTranslations);
        Object.assign(next, this._activeBundleTranslations);

        this._translations = next;
    }

    /** 从 assets/languages/{lang}/{bundleName}/{lang}.json 读取翻译表。 */
    private async loadTranslationsForBundle(lang: string, bundleName: string): Promise<Record<string, string>> {
        try {
            const asset = await Nexus.asset.load<JsonAsset>(lang, `${bundleName}/${lang}`, JsonAsset);
            return (asset.json ?? {}) as Record<string, string>;
        } catch (e) {
            console.warn(`[Nexus] Failed to load i18n ${lang}/${bundleName}/${lang}, falling back to key passthrough.`, e);
            return {};
        }
    }

    private resolveInitialLanguage(config: NexusConfig): string {
        const fromUrl = this.normalizeLanguage(
            getQueryParam('lang')
            ?? getQueryParam('language')
            ?? getQueryParam('locale')
            ?? '',
        );
        if (fromUrl && this._languages.has(fromUrl)) {
            return fromUrl;
        }

        if (fromUrl) {
            console.warn(`[Nexus] Unsupported URL language: ${fromUrl}, fallback to ${config.defaultLanguage}.`);
        }

        return config.defaultLanguage;
    }

    private normalizeLanguage(lang: string): string {
        return lang.trim().replace(/-/g, '_');
    }
}
