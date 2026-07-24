import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildTaskBody,
  buildTimespentBody,
  createTasksCommand,
  taskDetailFields,
  taskListColumns,
} from "../../src/commands/tasks.js";
import {
  buildAgendaEventBody,
  createAgendaCommand,
  agendaEventDetailFields,
  agendaEventListColumns,
} from "../../src/commands/agenda.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("tasks command (v0.4.5)", () => {
  const cmd = createTasksCommand();

  it("registers as 'tasks' with a description", () => {
    expect(cmd.name()).toBe("tasks");
    expect(cmd.description()).toMatch(/task/i);
  });

  it("exposes the route-confirmed subcommands", () => {
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "roles",
      "timespent",
      "update",
    ]);
  });

  it("list supports --project, --with-timespent and the shared flags", () => {
    const f = flags(sub(cmd, "list")!);
    for (const flag of ["--project", "--with-timespent", "--limit", "--output", "--fields"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("create exposes the three mandatory fields plus the optional ones", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--ref",
      "--label",
      "--project",
      "--description",
      "--parent",
      "--date-start",
      "--date-end",
      "--workload-hours",
      "--progress",
      "--priority",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("update has no status flag — Dolibarr ignores fk_statut on this PUT", () => {
    const f = flags(sub(cmd, "update")!);
    expect(f).not.toContain("--status");
    expect(f).not.toContain("--fk-statut");
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });

  it("timespent subgroup has add/update/delete but no list (no GET route exists)", () => {
    const grp = sub(cmd, "timespent")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual(["add", "delete", "update"]);
    expect(sub(grp, "list")).toBeUndefined();
  });

  it("timespent add requires --date and takes both duration forms", () => {
    const add = sub(sub(cmd, "timespent")!, "add")!;
    const dateOpt = add.options.find((o) => o.long === "--date")!;
    expect(dateOpt.required || dateOpt.mandatory).toBeTruthy();
    const f = flags(add);
    expect(f).toContain("--hours");
    expect(f).toContain("--duration");
    expect(f).toContain("--user");
  });

  it("timespent update and delete take task id + line id", () => {
    for (const name of ["update", "delete"]) {
      const c = sub(sub(cmd, "timespent")!, name)!;
      const args = (c as unknown as { _args: { _name: string }[] })._args;
      expect(args[0]._name, name).toBe("id");
      expect(args[1]._name, name).toBe("line-id");
    }
  });
});

describe("buildTaskBody", () => {
  it("maps flags to the live-verified field names", () => {
    expect(
      buildTaskBody({
        ref: "T1",
        label: "Design",
        project: "3",
        parent: "0",
        description: "d",
        progress: "40",
        priority: "2",
        dateStart: "2026-03-01",
        dateEnd: "2026-03-05",
      }),
    ).toEqual({
      ref: "T1",
      label: "Design",
      fk_project: 3,
      fk_task_parent: 0,
      description: "d",
      progress: 40,
      priority: 2,
      date_start: Date.UTC(2026, 2, 1) / 1000,
      date_end: Date.UTC(2026, 2, 5) / 1000,
    });
  });

  it("converts --workload-hours to seconds and prefers it over --workload", () => {
    expect(buildTaskBody({ workloadHours: "3" }).planned_workload).toBe(10800);
    expect(buildTaskBody({ workload: "600" }).planned_workload).toBe(600);
    expect(buildTaskBody({ workloadHours: "1", workload: "9" }).planned_workload).toBe(3600);
  });

  it("never emits fk_statut (silently ignored by the API)", () => {
    expect(buildTaskBody({ status: "1", label: "x" })).toEqual({ label: "x" });
  });

  it("sends only the flags that were passed", () => {
    expect(buildTaskBody({})).toEqual({});
  });
});

describe("buildTimespentBody", () => {
  it("renders the date as the YYYY-MM-DD HH:MM:SS string the endpoint demands", () => {
    expect(buildTimespentBody({ date: "2026-03-01", hours: "1" })).toEqual({
      date: "2026-03-01 00:00:00",
      duration: 3600,
    });
  });

  it("keeps an explicit time and fills in the seconds", () => {
    expect(buildTimespentBody({ date: "2026-03-01 09:30" }).date).toBe("2026-03-01 09:30:00");
    expect(buildTimespentBody({ date: "2026-03-01 09:30:15" }).date).toBe("2026-03-01 09:30:15");
  });

  it("passes --duration through and carries user and note", () => {
    expect(
      buildTimespentBody({ date: "2026-03-01", duration: "900", user: "2", note: "n" }),
    ).toEqual({ date: "2026-03-01 00:00:00", duration: 900, user_id: 2, note: "n" });
  });
});

describe("task column specs", () => {
  it("formats durations in seconds as hours and minutes", () => {
    const col = taskListColumns.find((c) => c.key === "planned_workload")!;
    expect(col.format!({ planned_workload: 10800 })).toBe("3h");
    expect(col.format!({ planned_workload: 5400 })).toBe("1h 30m");
    expect(col.format!({ planned_workload: 0 })).toBe("");
  });

  it("formats the time spent on the detail view", () => {
    const col = taskDetailFields.find((c) => c.key === "duration_effective")!;
    expect(col.format!({ duration_effective: 3600 })).toBe("1h");
  });
});

describe("agenda command (v0.4.5)", () => {
  const cmd = createAgendaCommand();

  it("registers as 'agenda' with full CRUD", () => {
    expect(cmd.name()).toBe("agenda");
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "update",
    ]);
  });

  it("list supports --user and --thirdparty filters", () => {
    const f = flags(sub(cmd, "list")!);
    expect(f).toContain("--user");
    expect(f).toContain("--thirdparty");
  });

  it("create exposes the event fields and --from-json", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--label",
      "--start",
      "--end",
      "--type",
      "--location",
      "--socid",
      "--contact",
      "--project",
      "--owner",
      "--percentage",
      "--full-day",
      "--note",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });
});

describe("buildAgendaEventBody", () => {
  it("maps --start/--end onto Dolibarr's datep/datef", () => {
    expect(
      buildAgendaEventBody({ label: "Call", start: "2026-04-01", end: "2026-04-02" }),
    ).toEqual({
      label: "Call",
      datep: Date.UTC(2026, 3, 1) / 1000,
      datef: Date.UTC(2026, 3, 2) / 1000,
    });
  });

  it("coerces the numeric references and flags", () => {
    expect(
      buildAgendaEventBody({
        type: "AC_RDV",
        socid: "5",
        contact: "9",
        project: "2",
        owner: "1",
        percentage: "-1",
        fullDay: "1",
      }),
    ).toEqual({
      type_code: "AC_RDV",
      socid: 5,
      contact_id: 9,
      fk_project: 2,
      userownerid: 1,
      percentage: -1,
      fulldayevent: 1,
    });
  });

  it("sends only the flags that were passed", () => {
    expect(buildAgendaEventBody({})).toEqual({});
  });
});

describe("agenda column specs", () => {
  it("renders start/end as date and time", () => {
    const col = agendaEventListColumns.find((c) => c.key === "datep")!;
    expect(col.format!({ datep: Date.UTC(2026, 3, 1, 9, 30) / 1000 })).toBe("2026-04-01 09:30");
    expect(col.format!({})).toBe("");
  });

  it("reads the type from type_code or code", () => {
    const col = agendaEventDetailFields.find((c) => c.key === "type_code")!;
    expect(col.format!({ type_code: "AC_RDV" })).toBe("AC_RDV");
    expect(col.format!({ code: "AC_TEL" })).toBe("AC_TEL");
  });
});
