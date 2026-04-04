import type { NexusConfig } from '../core/NexusConfig';
import { ServiceBase } from '../core/ServiceBase';
import type { HttpOptions } from '../services/contracts';

/**
 * 纯 HTTP 实现：GET/POST，BaseUrl，Token，超时，重试。
 */
export class HttpServiceImpl extends ServiceBase {
    private _baseUrl = '';
    private _token = '';
    private _timeout = 10000;
    /** 当前活跃的 XHR 实例，用于 cancelAllHttpRequests */
    private readonly _activeXhrs = new Set<XMLHttpRequest>();

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
        return this.requestWithRetry<T>('GET', path, undefined, options);
    }

    async post<T>(path: string, body?: unknown, options?: HttpOptions): Promise<T> {
        return this.requestWithRetry<T>('POST', path, body, options);
    }

    /**
     * 带重试的请求入口：失败后按指数退避重试。
     * 仅网络错误和超时会重试，HTTP 4xx/5xx 不重试（业务错误重试无意义）。
     */
    private async requestWithRetry<T>(
        method: string,
        path: string,
        body?: unknown,
        options?: HttpOptions,
    ): Promise<T> {
        const maxRetry = options?.retry ?? 0;
        const baseDelay = options?.retryDelay ?? 1000;
        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetry; attempt++) {
            try {
                return await this.request<T>(method, path, body, options);
            } catch (err) {
                lastError = err;
                // 仅网络错误和超时重试，HTTP 状态码错误不重试
                const isRetryable = typeof err === 'string'
                    && (err.includes('Network error') || err.includes('Request timeout'));
                if (!isRetryable || attempt >= maxRetry) break;

                const delay = baseDelay * Math.pow(2, attempt);
                console.warn(`[Nexus] HTTP retry ${attempt + 1}/${maxRetry} in ${delay}ms`);
                await this.sleep(delay);
            }
        }

        return Promise.reject(lastError);
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

            this._activeXhrs.add(xhr);

            const cleanup = () => this._activeXhrs.delete(xhr);

            xhr.onload = () => {
                cleanup();
                let data: T;
                try {
                    data = JSON.parse(xhr.responseText);
                } catch {
                    data = xhr.responseText as unknown as T;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(data);
                } else {
                    const msg = `[Nexus] HTTP ${xhr.status}: ${url}`;
                    console.error(msg);
                    reject(msg);
                }
            };

            xhr.onerror = () => { cleanup(); const msg = `[Nexus] Network error: ${url}`; console.error(msg); reject(msg); };
            xhr.ontimeout = () => { cleanup(); const msg = `[Nexus] Request timeout: ${url}`; console.error(msg); reject(msg); };
            xhr.onabort = () => { cleanup(); reject('[Nexus] HTTP request cancelled'); };

            xhr.send(body !== undefined ? JSON.stringify(body) : null);
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** 中止所有进行中的 HTTP 请求。 */
    cancelAllHttpRequests(): void {
        for (const xhr of this._activeXhrs) {
            xhr.abort();
        }
        this._activeXhrs.clear();
    }

    async onDestroy(): Promise<void> {
        this.cancelAllHttpRequests();
        this._baseUrl = '';
        this._token = '';
    }
}
