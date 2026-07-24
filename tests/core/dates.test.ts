import { describe, it, expect } from "vitest";
import { toEpochSeconds, normalizeDateFields } from "../../src/core/dates.js";
import { ValidationError } from "../../src/core/errors.js";

describe("toEpochSeconds", () => {
  it("converts YYYY-MM-DD to UTC-midnight epoch seconds", () => {
    // 2026-01-15T00:00:00Z
    expect(toEpochSeconds("2026-01-15")).toBe(Date.UTC(2026, 0, 15) / 1000);
    expect(toEpochSeconds("2026-01-15")).toBe(1768435200);
  });

  it("passes an all-digit epoch string through", () => {
    expect(toEpochSeconds("1768435200")).toBe(1768435200);
  });

  it("passes a numeric epoch through (floored)", () => {
    expect(toEpochSeconds(1768435200)).toBe(1768435200);
    expect(toEpochSeconds(1768435200.9)).toBe(1768435200);
  });

  it("does not drift across timezones (date-only is UTC)", () => {
    // A fixed date should always map to the same second regardless of local TZ.
    expect(toEpochSeconds("2000-01-01")).toBe(946684800);
  });

  it("throws a ValidationError on an unparseable value", () => {
    expect(() => toEpochSeconds("not-a-date")).toThrow(ValidationError);
    expect(() => toEpochSeconds("")).toThrow(ValidationError);
  });
});

describe("normalizeDateFields", () => {
  it("converts named date fields to epoch in place", () => {
    const body = { date: "2026-01-15", datef: "2026-02-01", amount: 50 };
    normalizeDateFields(body, ["date", "datef"]);
    expect(body.date).toBe(Date.UTC(2026, 0, 15) / 1000);
    expect(body.datef).toBe(Date.UTC(2026, 1, 1) / 1000);
    expect(body.amount).toBe(50);
  });

  it("leaves absent, null, and empty fields untouched", () => {
    const body: Record<string, unknown> = { date: null, other: "" };
    normalizeDateFields(body, ["date", "other", "missing"]);
    expect(body.date).toBeNull();
    expect(body.other).toBe("");
    expect("missing" in body).toBe(false);
  });

  it("leaves an already-epoch field unchanged", () => {
    const body = { date: 1768435200 };
    normalizeDateFields(body, ["date"]);
    expect(body.date).toBe(1768435200);
  });
});
