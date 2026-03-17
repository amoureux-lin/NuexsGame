import type { NexusConfig } from '../core/NexusConfig';
import { ServiceBase } from '../core/ServiceBase';
import type { HttpOptions } from '../services/contracts';

/**
 * 纯 HTTP 实现：GET/POST，BaseUrl，Token，超时。
 */
export class HttpServiceImpl extends ServiceBase {
    private _baseUrl = '';
    private _token = '';
    private _timeout = 10000;

    async onBoot(config: NexusConfig): Promise<void> {
        this._timeout = config.networkTimeout;
    }

    setBaseUrl(url: string): void {
        this._baseUrl = url.replace(/\/$/, '');
    }

    setToken(token: string): void {
        this._token = token;
    }

    async get<T>(path: string, options?: HttpOptions): Promise<T> {
        return this.request<T>('GET', path, undefined, options);
    }

    async post<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>('POST', path, body);
    }

    private request<T>(
        method: string,
        path: string,
        body?: unknown,
        options?: HttpOptions,
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const url = /^https?:\/\//.test(path) ? path : `${this._baseUrl}${path}`;
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            xhr.timeout = options?.timeout ?? this._timeout;

            if (this._token) {
                xhr.setRequestHeader('Authorization', `Bearer ${this._token}`);
            }
            if (options?.headers) {
                for (const key in options.headers) {
                    if (!Object.prototype.hasOwnProperty.call(options.headers, key)) continue;
                    xhr.setRequestHeader(key, options.headers[key]);
                }
            }
            if (body !== undefined) {
                xhr.setRequestHeader('Content-Type', 'application/json');
            }

            xhr.onload = () => {
                let data: T;
                try {
                    data = JSON.parse(xhr.responseText);
                } catch {
                    data = xhr.responseText as unknown as T;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`[Nexus] HTTP ${xhr.status}: ${url}`));
                }
            };

            xhr.onerror = () => reject(new Error(`[Nexus] Network error: ${url}`));
            xhr.ontimeout = () => reject(new Error(`[Nexus] Request timeout: ${url}`));

            xhr.send(body !== undefined ? JSON.stringify(body) : null);
        });
    }

    async onDestroy(): Promise<void> {
        this._baseUrl = '';
        this._token = '';
    }
}
