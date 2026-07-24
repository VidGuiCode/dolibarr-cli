import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildInvoiceLineBody,
  buildInvoiceUpdateBody,
  createInvoicesCommand,
  invoiceDetailFields,
} from "../../src/commands/invoices.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("invoices command", () => {
  const cmd = createInvoicesCommand();

  it("registers editable update with date/thirdparty/terms flags", () => {
    const update = sub(cmd, "update")!;
    const f = flags(update);
    expect(f).toContain("--date");
    expect(f).toContain("--due-date");
    expect(f).toContain("--socid");
    expect(f).toContain("--cond-reglement");
    expect(f).toContain("--mode-reglement");
    expect(f).toContain("--ref-client");
    // echoes state → carries the standard read flags
    expect(f).toContain("--output");
    expect(f).toContain("--fields");
  });

  it("registers update-line and delete-line", () => {
    expect(sub(cmd, "update-line")).toBeDefined();
    expect(sub(cmd, "delete-line")).toBeDefined();
    expect(flags(sub(cmd, "update-line")!)).toEqual(
      expect.arrayContaining(["--subprice", "--qty", "--tva-tx", "--desc"]),
    );
  });

  it("builds an update body only from passed flags and normalizes dates", () => {
    const body = buildInvoiceUpdateBody({
      date: "2025-06-15",
      dueDate: "2025-07-15",
      socid: "4",
      refClient: "PO-1",
    });
    expect(body).toEqual({
      date: 1749945600,
      date_lim_reglement: 1752537600,
      socid: 4,
      ref_client: "PO-1",
    });
  });

  it("omits an amount/total field from the update body (totals derive from lines)", () => {
    const body = buildInvoiceUpdateBody({ amount: "999", total_ht: "999" });
    expect(body).toEqual({});
  });

  it("accepts a Unix epoch date unchanged", () => {
    expect(buildInvoiceUpdateBody({ date: "1749945600" }).date).toBe(1749945600);
  });

  it("builds a line body with numeric coercion", () => {
    expect(buildInvoiceLineBody({ subprice: "40", qty: "2", tvaTx: "17", desc: "x" })).toEqual({
      subprice: 40,
      qty: 2,
      tva_tx: 17,
      desc: "x",
    });
  });

  it("exposes a due-date column in the detail fields", () => {
    expect(invoiceDetailFields.map((c) => c.key)).toContain("date_lim_reglement");
  });
});
