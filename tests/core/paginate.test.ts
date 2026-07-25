import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import { DolibarrApiClient } from "../../src/core/api-client.js";
import {
  AUTO_PAGE_SIZE,
  DEFAULT_MAX_RECORDS,
  enableAutoPaginate,
  getAutoPaginate,
  isPaginatedList,
  isPaginatedQuery,
  parseMaxRecords,
  resetAutoPaginate,
  setAutoPaginate,
} from "../../src/core/paginate.js";
import { ValidationError } from "../../src/core/errors.js";

const client = new DolibarrApiClient({
  baseUrl: "https://erp.example.com",
  apiKey: "k",
  retries: 0,
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAutoPaginate();
});

/** Serve `total` rows, paging by whatever `limit`/`page` the client asks for. */
function mockRows(total: number) {
  const seen: { limit: string | null; page: string | null }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const limit = Number(url.searchParams.get("limit"));
    const page = Number(url.searchParams.get("page"));
    seen.push({
      limit: url.searchParams.get("limit"),
      page: url.searchParams.get("page"),
    });
    const start = page * limit;
    const rows = [];
    for (let i = start; i < Math.min(start + limit, total); i++) rows.push({ id: i });
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  return seen;
}

describe("isPaginatedQuery", () => {
  it("needs both limit and page — the buildListQuery signature", () => {
    expect(isPaginatedQuery({ limit: "50", page: "0" })).toBe(true);
    expect(isPaginatedQuery({ limit: "50" })).toBe(false);
    expect(isPaginatedQuery({ page: "0" })).toBe(false);
    expect(isPaginatedQuery({})).toBe(false);
    expect(isPaginatedQuery(undefined)).toBe(false);
  });
});

describe("parseMaxRecords", () => {
  it("defaults when unset", () => {
    expect(parseMaxRecords(undefined)).toBe(DEFAULT_MAX_RECORDS);
  });

  it("accepts a positive integer", () => {
    expect(parseMaxRecords("250")).toBe(250);
  });

  it("rejects zero, negatives, decimals and junk", () => {
    for (const bad of ["0", "-5", "1.5", "abc", ""]) {
      expect(() => parseMaxRecords(bad), bad).toThrow(ValidationError);
    }
  });
});

describe("auto-paginate off (default)", () => {
  it("issues exactly one request and honours --limit", async () => {
    const seen = mockRows(500);
    const rows = await client.get<unknown[]>("things", { limit: "50", page: "0" });
    expect(rows).toHaveLength(50);
    expect(seen).toEqual([{ limit: "50", page: "0" }]);
  });

  it("leaves a detail fetch alone even when enabled", async () => {
    setAutoPaginate({ enabled: true });
    const seen = mockRows(500);
    await client.get("things/7");
    expect(seen).toHaveLength(1);
  });
});

describe("auto-paginate on", () => {
  it("walks every page and concatenates, ignoring the caller's limit", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    const seen = mockRows(245);
    const rows = await client.get<{ id: number }[]>("things", { limit: "50", page: "0" });

    expect(rows).toHaveLength(245);
    expect(seen).toEqual([
      { limit: String(AUTO_PAGE_SIZE), page: "0" },
      { limit: String(AUTO_PAGE_SIZE), page: "1" },
      { limit: String(AUTO_PAGE_SIZE), page: "2" },
    ]);
  });

  it("returns rows in order with no duplicates or gaps", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    mockRows(245);
    const rows = await client.get<{ id: number }[]>("things", { limit: "50", page: "0" });
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 245 }, (_, i) => i));
  });

  it("stops cleanly when the total is an exact multiple of the page size", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    const seen = mockRows(AUTO_PAGE_SIZE * 2);
    const rows = await client.get<unknown[]>("things", { limit: "50", page: "0" });
    // Two full pages, then one more request that comes back empty.
    expect(rows).toHaveLength(AUTO_PAGE_SIZE * 2);
    expect(seen).toHaveLength(3);
  });

  it("handles an empty first page", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    const seen = mockRows(0);
    expect(await client.get<unknown[]>("things", { limit: "50", page: "0" })).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("stops at the cap and announces it", async () => {
    setAutoPaginate({ enabled: true, maxRecords: 120 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRows(500);
    const rows = await client.get<unknown[]>("things", { limit: "50", page: "0" });
    expect(rows).toHaveLength(120);
    expect(err.mock.calls.flat().join("\n")).toMatch(/Stopped at the --max-records cap of 120/);
  });

  it("announces the cap even when it lands exactly on a page boundary", async () => {
    setAutoPaginate({ enabled: true, maxRecords: AUTO_PAGE_SIZE });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRows(500);
    const rows = await client.get<unknown[]>("things", { limit: "50", page: "0" });
    expect(rows).toHaveLength(AUTO_PAGE_SIZE);
    expect(err.mock.calls.flat().join("\n")).toMatch(/Stopped at the --max-records cap/);
  });

  it("does not announce a cap when the data simply ran out", async () => {
    setAutoPaginate({ enabled: true, maxRecords: 1000 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRows(150);
    const rows = await client.get<unknown[]>("things", { limit: "50", page: "0" });
    expect(rows).toHaveLength(150);
    expect(err).not.toHaveBeenCalled();
  });

  it("treats a 404 on a later page as the end of the list", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify(Array.from({ length: AUTO_PAGE_SIZE }, (_, i) => ({ id: i }))),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    const rows = await client.get<unknown[]>("things", { limit: "50", page: "0" });
    expect(rows).toHaveLength(AUTO_PAGE_SIZE);
  });

  it("propagates a 404 on the very first page", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ error: "nope" }), { status: 404 }),
    );
    await expect(client.get("things", { limit: "50", page: "0" })).rejects.toThrow();
  });

  it("propagates a permission error instead of returning a partial list", async () => {
    setAutoPaginate({ enabled: true, maxRecords: DEFAULT_MAX_RECORDS });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Forbidden", { status: 403 }),
    );
    await expect(client.get("things", { limit: "50", page: "0" })).rejects.toThrow();
  });
});

