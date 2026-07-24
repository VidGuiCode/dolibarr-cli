import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildWarehouseBody,
  createStockCommand,
  warehouseDetailFields,
  warehouseListColumns,
} from "../../src/commands/stock.js";
import {
  buildStockMovementBody,
  buildStockMovementFilter,
  stockMovementColumns,
} from "../../src/core/stock.js";
import { buildStockMovementBody as productsReExport } from "../../src/commands/products.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("stock command (v0.4.3)", () => {
  const cmd = createStockCommand();

  it("registers as 'stock' with the two documented subgroups", () => {
    expect(cmd.name()).toBe("stock");
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual(["movements", "warehouses"]);
  });

  it("warehouses has full CRUD", () => {
    const grp = sub(cmd, "warehouses")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "update",
    ]);
    expect(flags(sub(grp, "delete")!)).toContain("--confirm");
  });

  it("warehouses list supports --category plus the shared flags", () => {
    const f = flags(sub(sub(cmd, "warehouses")!, "list")!);
    for (const flag of ["--category", "--limit", "--output", "--fields"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("warehouses create requires --label and exposes the address fields", () => {
    const f = flags(sub(sub(cmd, "warehouses")!, "create")!);
    for (const flag of [
      "--label",
      "--location",
      "--description",
      "--address",
      "--zip",
      "--town",
      "--country",
      "--parent",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("movements exposes only list and create — the ledger is append-only", () => {
    const grp = sub(cmd, "movements")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual(["create", "list"]);
    for (const absent of ["get", "update", "delete"]) {
      expect(sub(grp, absent), absent).toBeUndefined();
    }
  });

  it("movements create is guarded and requires the three mandatory API fields", () => {
    const create = sub(sub(cmd, "movements")!, "create")!;
    expect(flags(create)).toContain("--confirm");
    for (const long of ["--product", "--warehouse", "--qty"]) {
      const opt = create.options.find((o) => o.long === long)!;
      expect(opt.required || opt.mandatory, long).toBeTruthy();
    }
  });
});

describe("buildWarehouseBody", () => {
  it("maps flags to Dolibarr field names", () => {
    expect(
      buildWarehouseBody({
        label: "Main",
        location: "Aisle 1",
        parent: "3",
        country: "1",
        status: "1",
      }),
    ).toEqual({ label: "Main", lieu: "Aisle 1", fk_parent: 3, country_id: 1, statut: 1 });
  });

  it("sends only the flags that were passed (update semantics)", () => {
    expect(buildWarehouseBody({ town: "Springfield" })).toEqual({ town: "Springfield" });
    expect(buildWarehouseBody({})).toEqual({});
  });
});

describe("shared stock helpers (core/stock.ts)", () => {
  it("is the single source of the movement body for both surfaces", () => {
    expect(productsReExport).toBe(buildStockMovementBody);
  });

  it("builds a movement body with the mandatory trio plus optional fields", () => {
    expect(
      buildStockMovementBody("5", {
        warehouse: "1",
        qty: "-3",
        type: "3",
        label: "cycle count",
        originType: "order",
        originId: "42",
      }),
    ).toEqual({
      product_id: 5,
      warehouse_id: 1,
      qty: -3,
      type: 3,
      movementlabel: "cycle count",
      origin_type: "order",
      origin_id: 42,
    });
  });

  it("normalizes the movement date to epoch seconds", () => {
    const body = buildStockMovementBody("1", { warehouse: "1", qty: "1", date: "2026-05-04" });
    expect(body.datem).toBe(Date.UTC(2026, 4, 4) / 1000);
  });

  it("builds an sqlfilters expression from the product and warehouse filters", () => {
    expect(buildStockMovementFilter({ product: "5" })).toBe("(t.fk_product:=:5)");
    expect(buildStockMovementFilter({ warehouse: "2" })).toBe("(t.fk_entrepot:=:2)");
    expect(buildStockMovementFilter({ product: "5", warehouse: "2" })).toBe(
      "(t.fk_product:=:5) and (t.fk_entrepot:=:2)",
    );
  });

  it("returns undefined when neither filter is set, so --filter wins", () => {
    expect(buildStockMovementFilter({})).toBeUndefined();
  });

  it("labels movement types", () => {
    const col = stockMovementColumns.find((c) => c.key === "type")!;
    expect(col.format!({ type: 0 })).toBe("Input");
    expect(col.format!({ type: 1 })).toBe("Output");
    expect(col.format!({ type_mouvement: 3 })).toBe("Transfer out");
  });

  it("reads product and warehouse ids under either naming", () => {
    const p = stockMovementColumns.find((c) => c.key === "fk_product")!;
    const w = stockMovementColumns.find((c) => c.key === "fk_entrepot")!;
    expect(p.format!({ product_id: 7 })).toBe("7");
    expect(w.format!({ warehouse_id: 2 })).toBe("2");
  });
});

describe("warehouse column specs", () => {
  it("labels the open/closed status", () => {
    const col = warehouseListColumns.find((c) => c.key === "statut")!;
    expect(col.format!({ statut: 1 })).toBe("Open");
    expect(col.format!({ statut: 0 })).toBe("Closed");
  });

  it("falls back to label when ref is absent", () => {
    const col = warehouseDetailFields.find((c) => c.key === "ref")!;
    expect(col.format!({ label: "Main" })).toBe("Main");
    expect(col.format!({ ref: "WH1", label: "Main" })).toBe("WH1");
  });
});
