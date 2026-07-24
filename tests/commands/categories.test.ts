import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createCategoriesCommand } from "../../src/commands/categories.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

describe("categories command", () => {
  const cmd = createCategoriesCommand();

  it("registers link, unlink and of-object", () => {
    for (const name of ["link", "unlink", "of-object"]) {
      expect(sub(cmd, name), name).toBeDefined();
    }
  });

  it("link takes category id, object type and object id", () => {
    const link = sub(cmd, "link")!;
    // three positional args: <id> <type> <object-id>
    expect(link.registeredArguments.map((a) => a.name())).toEqual(["id", "type", "object-id"]);
  });
});
