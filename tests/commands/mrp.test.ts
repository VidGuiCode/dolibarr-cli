import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  bomDetailFields,
  bomLineColumns,
  bomListColumns,
  buildBomBody,
  buildBomLineBody,
  buildMoBody,
  createMrpCommand,
  moListColumns,
} from "../../src/commands/mrp.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("mrp command (v0.4.7)", () => {
  const cmd = createMrpCommand();

  it("registers as 'mrp' with the three documented subgroups", () => {
    expect(cmd.name()).toBe("mrp");
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "boms",
      "mos",
      "workstations",
    ]);
  });

  it("boms has full CRUD plus lines and add-line", () => {
    const grp = sub(cmd, "boms")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual([
      "add-line",
      "create",
      "delete",
      "get",
      "lines",
      "list",
      "update",
    ]);
    expect(flags(sub(grp, "delete")!)).toContain("--confirm");
  });

  it("boms has no line edit or delete (no PUT/DELETE on /boms/{id}/lines/{lineid})", () => {
    const grp = sub(cmd, "boms")!;
    expect(sub(grp, "update-line")).toBeUndefined();
    expect(sub(grp, "delete-line")).toBeUndefined();
  });

  it("boms create exposes the BOM fields", () => {
    const f = flags(sub(sub(cmd, "boms")!, "create")!);
    for (const flag of [
      "--label",
      "--product",
      "--qty",
      "--type",
      "--warehouse",
      "--duration",
      "--efficiency",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("boms add-line exposes the component fields", () => {
    const f = flags(sub(sub(cmd, "boms")!, "add-line")!);
    for (const flag of [
      "--product",
      "--qty",
      "--qty-frozen",
      "--disable-stock-change",
      "--child-bom",
      "--position",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("mos has CRUD only — production is deliberately not wrapped", () => {
    const grp = sub(cmd, "mos")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "update",
    ]);
    for (const absent of ["produce", "produceandconsumeall", "consume", "validate", "cancel"]) {
      expect(sub(grp, absent), absent).toBeUndefined();
    }
  });

  it("the mrp help points at the raw escape hatch for production", () => {
    // addHelpText("after", …) is emitted by outputHelp, not helpInformation().
    let out = "";
    const c = createMrpCommand();
    c.configureOutput({ writeOut: (s) => { out += s; } });
    c.outputHelp();
    expect(out).toMatch(/produceandconsumeall/);
    expect(out).toMatch(/raw POST mos/);
    expect(out).toMatch(/not wrapped/i);
  });

  it("workstations is read-only", () => {
    const grp = sub(cmd, "workstations")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual(["get", "list"]);
    for (const absent of ["create", "update", "delete"]) {
      expect(sub(grp, absent), absent).toBeUndefined();
    }
  });
});

describe("buildBomBody", () => {
  it("maps flags to Dolibarr field names", () => {
    expect(
      buildBomBody({ label: "Widget BOM", product: "5", qty: "10", type: "0", warehouse: "1" }),
    ).toEqual({ label: "Widget BOM", fk_product: 5, qty: 10, bomtype: 0, fk_warehouse: 1 });
  });

  it("sends only the flags that were passed (update semantics)", () => {
    expect(buildBomBody({ description: "d" })).toEqual({ description: "d" });
    expect(buildBomBody({})).toEqual({});
  });
});

describe("buildBomLineBody", () => {
  it("maps the component flags, keeping a zero qty", () => {
    expect(
      buildBomLineBody({ product: "7", qty: "0", qtyFrozen: "1", disableStockChange: "0" }),
    ).toEqual({ fk_product: 7, qty: 0, qty_frozen: 1, disable_stock_change: 0 });
  });

  it("maps a sub-assembly child BOM", () => {
    expect(buildBomLineBody({ product: "7", qty: "2", childBom: "3" })).toEqual({
      fk_product: 7,
      qty: 2,
      fk_bom_child: 3,
    });
  });
});

describe("buildMoBody", () => {
  it("maps flags and normalizes the planned dates", () => {
    expect(
      buildMoBody({
        product: "5",
        qty: "100",
        bom: "2",
        dateStart: "2026-05-01",
        dateEnd: "2026-05-10",
      }),
    ).toEqual({
      fk_product: 5,
      qty: 100,
      fk_bom: 2,
      date_start_planned: Date.UTC(2026, 4, 1) / 1000,
      date_end_planned: Date.UTC(2026, 4, 10) / 1000,
    });
  });

  it("sends only the flags that were passed", () => {
    expect(buildMoBody({})).toEqual({});
  });
});

describe("mrp column specs", () => {
  it("labels BOM statuses, including the non-sequential cancelled code", () => {
    const col = bomListColumns.find((c) => c.key === "status")!;
    expect(col.format!({ status: 0 })).toBe("Draft");
    expect(col.format!({ status: 1 })).toBe("Validated");
    expect(col.format!({ statut: 9 })).toBe("Cancelled");
    expect(col.format!({})).toBe("");
  });

  it("labels MO statuses across the full production lifecycle", () => {
    const col = moListColumns.find((c) => c.key === "status")!;
    expect(col.format!({ status: 2 })).toBe("In progress");
    expect(col.format!({ status: 3 })).toBe("Produced");
    expect(col.format!({ status: 9 })).toBe("Cancelled");
  });

  it("labels the manufacturing/disassemble type on both resources", () => {
    const bomType = bomDetailFields.find((c) => c.key === "bomtype")!;
    expect(bomType.format!({ bomtype: 0 })).toBe("Manufacturing");
    expect(bomType.format!({ bomtype: 1 })).toBe("Disassemble");
  });

  it("reads a BOM line position from either naming", () => {
    const col = bomLineColumns.find((c) => c.key === "position")!;
    expect(col.format!({ position: 2 })).toBe("2");
    expect(col.format!({ rang: 5 })).toBe("5");
  });
});
