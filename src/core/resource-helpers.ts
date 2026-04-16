import type { Command } from "commander";
import { ask } from "./prompt.js";
import { printCsv, printInfo, printJson, printTable } from "./output.js";
import { isDryRunEnabled } from "./runtime.js";
import type { OutputFormat } from "./types.js";

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
 * Add the standard list-page options (--output, --json, --fields, --limit, --page, --sort, --order, --filter)
 * to a command. `--json` is kept as a back-compat alias for `--output json`.
 * Returns the same command for chaining.
 */
export function addListOptions(cmd: Command): Command {
  return cmd
    .option("--output <fmt>", "Output format: table|json|csv", "table")
    .option("--json", "Output as JSON (alias for --output json)")
    .option("--fields <keys>", "Comma-separated field keys to project (e.g. id,ref,total_ttc)")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression");
}

/**
 * Add the standard detail-page options (--output, --json, --fields) to a `get`-style command.
 * Returns the same command for chaining.
 */
export function addGetOptions(cmd: Command): Command {
  return cmd
    .option("--output <fmt>", "Output format: table|json|csv", "table")
    .option("--json", "Output as JSON (alias for --output json)")
    .option("--fields <keys>", "Comma-separated field keys to project");
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
 * Resolve the effective output format from parsed opts. Precedence:
 *   1. `--output <fmt>` if it's a known format other than the default "table"
 *   2. `--json` (back-compat alias for --output json)
 *   3. `--output table` (the default) or unset → "table"
 *
 * Unknown `--output` values fall back to "table".
 */
export function resolveOutput(opts: Record<string, unknown>): OutputFormat {
  const raw = opts.output as string | undefined;
  if (raw === "json" || raw === "csv") return raw;
  if (opts.json) return "json";
  if (raw === "table" || raw === undefined) return "table";
  return "table";
}

/**
 * Parse a `--fields a,b,c` option into a trimmed, non-empty list of keys.
 * Returns undefined when the option is absent.
 */
export function parseFields(opts: Record<string, unknown>): string[] | undefined {
  const raw = opts.fields as string | undefined;
  if (!raw) return undefined;
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : undefined;
}

/**
 * Describes one column of a list or detail view.
 *  - `key`   — the raw Dolibarr field key (used as CSV header and JSON projection key)
 *  - `label` — the human-readable header for the table view
 *  - `format` — optional value extractor. When omitted, falls back to String(item[key] ?? "")
 */
export interface ColumnSpec {
  key: string;
  label: string;
  format?: (item: Record<string, unknown>) => string;
}

function stringifyField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function pickKeys(
  item: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = item[k];
  return out;
}

/**
 * Render a list of items honoring `--output` and `--fields`.
 *
 * When `--fields` is passed, the `columns` spec is ignored and projection is done
 * directly off raw item keys. Without `--fields`, the `columns` spec controls headers
 * (labels for table; keys for CSV) and per-cell formatting.
 */
export function renderList(
  items: Record<string, unknown>[],
  config: { columns: ColumnSpec[]; opts: Record<string, unknown> },
): void {
  const output = resolveOutput(config.opts);
  const fields = parseFields(config.opts);

  if (fields) {
    if (output === "json") {
      printJson(items.map((i) => pickKeys(i, fields)));
      return;
    }
    const rows = items.map((i) => fields.map((k) => stringifyField(i[k])));
    if (output === "csv") printCsv(rows, fields);
    else printTable(rows, fields);
    return;
  }

  if (output === "json") {
    printJson(items);
    return;
  }
  const rows = items.map((i) =>
    config.columns.map((c) =>
      c.format ? c.format(i) : stringifyField(i[c.key]),
    ),
  );
  if (output === "csv") {
    printCsv(
      rows,
      config.columns.map((c) => c.key),
    );
  } else {
    printTable(
      rows,
      config.columns.map((c) => c.label),
    );
  }
}

/**
 * Render a single item (detail view) honoring `--output` and `--fields`.
 *
 * Default table view is the two-column Field|Value shape. CSV produces a single
 * data row with column headers = field keys. JSON prints the raw item (or a
 * projected subset when `--fields` is passed).
 */
export function renderGet(
  item: Record<string, unknown>,
  config: { fields: ColumnSpec[]; opts: Record<string, unknown> },
): void {
  const output = resolveOutput(config.opts);
  const projected = parseFields(config.opts);

  if (projected) {
    if (output === "json") {
      printJson(pickKeys(item, projected));
      return;
    }
    if (output === "csv") {
      printCsv([projected.map((k) => stringifyField(item[k]))], projected);
      return;
    }
    const rows = projected.map((k) => [k, stringifyField(item[k])]);
    printTable(rows, ["Field", "Value"]);
    return;
  }

  if (output === "json") {
    printJson(item);
    return;
  }
  if (output === "csv") {
    const keys = config.fields.map((f) => f.key);
    const row = config.fields.map((f) =>
      f.format ? f.format(item) : stringifyField(item[f.key]),
    );
    printCsv([row], keys);
    return;
  }
  const rows = config.fields.map((f) => [
    f.label,
    f.format ? f.format(item) : stringifyField(item[f.key]),
  ]);
  printTable(rows, ["Field", "Value"]);
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
