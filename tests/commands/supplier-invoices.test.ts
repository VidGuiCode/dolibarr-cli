import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildSupplierInvoiceUpdateBody,
  createSupplierInvoicesCommand,
  supplierInvoiceDetailFields,
} from "../../src/commands/supplier-invoices.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("supplier-invoices command", () => {
  const cmd = createSupplierInvoicesCommand();

  it("registers editable update with date/supplier/ref flags", () => {
    const update = sub(cmd, "update")!;
    const f = flags(update);
    expect(f).toContain("--date");
    expect(f).toContain("--due-date");
    expect(f).toContain("--socid");
    expect(f).toContain("--ref-supplier");
    expect(f).toContain("--cond-reglement");
    expect(f).toContain("--output");
  });

  it("maps due-date to date_echeance (supplier-invoice due-date field)", () => {
    const body = buildSupplierInvoiceUpdateBody({
      date: "2025-03-01",
      dueDate: "2025-04-01",
      socid: "3",
      refSupplier: "INV-9",
    });
    expect(body).toEqual({
      date: 1740787200,
      date_echeance: 1743465600,
      socid: 3,
      ref_supplier: "INV-9",
    });
  });

  it("omits amount/total from the update body", () => {
    expect(buildSupplierInvoiceUpdateBody({ total_ht: "999" })).toEqual({});
  });

  it("exposes a due-date column in the detail fields", () => {
    expect(supplierInvoiceDetailFields.map((c) => c.key)).toContain("date_echeance");
  });
});
