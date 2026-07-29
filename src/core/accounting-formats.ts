import { ValidationError } from "./errors.js";

/**
 * Dolibarr's `GET /accountancy/exportdata` takes a NUMERIC export-model id, not a
 * format name. Passing a name (`CSV`, `FEC`, `FEC2`) makes the server answer
 * `404 Not Found: Accountancy export format not found` from inside
 * `api_accountancy.class.php` — which is what broke `accounting ledger` up to v0.5.6.
 *
 * The ids below are Dolibarr's `AccountancyExport::$EXPORT_TYPE_*` constants
 * (verified against Dolibarr 20.0.4 and confirmed against a live 20.0.4 instance:
 * exactly these ids are accepted, every other id is rejected). They have been
 * stable across Dolibarr 14–20.
 *
 * Which models actually produce output depends on the instance's accounting
 * configuration — an accepted id may still return an empty body if the model is
 * unconfigured or the period holds no bound entries. `FEC` (1000) is the one
 * that works out of the box on a standard French install.
 */
export interface AccountingExportFormat {
  /** Dolibarr's numeric export-model id, sent as the `format` query param. */
  readonly id: number;
  /** Canonical CLI name. */
  readonly name: string;
  /** Human-readable description shown by `accounting formats`. */
  readonly label: string;
  /** Extra accepted spellings, all lowercase. */
  readonly aliases: readonly string[];
}

export const ACCOUNTING_EXPORT_FORMATS: readonly AccountingExportFormat[] = [
  { id: 1, name: "configurable", label: "Configurable CSV (uses the instance's export settings)", aliases: ["csv"] },
  { id: 10, name: "agiris", label: "Agiris", aliases: [] },
  { id: 15, name: "ebp", label: "EBP", aliases: [] },
  { id: 20, name: "cegid", label: "Cegid Expert", aliases: [] },
  { id: 25, name: "cogilog", label: "Cogilog", aliases: [] },
  { id: 30, name: "coala", label: "Coala", aliases: [] },
  { id: 35, name: "bob50", label: "BOB 50", aliases: [] },
  { id: 40, name: "ciel", label: "Ciel / Sage 50 France", aliases: [] },
  { id: 45, name: "sage50-swiss", label: "Sage 50 Switzerland", aliases: ["sage50"] },
  { id: 50, name: "charlemagne", label: "Charlemagne", aliases: [] },
  { id: 60, name: "quadratus", label: "Quadratus", aliases: [] },
  { id: 70, name: "winfic", label: "Winfic / eWinfic", aliases: [] },
  { id: 100, name: "openconcerto", label: "OpenConcerto", aliases: [] },
  { id: 110, name: "ldcompta", label: "LD Compta", aliases: [] },
  { id: 120, name: "ldcompta10", label: "LD Compta v10", aliases: [] },
  { id: 130, name: "gestimum-v3", label: "Gestimum v3", aliases: ["gestimumv3"] },
  { id: 135, name: "gestimum-v5", label: "Gestimum v5", aliases: ["gestimumv5"] },
  { id: 200, name: "isuiteexpert", label: "iSuite Expert", aliases: ["isuite-expert"] },
  { id: 1000, name: "fec", label: "FEC — French tax authority export (recommended)", aliases: [] },
  { id: 1010, name: "fec2", label: "FEC2 — FEC variant with alternative column order", aliases: [] },
];

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Every accepted spelling, canonical names first — for help and error text. */
export function exportFormatNames(): string[] {
  return ACCOUNTING_EXPORT_FORMATS.map((f) => f.name);
}

/**
 * Turn a user-supplied `--format` value into the numeric id Dolibarr expects.
 *
 * Accepts a canonical name, an alias, or a raw numeric id. The numeric passthrough
 * matters: it keeps the CLI usable if a future Dolibarr adds an export model this
 * table doesn't know about yet.
 */
export function resolveExportFormat(input: string): number {
  const raw = input.trim();
  if (raw === "") {
    throw new ValidationError(
      `--format is required. Accepted formats: ${exportFormatNames().join(", ")}.\n` +
        `  Run \`dolibarr accounting formats\` for the full list with numeric ids.`,
    );
  }

  if (/^\d+$/.test(raw)) return Number(raw);

  const key = normalize(raw);
  const match = ACCOUNTING_EXPORT_FORMATS.find(
    (f) => f.name === key || f.aliases.includes(key),
  );
  if (match) return match.id;

  throw new ValidationError(
    `Unknown accounting export format "${input}". Accepted formats: ${exportFormatNames().join(", ")}.\n` +
      `  A numeric Dolibarr export-model id is also accepted (e.g. 1000 for FEC).\n` +
      `  Run \`dolibarr accounting formats\` for the full list.`,
  );
}

/** Look up a format by its numeric id, for reporting back what was sent. */
export function findExportFormatById(id: number): AccountingExportFormat | undefined {
  return ACCOUNTING_EXPORT_FORMATS.find((f) => f.id === id);
}
