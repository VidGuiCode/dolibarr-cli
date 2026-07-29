import { describe, it, expect } from "vitest";
import {
  DEFAULT_WINDOW_DAYS,
  FINGERPRINT_IGNORED_OPTS,
  duplicateError,
  findDuplicate,
  fingerprint,
  ledgerPath,
  pruneLedger,
  type LedgerRecord,
} from "../../src/core/idempotency.js";
import { ValidationError } from "../../src/core/errors.js";

const PAYMENT = {
  amount: "100",
  date: "2026-07-29",
  bankAccount: "2",
  paymentType: "CB",
};

function rec(fp: string, ts: string): LedgerRecord {
  return { fingerprint: fp, ts, command: "invoices pay" };
}

describe("payment fingerprinting", () => {
  it("is stable for the same movement", () => {
    expect(fingerprint("invoices pay", ["42"], PAYMENT)).toBe(
      fingerprint("invoices pay", ["42"], PAYMENT),
    );
  });

  it("ignores the order flags were typed in", () => {
    const reordered = {
      paymentType: "CB",
      bankAccount: "2",
      date: "2026-07-29",
      amount: "100",
    };
    expect(fingerprint("invoices pay", ["42"], reordered)).toBe(
      fingerprint("invoices pay", ["42"], PAYMENT),
    );
  });

  /** A retry typed slightly differently is still the same payment. */
  it("normalizes numeric amounts", () => {
    const base = fingerprint("invoices pay", ["42"], PAYMENT);
    for (const amount of ["100", "100.0", "100.00", 100]) {
      expect(fingerprint("invoices pay", ["42"], { ...PAYMENT, amount }), String(amount)).toBe(base);
    }
  });

  it("distinguishes a different amount", () => {
    expect(fingerprint("invoices pay", ["42"], { ...PAYMENT, amount: "250" })).not.toBe(
      fingerprint("invoices pay", ["42"], PAYMENT),
    );
  });

  it("distinguishes a different record, account, date and command", () => {
    const base = fingerprint("invoices pay", ["42"], PAYMENT);
    expect(fingerprint("invoices pay", ["43"], PAYMENT)).not.toBe(base);
    expect(fingerprint("invoices pay", ["42"], { ...PAYMENT, bankAccount: "3" })).not.toBe(base);
    expect(fingerprint("invoices pay", ["42"], { ...PAYMENT, date: "2026-07-30" })).not.toBe(base);
    expect(fingerprint("bank transfer", ["42"], PAYMENT)).not.toBe(base);
  });

  /**
   * Control flags must not participate. `--max` in particular carries a DEFAULT value
   * from the batch layer, so it is present on every run — it once broke matching.
   */
  it("ignores control flags, including ones with defaults", () => {
    const base = fingerprint("invoices pay", ["42"], PAYMENT);
    expect(
      fingerprint("invoices pay", ["42"], {
        ...PAYMENT,
        max: "100",
        confirm: true,
        approve: "tok",
        allowDuplicate: true,
        json: true,
        output: "json",
        filter: "(t.ref:like:'X%')",
      }),
    ).toBe(base);
  });

  it("excludes every documented control flag", () => {
    for (const k of ["confirm", "approve", "allowDuplicate", "max", "filter", "json"]) {
      expect(FINGERPRINT_IGNORED_OPTS.has(k), k).toBe(true);
    }
  });

  /** An exclusion list means a new money flag is covered by default. */
  it("includes an unrecognized flag rather than ignoring it", () => {
    expect(fingerprint("invoices pay", ["42"], { ...PAYMENT, someNewField: "x" })).not.toBe(
      fingerprint("invoices pay", ["42"], PAYMENT),
    );
  });

  it("ignores absent and false-valued flags", () => {
    expect(
      fingerprint("invoices pay", ["42"], { ...PAYMENT, close: false, note: undefined, x: "" }),
    ).toBe(fingerprint("invoices pay", ["42"], PAYMENT));
  });
});

describe("the movement ledger", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  const fp = "abc123";

  it("finds an identical recent movement", () => {
    const records = [rec(fp, "2026-07-29T11:00:00Z")];
    expect(findDuplicate(records, fp, now)).toBeDefined();
  });

  it("does not match a different movement", () => {
    expect(findDuplicate([rec("other", "2026-07-29T11:00:00Z")], fp, now)).toBeUndefined();
  });

  it("stops matching once the window has passed", () => {
    const old = new Date(now.getTime() - (DEFAULT_WINDOW_DAYS + 1) * 86400000).toISOString();
    expect(findDuplicate([rec(fp, old)], fp, now)).toBeUndefined();
  });

  it("still matches just inside the window", () => {
    const recent = new Date(now.getTime() - (DEFAULT_WINDOW_DAYS - 1) * 86400000).toISOString();
    expect(findDuplicate([rec(fp, recent)], fp, now)).toBeDefined();
  });

  it("prunes expired records so the file cannot grow without bound", () => {
    const old = new Date(now.getTime() - 90 * 86400000).toISOString();
    const pruned = pruneLedger([rec(fp, old), rec("keep", "2026-07-29T11:00:00Z")], now);
    expect(pruned.map((r) => r.fingerprint)).toEqual(["keep"]);
  });

  it("discards records with an unparseable timestamp", () => {
    expect(pruneLedger([rec(fp, "not-a-date")], now)).toEqual([]);
  });

  it("honours DOLIBARR_IDEMPOTENCY_FILE", () => {
    expect(ledgerPath({ DOLIBARR_IDEMPOTENCY_FILE: "/tmp/x.json" })).toBe("/tmp/x.json");
  });
});

describe("duplicateError", () => {
  const err = duplicateError("invoices pay", rec("abc", "2026-07-29T11:00:00Z"));

  it("is a validation error, so it exits 3", () => {
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("says when the original happened and how to override", () => {
    expect(err.message).toContain("2026-07-29T11:00:00Z");
    expect(err.message).toContain("--allow-duplicate");
  });

  /** Overstating the guarantee would be worse than not having it. */
  it("admits it only sees writes from this CLI on this machine", () => {
    expect(err.message).toContain("only sees writes made by this CLI on this machine");
  });
});
