import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildOrderLineBody,
  buildOrderUpdateBody,
  createOrdersCommand,
  orderDetailFields,
  ORDER_CONTACT_TYPES,
} from "../../src/commands/orders.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("orders command", () => {
  const cmd = createOrdersCommand();

  it("registers editable update with date/delivery/thirdparty flags", () => {
    const update = sub(cmd, "update")!;
    const f = flags(update);
    expect(f).toContain("--date");
    expect(f).toContain("--delivery-date");
    expect(f).toContain("--socid");
    expect(f).toContain("--ref-client");
    expect(f).toContain("--output");
  });

  it("maps order date to date_commande and delivery to delivery_date (verified live)", () => {
    const body = buildOrderUpdateBody({
      date: "2025-06-15",
      deliveryDate: "2025-07-01",
      socid: "4",
      refClient: "OC-1",
    });
    expect(body).toEqual({
      date_commande: 1749945600,
      delivery_date: 1751328000,
      socid: 4,
      ref_client: "OC-1",
    });
    // must NOT send the `date` key — Dolibarr ignores it on an order PUT
    expect(body).not.toHaveProperty("date");
  });

  it("omits amount/total from the update body", () => {
    expect(buildOrderUpdateBody({ total_ht: "999" })).toEqual({});
  });

  it("exposes a delivery-date column in the detail fields", () => {
    expect(orderDetailFields.map((c) => c.key)).toContain("delivery_date");
  });

  it("registers the deep orders surface (v0.3.3)", () => {
    for (const name of [
      "update-line",
      "delete-line",
      "reopen",
      "create-from-proposal",
      "shipments",
      "create-shipment",
      "contacts",
    ]) {
      expect(sub(cmd, name), name).toBeDefined();
    }
  });

  it("contacts subgroup exposes list/add/remove and the valid types", () => {
    const grp = sub(cmd, "contacts")!;
    for (const name of ["list", "add", "remove"]) expect(sub(grp, name), name).toBeDefined();
    expect(ORDER_CONTACT_TYPES).toEqual(["BILLING", "SHIPPING", "CUSTOMER"]);
  });

  it("add-line now offers --product-type (order lines require an integer product_type)", () => {
    expect(flags(sub(cmd, "add-line")!)).toContain("--product-type");
  });

  it("builds an order line body with product_type coercion", () => {
    expect(buildOrderLineBody({ subprice: "30", qty: "2", productType: "1" })).toEqual({
      subprice: 30,
      qty: 2,
      product_type: 1,
    });
  });
});
