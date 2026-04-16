import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createReceptionsCommand } from "../../src/commands/receptions.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("receptions command", () => {
  const cmd = createReceptionsCommand();

  it("registers as 'receptions' with a description", () => {
    expect(cmd.name()).toBe("receptions");
    expect(cmd.description()).toMatch(/reception/i);
  });

  it("exposes the six expected subcommands", () => {
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["close", "create", "delete", "get", "list", "validate"]);
  });

  it("list supports pagination, output, and --thirdparty filter", () => {
    const list = sub(cmd, "list")!;
    const f = flags(list);
    expect(f).toContain("--limit");
    expect(f).toContain("--output");
    expect(f).toContain("--fields");
    expect(f).toContain("--thirdparty");
  });

  it("get takes a positional id", () => {
    const get = sub(cmd, "get")!;
    const args = (get as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
  });

  it("create exposes --socid, --order, --date, --tracking, --from-json", () => {
    const create = sub(cmd, "create")!;
    const f = flags(create);
    expect(f).toContain("--socid");
    expect(f).toContain("--order");
    expect(f).toContain("--date");
    expect(f).toContain("--tracking");
    expect(f).toContain("--from-json");
  });

  it("delete requires explicit confirmation", () => {
    const del = sub(cmd, "delete")!;
    expect(flags(del)).toContain("--confirm");
  });

  it("validate accepts --no-trigger", () => {
    const validate = sub(cmd, "validate")!;
    const f = flags(validate);
    expect(f).toContain("--no-trigger");
  });

  it("close takes a reception id", () => {
    const close = sub(cmd, "close")!;
    const args = (close as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
  });
});
