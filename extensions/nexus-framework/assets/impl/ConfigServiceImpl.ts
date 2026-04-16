import { TextAsset } from 'cc';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { IAssetService, IConfigService } from '../services/contracts';

/**
 * IConfigService 实现：运行时加载 CSV / JSON 并缓存到内存。
 *
 * CSV 规则：
 *   - 第一行为列名（header）
 *   - 每行解析为一个 Record<string, string>，key 为列名
 *   - 支持双引号包裹字段（字段内含逗号或换行时）
 *   - 支持 "" 转义为 "
 *   - 忽略空行与 # 开头的注释行
 */
export class ConfigServiceImpl extends IConfigService {

    private readonly _csvCache = new Map<string, Record<string, string>[]>();
    private readonly _jsonCache = new Map<string, unknown>();

    // ── IConfigService ────────────────────────────────────────────────────────

    async loadCSV(key: string, bundle: string, path: string): Promise<void> {
        const asset = await ServiceRegistry.get(IAssetService).load<TextAsset>(bundle, path, TextAsset);
        this._csvCache.set(key, this._parseCSV(asset.text ?? ''));
    }

    async loadJSON<T = unknown>(key: string, bundle: string, path: string): Promise<void> {
        const asset = await ServiceRegistry.get(IAssetService).load<TextAsset>(bundle, path, TextAsset);
        this._jsonCache.set(key, JSON.parse(asset.text ?? '{}') as T);
    }

    getCSVRows(key: string): Record<string, string>[] {
        return this._csvCache.get(key) ?? [];
    }

    getJSON<T = unknown>(key: string): T | undefined {
        return this._jsonCache.get(key) as T | undefined;
    }

    isLoaded(key: string): boolean {
        return this._csvCache.has(key) || this._jsonCache.has(key);
    }

    clear(key?: string): void {
        if (key === undefined) {
            this._csvCache.clear();
            this._jsonCache.clear();
        } else {
            this._csvCache.delete(key);
            this._jsonCache.delete(key);
        }
    }

    // ── CSV 解析 ──────────────────────────────────────────────────────────────

    private _parseCSV(text: string): Record<string, string>[] {
        // 统一换行符
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        if (lines.length === 0) return [];

        // 找到第一行有效 header（跳过空行与注释行）
        let headerIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t && !t.startsWith('#')) { headerIdx = i; break; }
        }
        if (headerIdx < 0) return [];

        const headers = this._splitCSVLine(lines[headerIdx]);
        const rows: Record<string, string>[] = [];

        for (let i = headerIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const values = this._splitCSVLine(line);
            const row: Record<string, string> = {};
            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = values[j] ?? '';
            }
            rows.push(row);
        }

        return rows;
    }

    /**
     * 将一行 CSV 分割为字段数组。
     * 支持双引号包裹：`"a,b"` → `a,b`；`""` 转义 → `"`。
     */
    private _splitCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // 双引号转义
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }

        result.push(current.trim());
        return result;
    }
}
