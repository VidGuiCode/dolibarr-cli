import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildThirdpartyBankAccountBody,
  createThirdpartiesCommand,
  outstandingPath,
} from "../../src/commands/thirdparties.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("thirdparties command", () => {
  const cmd = createThirdpartiesCommand();

  it("registers bank-accounts, gateways and outstanding", () => {
    expect(sub(cmd, "bank-accounts")).toBeDefined();
    expect(sub(cmd, "gateways")).toBeDefined();
    expect(sub(cmd, "outstanding")).toBeDefined();
  });

  it("bank-accounts subgroup has list/create/update/delete", () => {
    const grp = sub(cmd, "bank-accounts")!;
    for (const name of ["list", "create", "update", "delete"]) {
      expect(sub(grp, name), name).toBeDefined();
    }
  });

  it("gives merge a --confirm guard (it deletes the source)", () => {
    expect(flags(sub(cmd, "merge")!)).toContain("--confirm");
  });

  it("builds a thirdparty bank-account body with RIB + SEPA fields", () => {
    expect(
      buildThirdpartyBankAccountBody({
        label: "Main",
        iban: "LU28",
        bic: "BCEE",
        codeBanque: "001",
        codeGuichet: "9400",
        number: "0644750000",
        cleRib: "12",
        owner: "Acme",
        rum: "RUM-1",
      }),
    ).toEqual({
      label: "Main",
      iban: "LU28",
      bic: "BCEE",
      code_banque: "001",
      code_guichet: "9400",
      number: "0644750000",
      cle_rib: "12",
      proprio: "Acme",
      rum: "RUM-1",
    });
  });

  it("resolves the outstanding sub-resource path and supplier mode", () => {
    expect(outstandingPath("3", {})).toBe("thirdparties/3/outstandinginvoices");
    expect(outstandingPath("3", { type: "orders" })).toBe("thirdparties/3/outstandingorders");
    expect(outstandingPath("3", { type: "proposals" })).toBe(
      "thirdparties/3/outstandingproposals",
    );
    expect(outstandingPath("3", { mode: "supplier" })).toBe(
      "thirdparties/3/outstandinginvoices?mode=supplier",
    );
  });
});
