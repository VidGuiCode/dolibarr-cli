import { describe, it, expect } from "vitest";
import {
  REDACTED,
  SENSITIVE_KEYS,
  VIEWS,
  VIEW_NAMES,
  isSensitiveKey,
  redactItems,
  redactValue,
  resolveViewKeys,
  resolveViewName,
  viewKeysFor,
} from "../../src/core/views.js";
import { ValidationError } from "../../src/core/errors.js";

const invoice = {
  id: "16",
  ref: "IN2401-0001",
  date: 1704067200,
  socid: "3",
  total_ht: "10.00",
  total_ttc: "11.70",
  status: "0",
  note_private: "chase this one",
  email: "billing@example.com",
  iban: "XX00 1234 5678",
  unused_field: null,
  another_null: "",
};

describe("output views", () => {
  describe("resolveViewName", () => {
    it("accepts every documented view, case-insensitively", () => {
      for (const n of VIEW_NAMES) {
        expect(resolveViewName(n)).toBe(n);
        expect(resolveViewName(n.toUpperCase())).toBe(n);
      }
    });

    it("returns undefined when no view was requested", () => {
      expect(resolveViewName(undefined)).toBeUndefined();
      expect(resolveViewName("")).toBeUndefined();
    });

    it("rejects an unknown view, listing the accepted ones", () => {
      expect(() => resolveViewName("bogus")).toThrow(ValidationError);
      expect(() => resolveViewName("bogus")).toThrow(/summary/);
    });

    /** `--profile <name>` is reserved for 0.7.0 multi-instance config. */
    it("is spelled --view, not --profile", () => {
      expect(VIEW_NAMES).toContain("summary");
      expect(() => resolveViewName("profile")).toThrow(ValidationError);
    });
  });

  describe("viewKeysFor", () => {
    it("projects a large object down to the summary fields", () => {
      const keys = viewKeysFor("summary", [invoice])!;
      expect(keys).toEqual(["id", "ref", "date", "socid", "total_ht", "total_ttc", "status"]);
    });

    it("keeps the view's declared order, not the object's", () => {
      const keys = viewKeysFor("summary", [{ status: 1, id: 2, ref: "R" }])!;
      expect(keys).toEqual(["id", "ref", "status"]);
    });

    it("drops keys the object does not carry rather than rendering blanks", () => {
      expect(viewKeysFor("summary", [{ id: 1, ref: "R" }])).toEqual(["id", "ref"]);
    });

    /** A column that is null on every row is noise — views exist to cut that tail. */
    it("drops keys that are null or empty on every row", () => {
      const keys = viewKeysFor("summary", [invoice])!;
      expect(keys).not.toContain("unused_field");
      expect(keys).not.toContain("another_null");
    });

    it("keeps a key when at least one row has a value", () => {
      const keys = viewKeysFor("summary", [{ id: 1, ref: null }, { id: 2, ref: "R" }])!;
      expect(keys).toContain("ref");
    });

    it("full means no projection at all", () => {
      expect(viewKeysFor("full", [invoice])).toBeUndefined();
    });

    /** Showing nothing would read as "no data", which is worse than showing everything. */
    it("falls back to no projection when a view matches nothing", () => {
      expect(viewKeysFor("accounting", [{ totally: "unrelated" }])).toBeUndefined();
    });

    it("handles an empty result set", () => {
      expect(viewKeysFor("summary", [])).toBeUndefined();
    });

    it("declares a non-empty key list for every named view", () => {
      for (const n of VIEW_NAMES) {
        if (n === "full") continue;
        expect(VIEWS[n].length, n).toBeGreaterThan(0);
      }
    });
  });

  describe("resolveViewKeys", () => {
    it("returns undefined when no view was asked for", () => {
      expect(resolveViewKeys({}, [invoice])).toBeUndefined();
    });

    /** Same rule 0.5.6 set for --field vs --fields: confusable combinations fail loudly. */
    it("rejects --view together with --fields instead of silently picking one", () => {
      expect(() => resolveViewKeys({ view: "summary", fields: "id,ref" }, [invoice])).toThrow(
        ValidationError,
      );
    });

    it("allows --fields on its own", () => {
      expect(() => resolveViewKeys({ fields: "id,ref" }, [invoice])).not.toThrow();
    });
  });
});

describe("redaction", () => {
  it("masks bank identifiers", () => {
    for (const k of ["iban", "bic", "rum", "account_number"]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
  });

  it("masks notes, credentials and direct contact details", () => {
    for (const k of ["note_private", "note_public", "password", "token", "email", "phone"]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
  });

  it("matches key names exactly, never as substrings", () => {
    expect(isSensitiveKey("email_template")).toBe(false);
    expect(isSensitiveKey("total_ht")).toBe(false);
    expect(isSensitiveKey("ref")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isSensitiveKey("IBAN")).toBe(true);
    expect(isSensitiveKey("Note_Private")).toBe(true);
  });

  it("replaces the value but keeps the key, so withheld reads differently from absent", () => {
    const out = redactValue({ id: 1, email: "a@b.c" }) as Record<string, unknown>;
    expect(out).toEqual({ id: 1, email: REDACTED });
    expect("email" in out).toBe(true);
  });

  it("leaves non-sensitive values untouched", () => {
    expect(redactValue({ id: 1, ref: "R", total_ttc: "11.70" })).toEqual({
      id: 1,
      ref: "R",
      total_ttc: "11.70",
    });
  });

  it("does not turn an empty value into a redaction marker", () => {
    expect(redactValue({ iban: "", bic: null })).toEqual({ iban: "", bic: null });
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactValue({
      id: 1,
      owner: { name: "X", email: "a@b.c" },
      accounts: [{ iban: "XX1" }, { iban: "XX2" }],
    });
    expect(out).toEqual({
      id: 1,
      owner: { name: "X", email: REDACTED },
      accounts: [{ iban: REDACTED }, { iban: REDACTED }],
    });
  });

  it("redacts every row of a list", () => {
    const out = redactItems([{ email: "a@b.c" }, { email: "d@e.f" }]);
    expect(out).toEqual([{ email: REDACTED }, { email: REDACTED }]);
  });

  it("has no sensitive key listed twice", () => {
    expect(new Set(SENSITIVE_KEYS).size).toBe(SENSITIVE_KEYS.size);
  });
});
