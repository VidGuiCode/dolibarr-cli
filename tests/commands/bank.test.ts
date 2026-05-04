import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  bankAccountColumns,
  bankAccountFields,
  createBankCommand,
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

  it("renders Dolibarr account_number / balance fields with legacy fallbacks", () => {
    const account = {
      id: 1,
      label: "Main",
      account_number: "ACC-1",
      balance: 123.45,
      currency_code: "EUR",
    };
    const legacyAccount = {
      id: 2,
      label: "Legacy",
      number: "OLD-2",
      solde: 67.89,
      currency_code: "EUR",
    };

    const numberColumn = bankAccountColumns.find((c) => c.key === "account_number")!;
    const balanceColumn = bankAccountColumns.find((c) => c.key === "balance")!;

    expect(numberColumn.format?.(account)).toBe("ACC-1");
    expect(numberColumn.format?.(legacyAccount)).toBe("OLD-2");
    expect(balanceColumn.format?.(account)).toBe("123.45");
    expect(balanceColumn.format?.(legacyAccount)).toBe("67.89");
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
});
