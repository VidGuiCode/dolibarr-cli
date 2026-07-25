import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  DEFAULT_SELECTION_CAP,
  EXIT_PARTIAL_FAILURE,
  STATUS_SCOPED_VERBS,
  enableBatchIds,
  resolveStatusSelection,
  walkLeaves,
} from "../../src/core/batch.js";
import { RESOURCE_STATUSES } from "../../src/core/statuses.js";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.DOLIBARR_URL = "https://erp.example.com";
  process.env.DOLIBARR_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...OLD_ENV };
});

/** Capture the sqlfilters/limit actually sent, and reply with `rows`. */
function mockList(rows: unknown[], status = 200) {
  const seen: URL[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    seen.push(new URL(String(input)));
    return new Response(JSON.stringify(rows), { status });
  });
  return seen;
}

describe("resolveStatusSelection", () => {
  const spec = RESOURCE_STATUSES.invoices;

  it("sends the status predicate server-side and returns the ids", async () => {
    const seen = mockList([{ id: 4 }, { id: 5 }]);
    const sel = await resolveStatusSelection(spec, 0, undefined, 10);
    expect(sel).toEqual({ ids: ["4", "5"], truncated: false, cap: 10 });
    expect(seen[0].searchParams.get("sqlfilters")).toBe("(t.fk_statut:=:0)");
  });

  it("asks for cap + 1 rows so truncation is detectable, never silent", async () => {
    const seen = mockList([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const sel = await resolveStatusSelection(spec, 0, undefined, 2);
    expect(seen[0].searchParams.get("limit")).toBe("3");
    expect(sel.ids).toEqual(["1", "2"]);
    expect(sel.truncated).toBe(true);
  });

  it("ANDs a user filter into the selection", async () => {
    const seen = mockList([]);
    await resolveStatusSelection(spec, 1, "(t.ref:like:'CLIBULK-%')", 5);
    expect(seen[0].searchParams.get("sqlfilters")).toBe(
      "((t.ref:like:'CLIBULK-%')) and (t.fk_statut:=:1)",
    );
  });

  it("treats a 404 as an empty selection, not a crash", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 }),
    );
    expect(await resolveStatusSelection(spec, 3, undefined, 10)).toEqual({
      ids: [],
      truncated: false,
      cap: 10,
    });
  });

  it("falls back to rowid when id is absent, and drops rows with neither", async () => {
    mockList([{ rowid: 7 }, { ref: "no-id" }]);
    const sel = await resolveStatusSelection(spec, 0, undefined, 10);
    expect(sel.ids).toEqual(["7"]);
  });

  it("propagates a non-404 API error rather than selecting nothing", async () => {
    // 403 rather than 5xx: the client retries 5xx with backoff, which is not
    // what this test is about.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("nope", { status: 403 }),
    );
    await expect(resolveStatusSelection(spec, 0, undefined, 10)).rejects.toThrow();
  });
});

/** A fixture group carrying a real status vocabulary (`invoices`). */
function fixture(onRun: (id: string) => void | Promise<void>) {
  const group = new Command("invoices");
  group
    .command("validate")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .action(async (id: string) => {
      await onRun(id);
    });
  const program = new Command("root").exitOverride();
  program.addCommand(group);
  enableBatchIds(program);
  return program;
}

