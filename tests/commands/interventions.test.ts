import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildInterventionCreateBody,
  buildInterventionLineBody,
  createInterventionsCommand,
  interventionDetailFields,
  interventionLineColumns,
  interventionListColumns,
} from "../../src/commands/interventions.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("interventions command (v0.4.0)", () => {
  const cmd = createInterventionsCommand();

  it("registers as 'interventions' with a description", () => {
    expect(cmd.name()).toBe("interventions");
    expect(cmd.description()).toMatch(/intervention/i);
  });

  it("exposes exactly the route-confirmed subcommands", () => {
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "add-line",
      "close",
      "create",
      "delete",
      "get",
      "lines",
      "list",
      "validate",
    ]);
  });

  it("has no update subcommand (Dolibarr exposes no PUT /interventions)", () => {
    expect(sub(cmd, "update")).toBeUndefined();
  });

  it("list supports the shared list flags plus --thirdparty", () => {
    const f = flags(sub(cmd, "list")!);
    for (const flag of [
      "--limit",
      "--page",
      "--sort",
      "--order",
      "--filter",
      "--output",
      "--json",
      "--fields",
      "--thirdparty",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("get takes a required positional id and the detail-view flags", () => {
    const get = sub(cmd, "get")!;
    const args = (get as unknown as { _args: { _name: string; required: boolean }[] })._args;
    expect(args[0]._name).toBe("id");
    expect(args[0].required).toBe(true);
    const f = flags(get);
    expect(f).toContain("--output");
    expect(f).toContain("--fields");
  });

  it("create exposes the documented fields and --from-json", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--socid",
      "--ref",
      "--ref-client",
      "--description",
      "--date",
      "--project",
      "--contract",
      "--note-public",
      "--note-private",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });

  it("validate offers --no-trigger", () => {
    expect(flags(sub(cmd, "validate")!)).toContain("--no-trigger");
  });

  it("add-line takes an id plus duration flags", () => {
    const line = sub(cmd, "add-line")!;
    const args = (line as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
    const f = flags(line);
    expect(f).toContain("--hours");
    expect(f).toContain("--duration");
    expect(f).toContain("--description");
  });
});

describe("buildInterventionCreateBody", () => {
  it("maps flags to Dolibarr field names and normalizes the date", () => {
    expect(
      buildInterventionCreateBody({
        socid: "12",
        description: "On-site repair",
        project: "4",
        contract: "9",
        date: "2026-03-01",
        notePublic: "hello",
      }),
    ).toEqual({
      socid: 12,
      description: "On-site repair",
      fk_project: 4,
      fk_contrat: 9,
      note_public: "hello",
      datei: Date.UTC(2026, 2, 1) / 1000,
    });
  });

  it("omits every unset optional field", () => {
    expect(buildInterventionCreateBody({ socid: "3" })).toEqual({ socid: 3 });
  });
});

describe("buildInterventionLineBody", () => {
  it("converts --hours to seconds", () => {
    expect(buildInterventionLineBody({ description: "work", hours: "1.5" })).toEqual({
      desc: "work",
      duration: 5400,
    });
  });

  it("passes --duration through as seconds and normalizes --date", () => {
    expect(buildInterventionLineBody({ duration: "600", date: "2026-01-02" })).toEqual({
      duration: 600,
      date: Date.UTC(2026, 0, 2) / 1000,
    });
  });

  it("prefers --hours over --duration when both are given", () => {
    expect(buildInterventionLineBody({ hours: "2", duration: "60" })).toEqual({
      duration: 7200,
    });
  });
});

describe("intervention column specs", () => {
  it("formats the status code as a label", () => {
    const col = interventionListColumns.find((c) => c.key === "statut")!;
    expect(col.format!({ statut: 1 })).toBe("Validated");
    expect(col.format!({ status: 3 })).toBe("Closed");
  });

  it("formats a duration in seconds as hours and minutes", () => {
    const col = interventionDetailFields.find((c) => c.key === "duration")!;
    expect(col.format!({ duration: 5400 })).toBe("1h 30m");
    expect(col.format!({ duration: 7200 })).toBe("2h");
    expect(col.format!({ duration: 0 })).toBe("");
  });

  it("reads a line description from either desc or description", () => {
    const col = interventionLineColumns.find((c) => c.key === "desc")!;
    expect(col.format!({ desc: "a" })).toBe("a");
    expect(col.format!({ description: "b" })).toBe("b");
  });
});
