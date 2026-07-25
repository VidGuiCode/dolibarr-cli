import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  RESOURCE_STATUSES,
  buildStatusFilter,
  readStatus,
  specForPath,
  statusFlag,
} from "../../src/core/statuses.js";
import { camelize } from "../../src/core/batch.js";

describe("specForPath", () => {
  it("resolves a plain group", () => {
    expect(specForPath("invoices validate")?.path).toBe("invoices");
  });

  it("prefers the two-word group over the one-word one", () => {
    // `mrp` alone has no spec; `mrp boms` and `mrp mos` are distinct resources.
    expect(specForPath("mrp boms validate")?.path).toBe("boms");
    expect(specForPath("mrp mos validate")?.path).toBe("mos");
  });

  it("returns undefined for a group with no status vocabulary", () => {
    expect(specForPath("bank delete")).toBeUndefined();
    expect(specForPath("users update")).toBeUndefined();
  });

  it("never matches the verb itself as a group", () => {
    // A one-word path has no group/verb split to make.
    expect(specForPath("invoices")).toBeUndefined();
  });
});

describe("buildStatusFilter", () => {
  const spec = RESOURCE_STATUSES.invoices;

  it("builds a bare status predicate", () => {
    expect(buildStatusFilter(spec, 0)).toBe("(t.fk_statut:=:0)");
  });

  it("ANDs a user filter so a bulk run stays scopable", () => {
    expect(buildStatusFilter(spec, 1, "(t.ref:like:'CLIBULK-%')")).toBe(
      "((t.ref:like:'CLIBULK-%')) and (t.fk_statut:=:1)",
    );
  });

  it("uses the resource's own column, not a hardcoded one", () => {
    expect(buildStatusFilter(RESOURCE_STATUSES.contracts, 0)).toBe("(t.statut:=:0)");
    expect(buildStatusFilter(RESOURCE_STATUSES["mrp boms"], 9)).toBe("(t.status:=:9)");
  });

  it("handles negative status codes", () => {
    expect(buildStatusFilter(RESOURCE_STATUSES.members, -1)).toBe("(t.statut:=:-1)");
  });
});

describe("readStatus", () => {
  it("prefers status, then fk_statut, then statut", () => {
    expect(readStatus({ status: 1, fk_statut: 9 })).toBe("1");
    expect(readStatus({ fk_statut: 2 })).toBe("2");
    expect(readStatus({ statut: 3 })).toBe("3");
  });

  it("returns an empty string when absent", () => {
    expect(readStatus({})).toBe("");
  });

  it("preserves a zero status rather than treating it as absent", () => {
    expect(readStatus({ status: 0 })).toBe("0");
  });
});

describe("statusFlag / camelize round-trip", () => {
  it("produces the opts key commander will actually populate", () => {
    expect(camelize(statusFlag("draft"))).toBe("allDraft");
    expect(camelize(statusFlag("in-progress"))).toBe("allInProgress");
    expect(camelize(statusFlag("shipment-started"))).toBe("allShipmentStarted");
    expect(camelize(statusFlag("partially-received"))).toBe("allPartiallyReceived");
  });
});

describe("status vocabulary integrity", () => {
  it("gives every spec a column and at least one status", () => {
    for (const [group, spec] of Object.entries(RESOURCE_STATUSES)) {
      expect(spec.column, group).toMatch(/^(fk_statut|statut|status)$/);
      expect(Object.keys(spec.statuses).length, group).toBeGreaterThan(0);
      expect(spec.path, group).toBeTruthy();
    }
  });

  it("uses flag-safe status names", () => {
    for (const [group, spec] of Object.entries(RESOURCE_STATUSES)) {
      for (const name of Object.keys(spec.statuses)) {
        expect(name, `${group}.${name}`).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it("keeps status codes unique within a resource", () => {
    for (const [group, spec] of Object.entries(RESOURCE_STATUSES)) {
      const codes = Object.values(spec.statuses);
      expect(new Set(codes).size, group).toBe(codes.length);
    }
  });
});

/**
 * The command files carry their own display-only STATUS_MAP for rendering. Core
 * owns the selection vocabulary. These are two copies of the same fact, so this
 * test fails if they ever drift apart.
 */
describe("core status codes match the command files' display maps", () => {
  const CASES: [group: string, file: string, mapName: string][] = [
    ["invoices", "invoices", "STATUS_MAP"],
    ["orders", "orders", "STATUS_MAP"],
    ["proposals", "proposals", "STATUS_MAP"],
    ["projects", "projects", "STATUS_MAP"],
    ["contracts", "contracts", "STATUS_MAP"],
    ["supplier-invoices", "supplier-invoices", "STATUS_MAP"],
    ["supplier-orders", "supplier-orders", "STATUS_MAP"],
    ["expensereports", "expensereports", "STATUS_MAP"],
    ["tickets", "tickets", "STATUS_MAP"],
    ["shipments", "shipments", "STATUS_MAP"],
    ["receptions", "receptions", "STATUS_MAP"],
    ["interventions", "interventions", "STATUS_MAP"],
    ["members", "members", "STATUS_MAP"],
    ["knowledge", "knowledge", "STATUS_MAP"],
    ["supplier-proposals", "supplier-proposals", "STATUS_MAP"],
    ["mrp boms", "mrp", "BOM_STATUS_MAP"],
    ["mrp mos", "mrp", "MO_STATUS_MAP"],
  ];

  /** Pull the numeric keys out of a `const NAME: Record<string,string> = {...}` literal. */
  function codesInSource(file: string, mapName: string): number[] {
    const src = fs.readFileSync(
      path.resolve(__dirname, `../../src/commands/${file}.ts`),
      "utf-8",
    );
    const start = src.indexOf(`const ${mapName}`);
    expect(start, `${mapName} not found in ${file}.ts`).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("};", start));
    return [...body.matchAll(/"(-?\d+)":/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  }

  for (const [group, file, mapName] of CASES) {
    it(`${group} agrees with ${file}.ts ${mapName}`, () => {
      const core = Object.values(RESOURCE_STATUSES[group].statuses).sort((a, b) => a - b);
      expect(core).toEqual(codesInSource(file, mapName));
    });
  }
});
