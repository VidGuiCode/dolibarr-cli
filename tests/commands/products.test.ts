import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildPurchasePriceBody,
  buildVariantBody,
  createProductsCommand,
} from "../../src/commands/products.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

describe("products command — variants surface (v0.3.6)", () => {
  const cmd = createProductsCommand();

  it("registers attributes, attribute-values, variants and subproducts", () => {
    for (const name of ["attributes", "attribute-values", "variants", "subproducts"]) {
      expect(sub(cmd, name), name).toBeDefined();
    }
  });

  it("attributes subgroup has full CRUD", () => {
    const grp = sub(cmd, "attributes")!;
    for (const name of ["list", "get", "create", "update", "delete"]) {
      expect(sub(grp, name), name).toBeDefined();
    }
  });

  it("variants subgroup has list/create/update/delete", () => {
    const grp = sub(cmd, "variants")!;
    for (const name of ["list", "create", "update", "delete"]) {
      expect(sub(grp, name), name).toBeDefined();
    }
  });

  it("builds a variant body with a features map from repeated --feature attr:value", () => {
    const body = buildVariantBody({
      priceImpact: "10",
      weightImpact: "0",
      reference: "RED-XL",
      feature: ["1:3", "2:7"],
    });
    expect(body).toEqual({
      price_impact: 10,
      weight_impact: 0,
      reference: "RED-XL",
      features: { "1": 3, "2": 7 },
    });
  });

  it("omits features when no --feature pairs are given", () => {
    expect(buildVariantBody({ priceImpact: "5" })).toEqual({ price_impact: 5 });
  });
});

describe("products command — pricing surface (v0.3.7)", () => {
  const cmd = createProductsCommand();

  it("registers purchase-prices, multiprices and price-by-qty", () => {
    for (const name of ["purchase-prices", "multiprices", "price-by-qty"]) {
      expect(sub(cmd, name), name).toBeDefined();
    }
  });

  it("purchase-prices has list/set/delete (no update — Dolibarr upserts via POST)", () => {
    const grp = sub(cmd, "purchase-prices")!;
    expect(sub(grp, "list")).toBeDefined();
    expect(sub(grp, "set")).toBeDefined();
    expect(sub(grp, "delete")).toBeDefined();
    expect(sub(grp, "update")).toBeUndefined();
  });

  it("builds a purchase-price body with required + optional fields", () => {
    expect(
      buildPurchasePriceBody({ supplier: "3", buyprice: "12.5", qty: "10", refFourn: "SUP-9" }),
    ).toEqual({
      qty: 10,
      buyprice: 12.5,
      price_base_type: "HT",
      fourn_id: 3,
      ref_fourn: "SUP-9",
    });
  });
});
