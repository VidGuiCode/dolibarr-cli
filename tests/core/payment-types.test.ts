import { describe, it, expect, vi, beforeEach } from "vitest";
import { DolibarrApiClient } from "../../src/core/api-client.js";
import { resolvePaymentTypeId } from "../../src/core/payment-types.js";
import { ValidationError } from "../../src/core/errors.js";

const PAYMENT_TYPES = [
  { id: "2", code: "CHQ", label: "Cheque", active: "1" },
  { id: "4", code: "LIQ", label: "Cash", active: "1" },
  { id: "6", code: "CB", label: "Credit card", active: "1" },
  { id: "50", code: "VIR", label: "Bank transfer", active: "1" },
];

describe("resolvePaymentTypeId", () => {
  const client = new DolibarrApiClient({
    baseUrl: "https://erp.example.com",
    apiKey: "k",
    retries: 0,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a numeric id through without any API call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const id = await resolvePaymentTypeId(client, "6");
    expect(id).toBe(6);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves a code to its dictionary id", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(PAYMENT_TYPES), { status: 200 }),
    );
    expect(await resolvePaymentTypeId(client, "CB")).toBe(6);
    expect(await resolvePaymentTypeId(client, "VIR")).toBe(50);
  });

  it("matches codes case-insensitively and trims whitespace", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(PAYMENT_TYPES), { status: 200 }),
    );
    expect(await resolvePaymentTypeId(client, "  liq ")).toBe(4);
  });

  it("throws a ValidationError listing known codes for an unknown code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(PAYMENT_TYPES), { status: 200 }),
    );
    await expect(resolvePaymentTypeId(client, "PAYPAL")).rejects.toThrow(ValidationError);
    await expect(resolvePaymentTypeId(client, "PAYPAL")).rejects.toThrow(/CB, CHQ, LIQ, VIR/);
  });

  it("falls back to rowid when id is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ rowid: 9, code: "PRE" }]), { status: 200 }),
    );
    expect(await resolvePaymentTypeId(client, "PRE")).toBe(9);
  });

  it("requests the dictionary with a high limit so nothing is paginated out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(PAYMENT_TYPES), { status: 200 }),
    );
    await resolvePaymentTypeId(client, "CB");
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/setup/dictionary/payment_types");
    expect(url).toContain("limit=1000");
  });
});
