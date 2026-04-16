import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createTicketsCommand } from "../../src/commands/tickets.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("tickets command", () => {
  const cmd = createTicketsCommand();

  it("registers as 'tickets' with a description", () => {
    expect(cmd.name()).toBe("tickets");
    expect(cmd.description()).toMatch(/ticket/i);
  });

  it("exposes the six expected subcommands including reply", () => {
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["create", "delete", "get", "list", "reply", "update"]);
  });

  it("list supports pagination, output, and --thirdparty filter", () => {
    const list = sub(cmd, "list")!;
    const f = flags(list);
    expect(f).toContain("--limit");
    expect(f).toContain("--output");
    expect(f).toContain("--fields");
    expect(f).toContain("--thirdparty");
  });

  it("get supports id/ref positional and --track-id alternative", () => {
    const get = sub(cmd, "get")!;
    const args = (get as unknown as { _args: { _name: string; required: boolean }[] })._args;
    expect(args[0]._name).toBe("id-or-ref");
    // The positional should be OPTIONAL — it's omitted when --track-id is used.
    expect(args[0].required).toBe(false);
    expect(flags(get)).toContain("--track-id");
  });

  it("create exposes --subject, --message, --project, --from-json", () => {
    const create = sub(cmd, "create")!;
    const f = flags(create);
    expect(f).toContain("--subject");
    expect(f).toContain("--message");
    expect(f).toContain("--project");
    expect(f).toContain("--from-json");
    expect(f).toContain("--severity");
  });

  it("update exposes status and content flags", () => {
    const update = sub(cmd, "update")!;
    const f = flags(update);
    expect(f).toContain("--subject");
    expect(f).toContain("--status");
    expect(f).toContain("--severity");
  });

  it("delete requires explicit confirmation", () => {
    const del = sub(cmd, "delete")!;
    expect(flags(del)).toContain("--confirm");
  });

  it("reply takes a track-id argument and requires --message", () => {
    const reply = sub(cmd, "reply")!;
    const args = (reply as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("track-id");
    const msg = reply.options.find((o) => o.long === "--message");
    expect(msg).toBeDefined();
    // requiredOption sets mandatory=true
    expect((msg as unknown as { mandatory: boolean }).mandatory).toBe(true);
  });
});