/** A list command shaped like one built by addListOptions. */
function listFixture(onRun?: () => void | Promise<void>) {
  const program = new Command("root").exitOverride();
  const group = new Command("things");
  group
    .command("list")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number", "0")
    .option("--json", "Output as JSON")
    .action(async () => {
      await onRun?.();
    });
  group.command("get").argument("<id>", "id").action(() => {});
  program.addCommand(group);
  return program;
}

describe("enableAutoPaginate wiring", () => {
  it("wires list commands and not detail commands", () => {
    const program = listFixture();
    expect(enableAutoPaginate(program)).toEqual(["things list"]);
  });

  it("identifies a paginated list by its --limit flag", () => {
    const program = listFixture();
    const list = program.commands[0].commands.find((c) => c.name() === "list")!;
    const get = program.commands[0].commands.find((c) => c.name() === "get")!;
    expect(isPaginatedList(list)).toBe(true);
    expect(isPaginatedList(get)).toBe(false);
  });

  it("skips a --limit-only command, which could never page", () => {
    // `categories objects` is the real example: it takes --limit but never
    // emits `page`, so --all there would be a flag that silently does nothing.
    const program = new Command("root").exitOverride();
    const group = new Command("categories");
    group.command("objects").option("--limit <n>", "Max results").action(() => {});
    program.addCommand(group);

    expect(isPaginatedList(group.commands[0])).toBe(false);
    expect(enableAutoPaginate(program)).toEqual([]);
    expect(group.commands[0].options.map((o) => o.long)).not.toContain("--all");
  });

  it("adds --all and --max-records", () => {
    const program = listFixture();
    enableAutoPaginate(program);
    const list = program.commands[0].commands.find((c) => c.name() === "list")!;
    const longs = list.options.map((o) => o.long);
    expect(longs).toContain("--all");
    expect(longs).toContain("--max-records");
  });

  it("leaves the state off when --all is absent", async () => {
    let observed = true;
    const program = listFixture(() => {
      observed = getAutoPaginate().enabled;
    });
    enableAutoPaginate(program);
    await program.parseAsync(["things", "list"], { from: "user" });
    expect(observed).toBe(false);
  });

  it("turns the state on for the duration of the action only", async () => {
    let observed = false;
    const program = listFixture(() => {
      observed = getAutoPaginate().enabled;
    });
    enableAutoPaginate(program);
    await program.parseAsync(["things", "list", "--all"], { from: "user" });
    expect(observed).toBe(true);
    // Must not leak into whatever runs next.
    expect(getAutoPaginate().enabled).toBe(false);
  });

  it("resets the state even when the action throws", async () => {
    const program = listFixture(() => {
      throw new Error("boom");
    });
    enableAutoPaginate(program);
    await expect(
      program.parseAsync(["things", "list", "--all"], { from: "user" }),
    ).rejects.toThrow("boom");
    expect(getAutoPaginate().enabled).toBe(false);
  });

  it("passes --max-records through to the state", async () => {
    let observed = 0;
    const program = listFixture(() => {
      observed = getAutoPaginate().maxRecords;
    });
    enableAutoPaginate(program);
    await program.parseAsync(["things", "list", "--all", "--max-records", "250"], {
      from: "user",
    });
    expect(observed).toBe(250);
  });

  it("rejects a bad --max-records with exit 3 before running the action", async () => {
    let ran = false;
    const program = listFixture(() => {
      ran = true;
    });
    enableAutoPaginate(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["things", "list", "--all", "--max-records", "0"], {
      from: "user",
    });
    expect(exit).toHaveBeenCalledWith(3);
    expect(ran).toBe(false);
  });

  it("is idempotent if wiring runs twice", () => {
    const program = listFixture();
    expect(enableAutoPaginate(program)).toEqual(["things list"]);
    expect(enableAutoPaginate(program)).toEqual([]);
  });
});
