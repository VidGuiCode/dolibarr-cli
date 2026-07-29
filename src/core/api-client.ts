import type { DolibarrConfig } from "./types.js";
import { DolibarrApiError, DolibarrAuthError, DolibarrParseError } from "./errors.js";
import {
  AUTO_PAGE_SIZE,
  finishProgress,
  getAutoPaginate,
  isPaginatedQuery,
  reportProgress,
} from "./paginate.js";

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

  /**
   * Pull both the human message and Dolibarr's `debug.source` out of an error body.
   *
   * `debug.source` is the most useful diagnostic the API emits and the CLI used to
   * throw it away. It names the PHP file and the stage that failed, which is what
   * separates "this route does not exist on this instance" from "it exists but the
   * API user is not allowed" — two failures that otherwise look identical.
   */
  private async readErrorBody(res: Response): Promise<{ message: string; debugSource?: string }> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      return { message: `HTTP ${res.status}` };
    }

    try {
      const json = JSON.parse(text);
      const debugSource =
        typeof json?.debug?.source === "string" ? json.debug.source : undefined;
      if (json?.error?.message) return { message: json.error.message, debugSource };
      if (typeof json?.error === "string") return { message: json.error, debugSource };
      if (typeof json === "string") return { message: json, debugSource };
    } catch {
      // not JSON
    }
    return { message: text || `HTTP ${res.status}` };
  }

  /**
   * Read a successful response body without ever leaking a raw
   * `Unexpected end of JSON input` to the user.
   *
   * Dolibarr does not always answer JSON on a 2xx: `accountancy/exportdata`
   * returns an empty body when a period holds no exportable entries, and several
   * endpoints stream plain text. So:
   *   - empty body  -> `null` (the caller decides what "nothing" means)
   *   - valid JSON  -> the parsed value
   *   - other text  -> the raw string, which is the useful payload for exports
   * A DolibarrParseError is only thrown when the body defeats even that, so an
   * error the user sees always distinguishes an API failure from a CLI one.
   */
  private async parseSuccessBody(res: Response, method: string, path: string): Promise<unknown> {
    let text: string;
    try {
      text = await res.text();
    } catch (error) {
      throw new DolibarrParseError(
        `Could not read the response body from ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
        method,
        path,
      );
    }

    if (text.trim() === "") return null;

    try {
      return JSON.parse(text);
    } catch {
      // Not JSON. Dolibarr returns raw CSV/FEC content this way, so hand it back
      // verbatim rather than failing on a body that is perfectly usable.
      return text;
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
          const err = await this.readErrorBody(res);
          throw new DolibarrApiError(
            res.status,
            err.message,
            options.method ?? "GET",
            path,
            { response: err.message },
            err.debugSource,
          );
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
    const auto = getAutoPaginate();
    if (auto.enabled && isPaginatedQuery(params)) {
      return (await this.getAllPages(path, params!)) as T;
    }
    return this.getOnce<T>(path, params);
  }

  private async getOnce<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const fullPath = path + this.buildQueryString(params);
    const res = await this.fetchWithRetry(fullPath);
    if (!res.ok) {
      if (res.status === 401) {
        throw new DolibarrAuthError();
      }
      const err = await this.readErrorBody(res);
      throw new DolibarrApiError(
        res.status,
        err.message,
        "GET",
        fullPath,
        { response: err.message },
        err.debugSource,
      );
    }
    return (await this.parseSuccessBody(res, "GET", path)) as T;
  }

  /**
   * Walk every page of a list endpoint and return the concatenated rows.
   *
   * Used only when `--all` is active. `limit`/`page` from the caller are
   * replaced with the auto page size — `--all` bypasses `--limit` by design.
   * Stops on a short page (the last one), on the record cap, or on the 404 that
   * several Dolibarr list endpoints return for an empty result.
   */
  private async getAllPages(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<Record<string, unknown>[]> {
    const { maxRecords } = getAutoPaginate();
    const rows: Record<string, unknown>[] = [];
    let page = 0;
    let truncated = false;

    for (;;) {
      let batch: Record<string, unknown>[];
      try {
        batch = await this.getOnce<Record<string, unknown>[]>(path, {
          ...params,
          limit: AUTO_PAGE_SIZE,
          page,
        });
      } catch (err) {
        // An empty result set answers 404 on several list endpoints.
        if (err instanceof DolibarrApiError && err.status === 404 && page > 0) break;
        throw err;
      }
      if (!Array.isArray(batch) || batch.length === 0) break;

      rows.push(...batch);
      reportProgress(rows.length, page);

      if (rows.length >= maxRecords) {
        truncated = rows.length > maxRecords || batch.length === AUTO_PAGE_SIZE;
        rows.length = Math.min(rows.length, maxRecords);
        break;
      }
      // A short page is the last page.
      if (batch.length < AUTO_PAGE_SIZE) break;
      page += 1;
    }

    finishProgress(rows.length, truncated);
    return rows;
  }

  /**
   * Fetch a single record by numeric id OR by human ref. All-digit inputs are
   * treated as ids and hit `GET /{resource}/{id}`; anything else is treated as
   * a ref and hits `GET /{resource}/ref/{ref}`. Only call this for resources
   * whose Dolibarr API exposes the `/ref/{ref}` endpoint (see Phase 1 reference
   * docs — as of Dolibarr 20.x: invoices, orders, proposals, categories, projects).
   */
  async getByRefOrId<T>(resource: string, idOrRef: string): Promise<T> {
    const trimmed = idOrRef.trim();
    const path = /^\d+$/.test(trimmed)
      ? `${resource}/${trimmed}`
      : `${resource}/ref/${encodeURIComponent(trimmed)}`;
    return this.get<T>(path);
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
      const err = await this.readErrorBody(res);
      throw new DolibarrApiError(
        res.status,
        err.message,
        "POST",
        path,
        { request: body, response: err.message },
        err.debugSource,
      );
    }
    return (await this.parseSuccessBody(res, "POST", path)) as T;
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
      const err = await this.readErrorBody(res);
      throw new DolibarrApiError(
        res.status,
        err.message,
        "PUT",
        path,
        { request: body, response: err.message },
        err.debugSource,
      );
    }
    return (await this.parseSuccessBody(res, "PUT", path)) as T;
  }

  /**
   * Perform a raw request and return the HTTP status alongside the parsed body,
   * WITHOUT throwing on a non-2xx response. The `raw` command uses this so it can
   * surface the real status/body instead of masking a failure (e.g. a 403 or an
   * all-null stub) as success. Retryable 5xx/429 responses are still retried, and
   * a final failed retry throws DolibarrApiError as usual.
   */
  async requestRaw(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; ok: boolean; data: unknown }> {
    const res = await this.fetchWithRetry(path, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, ok: res.ok, data };
  }

  async delete<T = void>(path: string): Promise<T> {
    const res = await this.fetchWithRetry(path, { method: "DELETE" });
    if (!res.ok) {
      if (res.status === 401) {
        throw new DolibarrAuthError();
      }
      const err = await this.readErrorBody(res);
      throw new DolibarrApiError(
        res.status,
        err.message,
        "DELETE",
        path,
        { response: err.message },
        err.debugSource,
      );
    }
    const parsed = await this.parseSuccessBody(res, "DELETE", path);
    // DELETE has always answered `undefined` on an empty body; keep that shape.
    return (parsed === null ? undefined : parsed) as T;
  }
}
