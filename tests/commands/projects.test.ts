import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createProjectsCommand } from "../../src/commands/projects.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("projects command", () => {
  const cmd = createProjectsCommand();

  it("registers as 'projects' with a description", () => {
    expect(cmd.name()).toBe("projects");
    expect(cmd.description()).toMatch(/project/i);
  });

  it("exposes the six expected subcommands", () => {
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["create", "delete", "get", "list", "tasks", "update"]);
  });

  it("list supports pagination, output, and resource-specific filters", () => {
    const list = sub(cmd, "list")!;
    const f = flags(list);
    expect(f).toContain("--limit");
    expect(f).toContain("--page");
    expect(f).toContain("--output");
    expect(f).toContain("--json");
    expect(f).toContain("--fields");
    expect(f).toContain("--thirdparty");
    expect(f).toContain("--status");
  });

  it("get takes a positional id-or-ref argument", () => {
    const get = sub(cmd, "get")!;
    const args = (get as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id-or-ref");
  });

  it("create exposes --ref, --title, --socid, and --from-json", () => {
    const create = sub(cmd, "create")!;
    const f = flags(create);
    expect(f).toContain("--ref");
    expect(f).toContain("--title");
    expect(f).toContain("--socid");
    expect(f).toContain("--from-json");
    expect(f).toContain("--date-start");
    expect(f).toContain("--date-end");
  });

  it("update exposes mutation flags", () => {
    const update = sub(cmd, "update")!;
    const f = flags(update);
    expect(f).toContain("--title");
    expect(f).toContain("--status");
  });

  it("delete requires explicit confirmation", () => {
    const del = sub(cmd, "delete")!;
    expect(flags(del)).toContain("--confirm");
  });

  it("tasks subcommand takes a project-id argument and supports --with-timespent", () => {
    const tasks = sub(cmd, "tasks")!;
    const args = (tasks as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("project-id");
    expect(flags(tasks)).toContain("--with-timespent");
  });
});