describe("status-scoped run", () => {
  it("selects, reports per item, and exits 0 when all succeed", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    mockList([{ id: 41 }, { id: 42 }]);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["invoices", "validate", "--all-draft", "--confirm"], {
      from: "user",
    });
    expect(seen).toEqual(["41", "42"]);
    expect(exit).toHaveBeenLastCalledWith(0);
  });

  it("exits 0 and does nothing when no record matches", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    mockList([]);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["invoices", "validate", "--all-paid", "--confirm"], {
      from: "user",
    });
    expect(seen).toEqual([]);
    expect(exit).toHaveBeenLastCalledWith(0);
    expect(log.mock.calls.flat().join("\n")).toMatch(/No paid records matched/);
  });

  it("announces truncation instead of silently capping", async () => {
    const program = fixture(() => {});
    mockList([{ id: 1 }, { id: 2 }, { id: 3 }]);
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(
      ["invoices", "validate", "--all-draft", "--max", "2", "--confirm"],
      { from: "user" },
    );
    expect(err.mock.calls.flat().join("\n")).toMatch(/More than 2 draft records matched/);
  });

  it("reports partial failure with exit 5", async () => {
    const program = fixture((id) => {
      if (id === "42") throw new Error("boom");
    });
    mockList([{ id: 41 }, { id: 42 }]);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["invoices", "validate", "--all-draft", "--confirm"], {
      from: "user",
    });
    expect(exit).toHaveBeenLastCalledWith(EXIT_PARTIAL_FAILURE);
  });

  it("rejects combining an id with a selector", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["invoices", "validate", "9", "--all-draft", "--confirm"], {
      from: "user",
    });
    expect(seen).toEqual([]);
    expect(exit).toHaveBeenLastCalledWith(3);
    expect(err.mock.calls.flat().join("\n")).toMatch(/either an id or --all-draft/);
  });

  it("rejects two selectors at once", async () => {
    const program = fixture(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(
      ["invoices", "validate", "--all-draft", "--all-paid", "--confirm"],
      { from: "user" },
    );
    expect(exit).toHaveBeenLastCalledWith(3);
    expect(err.mock.calls.flat().join("\n")).toMatch(/Pick one status selector/);
  });

  it("rejects a nonsense --max before touching anything", async () => {
    const program = fixture(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(
      ["invoices", "validate", "--all-draft", "--max", "0", "--confirm"],
      { from: "user" },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(exit).toHaveBeenLastCalledWith(3);
  });

  it("still errors with exit 1 when neither an id nor a selector is given", async () => {
    // Making <id> optional must not change what happens when it is omitted:
    // commander's own missing-argument error, and its exit code 1 — not our 3.
    const program = fixture(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    // commander writes this one straight to the stream, not via console.error.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await program.parseAsync(["invoices", "validate"], { from: "user" });
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr.mock.calls.flat().join("\n")).toMatch(/missing required argument/i);
  });

  it("degrades gracefully when the selection call is permission-gated", async () => {
    // Resolving a selection is an API call outside any command's own try/catch.
    // A 403 here must produce the normal hinted error and exit 2, never an
    // unhandled rejection with a stack trace.
    const program = fixture(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Forbidden", { status: 403 }),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      program.parseAsync(["invoices", "validate", "--all-draft", "--confirm"], { from: "user" }),
    ).resolves.toBeDefined();

    expect(exit).toHaveBeenCalledWith(2);
    expect(err.mock.calls.flat().join("\n")).toMatch(/Permission denied|403/);
  });

  it("degrades gracefully in JSON mode too", async () => {
    const program = fixture(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Forbidden", { status: 403 }),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["invoices", "validate", "--all-draft", "--confirm", "--json"], {
      from: "user",
    });
    expect(exit).toHaveBeenCalledWith(2);
    expect(JSON.parse(err.mock.calls.at(-1)![0] as string)).toMatchObject({ status: "error" });
  });

  it("leaves the plain single-id path completely alone", async () => {
    const seen: string[] = [];
    const program = fixture((id) => {
      seen.push(id);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await program.parseAsync(["invoices", "validate", "9"], { from: "user" });
    expect(seen).toEqual(["9"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("status-scoped defaults", () => {
  it("defaults the cap to DEFAULT_SELECTION_CAP", async () => {
    const program = fixture(() => {});
    const seen = mockList([]);
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["invoices", "validate", "--all-draft", "--confirm"], {
      from: "user",
    });
    expect(seen[0].searchParams.get("limit")).toBe(String(DEFAULT_SELECTION_CAP + 1));
  });

  it("keeps status-scoped verbs a subset of the batchable ones", () => {
    const validate = walkLeaves(fixture(() => {})).find((l) => l.path === "invoices validate")!;
    expect(STATUS_SCOPED_VERBS.has(validate.cmd.name())).toBe(true);
  });
});
