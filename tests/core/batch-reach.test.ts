import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  BATCH_VERBS,
  READ_ONLY_ID_VERBS,
  STATUS_SCOPED_VERBS,
  enableBatchIds,
  isBatchable,
  walkLeaves,
} from "../../src/core/batch.js";
import { specForPath, statusFlag } from "../../src/core/statuses.js";

/**
 * Reach test for the 0.5.x line: rather than spot-checking one group, rebuild the
 * whole command tree exactly as `src/cli.ts` registers it and assert the new
 * capability landed everywhere it should — and nowhere it shouldn't.
 *
 * The group list is parsed out of `src/cli.ts` itself, so a group added later is
 * picked up automatically instead of silently escaping coverage.
 */

const cliSource = fs.readFileSync(
  path.resolve(__dirname, "../../src/cli.ts"),
  "utf-8",
);

/** [factoryName, moduleFile] for every group cli.ts actually registers. */
function registeredGroups(): [string, string][] {
  const imports = new Map<string, string>();
  const importRe = /import\s*\{\s*(create\w+Command)\s*\}\s*from\s*"\.\/commands\/([\w-]+)\.js"/g;
  for (const m of cliSource.matchAll(importRe)) imports.set(m[1], m[2]);

  const added: [string, string][] = [];
  const addRe = /program\.addCommand\((create\w+Command)\(\)\)/g;
  for (const m of cliSource.matchAll(addRe)) {
    const file = imports.get(m[1]);
    if (file) added.push([m[1], file]);
  }
  return added;
}

let program: Command;
let wired: string[];
let leaves: { path: string; cmd: Command }[];
/** Snapshot taken *before* wiring — status-scoped wiring makes <id> optional. */
let batchableBefore: string[];

// Vite needs a statically analysable glob; the cli.ts parse above still decides
// which of these actually get registered.
const commandModules = import.meta.glob<Record<string, () => Command>>(
  "../../src/commands/*.ts",
);

beforeAll(async () => {
  const groups = registeredGroups();
  program = new Command("dolibarr");
  for (const [factory, file] of groups) {
    const loader = commandModules[`../../src/commands/${file}.ts`];
    expect(loader, `no module for ${file}`).toBeTypeOf("function");
    const mod = await loader();
    program.addCommand(mod[factory]());
  }
  leaves = walkLeaves(program);
  batchableBefore = leaves.filter((l) => isBatchable(l.cmd)).map((l) => l.path).sort();
  wired = enableBatchIds(program);
});

describe("batch reach across every registered command group", () => {
  it("rebuilds all 33 groups from cli.ts", () => {
    expect(program.commands.length).toBe(33);
  });

  it("classifies every id-taking leaf as either batchable or read-only", () => {
    const unclassified = leaves
      .filter((l) => {
        const args = l.cmd.registeredArguments;
        const soleId =
          args.length > 0 &&
          args[0].name() === "id" &&
          args[0].required &&
          args.filter((a) => a.required).length === 1;
        return soleId && !BATCH_VERBS.has(l.cmd.name()) && !READ_ONLY_ID_VERBS.has(l.cmd.name());
      })
      .map((l) => l.path);

    // A new sole-<id> subcommand must be added to one of the two tables in
    // src/core/batch.ts. Failing here is the intended signal, not a nuisance.
    expect(unclassified).toEqual([]);
  });

  it("wires batch ids into every batchable subcommand and no others", () => {
    expect(wired.sort()).toEqual(batchableBefore);
    expect(wired.length).toBeGreaterThan(80);
  });

  it("reaches groups across the whole CLI, not just one", () => {
    const groupsCovered = new Set(wired.map((p) => p.split(" ")[0]));
    // The groups without any sole-<id> mutation are the non-resource ones
    // (config, status, raw, upgrade, ...) plus read-only surfaces.
    expect(groupsCovered.size).toBeGreaterThanOrEqual(26);
    for (const g of ["invoices", "orders", "thirdparties", "projects", "tasks", "mrp"]) {
      expect(groupsCovered).toContain(g);
    }
  });

  it("gives every wired subcommand a --confirm flag", () => {
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      expect(cmd.options.map((o) => o.long)).toContain("--confirm");
    }
  });

  it("never wires a read-oriented subcommand", () => {
    for (const p of wired) {
      const verb = p.split(" ").pop()!;
      expect(READ_ONLY_ID_VERBS.has(verb)).toBe(false);
    }
  });
});

