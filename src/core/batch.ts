import type { Command } from "commander";
import { printError, printInfo, printJson } from "./output.js";
import {
  DolibarrApiError,
  exitWithError,
  getErrorMessage,
  getExitCode,
  NonInteractiveError,
  ValidationError,
} from "./errors.js";
import { isDryRunEnabled, isNonInteractiveMode } from "./runtime.js";
import { ask } from "./prompt.js";
import { createClient } from "./config-store.js";
import { walkLeaves } from "./command-tree.js";
import {
  buildStatusFilter,
  specForPath,
  statusFlag,
  type ResourceStatusSpec,
} from "./statuses.js";

/**
 * Exit code reserved for "some items applied, some failed". Distinct from a
 * whole-batch failure, which keeps the underlying single-item exit code
 * (2 = auth, 3 = validation/non-interactive, 4 = rate limit, 1 = generic).
 */
export const EXIT_PARTIAL_FAILURE = 5;

/**
 * Mutating verbs that take the record id as their sole required positional and
 * are therefore safe to batch over a comma-separated id list.
 *
 * Kept as an explicit table rather than a heuristic: this set decides which
 * commands can mutate many real records in one call, so it must be auditable.
 * `tests/core/batch-reach.test.ts` asserts every id-taking leaf subcommand in
 * the CLI is classified here or in {@link READ_ONLY_ID_VERBS}, so a new command
 * cannot land unclassified.
 */
export const BATCH_VERBS = new Set([
  "delete",
  "update",
  "validate",
  "close",
  "add-line",
  "add",
  "pay",
  "create",
  "set-status",
  "set-draft",
  "set-rate",
  "unpay",
  "reopen",
  "approve",
  "make-order",
  "receive",
]);

/**
 * Read-oriented verbs that also take a sole `<id>`. Excluded from batching:
 * batching a read would change its output shape, which this line must not do.
 */
export const READ_ONLY_ID_VERBS = new Set([
  "get",
  "list",
  "list-lines",
  "lines",
  "categories",
  "contacts",
  "objects",
  "payments",
  "template",
  "rates",
  "shipments",
  "stock",
  "roles",
  "outstanding",
]);

/** Outcome of one item in a batch run. */
export interface BatchItemResult {
  id: string;
  ok: boolean;
  exitCode?: number;
  error?: string;
  /** Structured error payload when the item failed in JSON mode. */
  detail?: unknown;
}

/**
 * Commands report failures in JSON mode by printing an error envelope. Unpack it
 * so a batch result carries a real message plus structured details, rather than
 * a JSON document embedded in a string.
 */
export function unpackItemError(raw: string): { error: string; detail?: unknown } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return { error: trimmed.replace(/^✗\s*/, "") };
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const message = typeof parsed.message === "string" ? parsed.message : trimmed;
    return { error: message, detail: parsed.details };
  } catch {
    return { error: trimmed };
  }
}

/**
 * Parse a comma-separated id list into a de-duplicated, ordered list of ids.
 *
 * Only called when the raw positional actually contains a comma, so a plain
 * `12` — or a non-numeric ref — never reaches this and keeps its existing
 * behaviour untouched.
 *
 * @throws ValidationError on an empty list or a non-numeric id.
 */
export function parseIdList(raw: string): string[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    throw new ValidationError(`Empty id list: "${raw}". Expected e.g. 1,2,3`);
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      throw new ValidationError(
        `Invalid id "${p}" in list "${raw}". Batch ids must be positive integers (e.g. 1,2,3).`,
      );
    }
    if (seen.has(p)) continue;
    seen.add(p);
    ids.push(p);
  }
  return ids;
}

/** True when a raw positional value should be treated as a batch id list. */
export function isBatchInput(raw: unknown): boolean {
  return typeof raw === "string" && raw.includes(",");
}

/**
 * Aggregate exit code for a finished batch:
 *  - every item ok            → 0
 *  - some ok, some failed     → 5 (partial)
 *  - every item failed        → the first item's own exit code
 */
export function batchExitCode(results: BatchItemResult[]): number {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return 0;
  if (failed.length < results.length) return EXIT_PARTIAL_FAILURE;
  return failed[0].exitCode ?? 1;
}

/** Thrown in place of process.exit() while a batch item is running. */
class BatchItemExit extends Error {
  constructor(public readonly code: number) {
    super(`batch item exited with ${code}`);
    this.name = "BatchItemExit";
  }
}

