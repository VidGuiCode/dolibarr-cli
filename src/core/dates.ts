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
 * Convert a human date/time to the `YYYY-MM-DD HH:MM:SS` string a few Dolibarr
 * endpoints demand instead of an epoch — notably `POST /tasks/{id}/addtimespent`
 * and `PUT /tasks/{id}/timespent/{lineid}`, which reject an epoch outright
 * ("Expecting date and time in `YYYY-MM-DD HH:MM:SS` format").
 *
 * Accepts:
 *  - `YYYY-MM-DD` (midnight is assumed)
 *  - `YYYY-MM-DD HH:MM` / `YYYY-MM-DD HH:MM:SS` (passed through, seconds filled in)
 *  - a Unix epoch in seconds, or any `Date.parse`-able string
 *
 * The result is always rendered in UTC so it round-trips with `toEpochSeconds`.
 */
export function toDateTimeString(input: string | number): string {
  const render = (ms: number): string =>
    new Date(ms).toISOString().replace("T", " ").slice(0, 19);

  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new ValidationError(`Invalid date: ${input}`);
    return render(Math.floor(input) * 1000);
  }

  const trimmed = input.trim();
  if (trimmed === "") throw new ValidationError("Empty date value.");

  // Already in the wanted shape — normalize the seconds part only.
  const dt = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dt) return `${dt[1]} ${dt[2]}:${dt[3]}:${dt[4] ?? "00"}`;

  const ymd = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
  if (ymd) return `${trimmed} 00:00:00`;

  // Anything else (epoch string, RFC date, …) goes through toEpochSeconds.
  return render(toEpochSeconds(trimmed) * 1000);
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
