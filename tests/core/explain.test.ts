import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { walkLeaves } from "../../src/core/command-tree.js";
import {
  buildExplanation,
  describeGates,
  displayOptions,
  enableExplain,
  renderExplanation,
} from "../../src/core/explain.js";

const NONE = {
  dryRun: false,
  readOnly: false,
  nonInteractive: false,
  assumeYes: false,
  auditing: false,
  hasConfirm: false,
  hasApprove: false,
};

function gateText(path: string, env: Partial<typeof NONE> = {}): string {
  return describeGates(path, { ...NONE, ...env }).join("\n");
}

describe("displayOptions", () => {
  it("keeps the options that describe the operation", () => {
    expect(displayOptions({ amount: "500", from: "1" })).toEqual({ amount: "500", from: "1" });
  });

  it("drops flags that describe the run rather than the operation", () => {
    expect(
      displayOptions({ amount: "500", json: true, explain: true, output: "json", quiet: true }),
    ).toEqual({ amount: "500" });
  });

  /** The approval token is a secret; printing it would put it in terminals and CI logs. */
  it("never shows the approval token", () => {
    expect(displayOptions({ amount: "500", approve: "s3cret" })).toEqual({ amount: "500" });
  });

  it("redacts a sensitive value it does show", () => {
    expect(displayOptions({ iban: "XX00 1111" }).iban).toBe("[redacted]");
  });

  it("drops absent and false flags", () => {
    expect(displayOptions({ a: undefined, b: false, c: "keep" })).toEqual({ c: "keep" });
  });
});

describe("gate description", () => {
  it("says a read command writes nothing", () => {
    const text = gateText("invoices list");
    expect(text).toContain("does not write");
  });

  it("leads with read-only, because it stops a write before anything asks for approval", () => {
    const gates = describeGates("bank transfer", { ...NONE, readOnly: true });
    expect(gates[0]).toContain("read-only");
    expect(gates[0]).toContain("exit 6");
  });

  it("reports the duplicate check only on money movements", () => {
    expect(gateText("bank transfer")).toContain("Duplicate check");
    expect(gateText("invoices validate")).not.toContain("Duplicate check");
  });

  it("predicts refusal in non-interactive mode without approval", () => {
    expect(gateText("bank transfer", { nonInteractive: true })).toContain("WILL BE REFUSED");
  });

  it("recognises each approval route", () => {
    expect(gateText("bank transfer", { hasConfirm: true })).toContain("satisfied by --confirm");
    expect(gateText("bank transfer", { assumeYes: true })).toContain("DOLIBARR_ASSUME_YES");
    expect(gateText("bank transfer", { hasApprove: true })).toContain(
      "DOLIBARR_APPROVAL_TOKEN",
    );
  });

  it("prefers the token over --confirm when both are present", () => {
    expect(gateText("bank transfer", { hasApprove: true, hasConfirm: true })).toContain(
      "DOLIBARR_APPROVAL_TOKEN",
    );
  });

  it("says a dry run neither sends nor asks for approval", () => {
    const text = gateText("bank transfer", { dryRun: true });
    expect(text).toContain("never sent");
    expect(text).toContain("Approval is not requested");
  });

  it("mentions the audit log when auditing is on", () => {
    expect(gateText("bank transfer", { auditing: true })).toContain("audit log");
  });
});

describe("buildExplanation", () => {
  it("classifies a money movement", () => {
    const e = buildExplanation("bank transfer", "Transfer", [], { amount: "5" }, NONE);
    expect(e.classification).toBe("money");
    expect(e.willExecute).toBe(false);
  });

  it("classifies a read as read", () => {
    const e = buildExplanation("invoices list", "List", [], {}, NONE);
    expect(e.classification).toBe("read");
    expect(e.effect).toContain("makes no change");
  });

  it("carries the positional arguments", () => {
    expect(buildExplanation("invoices validate", "V", ["42"], {}, NONE).arguments).toEqual(["42"]);
  });
});

describe("renderExplanation", () => {
  const lines = renderExplanation(
    buildExplanation("bank transfer", "Transfer between accounts", [], { amount: "500" }, NONE),
  );

  it("names the command, effect and gates", () => {
    const text = lines.join("\n");
    expect(text).toContain("dolibarr bank transfer");
    expect(text).toContain("Classification: money");
    expect(text).toContain("--amount 500");
    expect(text).toContain("Gates:");
  });

  it("states plainly that nothing ran", () => {
    expect(lines.join("\n")).toContain("Nothing was executed");
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

describe("explain reach", () => {
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
    wired = enableExplain(program);
    leaves = walkLeaves(program);
  });

  it("reaches every leaf command", () => {
    expect(wired.slice().sort()).toEqual(leaves.map((l) => l.path).sort());
  });

  it("gives every command the --explain flag", () => {
    for (const p of wired) {
      const cmd = leaves.find((l) => l.path === p)!.cmd;
      expect(cmd.options.map((o) => o.long), p).toContain("--explain");
    }
  });

  it("is idempotent", () => {
    expect(enableExplain(program)).toEqual([]);
  });

  /**
   * --explain must short-circuit before every other layer, so it can describe a
   * financial write without triggering the confirmation prompt it is describing.
   */
  it("is wired outermost in cli.ts", () => {
    const explain = cliSource.indexOf("enableExplain(program)");
    for (const earlier of [
      "enableFinancialConfirmation(program)",
      "enableBatchIds(program)",
      "enableAutoPaginate(program)",
      "enablePickers(program)",
    ]) {
      expect(cliSource.indexOf(earlier), earlier).toBeLessThan(explain);
    }
  });
});
