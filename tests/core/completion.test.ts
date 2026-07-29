import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  SUPPORTED_SHELLS,
  buildCompletionSpec,
  generateBash,
  generateCompletion,
  generateFish,
  generateZsh,
  isSupportedShell,
  type CompletionSpec,
} from "../../src/core/completion.js";
import { createCompletionCommand } from "../../src/commands/completion.js";
import { enableOutputFormats } from "../../src/core/formats.js";
import { enableFinancialConfirmation } from "../../src/core/financial-writes.js";
import { enableViews } from "../../src/core/views.js";

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

let spec: CompletionSpec;
let program: Command;

beforeAll(async () => {
  program = new Command("dolibarr");
  program.option("--dry-run").option("--read-only").option("--no-color");
  for (const [factory, file] of registeredGroups()) {
    const loader = commandModules[`../../src/commands/${file}.ts`];
    const mod = await loader();
    program.addCommand(mod[factory]());
  }
  // Same layers cli.ts applies, so the spec sees the flags they add.
  enableFinancialConfirmation(program);
  enableOutputFormats(program);
  enableViews(program);
  spec = buildCompletionSpec(program);
});

describe("shell detection", () => {
  it("accepts the three supported shells", () => {
    for (const s of SUPPORTED_SHELLS) expect(isSupportedShell(s)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isSupportedShell("powershell")).toBe(false);
    expect(isSupportedShell("")).toBe(false);
  });
});

describe("completion spec", () => {
  it("is built from the real command tree", () => {
    expect(spec.groups).toContain("invoices");
    expect(spec.groups).toContain("bank");
    expect(spec.leaves).toContain("invoices list");
    expect(spec.leaves).toContain("bank transfer");
  });

  it("covers the whole surface, not a sample", () => {
    expect(spec.leaves.length).toBeGreaterThan(200);
  });

  /**
   * The point of generating rather than hand-maintaining: flags added by the wiring
   * layers, long after a command file was written, still show up.
   */
  it("includes flags added by the 0.6.x wiring layers", () => {
    expect(spec.flagsByPath["invoices list"]).toContain("--view");
    expect(spec.flagsByPath["invoices list"]).toContain("--redact");
    expect(spec.flagsByPath["bank transfer"]).toContain("--confirm");
    expect(spec.flagsByPath["bank transfer"]).toContain("--allow-duplicate");
  });

  it("captures the program's own global flags", () => {
    expect(spec.globalFlags).toContain("--dry-run");
    expect(spec.globalFlags).toContain("--read-only");
  });
});

describe("generated scripts", () => {
  it("emits something substantial for every shell", () => {
    for (const s of SUPPORTED_SHELLS) {
      expect(generateCompletion(s, spec).length, s).toBeGreaterThan(500);
    }
  });

  it("names the command in each script", () => {
    for (const s of SUPPORTED_SHELLS) {
      expect(generateCompletion(s, spec), s).toContain("dolibarr");
    }
  });

  describe("bash", () => {
    const script = () => generateBash(spec);

    it("registers a completion function", () => {
      expect(script()).toContain("complete -F _dolibarr_completions dolibarr");
    });

    it("offers group names at the top level", () => {
      expect(script()).toContain("invoices");
      expect(script()).toContain("thirdparties");
    });

    it("has balanced case blocks", () => {
      const s = script();
      expect((s.match(/\bcase\b/g) ?? []).length).toBe((s.match(/\besac\b/g) ?? []).length);
    });

    it("carries an install hint", () => {
      expect(script()).toContain("bash_completion.d");
    });
  });

  describe("zsh", () => {
    it("starts with the compdef marker zsh requires", () => {
      expect(generateZsh(spec).startsWith("#compdef dolibarr")).toBe(true);
    });

    it("offers subcommands", () => {
      expect(generateZsh(spec)).toContain("'list'");
    });
  });

  describe("fish", () => {
    const script = () => generateFish(spec);

    it("uses fish's complete syntax", () => {
      expect(script()).toContain("complete -c dolibarr");
    });

    it("offers group names and subcommands", () => {
      expect(script()).toContain("-a 'invoices'");
      expect(script()).toContain("__fish_seen_subcommand_from invoices");
    });

    /**
     * fish sources completion files eagerly, so size is a startup cost. Per-leaf flags
     * produced ~440 KB; per-group keeps it manageable.
     */
    it("stays small enough not to slow shell startup", () => {
      expect(script().length).toBeLessThan(200_000);
    });

    it("does not repeat the global flags on every group", () => {
      const occurrences = (script().match(/-l 'dry-run'/g) ?? []).length;
      expect(occurrences).toBe(1);
    });
  });
});

describe("completion command", () => {
  it("takes a shell argument", () => {
    const cmd = createCompletionCommand(() => program);
    expect(cmd.name()).toBe("completion");
    expect(cmd.registeredArguments.map((a) => a.name())).toEqual(["shell"]);
  });

  it("names the supported shells in its help", () => {
    const cmd = createCompletionCommand(() => program);
    expect(cmd.usage() + cmd.description()).toBeTruthy();
    expect(cmd.registeredArguments[0].description).toContain("bash");
  });
});
