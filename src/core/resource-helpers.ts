import type { Command } from "commander";
import { ask } from "./prompt.js";
import { printInfo, printJson } from "./output.js";
import { isDryRunEnabled } from "./runtime.js";

/**
 * Remove keys whose value is `undefined` from a payload object. Mutates and returns.
 * Use when building an optional-field body so the JSON sent to Dolibarr omits unset keys.
 */
export function prunePayload<T extends Record<string, unknown>>(body: T): T {
  for (const k of Object.keys(body)) {
    if (body[k] === undefined) delete body[k];
  }
  return body;
}

/**
 * Add the standard list-page options (--json, --limit, --page, --sort, --order, --filter) to a command.
 * Returns the same command for chaining.
 */
export function addListOptions(cmd: Command): Command {
  return cmd
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression");
}

/**
 * Build the standard Dolibarr list-endpoint query object from parsed `opts` plus
 * any resource-specific extras (e.g. status, thirdparty_ids).
 *
 * The `sortfield` value is wrapped as `t.${sort}` to match what each command currently does.
 */
export function buildListQuery(
  opts: Record<string, unknown>,
  extras?: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> {
  const sort = opts.sort as string | undefined;
  return {
    limit: opts.limit as string | undefined,
    page: opts.page as string | undefined,
    sortfield: sort ? `t.${sort}` : undefined,
    sortorder: opts.order as string | undefined,
    sqlfilters: opts.filter as string | undefined,
    ...(extras ?? {}),
  };
}

/**
 * If `--dry-run` was passed, emit a normalized dry-run JSON envelope and return true.
 * Otherwise return false so the caller can continue.
 */
export function dryRunJson(
  action: string,
  payload: Record<string, unknown>,
): boolean {
  if (!isDryRunEnabled()) return false;
  printJson({ dryRun: true, action, ...payload });
  return true;
}

/**
 * Handle delete-style confirmation: if `--confirm` was passed, proceed; otherwise
 * prompt the user and return false if they decline. Caller should early-return when false.
 */
export async function confirmOrCancel(
  prompt: string,
  opts: { confirm?: boolean },
): Promise<boolean> {
  if (opts.confirm) return true;
  const answer = await ask(`${prompt} (yes/no)`);
  if (answer !== "yes") {
    printInfo("Cancelled.");
    return false;
  }
  return true;
}
