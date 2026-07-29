import { describe, it, expect } from "vitest";
import {
  decideConfirmation,
  describeWrite,
  financialWriteSpec,
  isAssumeYes,
  MONEY_VERBS,
  STATE_VERBS,
  type ConfirmContext,
} from "../../src/core/financial-writes.js";

/** The gate with every escape hatch shut — the state a bare cron job is in. */
const LOCKED: ConfirmContext = {
  path: "bank transfer",
  hasConfirmFlag: false,
  assumeYes: false,
  dryRun: false,
  nonInteractive: true,
};

describe("financialWriteSpec", () => {
  it("classifies the money movers named in the report", () => {
    expect(financialWriteSpec("bank transfer")?.risk).toBe("money");
    expect(financialWriteSpec("bank add-transaction")?.risk).toBe("money");
    expect(financialWriteSpec("invoices pay")?.risk).toBe("money");
    expect(financialWriteSpec("supplier-invoices pay")?.risk).toBe("money");
  });

  it("classifies document state changes", () => {
    expect(financialWriteSpec("invoices validate")?.risk).toBe("state");
    expect(financialWriteSpec("orders close")?.risk).toBe("state");
    expect(financialWriteSpec("supplier-orders approve")?.risk).toBe("state");
  });

  it("classifies raw and document overwrite separately", () => {
    expect(financialWriteSpec("raw")?.risk).toBe("raw");
    expect(financialWriteSpec("documents upload")?.risk).toBe("overwrite");
  });

  /** Verb-based, so a resource group added later inherits the gate for free. */
  it("covers a hypothetical future group by verb alone", () => {
    expect(financialWriteSpec("newthing validate")?.risk).toBe("state");
    expect(financialWriteSpec("newthing pay")?.risk).toBe("money");
  });

  it("leaves reads and ordinary writes alone", () => {
    for (const path of [
      "invoices list",
      "invoices get",
      "invoices create",
      "invoices update",
      "thirdparties list",
      "bank transactions",
      "accounting ledger",
    ]) {
      expect(financialWriteSpec(path), path).toBeNull();
    }
  });

  it("does not gate plain delete, which already confirms on its own", () => {
    expect(financialWriteSpec("invoices delete")).toBeNull();
  });

  it("keeps the money and state verb sets disjoint", () => {
    for (const v of MONEY_VERBS) expect(STATE_VERBS.has(v)).toBe(false);
  });
});

describe("isAssumeYes", () => {
  it("accepts the documented truthy spellings", () => {
    for (const v of ["1", "true", "yes", "YES", " True "]) {
      expect(isAssumeYes({ DOLIBARR_ASSUME_YES: v }), v).toBe(true);
    }
  });

  it("rejects anything else, including 0 and empty", () => {
    for (const v of ["0", "false", "no", "", "  "]) {
      expect(isAssumeYes({ DOLIBARR_ASSUME_YES: v }), v).toBe(false);
    }
    expect(isAssumeYes({})).toBe(false);
  });
});

describe("decideConfirmation", () => {
  /** The headline safety property of v0.6.0. */
  it("REFUSES a financial write with no approval in non-interactive mode", () => {
    const d = decideConfirmation(LOCKED);
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") {
      expect(d.message).toContain("--confirm");
      expect(d.message).toContain("DOLIBARR_ASSUME_YES=1");
    }
  });

  it("proceeds with --confirm", () => {
    expect(decideConfirmation({ ...LOCKED, hasConfirmFlag: true })).toEqual({
      action: "proceed",
      reason: "confirm-flag",
    });
  });

  it("proceeds with the env opt-out", () => {
    expect(decideConfirmation({ ...LOCKED, assumeYes: true })).toEqual({
      action: "proceed",
      reason: "assume-yes",
    });
  });

  it("prompts when interactive and unapproved", () => {
    expect(decideConfirmation({ ...LOCKED, nonInteractive: false })).toEqual({
      action: "prompt",
    });
  });

  /** A preview changes nothing, so it needs no approval — but it is not approval. */
  it("lets --dry-run through without approval", () => {
    expect(decideConfirmation({ ...LOCKED, dryRun: true })).toEqual({
      action: "proceed",
      reason: "dry-run",
    });
  });

  it("does not let --dry-run alone approve a real run", () => {
    // Same context minus the dry run: still refused. --dry-run is not a substitute.
    expect(decideConfirmation({ ...LOCKED, dryRun: false }).action).toBe("refuse");
  });

  it("names the real risk in the refusal", () => {
    const d = decideConfirmation({ ...LOCKED, path: "raw", effect: "Send an unchecked write" });
    if (d.action === "refuse") expect(d.message).toContain("Send an unchecked write");
  });
});

describe("describeWrite", () => {
  const spec = financialWriteSpec("bank transfer")!;

  it("shows what is about to happen, not a bare yes/no", () => {
    const text = describeWrite("bank transfer", spec, [], {
      from: "1",
      to: "2",
      amount: "500",
    }).join("\n");
    expect(text).toContain("FINANCIAL WRITE");
    expect(text).toContain("bank transfer");
    expect(text).toContain("--from: 1");
    expect(text).toContain("--amount: 500");
  });

  it("includes positional arguments", () => {
    const validate = financialWriteSpec("invoices validate")!;
    expect(describeWrite("invoices validate", validate, ["42"], {}).join("\n")).toContain(
      "Arguments: 42",
    );
  });

  it("omits flags that describe the run rather than the write", () => {
    const text = describeWrite("bank transfer", spec, [], {
      amount: "500",
      json: true,
      confirm: true,
      dryRun: true,
      output: "json",
    }).join("\n");
    expect(text).toContain("--amount: 500");
    expect(text).not.toContain("--json");
    expect(text).not.toContain("--confirm");
    expect(text).not.toContain("--output");
  });

  it("converts camelCase option names back to their flag spelling", () => {
    expect(describeWrite("bank add-transaction", spec, [], { numReleve: "R1" }).join("\n")).toContain(
      "--num-releve: R1",
    );
  });
});
