import type { DolibarrApiClient } from "./api-client.js";
import { ValidationError } from "./errors.js";

/**
 * Resolve a `--payment-type` value to the numeric dictionary id Dolibarr's payment
 * endpoints expect. A numeric input is passed through unchanged. A code (`CB`,
 * `VIR`, `LIQ`, `CHQ`, …) is looked up case-insensitively against
 * `GET /setup/dictionary/payment_types` — the stable identifier, unlike the
 * per-instance numeric rowid.
 *
 * Throws a ValidationError listing the known codes when the code isn't found.
 */
export async function resolvePaymentTypeId(
  client: Pick<DolibarrApiClient, "get">,
  input: string,
): Promise<number> {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const rows = await client.get<Record<string, unknown>[]>("setup/dictionary/payment_types", {
    limit: 1000,
  });
  const wanted = trimmed.toUpperCase();
  const match = Array.isArray(rows)
    ? rows.find((r) => String(r.code ?? "").toUpperCase() === wanted)
    : undefined;

  if (!match) {
    const codes = Array.isArray(rows)
      ? Array.from(
          new Set(rows.map((r) => String(r.code ?? "").toUpperCase()).filter(Boolean)),
        ).sort()
      : [];
    const known = codes.length ? ` Known codes: ${codes.join(", ")}.` : "";
    throw new ValidationError(
      `Unknown payment type "${input}".${known} You can also pass the numeric dictionary id.`,
    );
  }

  const id = match.id ?? match.rowid;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    throw new ValidationError(
      `Payment type "${input}" matched a dictionary row with a non-numeric id (${String(id)}).`,
    );
  }
  return n;
}