describe("status-scoped reach (v0.5.1)", () => {
  /** Every wired leaf that should have gained `--all-<status>` flags. */
  function expectedStatusScoped() {
    return wired.filter((p) => {
      const verb = p.split(" ").pop()!;
      return STATUS_SCOPED_VERBS.has(verb) && specForPath(p) !== undefined;
    });
  }

  it("covers a meaningful slice of the CLI, across many groups", () => {
    const paths = expectedStatusScoped();
    expect(paths.length).toBeGreaterThan(30);
    expect(new Set(paths.map((p) => p.split(" ")[0])).size).toBeGreaterThanOrEqual(15);
  });

  it("gives every status-scoped command one --all-<status> flag per status", () => {
    for (const p of expectedStatusScoped()) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      const spec = specForPath(p)!;
      const longs = cmd.options.map((o) => o.long);
      for (const name of Object.keys(spec.statuses)) {
        expect(longs, `${p} missing ${statusFlag(name)}`).toContain(statusFlag(name));
      }
      expect(longs, `${p} missing --filter`).toContain("--filter");
      expect(longs, `${p} missing --max`).toContain("--max");
    }
  });

  it("makes <id> optional only where a selector can replace it", () => {
    const scoped = new Set(expectedStatusScoped());
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      expect(cmd.registeredArguments[0].required, `${p}`).toBe(!scoped.has(p));
    }
  });

  it("never registers a duplicate option on any wired command", () => {
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      const longs = cmd.options.map((o) => o.long).filter(Boolean);
      expect(new Set(longs).size, `${p} has duplicate flags`).toBe(longs.length);
    }
  });

  it("adds no selector to a group without a status vocabulary", () => {
    for (const p of wired) {
      if (specForPath(p)) continue;
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      expect(cmd.options.some((o) => o.long?.startsWith("--all-")), `${p}`).toBe(false);
    }
  });

  it("adds no selector to a non-status verb even in a status-bearing group", () => {
    const addLine = leaves.find((l) => l.path === "invoices add-line")!.cmd;
    expect(addLine.options.some((o) => o.long?.startsWith("--all-"))).toBe(false);
    expect(addLine.registeredArguments[0].required).toBe(true);
  });
});

describe("pre-0.5.0 flag surface is unchanged", () => {
  it("keeps the full shared list flag set on every addListOptions list", () => {
    // Sub-resource lists (e.g. `thirdparties representatives list`) use
    // addGetOptions and never had pagination; --limit identifies the real ones.
    const lists = leaves.filter(
      (l) => l.cmd.name() === "list" && l.cmd.options.some((o) => o.long === "--limit"),
    );
    expect(lists.length).toBeGreaterThan(30);
    for (const { path: p, cmd } of lists) {
      const f = cmd.options.map((o) => o.long);
      for (const flag of [
        "--output",
        "--json",
        "--fields",
        "--limit",
        "--page",
        "--sort",
        "--order",
        "--filter",
      ]) {
        expect(f, `${p} lost ${flag}`).toContain(flag);
      }
    }
  });

  it("keeps --output/--json/--fields on every list, paginated or not", () => {
    for (const { path: p, cmd } of leaves.filter((l) => l.cmd.name() === "list")) {
      const f = cmd.options.map((o) => o.long);
      for (const flag of ["--output", "--json", "--fields"]) {
        expect(f, `${p} lost ${flag}`).toContain(flag);
      }
    }
  });

  it("keeps --confirm on the delete commands that already had it", () => {
    const deletes = leaves.filter((l) => l.cmd.name() === "delete");
    expect(deletes.length).toBeGreaterThan(20);
    for (const { path: p, cmd } of deletes) {
      expect(cmd.options.map((o) => o.long), `${p}`).toContain("--confirm");
    }
  });

  it("leaves read commands' positional arguments untouched", () => {
    const get = leaves.find((l) => l.path === "orders get")!.cmd;
    expect(get.registeredArguments[0].description).not.toMatch(/comma-separated/);
  });

  it("documents the id list on a wired command", () => {
    const validate = leaves.find((l) => l.path === "invoices validate")!.cmd;
    expect(validate.registeredArguments[0].description).toMatch(/comma-separated list/);
  });
});
