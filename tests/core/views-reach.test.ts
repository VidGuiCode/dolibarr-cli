import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { walkLeaves } from "../../src/core/command-tree.js";
import { enableViews } from "../../src/core/views.js";
import { enableOutputFormats } from "../../src/core/formats.js";
import { renderGet, renderList } from "../../src/core/resource-helpers.js";

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

beforeAll(async () => {
  program = new Command("dolibarr");
  for (const [factory, file] of registeredGroups()) {
    const loader = commandModules[`../../src/commands/${file}.ts`];
    const mod = await loader();
    program.addCommand(mod[factory]());
  }
  enableOutputFormats(program);
  wired = enableViews(program);
  leaves = walkLeaves(program);
});

describe("views reach", () => {
  it("wires --view and --redact onto every output-rendering command", () => {
    const rendering = leaves
      .filter((l) => l.cmd.options.some((o) => o.long === "--output"))
      .map((l) => l.path)
      .sort();
    expect(wired.slice().sort()).toEqual(rendering);
  });

  it("reaches a substantial share of the command surface", () => {
    expect(wired.length).toBeGreaterThan(50);
  });

  it("gives each wired command both flags", () => {
    for (const p of wired) {
      const longs = leaves.find((l) => l.path === p)!.cmd.options.map((o) => o.long);
      expect(longs, p).toContain("--view");
      expect(longs, p).toContain("--redact");
    }
  });

  it("does not claim --profile, which 0.7.0 reserves for multi-instance config", () => {
    for (const p of wired) {
      const longs = leaves.find((l) => l.path === p)!.cmd.options.map((o) => o.long);
      expect(longs, p).not.toContain("--profile");
    }
  });

  it("is idempotent", () => {
    expect(enableViews(program)).toEqual([]);
  });
});

/**
 * The safety property the run must hold by the end of Phase 2: a redacted field
 * never reaches output. Asserted against every rendering path, because `--field`
 * and `--template` bypass the normal projection and would otherwise be a hole.
 */
describe("redaction reaches every output path", () => {
  const row = { id: 1, ref: "R1", email: "secret@example.com", iban: "XX00 1111" };

  afterEach(() => vi.restoreAllMocks());

  function captured(fn: () => void): string {
    const chunks: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => chunks.push(a.join(" ")));
    vi.spyOn(process.stdout, "write").mockImplementation((c) => (chunks.push(String(c)), true));
    fn();
    return chunks.join("\n");
  }

  const columns = [
    { key: "id", label: "ID" },
    { key: "email", label: "Email" },
  ];

  for (const output of ["table", "json", "csv", "ndjson", "yaml"]) {
    it(`never leaks a sensitive value in --output ${output}`, () => {
      const text = captured(() =>
        renderList([row], { columns, opts: { output, redact: true } }),
      );
      expect(text).not.toContain("secret@example.com");
      expect(text).toContain("[redacted]");
    });
  }

  it("never leaks through --field scalar extraction", () => {
    const text = captured(() =>
      renderList([row], { columns, opts: { field: "email", redact: true } }),
    );
    expect(text).not.toContain("secret@example.com");
  });

  it("never leaks through --template", () => {
    const text = captured(() =>
      renderList([row], { columns, opts: { template: "{{.email}}", redact: true } }),
    );
    expect(text).not.toContain("secret@example.com");
  });

  it("never leaks through a detail view", () => {
    const text = captured(() =>
      renderGet(row, {
        fields: [{ key: "email", label: "Email" }],
        opts: { output: "json", redact: true },
      }),
    );
    expect(text).not.toContain("secret@example.com");
  });

  it("never leaks a nested sensitive value", () => {
    const text = captured(() =>
      renderList([{ id: 1, owner: { iban: "XX00 1111" } }], {
        columns,
        opts: { output: "json", redact: true },
      }),
    );
    expect(text).not.toContain("XX00 1111");
  });

  it("shows the value when --redact is absent", () => {
    const text = captured(() => renderList([row], { columns, opts: { output: "json" } }));
    expect(text).toContain("secret@example.com");
  });
});
