import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import {
  RESOURCE_FILTERS,
  buildListFilters,
  combineFilters,
  enableListFilters,
  filterSpecForPath,
  hasListFilterOpts,
  isFilterable,
  nextDay,
  parseFilterAmount,
  parseFilterDate,
} from "../../src/core/list-filters.js";
import { ValidationError } from "../../src/core/errors.js";

afterEach(() => vi.restoreAllMocks());

describe("combineFilters", () => {
  it("returns undefined when nothing is supplied", () => {
    expect(combineFilters(undefined, null, "")).toBeUndefined();
  });

  it("passes a lone fragment through unwrapped", () => {
    expect(combineFilters("(t.a:=:1)")).toBe("(t.a:=:1)");
    expect(combineFilters(undefined, "(t.a:=:1)")).toBe("(t.a:=:1)");
  });

  it("ANDs multiple fragments, parenthesising each", () => {
    expect(combineFilters("(t.a:=:1)", "(t.b:=:2)")).toBe("((t.a:=:1)) and ((t.b:=:2))");
  });

  it("preserves order", () => {
    expect(combineFilters("A", "B", "C")).toBe("(A) and (B) and (C)");
  });
});

describe("parseFilterDate", () => {
  it("accepts a well-formed date", () => {
    expect(parseFilterDate("2026-03-31", "--from")).toBe("2026-03-31");
  });

  it("rejects other formats", () => {
    for (const bad of ["01/02/2024", "2024-1-1", "20240101", "March 1", ""]) {
      expect(() => parseFilterDate(bad, "--from"), bad).toThrow(ValidationError);
    }
  });

  it("rejects a date that does not exist on the calendar", () => {
    expect(() => parseFilterDate("2024-02-30", "--to")).toThrow(/not a real calendar date/);
    expect(() => parseFilterDate("2023-02-29", "--to")).toThrow(/not a real calendar date/);
    expect(() => parseFilterDate("2024-13-01", "--to")).toThrow(ValidationError);
  });

  it("accepts a real leap day", () => {
    expect(parseFilterDate("2024-02-29", "--to")).toBe("2024-02-29");
  });

  it("names the offending flag", () => {
    expect(() => parseFilterDate("nope", "--to")).toThrow(/--to/);
  });
});

describe("nextDay", () => {
  it("advances within a month", () => {
    expect(nextDay("2026-03-30")).toBe("2026-03-31");
  });

  it("rolls over a month boundary", () => {
    expect(nextDay("2026-03-31")).toBe("2026-04-01");
  });

  it("rolls over a year boundary", () => {
    expect(nextDay("2025-12-31")).toBe("2026-01-01");
  });

  it("handles leap and non-leap February", () => {
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
    expect(nextDay("2024-02-29")).toBe("2024-03-01");
    expect(nextDay("2023-02-28")).toBe("2023-03-01");
  });
});

describe("parseFilterAmount", () => {
  it("accepts integers, decimals and negatives", () => {
    expect(parseFilterAmount("100", "--min-amount")).toBe(100);
    expect(parseFilterAmount("99.95", "--min-amount")).toBe(99.95);
    expect(parseFilterAmount("-5", "--min-amount")).toBe(-5);
  });

  it("rejects non-numbers", () => {
    expect(() => parseFilterAmount("abc", "--max-amount")).toThrow(ValidationError);
    expect(() => parseFilterAmount("", "--max-amount")).toThrow(ValidationError);
  });
});

describe("filterSpecForPath", () => {
  it("resolves a group and inherits into its sub-commands", () => {
    expect(filterSpecForPath("invoices list")?.dateColumn).toBe("datef");
    expect(filterSpecForPath("invoices credit-notes list")?.dateColumn).toBe("datef");
  });

  it("returns undefined for a resource with no known columns", () => {
    expect(filterSpecForPath("bank list")).toBeUndefined();
    expect(filterSpecForPath("categories list")).toBeUndefined();
  });
});

