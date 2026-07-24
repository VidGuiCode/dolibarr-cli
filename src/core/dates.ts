import { ValidationError } from "./errors.js";

/**
 * Convert a human date to the Unix epoch seconds Dolibarr's API expects.
 *
 * Accepts:
 *  - `YYYY-MM-DD` (interpreted as UTC midnight to avoid timezone drift)
 *  - a Unix epoch in seconds (all-digit string or number) — passed through
 *  - any other `Date.parse`-able string as a fallback
 *
 * Throws a ValidationError on an unparseable value so agents get a clear message
 * instead of a silent `NaN` in the request body.
 */
export function toEpochSeconds(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new ValidationError(`Invalid date: ${input}`);
    return Math.floor(input);
  }

  const trimmed = input.trim();
  if (trimmed === "") throw new ValidationError("Empty date value.");

  // Already a Unix epoch (seconds).
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  // YYYY-MM-DD → UTC midnight.
  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const ms = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Math.floor(ms / 1000);
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);

  throw new ValidationError(
    `Invalid date "${input}". Use YYYY-MM-DD or a Unix epoch (seconds).`,
  );
}

/**
 * Convert the named body fields from a human date (YYYY-MM-DD) to Unix epoch
 * seconds in place. Absent, null, or empty-string fields are left untouched.
 * Mutates and returns the body.
 */
export function normalizeDateFields(
  body: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  for (const k of keys) {
    const v = body[k];
    if (v === undefined || v === null || v === "") continue;
    body[k] = toEpochSeconds(v as string | number);
  }
  return body;
}
