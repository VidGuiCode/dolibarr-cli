import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getConfigDir } from "./config-store.js";
import { ValidationError } from "./errors.js";

/**
 * Duplicate-payment protection (v0.6.3).
 *
 * The hazard: a payment or transfer command that appears to fail — a timeout, a
 * dropped connection, an ambiguous error — but actually applied server-side. Re-running
 * it moves the money twice, and Dolibarr will happily accept the second one because
 * from its side nothing is wrong.
 *
 * So the CLI keeps a small local ledger of the money movements it has performed,
 * fingerprinted by the facts that make a payment *the same payment*: the command, the
 * account, the amount, the date, and the reference. A second attempt with an identical
 * fingerprint is refused, and can be overridden deliberately with `--allow-duplicate`.
 *
 * This is a local guard, not a distributed one. It cannot see payments made through
 * the web UI or from another machine, and it says so rather than implying otherwise.
 */

/** How long a recorded movement keeps blocking an identical repeat. */
export const DEFAULT_WINDOW_DAYS = 30;

export interface LedgerRecord {
  fingerprint: string;
  ts: string;
  command: string;
}

/**
 * Options that describe how the CLI should run rather than what money moves, and are
 * therefore excluded from the fingerprint.
 *
 * Deliberately an EXCLUSION list rather than a list of identifying fields: every
 * remaining flag participates, so a money command added later — or a flag added to an
 * existing one, like `--bank-account` — is fingerprinted automatically instead of
 * silently falling outside the check. Getting this wrong in the exclusion direction
 * weakens detection; getting it wrong in the inclusion direction only risks treating
 * two genuinely different payments as different, which is the safe failure.
 */
export const FINGERPRINT_IGNORED_OPTS: ReadonlySet<string> = new Set([
  "confirm",
  "approve",
  "allowDuplicate",
  "json",
  "output",
  "dryRun",
  "noInteractive",
  "compact",
  "quiet",
  "fields",
  "field",
  "template",
  "view",
  "redact",
  "header",
  "all",
  "maxRecords",
  "readOnly",
  "auditLog",
  "sort",
  "order",
  "limit",
  "page",
  // Batch/status-scoped selection controls. `--max` in particular carries a default
  // value, so it is present in opts on every run and would otherwise be fingerprinted
  // as though it described the payment.
  "max",
  "filter",
]);

export function ledgerPath(env = process.env): string {
  if (env.DOLIBARR_IDEMPOTENCY_FILE) return env.DOLIBARR_IDEMPOTENCY_FILE;
  return path.join(getConfigDir(), "money-writes.json");
}

/**
 * Build a stable fingerprint for a money movement.
 *
 * Only the identifying fields participate, sorted so flag order cannot change the
 * result, and normalized so `100`, `100.0` and `"100.00"` are the same amount —
 * otherwise a retry typed slightly differently would slip through.
 */
export function fingerprint(
  command: string,
  positionals: unknown[],
  opts: Record<string, unknown>,
): string {
  const parts: string[] = [command, ...positionals.filter((p) => p !== undefined && p !== null).map(String)];

  for (const key of Object.keys(opts).sort()) {
    if (FINGERPRINT_IGNORED_OPTS.has(key)) continue;
    const value = opts[key];
    if (value === undefined || value === null || value === "" || value === false) continue;
    parts.push(`${key}=${normalizeValue(value)}`);
  }

  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function normalizeValue(value: unknown): string {
  const s = String(value).trim();
  // Numeric amounts must compare equal regardless of how they were typed.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? String(n) : s;
  }
  return s.toLowerCase();
}

export function readLedger(file = ledgerPath()): LedgerRecord[] {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? (parsed as LedgerRecord[]) : [];
  } catch {
    // A corrupt ledger must not block a legitimate payment; treat it as empty.
    return [];
  }
}

/** Drop records older than the window, so the file cannot grow without bound. */
export function pruneLedger(
  records: LedgerRecord[],
  now: Date,
  windowDays = DEFAULT_WINDOW_DAYS,
): LedgerRecord[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return records.filter((r) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= cutoff;
  });
}

export function findDuplicate(
  records: LedgerRecord[],
  fp: string,
  now: Date,
  windowDays = DEFAULT_WINDOW_DAYS,
): LedgerRecord | undefined {
  return pruneLedger(records, now, windowDays).find((r) => r.fingerprint === fp);
}

export function duplicateError(command: string, previous: LedgerRecord): ValidationError {
  return new ValidationError(
    `Refusing a duplicate money movement: an identical \`${command}\` was already performed\n` +
      `  by this CLI at ${previous.ts}.\n` +
      `  Same command, account, amount, date and reference — so this looks like a repeat of a\n` +
      `  payment that already went through, which would move the money twice.\n` +
      `  If it is genuinely a second, separate payment, re-run with --allow-duplicate.\n` +
      `  Note: this check only sees writes made by this CLI on this machine.`,
  );
}

export function recordMovement(
  command: string,
  fp: string,
  now: Date,
  file = ledgerPath(),
): void {
  try {
    const records = pruneLedger(readLedger(file), now);
    records.push({ fingerprint: fp, ts: now.toISOString(), command });
    const dir = path.dirname(file);
    if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(records, null, 2), "utf-8");
  } catch {
    // Failing to record must never fail the payment that already succeeded.
  }
}
