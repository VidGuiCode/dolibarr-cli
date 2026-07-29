import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createAccountingCommand } from "../../src/commands/accounting.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("accounting command", () => {
  const cmd = createAccountingCommand();

  it("registers ledger and formats", () => {
    expect(sub(cmd, "ledger")).toBeDefined();
    expect(sub(cmd, "formats")).toBeDefined();
  });

  it("keeps the pre-existing ledger flag surface", () => {
    const f = flags(sub(cmd, "ledger")!);
    expect(f).toContain("--period");
    expect(f).toContain("--from");
    expect(f).toContain("--to");
    expect(f).toContain("--format");
    expect(f).toContain("--json");
  });

  it("points --format at the formats command instead of naming CSV/FEC only", () => {
    const format = sub(cmd, "ledger")!.options.find((o) => o.long === "--format")!;
    expect(format.description).toContain("accounting formats");
    expect(format.description).toContain("numeric");
  });

  it("exposes formats as a machine-readable listing", () => {
    expect(flags(sub(cmd, "formats")!)).toContain("--json");
  });
});
