import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createContractsCommand } from "../../src/commands/contracts.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("contracts command", () => {
  const cmd = createContractsCommand();

  it("registers as 'contracts' with a description", () => {
    expect(cmd.name()).toBe("contracts");
    expect(cmd.description()).toMatch(/contract/i);
  });

  it("exposes the expected subcommands", () => {
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      "activate-line",
      "close",
      "create",
      "deactivate-line",
      "delete",
      "get",
      "list",
      "list-lines",
      "update",
      "validate",
    ]);
  });

  it("list supports --thirdparty and shared list flags", () => {
    const list = sub(cmd, "list")!;
    const f = flags(list);
    expect(f).toContain("--limit");
    expect(f).toContain("--output");
    expect(f).toContain("--fields");
    expect(f).toContain("--thirdparty");
  });

  it("get takes a positional id", () => {
    const get = sub(cmd, "get")!;
    const args = (get as unknown as { _args: { _name: string; required: boolean }[] })._args;
    expect(args[0]._name).toBe("id");
    expect(args[0].required).toBe(true);
  });

  it("create exposes --socid, --date, --ref-ext, note flags, and --from-json", () => {
    const create = sub(cmd, "create")!;
    const f = flags(create);
    expect(f).toContain("--socid");
    expect(f).toContain("--date");
    expect(f).toContain("--ref-ext");
    expect(f).toContain("--note-public");
    expect(f).toContain("--note-private");
    expect(f).toContain("--from-json");
  });

  it("delete requires explicit confirmation", () => {
    const del = sub(cmd, "delete")!;
    expect(flags(del)).toContain("--confirm");
  });

  it("validate / close take a contract id", () => {
    const validate = sub(cmd, "validate")!;
    const close = sub(cmd, "close")!;
    const vArgs = (validate as unknown as { _args: { _name: string }[] })._args;
    const cArgs = (close as unknown as { _args: { _name: string }[] })._args;
    expect(vArgs[0]._name).toBe("id");
    expect(cArgs[0]._name).toBe("id");
  });

  it("activate-line takes id + line-id positionals and a --date-start flag", () => {
    const activate = sub(cmd, "activate-line")!;
    const args = (activate as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
    expect(args[1]._name).toBe("line-id");
    const f = flags(activate);
    expect(f).toContain("--date-start");
    expect(f).toContain("--date-end");
    expect(f).toContain("--comment");
  });

  it("deactivate-line takes id + line-id positionals", () => {
    const deactivate = sub(cmd, "deactivate-line")!;
    const args = (deactivate as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
    expect(args[1]._name).toBe("line-id");
    expect(flags(deactivate)).toContain("--date-start");
  });
});
