import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  bankAccountColumns,
  bankAccountFields,
  buildBankAccountBody,
  buildBankTransactionBody,
  createBankCommand,
  parseBankTransferDate,
  sanitizeBankAccountListItem,
} from "../../src/commands/bank.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

/** Full rendered help, including `addHelpText` blocks that helpInformation() omits. */
function helpText(cmd: Command): string {
  let out = "";
  cmd.configureOutput({ writeOut: (s) => { out += s; } });
  cmd.outputHelp();
  return out;
}

describe("bank command", () => {
  const cmd = createBankCommand();

  it("registers bank list with shared list flags", () => {
    const list = sub(cmd, "list")!;
    const f = flags(list);
    expect(f).toContain("--limit");
    expect(f).toContain("--page");
    expect(f).toContain("--output");
    expect(f).toContain("--json");
    expect(f).toContain("--fields");
  });

  it("renders Dolibarr account_number fields with a legacy fallback", () => {
    const account = {
      id: 1,
      label: "Main",
      account_number: "ACC-1",
      currency_code: "EUR",
    };
    const legacyAccount = {
      id: 2,
      label: "Legacy",
      number: "OLD-2",
      currency_code: "EUR",
    };

    const numberColumn = bankAccountColumns.find((c) => c.key === "account_number")!;

    expect(numberColumn.format?.(account)).toBe("ACC-1");
    expect(numberColumn.format?.(legacyAccount)).toBe("OLD-2");
  });

  it("does not show stale account-object balances in the default list columns", () => {
    expect(bankAccountColumns.map((c) => c.key)).toEqual([
      "id",
      "label",
      "account_number",
      "currency_code",
    ]);
  });

  it("removes stale account-object balances from list output items", () => {
    expect(
      sanitizeBankAccountListItem({
        id: 1,
        label: "Main",
        balance: 0,
        solde: 0,
        currency_code: "EUR",
      }),
    ).toEqual({
      id: 1,
      label: "Main",
      currency_code: "EUR",
    });
  });

  it("labels account-object balances as reported balances in details", () => {
    const balanceField = bankAccountFields.find((c) => c.key === "balance")!;

    expect(balanceField.label).toBe("Reported Balance");
    expect(balanceField.format?.({ balance: 123.45 })).toBe("123.45");
    expect(balanceField.format?.({ solde: 67.89 })).toBe("67.89");
  });

  it("renders iban_prefix with an iban fallback in account details", () => {
    const ibanField = bankAccountFields.find((c) => c.key === "iban_prefix")!;

    expect(ibanField.format?.({ iban_prefix: "LU12" })).toBe("LU12");
    expect(ibanField.format?.({ iban: "LU34" })).toBe("LU34");
  });

  it("create exposes bank account input flags", () => {
    const create = sub(cmd, "create")!;
    const f = flags(create);
    expect(f).toContain("--label");
    expect(f).toContain("--number");
    expect(f).toContain("--iban");
    expect(f).toContain("--currency");
  });

  it("converts transfer YYYY-MM-DD dates to Unix timestamps", () => {
    expect(parseBankTransferDate("2026-05-05")).toBe(1777939200);
  });

  it("accepts transfer Unix timestamps directly", () => {
    expect(parseBankTransferDate("1777939200")).toBe(1777939200);
  });

  it("rejects invalid transfer dates", () => {
    expect(() => parseBankTransferDate("2026-02-30")).toThrow(/valid calendar date/);
    expect(() => parseBankTransferDate("05/05/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("registers account update/delete and transaction add/update/delete", () => {
    for (const name of [
      "update",
      "delete",
      "add-transaction",
      "update-transaction",
      "delete-transaction",
    ]) {
      expect(sub(cmd, name), name).toBeDefined();
    }
  });

  it("maps bank-account flags to Dolibarr field names", () => {
    expect(
      buildBankAccountBody({ label: "Main", number: "123", iban: "LU28", bic: "BCEE", currency: "EUR", bankName: "BCEE Bank" }),
    ).toEqual({
      label: "Main",
      account_number: "123",
      iban_prefix: "LU28",
      bic: "BCEE",
      currency_code: "EUR",
      bank: "BCEE Bank",
    });
  });

  it("builds a transaction body with a normalized date", () => {
    expect(
      buildBankTransactionBody({ date: "2025-06-15", type: "VIR", label: "T", amount: "-12.5" }),
    ).toEqual({ date: 1749945600, type: "VIR", label: "T", amount: -12.5 });
  });

  it("update-transaction only offers --label (Dolibarr API cannot edit a line's date)", () => {
    const f = flags(sub(cmd, "update-transaction")!);
    expect(f).toContain("--label");
    expect(f).not.toContain("--date");
  });

  /**
   * The 2026-07-29 report found `--limit 1` and `--limit 3` both returning all 8
   * rows: Dolibarr's getLines($id, $sqlfilters) has no pagination arguments, so the
   * flags were silently discarded. They are now applied client-side, and the help
   * must say so rather than implying server-side paging.
   */
  describe("transactions pagination", () => {
    const transactions = sub(cmd, "transactions")!;

    it("still offers --limit and --page", () => {
      const f = flags(transactions);
      expect(f).toContain("--limit");
      expect(f).toContain("--page");
    });

    it("says in the flag help that the CLI applies them", () => {
      const limit = transactions.options.find((o) => o.long === "--limit")!;
      const page = transactions.options.find((o) => o.long === "--page")!;
      expect(limit.description).toContain("CLI");
      expect(page.description).toContain("CLI");
    });

    it("documents that the endpoint has no server-side pagination", () => {
      expect(helpText(transactions)).toContain("no server-side pagination");
    });
  });
});
