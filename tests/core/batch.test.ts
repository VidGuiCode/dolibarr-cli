import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import {
  BATCH_VERBS,
  EXIT_PARTIAL_FAILURE,
  READ_ONLY_ID_VERBS,
  batchExitCode,
  enableBatchIds,
  isBatchInput,
  isBatchable,
  parseIdList,
  unpackItemError,
  walkLeaves,
} from "../../src/core/batch.js";
import { ValidationError } from "../../src/core/errors.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.__none;
});

describe("parseIdList", () => {
  it("splits a comma list", () => {
    expect(parseIdList("1,2,3")).toEqual(["1", "2", "3"]);
  });

  it("trims whitespace and drops empty segments", () => {
    expect(parseIdList(" 1, 2 ,, 3 ,")).toEqual(["1", "2", "3"]);
  });

  it("de-duplicates while preserving order", () => {
    expect(parseIdList("3,1,3,2,1")).toEqual(["3", "1", "2"]);
  });

  it("accepts a single-element list", () => {
    expect(parseIdList("7,")).toEqual(["7"]);
  });

  it("throws on an empty list", () => {
    expect(() => parseIdList(",")).toThrow(ValidationError);
    expect(() => parseIdList(" , , ")).toThrow(/Empty id list/);
  });

  it("throws on a non-numeric id and names the offender", () => {
    expect(() => parseIdList("1,abc,3")).toThrow(ValidationError);
    expect(() => parseIdList("1,abc,3")).toThrow(/Invalid id "abc"/);
  });

  it("rejects negative and decimal ids", () => {
    expect(() => parseIdList("1,-2")).toThrow(ValidationError);
    expect(() => parseIdList("1,2.5")).toThrow(ValidationError);
  });
});

describe("isBatchInput", () => {
  it("is true only for comma-bearing strings", () => {
    expect(isBatchInput("1,2")).toBe(true);
    expect(isBatchInput("12")).toBe(false);
    expect(isBatchInput("FA2501-0001")).toBe(false);
    expect(isBatchInput(undefined)).toBe(false);
    expect(isBatchInput(12)).toBe(false);
  });
});

describe("batchExitCode", () => {
  it("returns 0 when everything succeeded", () => {
    expect(batchExitCode([{ id: "1", ok: true }, { id: "2", ok: true }])).toBe(0);
  });

  it("returns 5 on partial success", () => {
    expect(
      batchExitCode([
        { id: "1", ok: true },
        { id: "2", ok: false, exitCode: 1 },
      ]),
    ).toBe(EXIT_PARTIAL_FAILURE);
  });

  it("propagates the underlying code when everything failed", () => {
    expect(
      batchExitCode([
        { id: "1", ok: false, exitCode: 2 },
        { id: "2", ok: false, exitCode: 2 },
      ]),
    ).toBe(2);
  });

  it("falls back to 1 when a total failure carries no code", () => {
    expect(batchExitCode([{ id: "1", ok: false }])).toBe(1);
  });
});

describe("unpackItemError", () => {
  it("passes a plain message through, stripping the error glyph", () => {
    expect(unpackItemError("✗  boom")).toEqual({ error: "boom" });
  });

  it("unpacks a JSON error envelope into message + details", () => {
    const raw = JSON.stringify({
      status: "error",
      code: "API_ERROR",
      message: "API error 404: Not Found",
      details: { httpStatus: 404, path: "invoices/9/validate" },
    });
    expect(unpackItemError(raw)).toEqual({
      error: "API error 404: Not Found",
      detail: { httpStatus: 404, path: "invoices/9/validate" },
    });
  });

  it("falls back to the raw text on malformed JSON", () => {
    expect(unpackItemError("{not json")).toEqual({ error: "{not json" });
  });

  it("handles an empty reason", () => {
    expect(unpackItemError("")).toEqual({ error: "" });
  });
});

describe("verb tables", () => {
  it("do not overlap", () => {
    for (const v of BATCH_VERBS) expect(READ_ONLY_ID_VERBS.has(v)).toBe(false);
  });
});

