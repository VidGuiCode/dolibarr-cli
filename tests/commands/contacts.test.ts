import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createContactsCommand } from "../../src/commands/contacts.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("contacts command", () => {
  const cmd = createContactsCommand();

  it("list can filter by thirdparty", () => {
    expect(flags(sub(cmd, "list")!)).toContain("--thirdparty");
  });

  it("registers a categories reader", () => {
    expect(sub(cmd, "categories")).toBeDefined();
  });
});
