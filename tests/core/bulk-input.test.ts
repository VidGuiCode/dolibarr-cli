import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import {
  BULK_INPUT_EXCLUDED,
  acceptsBulkInput,
  enableBulkInput,
  parseRecords,
  recordLabel,
  recordsFromFile,
} from "../../src/core/bulk-input.js";
import { EXIT_PARTIAL_FAILURE, parseCaptured } from "../../src/core/batch.js";
import { ValidationError } from "../../src/core/errors.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-test-"));
function tmpFile(name: string, content: string): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, content);
  return p;
}

afterEach(() => vi.restoreAllMocks());

describe("parseRecords", () => {
  it("parses a JSON array", () => {
    expect(parseRecords('[{"a":1},{"a":2}]', "src")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("parses NDJSON", () => {
    expect(parseRecords('{"a":1}\n{"a":2}\n', "src")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("tolerates blank lines and CRLF in NDJSON", () => {
    expect(parseRecords('{"a":1}\r\n\r\n{"a":2}\r\n', "src")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("accepts a single object, including pretty-printed across lines", () => {
    expect(parseRecords('{\n  "a": 1\n}', "src")).toEqual([{ a: 1 }]);
  });

  it("accepts an empty array as zero records", () => {
    expect(parseRecords("[]", "src")).toEqual([]);
  });

  it("rejects empty input", () => {
    expect(() => parseRecords("   ", "src")).toThrow(/contained no data/);
  });

  it("rejects a non-object array entry, naming its position", () => {
    expect(() => parseRecords('[{"a":1},"nope"]', "src")).toThrow(
      /entry 2 must be a JSON object, got a string/,
    );
    expect(() => parseRecords("[[1]]", "src")).toThrow(/must be a JSON object, got an array/);
    expect(() => parseRecords("[null]", "src")).toThrow(/got null/);
  });

  it("rejects a malformed NDJSON line, naming the line number", () => {
    expect(() => parseRecords('{"a":1}\nnot json\n', "src")).toThrow(
      /line 2 is not valid JSON/,
    );
  });

  it("rejects a bare scalar", () => {
    expect(() => parseRecords("42", "src")).toThrow(ValidationError);
  });
});

describe("recordsFromFile", () => {
  it("returns undefined for a single object, leaving the old path alone", () => {
    expect(recordsFromFile(tmpFile("one.json", '{"a":1}'))).toBeUndefined();
  });

  it("returns records for an array", () => {
    expect(recordsFromFile(tmpFile("many.json", '[{"a":1},{"a":2}]'))).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  it("throws a clear error for a missing file", () => {
    expect(() => recordsFromFile(path.join(TMP, "nope.json"))).toThrow(
      /Could not read --from-json file/,
    );
  });
});

describe("recordLabel", () => {
  it("uses a human field when present", () => {
    expect(recordLabel({ ref: "INV-1" }, 0)).toBe("#1 INV-1");
    expect(recordLabel({ name: "Acme" }, 2)).toBe("#3 Acme");
  });

  it("falls back to the position", () => {
    expect(recordLabel({ socid: 3 }, 1)).toBe("#2");
    expect(recordLabel({ name: "   " }, 0)).toBe("#1");
  });

  it("truncates a very long label", () => {
    expect(recordLabel({ name: "x".repeat(100) }, 0).length).toBeLessThanOrEqual(45);
  });
});

describe("parseCaptured", () => {
  it("returns undefined when nothing was printed", () => {
    expect(parseCaptured([])).toBeUndefined();
    expect(parseCaptured(["  "])).toBeUndefined();
  });

  it("parses JSON output, so a create's new id is reportable", () => {
    expect(parseCaptured(["19"])).toBe(19);
    expect(parseCaptured(['{"deleted":"3"}'])).toEqual({ deleted: "3" });
  });

  it("falls back to raw text", () => {
    expect(parseCaptured(["Created invoice with ID: 19"])).toBe("Created invoice with ID: 19");
  });
});

describe("exclusions", () => {
  it("excludes supplier-orders receive, whose array means lines of one receipt", () => {
    expect(BULK_INPUT_EXCLUDED.has("supplier-orders receive")).toBe(true);
  });
});

/** A create command shaped like the real ones. */
function fixture(onRun: (body: unknown) => void | Promise<void>) {
  const program = new Command("root").exitOverride();
  const group = new Command("things");
  group
    .command("create")
    .option("--from-json <file>", "Create from JSON file")
    .option("--json", "Output as JSON")
    .action(async function (this: Command) {
      const opts = this.opts();
      const body = opts.fromJson
        ? JSON.parse(fs.readFileSync(opts.fromJson as string, "utf-8"))
        : {};
      await onRun(body);
    });
  program.addCommand(group);
  return program;
}

describe("enableBulkInput wiring", () => {
  it("wires commands with --from-json and adds --stdin/--confirm", () => {
    const program = fixture(() => {});
    expect(enableBulkInput(program)).toEqual(["things create"]);
    const create = program.commands[0].commands[0];
    const longs = create.options.map((o) => o.long);
    expect(longs).toContain("--stdin");
    expect(longs).toContain("--confirm");
  });

  it("identifies bulk-capable commands and honours the exclusion list", () => {
    const program = fixture(() => {});
    const create = program.commands[0].commands[0];
    expect(acceptsBulkInput(create, "things create")).toBe(true);
    expect(acceptsBulkInput(create, "supplier-orders receive")).toBe(false);
  });

  it("leaves a single-object --from-json completely untouched", async () => {
    const bodies: unknown[] = [];
    const program = fixture((b) => {
      bodies.push(b);
    });
    enableBulkInput(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await program.parseAsync(
      ["things", "create", "--from-json", tmpFile("s.json", '{"a":1}')],
      { from: "user" },
    );
    expect(bodies).toEqual([{ a: 1 }]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("runs one call per array entry", async () => {
    const bodies: unknown[] = [];
    const program = fixture((b) => {
      bodies.push(b);
    });
    enableBulkInput(program);
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(
      [
        "things",
        "create",
        "--from-json",
        tmpFile("m.json", '[{"a":1},{"a":2},{"a":3}]'),
        "--confirm",
      ],
      { from: "user" },
    );
    expect(bodies).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("treats a one-entry array as a single run, with no batch reporting", async () => {
    const bodies: unknown[] = [];
    const program = fixture((b) => {
      bodies.push(b);
    });
    enableBulkInput(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await program.parseAsync(
      ["things", "create", "--from-json", tmpFile("one-arr.json", '[{"a":1}]')],
      { from: "user" },
    );
    expect(bodies).toEqual([{ a: 1 }]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("reports partial failure with exit 5", async () => {
    const program = fixture((b) => {
      if ((b as { a: number }).a === 2) throw new Error("boom");
    });
    enableBulkInput(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(
      ["things", "create", "--from-json", tmpFile("p.json", '[{"a":1},{"a":2}]'), "--confirm"],
      { from: "user" },
    );
    expect(exit).toHaveBeenLastCalledWith(EXIT_PARTIAL_FAILURE);
  });

  it("surfaces each item's printed output in the JSON envelope", async () => {
    const program = new Command("root").exitOverride();
    const group = new Command("things");
    group
      .command("create")
      .option("--from-json <file>", "Create from JSON file")
      .option("--json", "Output as JSON")
      .action(function (this: Command) {
        const body = JSON.parse(fs.readFileSync(this.opts().fromJson as string, "utf-8"));
        console.log(String(100 + body.a));
      });
    program.addCommand(group);
    enableBulkInput(program);
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(
      [
        "things",
        "create",
        "--from-json",
        tmpFile("out.json", '[{"a":1},{"a":2}]'),
        "--confirm",
        "--json",
      ],
      { from: "user" },
    );
    const payload = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(payload.results.map((r: { output: unknown }) => r.output)).toEqual([101, 102]);
  });

  it("rejects malformed input with exit 3, running nothing", async () => {
    const bodies: unknown[] = [];
    const program = fixture((b) => {
      bodies.push(b);
    });
    enableBulkInput(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(
      ["things", "create", "--from-json", tmpFile("bad.json", '[{"a":1},"x"]'), "--confirm"],
      { from: "user" },
    );
    expect(exit).toHaveBeenCalledWith(3);
    expect(bodies).toEqual([]);
  });

  it("is idempotent if wiring runs twice", () => {
    const program = fixture(() => {});
    expect(enableBulkInput(program)).toEqual(["things create"]);
    expect(enableBulkInput(program)).toEqual([]);
  });
});