describe("buildListFilters", () => {
  const invoices = RESOURCE_FILTERS.invoices;
  const dateOnly = RESOURCE_FILTERS.contacts;

  it("returns undefined when no filter flag was given", () => {
    expect(buildListFilters({}, invoices)).toBeUndefined();
  });

  it("builds a lower bound", () => {
    expect(buildListFilters({ from: "2026-03-01" }, invoices)).toBe(
      "(t.datef:>=:'2026-03-01')",
    );
  });

  it("makes --to inclusive by using an exclusive next-day upper bound", () => {
    expect(buildListFilters({ to: "2026-03-31" }, invoices)).toBe("(t.datef:<:'2026-04-01')");
  });

  it("builds a full range", () => {
    expect(buildListFilters({ from: "2026-03-01", to: "2026-03-31" }, invoices)).toBe(
      "(t.datef:>=:'2026-03-01') and (t.datef:<:'2026-04-01')",
    );
  });

  it("builds amount bounds on the resource's own column", () => {
    expect(buildListFilters({ minAmount: "100", maxAmount: "500" }, invoices)).toBe(
      "(t.total_ttc:>=:100) and (t.total_ttc:<=:500)",
    );
    expect(buildListFilters({ minAmount: "1" }, RESOURCE_FILTERS.projects)).toBe(
      "(t.opp_amount:>=:1)",
    );
  });

  it("combines date and amount bounds", () => {
    expect(buildListFilters({ from: "2026-01-01", minAmount: "10" }, invoices)).toBe(
      "(t.datef:>=:'2026-01-01') and (t.total_ttc:>=:10)",
    );
  });

  it("rejects an inverted date range", () => {
    expect(() => buildListFilters({ from: "2026-05-01", to: "2026-01-01" }, invoices)).toThrow(
      /--to \(2026-01-01\) is before --from/,
    );
  });

  it("accepts a single-day range", () => {
    expect(buildListFilters({ from: "2026-03-31", to: "2026-03-31" }, invoices)).toBe(
      "(t.datef:>=:'2026-03-31') and (t.datef:<:'2026-04-01')",
    );
  });

  it("rejects an inverted amount range", () => {
    expect(() =>
      buildListFilters({ minAmount: "500", maxAmount: "100" }, invoices),
    ).toThrow(/--max-amount \(100\) is below --min-amount/);
  });

  it("refuses a date filter on a resource with no date column", () => {
    expect(() => buildListFilters({ from: "2026-01-01" }, { verified: true })).toThrow(
      /no date column/,
    );
  });

  it("refuses an amount filter on a resource with no amount column", () => {
    expect(() => buildListFilters({ minAmount: "5" }, dateOnly)).toThrow(/no amount column/);
  });

  it("refuses a date filter when there is no spec at all", () => {
    expect(() => buildListFilters({ to: "2026-01-01" }, undefined)).toThrow(ValidationError);
  });
});

describe("hasListFilterOpts", () => {
  it("detects each flag", () => {
    expect(hasListFilterOpts({})).toBe(false);
    expect(hasListFilterOpts({ from: "2026-01-01" })).toBe(true);
    expect(hasListFilterOpts({ maxAmount: "1" })).toBe(true);
  });
});

describe("filter spec integrity", () => {
  it("gives every spec at least one usable column", () => {
    for (const [group, spec] of Object.entries(RESOURCE_FILTERS)) {
      expect(Boolean(spec.dateColumn || spec.amountColumn), group).toBe(true);
    }
  });

  it("uses plain column identifiers — no injection, no table prefix", () => {
    for (const [group, spec] of Object.entries(RESOURCE_FILTERS)) {
      for (const col of [spec.dateColumn, spec.amountColumn]) {
        if (col) expect(col, group).toMatch(/^[a-z_][a-z0-9_]*$/);
      }
    }
  });
});

/** Minimal stand-in for an addListOptions-built list command. */
function listFixture() {
  const program = new Command("root").exitOverride();
  const group = new Command("invoices");
  const seen: Record<string, unknown>[] = [];
  group
    .command("list")
    .option("--filter <expr>", "SQL filter expression")
    .option("--json", "Output as JSON")
    .action(function (this: Command) {
      seen.push({ ...this.opts() });
    });
  // A sub-resource listing built without --filter must be left alone.
  group.command("sub-list").option("--json", "Output as JSON").action(() => {});
  program.addCommand(group);
  return { program, seen };
}

