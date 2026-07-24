import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildSupplierProposalBody,
  createSupplierProposalsCommand,
  supplierProposalDetailFields,
  supplierProposalLineColumns,
  supplierProposalListColumns,
} from "../../src/commands/supplier-proposals.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("supplier-proposals command (v0.4.4)", () => {
  const cmd = createSupplierProposalsCommand();

  it("registers as 'supplier-proposals' with a description", () => {
    expect(cmd.name()).toBe("supplier-proposals");
    expect(cmd.description()).toMatch(/supplier proposal/i);
  });

  it("exposes exactly the route-confirmed subcommands", () => {
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "lines",
      "list",
      "update",
    ]);
  });

  it("omits the subcommands whose routes do not exist", () => {
    for (const absent of ["validate", "close", "contacts", "add-line", "update-line"]) {
      expect(sub(cmd, absent), absent).toBeUndefined();
    }
  });

  it("list supports --thirdparty plus the shared flags", () => {
    const f = flags(sub(cmd, "list")!);
    for (const flag of ["--thirdparty", "--limit", "--page", "--output", "--fields"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("create exposes the documented fields and --from-json", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--socid",
      "--date",
      "--delivery-date",
      "--ref-supplier",
      "--project",
      "--note-public",
      "--note-private",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("update carries the same field flags and echoes state", () => {
    const f = flags(sub(cmd, "update")!);
    for (const flag of ["--socid", "--date", "--ref-supplier", "--output", "--fields"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });

  it("lines is a read-only view taking the proposal id", () => {
    const lines = sub(cmd, "lines")!;
    const args = (lines as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
    expect(flags(lines)).toContain("--fields");
  });
});

describe("buildSupplierProposalBody", () => {
  it("maps flags to Dolibarr field names and normalizes both dates", () => {
    expect(
      buildSupplierProposalBody({
        socid: "8",
        date: "2026-02-01",
        deliveryDate: "2026-03-01",
        refSupplier: "SUP-77",
        project: "3",
        condReglement: "1",
      }),
    ).toEqual({
      socid: 8,
      ref_fourn: "SUP-77",
      fk_project: 3,
      cond_reglement_id: 1,
      date: Date.UTC(2026, 1, 1) / 1000,
      date_livraison: Date.UTC(2026, 2, 1) / 1000,
    });
  });

  it("sends only the flags that were passed (update semantics)", () => {
    expect(buildSupplierProposalBody({ notePublic: "hi" })).toEqual({ note_public: "hi" });
    expect(buildSupplierProposalBody({})).toEqual({});
  });
});

describe("supplier-proposal column specs", () => {
  it("labels the status codes", () => {
    const col = supplierProposalListColumns.find((c) => c.key === "status")!;
    expect(col.format!({ status: 0 })).toBe("Draft");
    expect(col.format!({ status: 2 })).toBe("Signed");
    expect(col.format!({ status: 3 })).toBe("Not signed");
    expect(col.format!({ statut: 4 })).toBe("Closed");
  });

  it("reads the delivery date under either naming", () => {
    const col = supplierProposalDetailFields.find((c) => c.key === "date_livraison")!;
    const ts = Date.UTC(2026, 2, 1) / 1000;
    expect(col.format!({ date_livraison: ts })).toBe("2026-03-01");
    expect(col.format!({ delivery_date: ts })).toBe("2026-03-01");
  });

  it("truncates a long line description", () => {
    const col = supplierProposalLineColumns.find((c) => c.key === "desc")!;
    expect(col.format!({ desc: "x".repeat(60) })).toHaveLength(40);
    expect(col.format!({ description: "short" })).toBe("short");
  });
});
