import type { Command } from "commander";
import { ValidationError } from "./errors.js";
import { walkLeaves } from "./command-tree.js";

/**
 * Pipeline output formats (v0.5.5): `--output ndjson`, `--output yaml`,
 * `--template`, `--no-header` and `--quiet`.
 *
 * Everything here is hand-rolled — `commander` stays the only runtime dep.
 */

/** One row per line, no wrapping array — the shape `jq`/`while read` expect. */
export function renderNdjson(items: unknown[]): string {
  return items.map((i) => JSON.stringify(i)).join("\n");
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function yamlKey(key: string): string {
  return SAFE_KEY.test(key) ? key : yamlString(key);
}

/**
 * Emit a double-quoted YAML scalar.
 *
 * **Every** string is quoted, unconditionally. An unquoted `1.0`, `yes`, `null`
 * or `2024-01-01` would be re-typed by the reader as a number, boolean, null or
 * date — a silent data change in the middle of a pipeline, which is exactly the
 * failure this line exists to prevent. Quoting always is uglier and always
 * correct.
 */
function yamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * Serialise a value as YAML, covering the shapes Dolibarr actually returns:
 * flat-ish objects, nested `lines` arrays, nulls, numbers and strings.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return yamlString(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 1);
        // Nested containers start on the next line, under the dash.
        return isScalar(item)
          ? `${pad}- ${rendered}`
          : `${pad}-\n${indentBlock(rendered, indent + 1)}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, v]) => {
      const rendered = toYaml(v, indent + 1);
      if (isScalar(v) || rendered === "[]" || rendered === "{}") {
        return `${pad}${yamlKey(k)}: ${rendered}`;
      }
      return `${pad}${yamlKey(k)}:\n${rendered}`;
    })
    .join("\n");
}

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

function indentBlock(text: string, indent: number): string {
  const pad = "  ".repeat(indent);
  return text
    .split("\n")
    .map((l) => (l.startsWith(pad) ? l : pad + l))
    .join("\n");
}

/** Render a list of items as a YAML sequence. */
export function renderYaml(items: unknown[]): string {
  if (items.length === 0) return "[]";
  return toYaml(items, 0);
}

const TEMPLATE_TOKEN = /\{\{\s*\.([A-Za-z0-9_.\[\]-]*)\s*\}\}/g;

/**
 * Resolve a dotted path (`lines.0.qty`) against an object. Returns undefined
 * for anything missing, so a template never throws mid-stream.
 */
export function lookupPath(item: unknown, dotted: string): unknown {
  if (dotted === "") return item;
  let cur: unknown = item;
  for (const part of dotted.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Stringify a looked-up value for template output. */
export function templateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Expand a Go-style `{{.field}}` template against one item.
 *
 * Unknown fields render empty rather than erroring — a row missing an optional
 * field should not kill the stream.
 */
export function renderTemplateLine(item: unknown, template: string): string {
  return template.replace(TEMPLATE_TOKEN, (_m, path: string) =>
    templateValue(lookupPath(item, path)),
  );
}

/** Validate a template string, rejecting one with no substitutions at all. */
export function validateTemplate(template: string): string {
  if (!/\{\{/.test(template)) {
    throw new ValidationError(
      `--template must contain at least one {{.field}} placeholder, got "${template}".`,
    );
  }
  TEMPLATE_TOKEN.lastIndex = 0;
  if (!TEMPLATE_TOKEN.test(template)) {
    throw new ValidationError(
      `--template placeholders must look like {{.field}} (a leading dot), got "${template}".`,
    );
  }
  TEMPLATE_TOKEN.lastIndex = 0;
  return template;
}

/** Expand a template across many items, one line each. */
export function renderTemplate(items: unknown[], template: string): string {
  return items.map((i) => renderTemplateLine(i, template)).join("\n");
}

/**
 * Validate `--field` (v0.5.6) and return the single key it selects.
 *
 * `--field` (scalar extraction) sits one letter from the long-standing
 * `--fields` (column projection), which is a genuine footgun. Rather than leave
 * a mix-up to fail silently, every confusable combination is rejected loudly:
 * a comma in the value, or pairing `--field` with `--fields` or `--template`.
 *
 * @throws ValidationError naming the flag the user probably meant.
 */
export function resolveFieldOpt(opts: Record<string, unknown>): string | undefined {
  const raw = opts.field as string | undefined;
  if (raw === undefined) return undefined;

  const key = raw.trim();
  if (key === "") {
    throw new ValidationError("--field needs a key, e.g. --field ref.");
  }
  if (key.includes(",")) {
    throw new ValidationError(
      `--field takes a single key and prints one raw value per row; ` +
        `did you mean --fields ${key} (column projection)?`,
    );
  }
  if (opts.fields !== undefined) {
    throw new ValidationError(
      "--field (one raw value per row) and --fields (column projection) do things different " +
        "enough that combining them is almost certainly a mistake. Pass one or the other.",
    );
  }
  if (opts.template !== undefined) {
    throw new ValidationError("--field and --template are two ways to say the same thing; pass one.");
  }
  return key;
}

/** Extract one raw value per item — no header, no quoting, xargs-friendly. */
export function renderField(items: unknown[], key: string): string {
  return items.map((i) => templateValue(lookupPath(i, key))).join("\n");
}

/** True when `--no-header` was passed (commander stores it as `header === false`). */
export function headersSuppressed(opts: Record<string, unknown>): boolean {
  return opts.header === false || opts.quiet === true;
}

/**
 * Add the pipeline flags to every command that already renders output — i.e.
 * every one built with `addListOptions` / `addGetOptions`, identified by
 * `--output`. Returns the wired paths.
 */
export function enableOutputFormats(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    if (cmd.commands.length > 0) continue;

    const internal = cmd as unknown as { __formatsWired?: boolean };
    if (internal.__formatsWired) continue;
    internal.__formatsWired = true;

    const longs = cmd.options.map((o) => o.long);

    // --quiet is universal: it also silences the batch reporter, and those
    // commands render through --json rather than --output.
    if (!longs.includes("--quiet")) {
      cmd.option("--quiet", "Suppress headers and progress chatter; print data only");
    }

    // The rendering flags only make sense where there is rendered output.
    if (!longs.includes("--output")) continue;
    if (!longs.includes("--field")) {
      cmd.option(
        "--field <key>",
        "Print one raw value per row (singular; --fields projects columns)",
      );
    }
    if (!longs.includes("--template")) {
      cmd.option("--template <tpl>", "Render each row with a {{.field}} template");
    }
    if (!longs.includes("--no-header")) {
      cmd.option("--no-header", "Omit the header row from table/csv output");
    }
    wired.push(path);
  }

  return wired;
}
