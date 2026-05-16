import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  bankAccountColumns,
  bankAccountFields,
  createBankCommand,
  parseBankTransferDate,
} from "../../src/commands/bank.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
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
});
