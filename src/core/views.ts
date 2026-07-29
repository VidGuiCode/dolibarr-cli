import type { Command } from "commander";
import { ValidationError } from "./errors.js";
import { walkLeaves } from "./command-tree.js";

/**
 * Named output views + sensitive-field redaction (v0.6.2).
 *
 * Dolibarr returns very large objects — internal ids, user metadata, private and
 * public notes, bank references, contact details, and a long tail of nulls. The
 * 2026-07-29 report flagged that as a privacy and usability problem: `--fields`
 * helps but requires knowing every key name in advance.
 *
 * A view is a *candidate* key list resolved against the keys an object actually
 * has. Keys that aren't present are dropped rather than rendered empty, so one
 * table works across every resource and a view never invents a column.
 *
 * ⚠️ The flag is `--view`, NOT `--profile`. `--profile <name>` is reserved for
 * multi-instance config in 0.7.0.
 */

export const VIEW_NAMES = [
  "summary",
  "accounting",
  "reconciliation",
  "contact",
  "admin",
  "full",
] as const;

export type ViewName = (typeof VIEW_NAMES)[number];

/**
 * Candidate keys per view, in display order. Supersets across resources by design —
 * resolution keeps only what the object actually carries.
 */
export const VIEWS: Record<Exclude<ViewName, "full">, readonly string[]> = {
  summary: [
    "id",
    "ref",
    "ref_supplier",
    "label",
    "name",
    "date",
    "datef",
    "socid",
    "total_ht",
    "total_ttc",
    "amount",
    "status",
    "statut",
  ],
  accounting: [
    "id",
    "ref",
    "date",
    "datef",
    "date_lim_reglement",
    "type",
    "total_ht",
    "total_tva",
    "total_ttc",
    "remaintopay",
    "accountancy_code",
    "accountancy_code_sell",
    "accountancy_code_buy",
    "fk_account",
    "multicurrency_code",
    "status",
  ],
  reconciliation: [
    "id",
    "ref",
    "date",
    "dateo",
    "datev",
    "label",
    "amount",
    "total_ttc",
    "remaintopay",
    "num_releve",
    "num_chq",
    "fk_account",
    "fk_type",
    "rappro",
  ],
  contact: [
    "id",
    "name",
    "lastname",
    "firstname",
    "email",
    "phone",
    "phone_pro",
    "phone_mobile",
    "address",
    "zip",
    "town",
    "country_code",
    "socid",
  ],
  admin: [
    "id",
    "ref",
    "entity",
    "status",
    "statut",
    "active",
    "date_creation",
    "date_modification",
    "user_author_id",
    "user_modif_id",
    "import_key",
  ],
};

/**
 * Field keys whose values are masked by `--redact`.
 *
 * Matched case-insensitively against the exact key name, not as a substring, so an
 * unrelated key never gets silently blanked.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  // Banking identifiers
  "iban",
  "iban_prefix",
  "bic",
  "rum",
  "account_number",
  "number",
  "cle_rib",
  "code_banque",
  "code_guichet",
  "owner_address",
  "proprio",
  // Free-text that routinely holds private commentary
  "note",
  "note_private",
  "note_public",
  // Credentials
  "api_key",
  "apikey",
  "password",
  "pass",
  "pass_crypted",
  "token",
  "secret",
  // Direct personal contact details
  "email",
  "phone",
  "phone_pro",
  "phone_perso",
  "phone_mobile",
  "fax",
]);

export const REDACTED = "[redacted]";

/** Resolve `--view <name>`, rejecting unknown names with the accepted list. */
export function resolveViewName(raw: unknown): ViewName | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const name = String(raw).trim().toLowerCase();
  if ((VIEW_NAMES as readonly string[]).includes(name)) return name as ViewName;
  throw new ValidationError(
    `Unknown view "${String(raw)}". Accepted views: ${VIEW_NAMES.join(", ")}.`,
  );
}

/**
 * The keys a view should show for these specific rows.
 *
 * Returns undefined for `full` (no projection at all). Only keys actually present
 * on at least one row survive, so a view never renders a column of blanks.
 */
export function viewKeysFor(
  view: ViewName,
  items: Record<string, unknown>[],
): string[] | undefined {
  if (view === "full") return undefined;

  // A key counts as present only if at least one row carries a real value for it.
  // A column that is null on every row is noise — the whole point of a view is to
  // cut the long tail of empty Dolibarr fields.
  const present = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    for (const [k, v] of Object.entries(item)) {
      if (v !== null && v !== undefined && v !== "") present.add(k);
    }
  }
  const keys = VIEWS[view].filter((k) => present.has(k));
  // A view that matches nothing would render an empty table and look like "no data",
  // which is worse than showing everything. Fall back rather than mislead.
  return keys.length > 0 ? keys : undefined;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Mask sensitive values, recursively, preserving structure so the shape of the
 * output does not change — only the values. A redacted key is still visible, so a
 * consumer can see that something was withheld rather than that it was absent.
 */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k)
        ? v === null || v === undefined || v === ""
          ? v
          : REDACTED
        : redactValue(v);
    }
    return out;
  }
  return value;
}

export function redactItems(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map((i) => redactValue(i) as Record<string, unknown>);
}

/** True when `--redact` was passed. */
export function isRedactRequested(opts: Record<string, unknown>): boolean {
  return Boolean(opts.redact);
}

/**
 * Resolve `--view` into a projection for these rows, rejecting the one ambiguous
 * combination rather than silently picking a winner — the same rule 0.5.6 applied
 * to `--field` vs `--fields`.
 */
export function resolveViewKeys(
  opts: Record<string, unknown>,
  items: Record<string, unknown>[],
): string[] | undefined {
  const view = resolveViewName(opts.view);
  if (!view) return undefined;
  if (opts.fields) {
    throw new ValidationError(
      "Pass either --view or --fields, not both. --view is a named preset of fields; " +
        "--fields is an explicit list.",
    );
  }
  return viewKeysFor(view, items);
}

/**
 * Add `--view` and `--redact` to every command that renders output, from one call
 * in `cli.ts`. Returns the wired paths for the reach test.
 */
export function enableViews(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    const longs = cmd.options.map((o) => o.long);
    // Only where there is rendered output to shape — same test enableOutputFormats uses.
    if (!longs.includes("--output")) continue;

    const internal = cmd as unknown as { __viewsWired?: boolean };
    if (internal.__viewsWired) continue;
    internal.__viewsWired = true;

    if (!longs.includes("--view")) {
      cmd.option(
        "--view <name>",
        `Named field preset: ${VIEW_NAMES.join("|")}`,
      );
    }
    if (!longs.includes("--redact")) {
      cmd.option("--redact", "Mask sensitive values (bank details, notes, contact data)");
    }
    wired.push(path);
  }

  return wired;
}
