import type { Command } from "commander";
import { ValidationError } from "./errors.js";
import { printError, printJson } from "./output.js";
import { walkLeaves } from "./command-tree.js";

/**
 * `--all` auto-pagination (v0.5.3).
 *
 * Dolibarr list endpoints page with `limit` + `page`. `--all` walks every page
 * and returns the concatenated result, so a script never has to loop by hand.
 *
 * This module only holds the *state and wiring*; the page loop itself lives in
 * `DolibarrApiClient.get`, which is the single place every list command already
 * funnels through. That keeps the capability reaching all 33 groups from one
 * edit, and keeps this module free of any import back into the client.
 */

/** Rows fetched per request while auto-paginating. `--limit` is bypassed by design. */
export const AUTO_PAGE_SIZE = 100;

/** Default ceiling on records returned by one `--all` run. */
export const DEFAULT_MAX_RECORDS = 5000;

export interface AutoPaginateState {
  enabled: boolean;
  maxRecords: number;
  /** Emit per-page progress to stderr. */
  progress: boolean;
}

let state: AutoPaginateState = {
  enabled: false,
  maxRecords: DEFAULT_MAX_RECORDS,
  progress: false,
};

export function getAutoPaginate(): AutoPaginateState {
  return state;
}

export function setAutoPaginate(next: Partial<AutoPaginateState>): void {
  state = { ...state, ...next };
}

/** Reset to defaults. Exists for tests, which must not leak state between cases. */
export function resetAutoPaginate(): void {
  state = { enabled: false, maxRecords: DEFAULT_MAX_RECORDS, progress: false };
}

/**
 * True when a query looks like a paginated list request — i.e. it carries the
 * `limit`/`page` pair that `buildListQuery` emits. Detail fetches and
 * sub-resource listings don't, so they are never auto-paginated.
 */
export function isPaginatedQuery(
  params?: Record<string, string | number | boolean | undefined>,
): boolean {
  return (
    params !== undefined && params.limit !== undefined && params.page !== undefined
  );
}

/**
 * Progress goes to **stderr**, never stdout, so `list --all --output json > f`
 * stays a clean data stream.
 */
export function reportProgress(fetched: number, page: number): void {
  if (!state.progress) return;
  process.stderr.write(`\rFetching… ${fetched} records (page ${page + 1})`);
}

/** Close out the progress line once the walk finishes. */
export function finishProgress(total: number, truncated: boolean): void {
  if (state.progress) {
    process.stderr.write(`\rFetched ${total} records${" ".repeat(20)}\n`);
  }
  if (truncated) {
    printError(
      `Stopped at the --max-records cap of ${state.maxRecords}. More records match — ` +
        `raise the cap with --max-records, or narrow the query with --filter/--from/--to.`,
    );
  }
}

/** Validate `--max-records`. */
export function parseMaxRecords(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_RECORDS;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new ValidationError(
      `--max-records must be a positive integer, got "${String(value)}".`,
    );
  }
  return n;
}

/**
 * True when a command is a genuinely paginated list.
 *
 * Requires **both** `--limit` and `--page`, mirroring {@link isPaginatedQuery}
 * exactly. A command with only `--limit` (e.g. `categories objects`) never emits
 * the `page` param, so offering it `--all` would be a flag that silently does
 * nothing.
 */
export function isPaginatedList(cmd: Command): boolean {
  if (cmd.commands.length > 0) return false;
  const longs = cmd.options.map((o) => o.long);
  return longs.includes("--limit") && longs.includes("--page");
}

/**
 * Wire `--all` / `--max-records` into every paginated list command, from one
 * call in `cli.ts`. Returns the wired paths for the reach test.
 */
export function enableAutoPaginate(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    if (!isPaginatedList(cmd)) continue;

    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __paginateWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function" || internal.__paginateWired) continue;
    internal.__paginateWired = true;

    const longs = cmd.options.map((o) => o.long);
    if (!longs.includes("--all")) {
      cmd.option("--all", "Fetch every page, ignoring --limit");
    }
    if (!longs.includes("--max-records")) {
      cmd.option(
        "--max-records <n>",
        "Cap on records fetched by --all",
        String(DEFAULT_MAX_RECORDS),
      );
    }
    cmd.addHelpText(
      "after",
      `\n--all walks every page (ignoring --limit), capped at ${DEFAULT_MAX_RECORDS}` +
        `\nrecords by default. Hitting the cap is always reported, never silent.`,
    );

    internal._actionHandler = async (args: unknown[]) => {
      const opts = cmd.opts() as Record<string, unknown>;
      if (!opts.all) return original(args);

      try {
        const maxRecords = parseMaxRecords(opts.maxRecords);
        setAutoPaginate({
          enabled: true,
          maxRecords,
          // Keep stdout pristine when it is being piped or redirected.
          progress: process.stderr.isTTY === true,
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          const json = Boolean(opts.json || opts.output === "json");
          if (json) printJson({ status: "error", code: err.name, message: err.message });
          else printError(err.message);
          return process.exit(3);
        }
        throw err;
      }

      try {
        return await original(args);
      } finally {
        resetAutoPaginate();
      }
    };

    wired.push(path);
  }

  return wired;
}
