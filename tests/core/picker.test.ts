import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { walkLeaves } from "../../src/core/command-tree.js";
import {
  PICKER_COMMANDS,
  PICKER_PAGE,
  PICKER_SOURCES,
  enablePickers,
  filterItems,
  formatChoices,
  fuzzyScore,
} from "../../src/core/picker.js";

describe("fuzzy matching", () => {
  it("matches an exact substring", () => {
    expect(fuzzyScore("acme", "Acme Corp")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("ACME", "acme corp")).not.toBeNull();
  });

  it("matches a scattered subsequence", () => {
    expect(fuzzyScore("amc", "Acme Corp")).not.toBeNull();
  });

  it("rejects a non-subsequence", () => {
    expect(fuzzyScore("zzz", "Acme Corp")).toBeNull();
    expect(fuzzyScore("acmex", "Acme Corp")).toBeNull();
  });

  it("treats an empty query as matching everything", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });

  it("ranks a substring above a scattered subsequence", () => {
    const substring = fuzzyScore("corp", "Acme Corp")!;
    const scattered = fuzzyScore("cop", "Acme Corp")!;
    expect(substring).toBeGreaterThan(scattered);
  });

  it("ranks a prefix match above a later substring match", () => {
    expect(fuzzyScore("acme", "Acme Corp")!).toBeGreaterThan(
      fuzzyScore("acme", "The Acme Corp")!,
    );
  });

  it("ranks consecutive characters above scattered ones", () => {
    expect(fuzzyScore("ac", "acxxxx")!).toBeGreaterThan(fuzzyScore("ac", "axxxxc")!);
  });
});

describe("filterItems", () => {
  const items = [
    { id: "1", label: "Acme Corp" },
    { id: "2", label: "Acme Industries" },
    { id: "3", label: "Beta Ltd" },
  ];

  it("returns everything for an empty query, in the original order", () => {
    expect(filterItems(items, "").map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("drops non-matches", () => {
    expect(filterItems(items, "beta").map((i) => i.id)).toEqual(["3"]);
  });

  it("keeps every match when several qualify", () => {
    expect(filterItems(items, "acme").map((i) => i.id).sort()).toEqual(["1", "2"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterItems(items, "zzzz")).toEqual([]);
  });

  it("puts the better match first", () => {
    const ranked = filterItems(
      [
        { id: "1", label: "The Acme Corp" },
        { id: "2", label: "Acme Corp" },
      ],
      "acme",
    );
    expect(ranked[0].id).toBe("2");
  });

  it("handles an empty candidate list", () => {
    expect(filterItems([], "x")).toEqual([]);
  });
});

describe("choice rendering", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    label: `Item ${i}`,
    score: 0,
  }));

  it("numbers choices from 1", () => {
    expect(formatChoices(many)[0]).toContain("1. Item 0");
  });

  it("shows one page at a time", () => {
    expect(formatChoices(many)).toHaveLength(PICKER_PAGE);
  });

  it("shows everything when it fits", () => {
    expect(formatChoices(many.slice(0, 3))).toHaveLength(3);
  });
});

describe("picker sources", () => {
  it("defines the three kinds the roadmap names", () => {
    expect(Object.keys(PICKER_SOURCES).sort()).toEqual(["account", "product", "thirdparty"]);
  });

  it("labels a thirdparty by name, tolerating either field spelling", () => {
    expect(PICKER_SOURCES.thirdparty.label({ name: "Acme", code_client: "C1" })).toBe("Acme (C1)");
    expect(PICKER_SOURCES.thirdparty.label({ nom: "Acme" })).toBe("Acme");
  });

  it("labels a product by ref and label", () => {
    expect(PICKER_SOURCES.product.label({ ref: "P1", label: "Widget" })).toBe("P1 — Widget");
  });

  it("labels an account by label and bank", () => {
    expect(PICKER_SOURCES.account.label({ label: "Main", bank: "Bank" })).toBe("Main — Bank");
  });
});

const cliSource = fs.readFileSync(path.resolve(__dirname, "../../src/cli.ts"), "utf-8");

function registeredGroups(): [string, string][] {
  const imports = new Map<string, string>();
  const importRe = /import\s*\{\s*(create\w+Command)\s*\}\s*from\s*"\.\/commands\/([\w-]+)\.js"/g;
  for (const m of cliSource.matchAll(importRe)) imports.set(m[1], m[2]);
  const added: [string, string][] = [];
  for (const m of cliSource.matchAll(/program\.addCommand\((create\w+Command)\(\)\)/g)) {
    const file = imports.get(m[1]);
    if (file) added.push([m[1], file]);
  }
  return added;
}

const commandModules = import.meta.glob<Record<string, () => Command>>(
  "../../src/commands/*.ts",
);

describe("picker wiring", () => {
  let program: Command;
  let wired: string[];
  let leaves: { path: string; cmd: Command }[];

  beforeAll(async () => {
    program = new Command("dolibarr");
    for (const [factory, file] of registeredGroups()) {
      const loader = commandModules[`../../src/commands/${file}.ts`];
      const mod = await loader();
      program.addCommand(mod[factory]());
    }
    wired = enablePickers(program);
    leaves = walkLeaves(program);
  });

  it("wires exactly the allowlisted commands", () => {
    expect(wired.slice().sort()).toEqual(Object.keys(PICKER_COMMANDS).sort());
  });

  it("makes the id optional on those commands", () => {
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      expect(cmd.registeredArguments[0].required, p).toBe(false);
    }
  });

  /**
   * A picker on a mutation would mean an omitted id silently resolves to whatever the
   * user clicked, which is the opposite of what 0.6.0–0.6.3 established.
   */
  it("never fires on a mutating command", () => {
    for (const p of wired) {
      const verb = p.split(" ").pop()!;
      expect(["get", "transactions"], p).toContain(verb);
    }
  });

  it("leaves every other command's id required", () => {
    const untouched = leaves.filter(
      (l) => !wired.includes(l.path) && l.cmd.registeredArguments.length > 0,
    );
    expect(untouched.length).toBeGreaterThan(50);
    const stillRequired = untouched.filter((l) => l.cmd.registeredArguments[0].required);
    expect(stillRequired.length).toBeGreaterThan(0);
  });

  it("is idempotent", () => {
    expect(enablePickers(program)).toEqual([]);
  });
});