function isJsonMode(opts: Record<string, unknown>): boolean {
  return Boolean(opts.json || opts.output === "json");
}

/**
 * Run `fn` with process.exit() neutralised, so a per-item failure reports back
 * instead of tearing down the whole batch. Also captures the last message an
 * item wrote to stderr, to use as the failure reason in the report.
 *
 * In JSON mode stdout is swallowed too, so the batch emits one machine-readable
 * envelope rather than N interleaved per-item payloads.
 */
async function runItem(
  fn: () => Promise<unknown>,
  captureStdout: boolean,
): Promise<{ ok: boolean; exitCode?: number; error?: string; detail?: unknown }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  let lastError = "";

  process.exit = ((code?: number) => {
    throw new BatchItemExit(code ?? 0);
  }) as typeof process.exit;
  console.error = (...args: unknown[]) => {
    lastError = args.map((a) => String(a)).join(" ");
    if (!captureStdout) origError(...args);
  };
  if (captureStdout) console.log = () => {};

  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof BatchItemExit) {
      if (err.code === 0) return { ok: true };
      return { ok: false, exitCode: err.code, ...unpackItemError(lastError) };
    }
    return { ok: false, exitCode: getExitCode(err), error: getErrorMessage(err) };
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
  }
}

/**
 * Execute one batch: confirm, then run `perItem` for each id in turn, continuing
 * past failures, then report per-item outcomes and exit with the aggregate code.
 *
 * Sequential by design — a bulk mutation against a live ERP should not fan out
 * concurrent writes.
 */
export async function runBatch(
  action: string,
  ids: string[],
  opts: Record<string, unknown>,
  setConfirmed: () => void,
  perItem: (id: string) => Promise<unknown>,
): Promise<never> {
  const json = isJsonMode(opts);
  const dryRun = isDryRunEnabled();

  if (!json) {
    printInfo(`Batch ${action}: ${ids.length} record(s) selected`);
    for (const id of ids) printInfo(`  - ${id}`);
  }

  if (!dryRun && !opts.confirm) {
    if (isNonInteractiveMode()) {
      throw new NonInteractiveError(
        `Refusing to ${action} ${ids.length} records without --confirm in non-interactive mode.`,
      );
    }
    const answer = await ask(`About to ${action} ${ids.length} record(s). Continue? (yes/no)`);
    if (answer !== "yes") {
      printInfo("Cancelled.");
      return process.exit(0);
    }
  }
  // Suppress each item's own confirmation prompt — the batch already confirmed.
  setConfirmed();

  const results: BatchItemResult[] = [];
  for (const id of ids) {
    if (!json) printInfo(`\n→ ${action} ${id}`);
    const r = await runItem(() => perItem(id), json);
    results.push({ id, ...r });
    if (!json && !r.ok) printError(`${action} ${id} failed: ${r.error || "unknown error"}`);
  }

  const code = batchExitCode(results);
  const succeeded = results.filter((r) => r.ok).length;

  if (json) {
    printJson({
      batch: true,
      action,
      dryRun,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      exitCode: code,
      results,
    });
  } else {
    printInfo(
      `\nBatch ${action}: ${succeeded} succeeded, ${results.length - succeeded} failed, ` +
        `${results.length} total`,
    );
    if (code === EXIT_PARTIAL_FAILURE) {
      printInfo("Partial success — re-run with the failed ids once the cause is fixed.");
    }
  }

  process.exit(code);
}

/**
 * Verbs that may additionally be driven by a status selector (`--all-draft`).
 * A subset of {@link BATCH_VERBS}: `add-line` / `add` / `create` / `set-rate`
 * take an id but "add a line to every draft" is not a status transition, so they
 * stay id-only to keep the blast radius of one flag comprehensible.
 */
export const STATUS_SCOPED_VERBS = new Set([
  "validate",
  "close",
  "approve",
  "reopen",
  "set-draft",
  "unpay",
  "make-order",
  "receive",
  "set-status",
  "pay",
  "delete",
  "update",
]);

/** Default ceiling on how many records one status-scoped run may touch. */
export const DEFAULT_SELECTION_CAP = 100;

