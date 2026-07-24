import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createSupplierOrdersCommand } from "../../src/commands/supplier-orders.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("supplier-orders command", () => {
  const cmd = createSupplierOrdersCommand();

  it("registers make-order, receive and contacts", () => {
    expect(sub(cmd, "make-order")).toBeDefined();
    expect(sub(cmd, "receive")).toBeDefined();
    expect(sub(cmd, "contacts")).toBeDefined();
  });

  it("receive supports --close and --from-json for partial reception", () => {
    const f = flags(sub(cmd, "receive")!);
    expect(f).toContain("--close");
    expect(f).toContain("--from-json");
  });

  it("contacts defaults --source to external (Dolibarr requires source)", () => {
    const contacts = sub(cmd, "contacts")!;
    const opt = contacts.options.find((o) => o.long === "--source");
    expect(opt?.defaultValue).toBe("external");
  });
});
