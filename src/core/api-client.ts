import type { DolibarrConfig } from "./types.js";
import { DolibarrApiError, DolibarrAuthError } from "./errors.js";

export interface DolibarrClientOptions extends DolibarrConfig {
  retries?: number;
  retryDelay?: number;
}

interface FetchOptions {
  method?: string;
  body?: string;
}

export class DolibarrApiClient {
  private readonly maxRetries: number;
  private readonly baseDelay: number;

  constructor(private readonly options: DolibarrClientOptions) {
    this.maxRetries = options.retries ?? 3;
    this.baseDelay = options.retryDelay ?? 1000;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  private get headers(): Record<string, string> {
    return {
      DOLAPIKEY: this.options.apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private url(path: string): string {
    const base = this.options.baseUrl.replace(/\/$/, "");
    const p = path.replace(/^\//, "");
    return `${base}/api/index.php/${p}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateDelay(attempt: number, retryAfter: number | null): number {
    if (retryAfter !== null && retryAfter > 0) {
      return retryAfter * 1000;
    }
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 100;
    return exponentialDelay + jitter;
  }

  private isRetryableError(status: number): boolean {
    if (status >= 500 && status < 600) return true;
    if (status === 429) return true;
    return false;
  }

  private async parseErrorBody(res: Response): Promise<string> {
    try {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json?.error?.message) return json.error.message;
        if (typeof json?.error === "string") return json.error;
        if (typeof json === "string") return json;
      } catch {
        // not JSON
      }
      return text || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  private async fetchWithRetry(path: string, options: FetchOptions = {}): Promise<Response> {
    const url = this.url(path);
    const fetchOptions: RequestInit = {
      headers: this.headers,
      ...options,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, fetchOptions);

        if (res.ok || !this.isRetryableError(res.status)) {
          return res;
        }

        if (attempt === this.maxRetries) {
          const errorText = await this.parseErrorBody(res);
          throw new DolibarrApiError(res.status, errorText, options.method ?? "GET", path, {
            response: errorText,
          });
        }

        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
        const delay = this.calculateDelay(attempt, retryAfter);
        await this.sleep(delay);
      } catch (error) {
        if (error instanceof DolibarrApiError) {
          throw error;
        }

        if (error instanceof TypeError || error instanceof Error) {
          const isNetworkError =
            error instanceof TypeError ||
            error.message.includes("fetch") ||
            error.message.includes("network");

          if (isNetworkError && attempt < this.maxRetries) {
            const delay = this.calculateDelay(attempt, null);
            await this.sleep(delay);
            lastError = error;
            continue;
          }
        }

        if (attempt === this.maxRetries) {
          throw new Error(
            `Request failed after ${this.maxRetries} retries: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        const delay = this.calculateDelay(attempt, null);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error(`Request failed after ${this.maxRetries} retries`);
  }

  private buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
    if (!params) return "";
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (entries.length === 0) return "";
    const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    return `?${qs}`;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const fullPath = path + this.buildQueryString(params);
    const res = await this.fetchWithRetry(fullPath);
    if (!res.ok) {
      if (res.status === 401) {
        throw new DolibarrAuthError();
      }
      const errorText = await this.parseErrorBody(res);
      throw new DolibarrApiError(res.status, errorText, "GET", path, { response: errorText });
    }
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchWithRetry(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new DolibarrAuthError();
      }
      const errorText = await this.parseErrorBody(res);
      throw new DolibarrApiError(res.status, errorText, "POST", path, {
        request: body,
        response: errorText,
      });
    }
    return res.json() as Promise<T>;
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchWithRetry(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new DolibarrAuthError();
      }
      const errorText = await this.parseErrorBody(res);
      throw new DolibarrApiError(res.status, errorText, "PUT", path, {
        request: body,
        response: errorText,
      });
    }
    return res.json() as Promise<T>;
  }

  async delete<T = void>(path: string): Promise<T> {
    const res = await this.fetchWithRetry(path, { method: "DELETE" });
    if (!res.ok) {
      if (res.status === 401) {
        throw new DolibarrAuthError();
      }
      const errorText = await this.parseErrorBody(res);
      throw new DolibarrApiError(res.status, errorText, "DELETE", path, { response: errorText });
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
