import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { walkLeaves } from "../../src/core/command-tree.js";
import {
  enableFinancialConfirmation,
  financialWriteSpec,
} from "../../src/core/financial-writes.js";
import { enableBatchIds } from "../../src/core/batch.js";

/**
 * Reach test for v0.6.0: rebuild the whole command tree exactly as `src/cli.ts`
 * registers it and assert the confirmation gate landed on every financial write —
 * and on nothing else. Spot-checking one group would not catch a resource whose
 * `validate` quietly escaped the gate.
 *
 * The group list is parsed out of `src/cli.ts` itself, so a group added later is
 * covered automatically rather than silently escaping.
 */

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

let program: Command;
let leaves: { path: string; cmd: Command }[];
let wired: string[];
let expected: string[];

beforeAll(async () => {
  program = new Command("dolibarr");
  for (const [factory, file] of registeredGroups()) {
    const loader = commandModules[`../../src/commands/${file}.ts`];
    expect(loader, `no module for ${file}`).toBeTypeOf("function");
    const mod = await loader();
    program.addCommand(mod[factory]());
  }
  leaves = walkLeaves(program);
  expected = leaves.filter((l) => financialWriteSpec(l.path)).map((l) => l.path).sort();
  // Same order as cli.ts: the gate is wired innermost, before the batch layer.
  wired = enableFinancialConfirmation(program);
  enableBatchIds(program);
});

describe("financial confirmation reach", () => {
  it("gates every financial write in the registered tree", () => {
    expect(wired.slice().sort()).toEqual(expected);
  });

  it("actually found financial writes to gate", () => {
    expect(expected.length).toBeGreaterThan(15);
  });

  it("covers the commands the investigation report named by name", () => {
    for (const p of [
      "bank transfer",
      "bank add-transaction",
      "invoices pay",
      "invoices validate",
      "raw",
    ]) {
      expect(wired, p).toContain(p);
    }
  });

  it("gates validate consistently across every resource that has one", () => {
    const validates = leaves.filter((l) => l.path.endsWith(" validate")).map((l) => l.path);
    expect(validates.length).toBeGreaterThan(5);
    for (const p of validates) expect(wired, p).toContain(p);
  });

  it("gates no read command", () => {
    for (const p of wired) {
      expect(p.endsWith(" list"), p).toBe(false);
      expect(p.endsWith(" get"), p).toBe(false);
    }
  });

  it("gives every gated command a --confirm flag", () => {
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      expect(cmd.options.map((o) => o.long), p).toContain("--confirm");
    }
  });

  it("documents the gate in each gated command's help", () => {
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      let out = "";
      cmd.configureOutput({ writeOut: (s) => { out += s; } });
      cmd.outputHelp();
      expect(out, p).toContain("DOLIBARR_ASSUME_YES=1");
    }
  });

  it("is idempotent — wiring twice does not double-gate", () => {
    expect(enableFinancialConfirmation(program)).toEqual([]);
  });
});
