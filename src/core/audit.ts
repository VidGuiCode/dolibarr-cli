import * as fs from "node:fs";
import * as path from "node:path";
import { redactValue } from "./views.js";

/**
 * Audit trail for mutating API calls (v0.6.3).
 *
 * Records every write the CLI actually attempts — method, endpoint, body, outcome —
 * as one JSON object per line, so a run can be reconstructed after the fact. This is
 * the record that makes unattended operation reviewable rather than merely permitted.
 *
 * Opt-in: `--audit-log <path>` or `DOLIBARR_AUDIT_LOG=<path>`. Off by default, because
 * silently writing a file containing business data to a user's disk is not something
 * to do without being asked.
 *
 * Two things NEVER reach the log: the API key (which the client holds, and which is
 * excluded by only ever logging the body, never the headers), and any field
 * `views.ts` classifies as sensitive — IBANs, notes, credentials, contact details.
 * Redaction here is unconditional and does not depend on `--redact`.
 */

export interface AuditEntry {
  ts: string;
  method: string;
  path: string;
  /** Redacted request body, or null when the request had none. */
  body: unknown;
  outcome: "success" | "error" | "blocked";
  /** HTTP status when the call reached the server. */
  status?: number;
  /** Error message when the call failed or was refused. */
  error?: string;
}

let resolvedPath: string | null | undefined;

/** Where the audit log should be written, or null when auditing is off. */
export function auditLogPath(argv: string[] = process.argv, env = process.env): string | null {
  const i = argv.indexOf("--audit-log");
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const fromEnv = (env.DOLIBARR_AUDIT_LOG ?? "").trim();
  return fromEnv === "" ? null : fromEnv;
}

/** Reset the memoized path. Exists for tests, which must not leak state between cases. */
export function resetAuditPath(): void {
  resolvedPath = undefined;
}

export function isAuditEnabled(): boolean {
  if (resolvedPath === undefined) resolvedPath = auditLogPath();
  return resolvedPath !== null;
}

/**
 * Strip anything that must never be persisted. Applied to every entry regardless of
 * flags — an audit log that leaks an IBAN is worse than no audit log.
 */
export function sanitizeAuditEntry(entry: AuditEntry): AuditEntry {
  return { ...entry, body: entry.body === undefined ? null : redactValue(entry.body) };
}

export function formatAuditLine(entry: AuditEntry): string {
  return JSON.stringify(sanitizeAuditEntry(entry));
}

/**
 * Append one entry. Never throws: a failure to write the audit log must not abort the
 * user's command, but it must not pass unnoticed either, so it warns on stderr once.
 */
let warned = false;
export function recordAudit(entry: AuditEntry): void {
  if (!isAuditEnabled()) return;
  const target = resolvedPath as string;
  try {
    const dir = path.dirname(target);
    if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(target, formatAuditLine(entry) + "\n", "utf-8");
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error(
        `Warning: could not write the audit log at ${target}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Build an entry with the timestamp filled in. */
export function auditEntry(
  method: string,
  apiPath: string,
  body: unknown,
  outcome: AuditEntry["outcome"],
  extra: { status?: number; error?: string } = {},
): AuditEntry {
  return {
    ts: new Date().toISOString(),
    method,
    path: apiPath.replace(/^\//, ""),
    body: body === undefined ? null : body,
    outcome,
    ...extra,
  };
}