/** Build a throwaway group whose actions record calls instead of hitting the API. */
function fixture(onRun: (id: string) => void | Promise<void>) {
  const group = new Command("things");
  group
    .command("validate")
    .argument("<id>", "Thing ID")
    .option("--json", "Output as JSON")
    .action(async (id: string) => {
      await onRun(id);
    });
  group
    .command("get")
    .argument("<id>", "Thing ID")
    .action(async (id: string) => {
      await onRun(id);
    });
  const program = new Command("root").exitOverride();
  program.addCommand(group);
  return program;
}

describe("isBatchable / walkLeaves", () => {
  const program = fixture(() => {});
  const leaves = walkLeaves(program);

  it("finds leaf subcommands with their full path", () => {
    expect(leaves.map((l) => l.path).sort()).toEqual(["things get", "things validate"]);
  });

  it("accepts a mutating sole-<id> verb and rejects a read verb", () => {
    expect(isBatchable(leaves.find((l) => l.path === "things validate")!.cmd)).toBe(true);
    expect(isBatchable(leaves.find((l) => l.path === "things get")!.cmd)).toBe(false);
  });
});

describe("enableBatchIds wiring", () => {
  it("wires only the batchable subcommand", () => {
    expect(enableBatchIds(fixture(() => {}))).toEqual(["things validate"]);
  });

  it("adds --confirm to a batchable command that lacked it", () => {
    const program = fixture(() => {});
    enableBatchIds(program);
    const validate = walkLeaves(program).find((l) => l.path === "things validate")!.cmd;
    expect(validate.options.map((o) => o.long)).toContain("--confirm");
  });

  it("leaves a single id on the untouched original path", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    enableBatchIds(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await program.parseAsync(["things", "validate", "12"], { from: "user" });
    expect(seen).toEqual(["12"]);
    // The single-id path must not go through the batch reporter at all.
    expect(exit).not.toHaveBeenCalled();
  });

  it("treats a one-element list as the single-id path", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    enableBatchIds(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await program.parseAsync(["things", "validate", "12,"], { from: "user" });
    expect(seen).toEqual(["12"]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("runs every id and exits 0 when all succeed", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    enableBatchIds(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["things", "validate", "1,2,3", "--confirm"], { from: "user" });
    expect(seen).toEqual(["1", "2", "3"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("continues past a failure and exits 5 on partial success", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
      if (id === "2") throw new Error("boom");
    });
    enableBatchIds(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["things", "validate", "1,2,3", "--confirm"], { from: "user" });
    expect(seen).toEqual(["1", "2", "3"]);
    expect(exit).toHaveBeenCalledWith(EXIT_PARTIAL_FAILURE);
  });

  it("emits a machine-readable envelope under --json", async () => {
    const program = fixture((id) => {
      if (id === "2") throw new Error("boom");
    });
    enableBatchIds(program);
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["things", "validate", "1,2", "--confirm", "--json"], {
      from: "user",
    });
    const payload = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(payload).toMatchObject({
      batch: true,
      action: "things validate",
      total: 2,
      succeeded: 1,
      failed: 1,
      exitCode: EXIT_PARTIAL_FAILURE,
    });
    expect(payload.results).toEqual([
      { id: "1", ok: true },
      { id: "2", ok: false, exitCode: 1, error: expect.stringContaining("boom") },
    ]);
  });

  it("rejects a non-numeric id in a list without running anything", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    enableBatchIds(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["things", "validate", "1,nope", "--confirm"], { from: "user" });
    expect(seen).toEqual([]);
    expect(exit).toHaveBeenCalledWith(3);
  });

  it("survives an item that calls process.exit itself", async () => {
    const program = new Command("root").exitOverride();
    const group = new Command("things");
    const seen: string[] = [];
    group
      .command("validate")
      .argument("<id>", "Thing ID")
      .action((id: string) => {
        seen.push(id);
        if (id === "1") process.exit(2);
      });
    program.addCommand(group);
    enableBatchIds(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["things", "validate", "1,2", "--confirm"], { from: "user" });
    // The batch kept going after item 1 bailed out, and reported partial failure.
    expect(seen).toEqual(["1", "2"]);
    expect(exit).toHaveBeenLastCalledWith(EXIT_PARTIAL_FAILURE);
  });
});