describe("enableListFilters wiring", () => {
  it("wires only commands that carry --filter", () => {
    const { program } = listFixture();
    expect(enableListFilters(program)).toEqual(["invoices list"]);
  });

  it("marks a filterable command by its --filter flag", () => {
    const { program } = listFixture();
    const list = program.commands[0].commands.find((c) => c.name() === "list")!;
    const sub = program.commands[0].commands.find((c) => c.name() === "sub-list")!;
    expect(isFilterable(list)).toBe(true);
    expect(isFilterable(sub)).toBe(false);
  });

  it("folds the compiled predicate into --filter before the action runs", async () => {
    const { program, seen } = listFixture();
    enableListFilters(program);
    await program.parseAsync(["invoices", "list", "--from", "2026-03-01"], { from: "user" });
    expect(seen[0].filter).toBe("(t.datef:>=:'2026-03-01')");
  });

  it("ANDs the compiled predicate with a user-supplied --filter", async () => {
    const { program, seen } = listFixture();
    enableListFilters(program);
    await program.parseAsync(
      ["invoices", "list", "--filter", "(t.fk_statut:=:0)", "--to", "2026-03-31"],
      { from: "user" },
    );
    expect(seen[0].filter).toBe("((t.fk_statut:=:0)) and ((t.datef:<:'2026-04-01'))");
  });

  it("leaves --filter untouched when no new flag is used", async () => {
    const { program, seen } = listFixture();
    enableListFilters(program);
    await program.parseAsync(["invoices", "list", "--filter", "(t.a:=:1)"], { from: "user" });
    expect(seen[0].filter).toBe("(t.a:=:1)");
  });

  it("leaves --filter undefined when nothing was passed at all", async () => {
    const { program, seen } = listFixture();
    enableListFilters(program);
    await program.parseAsync(["invoices", "list"], { from: "user" });
    expect(seen[0].filter).toBeUndefined();
  });

  it("exits 3 on a malformed date without running the action", async () => {
    const { program, seen } = listFixture();
    enableListFilters(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["invoices", "list", "--from", "nope"], { from: "user" });
    expect(exit).toHaveBeenCalledWith(3);
    expect(seen).toEqual([]);
  });

  it("skips the date dimension when the command already owns --from/--to", () => {
    const program = new Command("root").exitOverride();
    const group = new Command("invoices");
    const seen: Record<string, unknown>[] = [];
    group
      .command("list")
      .option("--filter <expr>", "SQL filter expression")
      // Pre-existing flags with an unrelated meaning.
      .option("--from <account>", "Source account")
      .option("--to <account>", "Destination account")
      .action(function (this: Command) {
        seen.push({ ...this.opts() });
      });
    program.addCommand(group);
    enableListFilters(program);

    const list = group.commands[0];
    expect(list.options.find((o) => o.long === "--from")!.description).toBe("Source account");
    // The amount dimension is still offered — only the colliding one is dropped.
    expect(list.options.map((o) => o.long)).toContain("--min-amount");
  });

  it("does not treat a pre-existing --from value as a date", async () => {
    const program = new Command("root").exitOverride();
    const group = new Command("invoices");
    const seen: Record<string, unknown>[] = [];
    group
      .command("list")
      .option("--filter <expr>", "SQL filter expression")
      .option("--from <account>", "Source account")
      .option("--to <account>", "Destination account")
      .action(function (this: Command) {
        seen.push({ ...this.opts() });
      });
    program.addCommand(group);
    enableListFilters(program);
    await program.parseAsync(["invoices", "list", "--from", "7"], { from: "user" });
    expect(seen[0].from).toBe("7");
    expect(seen[0].filter).toBeUndefined();
  });

  it("is idempotent if wiring runs twice", () => {
    const { program } = listFixture();
    expect(enableListFilters(program)).toEqual(["invoices list"]);
    expect(enableListFilters(program)).toEqual([]);
  });
});