/** Mirror commander's long-flag → opts-key conversion (`--all-in-progress` → allInProgress). */
export function camelize(flag: string): string {
  return flag
    .replace(/^--/, "")
    .split("-")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** Outcome of resolving a status selector into concrete ids. */
export interface StatusSelection {
  ids: string[];
  /** True when more records matched than the cap allowed. */
  truncated: boolean;
  cap: number;
}

/**
 * Resolve `--all-<status>` into the ids it selects.
 *
 * The status predicate is applied **server-side** via sqlfilters, so fetching
 * `cap + 1` rows is enough to both bound the run and detect that more matched —
 * there is no window in which a matching record is silently skipped.
 */
export async function resolveStatusSelection(
  spec: ResourceStatusSpec,
  code: number,
  userFilter: string | undefined,
  cap: number,
): Promise<StatusSelection> {
  const client = createClient();
  try {
    const items = await client.get<Record<string, unknown>[]>(spec.path, {
      limit: String(cap + 1),
      page: "0",
      sqlfilters: buildStatusFilter(spec, code, userFilter),
    });
    const rows = Array.isArray(items) ? items : [];
    return {
      ids: rows.slice(0, cap).map((i) => String(i.id ?? i.rowid ?? "")).filter(Boolean),
      truncated: rows.length > cap,
      cap,
    };
  } catch (err) {
    // Several Dolibarr list endpoints answer an empty result set with 404.
    if (err instanceof DolibarrApiError && err.status === 404) {
      return { ids: [], truncated: false, cap };
    }
    throw err;
  }
}

/**
 * Resolve a `--all-<status>` selector into ids, announce exactly what was
 * selected, then hand off to {@link runBatch}.
 *
 * Selection is a read, so it runs even under `--dry-run` — previewing a
 * status-scoped run is precisely when you most want to see the real targets.
 */
export async function runStatusScoped(
  action: string,
  spec: ResourceStatusSpec,
  statusName: string,
  opts: Record<string, unknown>,
  cmd: Command,
  perItem: (id: string) => Promise<unknown>,
): Promise<never> {
  const json = isJsonMode(opts);
  const code = spec.statuses[statusName];
  const rawMax = opts.max === undefined ? DEFAULT_SELECTION_CAP : Number(opts.max);
  if (!Number.isFinite(rawMax) || rawMax < 1) {
    throw new ValidationError(`--max must be a positive integer, got "${String(opts.max)}".`);
  }
  const cap = Math.floor(rawMax);

  const selection = await resolveStatusSelection(
    spec,
    code,
    opts.filter as string | undefined,
    cap,
  );

  if (!json) {
    printInfo(
      `Selecting ${statusName} records (t.${spec.column} = ${code})` +
        (opts.filter ? ` scoped by --filter ${String(opts.filter)}` : ""),
    );
  }

  if (selection.ids.length === 0) {
    if (json) {
      printJson({
        batch: true,
        action,
        selector: statusFlag(statusName),
        dryRun: isDryRunEnabled(),
        total: 0,
        succeeded: 0,
        failed: 0,
        truncated: false,
        exitCode: 0,
        results: [],
      });
    } else {
      printInfo(`No ${statusName} records matched — nothing to do.`);
    }
    return process.exit(0);
  }

  if (selection.truncated) {
    const warning =
      `More than ${cap} ${statusName} records matched. Acting on the first ${cap} only — ` +
      `re-run to continue, or raise the cap with --max.`;
    if (!json) printError(warning);
    else printJson({ warning, truncated: true, cap });
  }

  return runBatch(action, selection.ids, opts, () => cmd.setOptionValue("confirm", true), perItem);
}

/**
 * True when `sub` is a leaf subcommand whose sole required positional is `<id>`
 * and whose verb is a known mutating one.
 */
export function isBatchable(sub: Command): boolean {
  if (sub.commands.length > 0) return false;
  if (!BATCH_VERBS.has(sub.name())) return false;
  const args = sub.registeredArguments;
  if (args.length === 0) return false;
  if (args[0].name() !== "id" || !args[0].required) return false;
  return args.filter((a) => a.required).length === 1;
}

export { walkLeaves } from "./command-tree.js";

/**
 * Wire comma-separated batch ids into every batchable subcommand of `program`.
 *
 * Called once from `cli.ts` after all groups are registered, so all 33 groups
 * inherit the capability from one edit rather than 33.
 *
 * A positional without a comma is dispatched to the original handler untouched,
 * so every pre-0.5.0 invocation keeps its exact behaviour and exit code.
 *
 * Returns the paths that were wired, for the reach test to assert against.
 */
export function enableBatchIds(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    if (!isBatchable(cmd)) continue;

    // `_actionHandler` is commander-internal but stable across v7–v13, and the
    // reach test fails loudly if an upgrade ever breaks this wiring.
    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __bulkWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function") continue;
    // Status-scoped wiring makes <id> optional, which would make isBatchable()
    // false on a second pass; the marker keeps this idempotent regardless.
    if (internal.__bulkWired) continue;
    internal.__bulkWired = true;

    if (!cmd.options.some((o) => o.long === "--confirm")) {
      cmd.option("--confirm", "Skip confirmation prompt");
    }
    const idArg = cmd.registeredArguments[0];
    idArg.description = `${idArg.description || "Record ID"} (or a comma-separated list: 1,2,3)`;

    // v0.5.1 — status-scoped selection, where the resource has a known status
    // vocabulary and the verb is a status transition.
    const spec = STATUS_SCOPED_VERBS.has(cmd.name()) ? specForPath(path) : undefined;
    const statusNames = spec ? Object.keys(spec.statuses) : [];
    if (spec) {
      for (const name of statusNames) {
        cmd.option(statusFlag(name), `Select every ${name} record instead of passing ids`);
      }
      if (!cmd.options.some((o) => o.long === "--filter")) {
        cmd.option("--filter <expr>", "Scope the selection with an SQL filter expression");
      }
      if (!cmd.options.some((o) => o.long === "--max")) {
        cmd.option("--max <n>", "Cap on selected records", String(DEFAULT_SELECTION_CAP));
      }
      // The id becomes optional so a selector can stand in for it. When neither
      // is given we still raise commander's own missing-argument error below, so
      // the pre-0.5.1 message and exit code are preserved.
      idArg.required = false;
    }

    cmd.addHelpText(
      "after",
      "\nBatch: pass a comma-separated id list (1,2,3) to apply this to several" +
        "\nrecords. Batch runs require --confirm (or a prompt), report per-item" +
        "\noutcomes, and exit 5 when only some items succeeded." +
        (spec
          ? `\n\nStatus-scoped: ${statusNames.map(statusFlag).join(", ")}` +
            `\nselects by status instead of ids. Scope it with --filter, and cap it` +
            `\nwith --max (default ${DEFAULT_SELECTION_CAP}); a truncated selection is always announced.`
          : ""),
    );

    internal._actionHandler = async (args: unknown[]) => {
      const raw = args[0];
      const opts = cmd.opts() as Record<string, unknown>;

      try {
        const chosen = statusNames.filter((n) => opts[camelize(statusFlag(n))]);
        if (chosen.length > 0) {
          if (chosen.length > 1) {
            throw new ValidationError(
              `Pick one status selector, got ${chosen.map(statusFlag).join(" and ")}.`,
            );
          }
          if (raw !== undefined && raw !== null) {
            throw new ValidationError(
              `Pass either an id or ${statusFlag(chosen[0])}, not both.`,
            );
          }
          return await runStatusScoped(
            path,
            spec!,
            chosen[0],
            opts,
            cmd,
            (id) => Promise.resolve(original([id, ...args.slice(1)])),
          );
        }

        // No selector: an id is mandatory again, with commander's own error.
        if (raw === undefined || raw === null) {
          // Reuse commander's own missing-argument path so the message and the
          // exit code match exactly what this command produced before v0.5.1.
          (cmd as unknown as { missingArgument(name: string): never }).missingArgument("id");
        }
        if (!isBatchInput(raw)) return original(args);

        const ids = parseIdList(raw as string);
        if (ids.length === 1) return original([ids[0], ...args.slice(1)]);
        return await runBatch(
          path,
          ids,
          opts,
          () => cmd.setOptionValue("confirm", true),
          (id) => Promise.resolve(original([id, ...args.slice(1)])),
        );
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NonInteractiveError) {
          if (isJsonMode(opts)) printJson({ status: "error", code: err.name, message: err.message });
          else printError(err.message);
          return process.exit(getExitCode(err));
        }
        // Resolving a status selection is an API call made outside any command's
        // own try/catch, so a 403 from a permission-gated module would otherwise
        // surface as an unhandled rejection instead of the usual hinted error.
        return exitWithError(err, isJsonMode(opts));
      }
    };

    wired.push(path);
  }

  return wired;
}
