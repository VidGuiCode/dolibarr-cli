import { ValidationError } from "./errors.js";
import { printNotice } from "./output.js";

/**
 * Client-side pagination for Dolibarr endpoints that don't paginate server-side.
 *
 * Most Dolibarr list routes are `index()` methods that honour `limit` and `page`.
 * A few sub-resource getters do not — they take no pagination arguments at all and
 * always return the whole collection:
 *
 *   - `GET /bankaccounts/{id}/lines`   — `getLines($id, $sqlfilters)`
 *   - `GET /categories/{id}/objects`   — `getObjects($id, $type, $onlyids)`
 *
 * Up to v0.5.7 the CLI sent `limit`/`page` to these anyway. The server discarded
 * them, so `--limit 1` and `--limit 3` both returned every row while the help text
 * promised pagination. This module makes the flags mean what they say by slicing
 * the response, and keeps the "never cap silently" rule: a truncated result always
 * says so, on stderr, so piped stdout stays clean.
 */

export interface ClientPaginationOpts {
  limit?: unknown;
  page?: unknown;
  /** `--all` returns every row, bypassing the slice — same contract as server-side `--all`. */
  all?: unknown;
}

export interface ClientPaginationResult<T> {
  /** The rows to render. */
  rows: T[];
  /** How many rows the server actually returned. */
  total: number;
  /** True when rows beyond this page exist. */
  hasMore: boolean;
  /** 0-indexed page that was applied. */
  page: number;
  /** Page size that was applied, or null when `--all` bypassed it. */
  limit: number | null;
}

/** Parse a non-negative integer flag, rejecting junk rather than coercing it to NaN. */
export function parseIntFlag(value: unknown, flag: string, min: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new ValidationError(
      `${flag} must be an integer >= ${min}, got "${String(value)}".`,
    );
  }
  return n;
}

/**
 * Apply `--limit`/`--page` to a fully-materialized result set.
 *
 * `--all` wins over both, matching how `--all` behaves on genuinely paginated
 * endpoints (it bypasses `--limit` by design).
 */
export function paginateClientSide<T>(
  rows: T[],
  opts: ClientPaginationOpts = {},
): ClientPaginationResult<T> {
  const all = Array.isArray(rows) ? rows : [];
  const total = all.length;

  if (opts.all) {
    return { rows: all, total, hasMore: false, page: 0, limit: null };
  }

  const limit = parseIntFlag(opts.limit ?? 50, "--limit", 1);
  const page = parseIntFlag(opts.page ?? 0, "--page", 0);

  const start = page * limit;
  const slice = all.slice(start, start + limit);
  return { rows: slice, total, hasMore: start + limit < total, page, limit };
}

/**
 * Tell the user rows were withheld, on stderr so redirected stdout is unaffected.
 * Silent when nothing was withheld, and when `--all` was used.
 */
export function reportClientPagination<T>(result: ClientPaginationResult<T>): void {
  if (result.limit === null || !result.hasMore) return;
  const first = result.page * result.limit + 1;
  const last = first + result.rows.length - 1;
  printNotice(
    `Showing ${first}-${last} of ${result.total}. This Dolibarr endpoint returns all rows ` +
      `at once, so --limit/--page are applied by the CLI. Use --all for everything, ` +
      `or --page ${result.page + 1} for the next page.`,
  );
}
