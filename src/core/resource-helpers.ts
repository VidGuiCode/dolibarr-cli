import type { Command } from "commander";
import type { DolibarrApiClient } from "./api-client.js";
import { ask } from "./prompt.js";
import { printCsv, printInfo, printJson, printLines, printTable } from "./output.js";
import {
  headersSuppressed,
  renderField,
  resolveFieldOpt,
  renderNdjson,
  renderTemplate,
  renderTemplateLine,
  renderYaml,
  toYaml,
  validateTemplate,
} from "./formats.js";
import { isDryRunEnabled } from "./runtime.js";
import { isRedactRequested, redactItems, redactValue, resolveViewKeys } from "./views.js";
import { colorizeStatus, isColorEnabled, isStatusColumn } from "./color.js";
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
  cmd
    .option("--output <fmt>", "Output format: table|json|csv|ndjson|yaml", "table")
    .option("--json", "Output as JSON (alias for --output json)")
    .option("--fields <keys>", "Comma-separated field keys to project (e.g. id,ref,total_ttc)")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression");
  cmd.addHelpText(
    "after",
    "\nOutput: shows a slim table by default (not full JSON). Pick columns with" +
      "\n  --fields id,ref,date,total_ttc   and/or switch format with --output json|csv.",
  );
  return cmd;
}

/**
 * Add the standard detail-page options (--output, --json, --fields) to a `get`-style command.
 * Returns the same command for chaining.
 */
export function addGetOptions(cmd: Command): Command {
  return cmd
    .option("--output <fmt>", "Output format: table|json|csv|ndjson|yaml", "table")
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
  if (raw === "json" || raw === "csv" || raw === "ndjson" || raw === "yaml") return raw;
  if (opts.json) return "json";
  if (raw === "table" || raw === undefined) return "table";
  // Unknown values keep falling back to "table", as they have since v0.2.0.
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
  const noHeader = headersSuppressed(config.opts);

  // Redaction happens FIRST, before any projection or formatting, so a sensitive
  // value cannot reach any output path — including --field and --template.
  items = isRedactRequested(config.opts) ? redactItems(items) : items;

  // --field is the most specific request there is: one raw value per row.
  const field = resolveFieldOpt(config.opts);
  if (field) {
    printLines(renderField(items, field));
    return;
  }

  // Both are resolved unconditionally: resolveViewKeys is what rejects the ambiguous
  // --view + --fields combination, so it must not be short-circuited away.
  const explicitFields = parseFields(config.opts);
  const viewFields = resolveViewKeys(config.opts, items);
  const fields = explicitFields ?? viewFields;

  // --template wins over --output: it *is* the output format.
  const template = config.opts.template as string | undefined;
  if (template) {
    const projected = fields ? items.map((i) => pickKeys(i, fields)) : items;
    printLines(renderTemplate(projected, validateTemplate(template)));
    return;
  }

  if (fields) {
    const projected = items.map((i) => pickKeys(i, fields));
    if (output === "json") return printJson(projected);
    if (output === "ndjson") return printLines(renderNdjson(projected));
    if (output === "yaml") return printLines(renderYaml(projected));
    const rows = items.map((i) => fields.map((k) => stringifyField(i[k])));
    if (output === "csv") printCsv(rows, noHeader ? undefined : fields);
    else printTable(rows, noHeader ? undefined : fields);
    return;
  }

  if (output === "json") return printJson(items);
  if (output === "ndjson") return printLines(renderNdjson(items));
  if (output === "yaml") return printLines(renderYaml(items));

  const color = isColorEnabled({ output });
  const rows = items.map((i) =>
    config.columns.map((c) => {
      const cell = c.format ? c.format(i) : stringifyField(i[c.key]);
      return color && isStatusColumn(c) ? colorizeStatus(cell) : cell;
    }),
  );
  if (output === "csv") {
    printCsv(rows, noHeader ? undefined : config.columns.map((c) => c.key));
  } else {
    printTable(rows, noHeader ? undefined : config.columns.map((c) => c.label));
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
  const noHeader = headersSuppressed(config.opts);

  // Redact before any projection or formatting, so no output path can leak a value.
  item = isRedactRequested(config.opts) ? (redactValue(item) as Record<string, unknown>) : item;

  const field = resolveFieldOpt(config.opts);
  if (field) {
    printLines(renderField([item], field));
    return;
  }

  const explicitFields = parseFields(config.opts);
  const viewFields = resolveViewKeys(config.opts, [item]);
  const projected = explicitFields ?? viewFields;

  const template = config.opts.template as string | undefined;
  if (template) {
    const value = projected ? pickKeys(item, projected) : item;
    printLines(renderTemplateLine(value, validateTemplate(template)));
    return;
  }

  if (projected) {
    const picked = pickKeys(item, projected);
    if (output === "json") return printJson(picked);
    if (output === "ndjson") return printLines(renderNdjson([picked]));
    if (output === "yaml") return printLines(toYaml(picked));
    if (output === "csv") {
      printCsv([projected.map((k) => stringifyField(item[k]))], noHeader ? undefined : projected);
      return;
    }
    const rows = projected.map((k) => [k, stringifyField(item[k])]);
    printTable(rows, noHeader ? undefined : ["Field", "Value"]);
    return;
  }

  if (output === "json") return printJson(item);
  if (output === "ndjson") return printLines(renderNdjson([item]));
  if (output === "yaml") return printLines(toYaml(item));
  if (output === "csv") {
    const keys = config.fields.map((f) => f.key);
    const row = config.fields.map((f) =>
      f.format ? f.format(item) : stringifyField(item[f.key]),
    );
    printCsv([row], noHeader ? undefined : keys);
    return;
  }
  const color = isColorEnabled({ output });
  const rows = config.fields.map((f) => {
    const cell = f.format ? f.format(item) : stringifyField(item[f.key]);
    return [f.label, color && isStatusColumn(f) ? colorizeStatus(cell) : cell];
  });
  printTable(rows, noHeader ? undefined : ["Field", "Value"]);
}

/**
 * After a mutation, re-fetch the object and render its resulting state honoring
 * `--output`/`--json`/`--fields`. Echoing the server's post-write view makes a
 * half-applied write detectable by an agent (the printed state reflects what
 * actually persisted, not the request body). Returns the fetched object.
 */
export async function echoState(
  client: DolibarrApiClient,
  getPath: string,
  opts: Record<string, unknown>,
  fields: ColumnSpec[],
): Promise<Record<string, unknown>> {
  const fresh = await client.get<Record<string, unknown>>(getPath);
  renderGet(fresh, { opts, fields });
  return fresh;
}

/**
 * The resolved HTTP request a dry run would have sent (v0.6.8).
 *
 * Optional: supplied by the commands where knowing the exact endpoint matters most —
 * the money movers — rather than retrofitted onto all 292 leaves.
 */
export interface DryRunRequest {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

/**
 * If `--dry-run` was passed, emit a normalized dry-run JSON envelope and return true.
 * Otherwise return false so the caller can continue.
 *
 * Passing `request` adds a `request` key showing the resolved method, path and body.
 */
export function dryRunJson(
  action: string,
  payload: Record<string, unknown>,
  request?: DryRunRequest,
): boolean {
  if (!isDryRunEnabled()) return false;
  // `request` is only added when a caller supplies it, so the pre-0.6.8 envelope shape
  // is unchanged for every command that has not been given a request descriptor.
  printJson({
    dryRun: true,
    action,
    ...payload,
    ...(request ? { request: { method: request.method, path: request.path, body: request.body ?? null } } : {}),
  });
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
