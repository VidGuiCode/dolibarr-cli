import type { Command } from "commander";
import { printError, printInfo, printJson } from "./output.js";
import { getErrorMessage, getExitCode, NonInteractiveError, ValidationError } from "./errors.js";
import { isDryRunEnabled, isNonInteractiveMode } from "./runtime.js";
import { ask } from "./prompt.js";

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

/** Every leaf subcommand of `root`, paired with its full space-joined path. */
export function walkLeaves(root: Command, prefix = ""): { path: string; cmd: Command }[] {
  const out: { path: string; cmd: Command }[] = [];
  for (const sub of root.commands) {
    const full = `${prefix} ${sub.name()}`.trim();
    if (sub.commands.length > 0) out.push(...walkLeaves(sub, full));
    else out.push({ path: full, cmd: sub });
  }
  return out;
}

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
    };
    const original = internal._actionHandler;
    if (typeof original !== "function") continue;

    if (!cmd.options.some((o) => o.long === "--confirm")) {
      cmd.option("--confirm", "Skip confirmation prompt");
    }
    const idArg = cmd.registeredArguments[0];
    idArg.description = `${idArg.description || "Record ID"} (or a comma-separated list: 1,2,3)`;
    cmd.addHelpText(
      "after",
      "\nBatch: pass a comma-separated id list (1,2,3) to apply this to several" +
        "\nrecords. Batch runs require --confirm (or a prompt), report per-item" +
        "\noutcomes, and exit 5 when only some items succeeded.",
    );

    internal._actionHandler = async (args: unknown[]) => {
      const raw = args[0];
      if (!isBatchInput(raw)) return original(args);

      const opts = cmd.opts() as Record<string, unknown>;
      try {
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
        throw err;
      }
    };

    wired.push(path);
  }

  return wired;
}
