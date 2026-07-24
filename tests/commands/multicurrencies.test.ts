import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildCurrencyBody,
  createMulticurrenciesCommand,
  currencyListColumns,
} from "../../src/commands/multicurrencies.js";
import {
  buildKnowledgeBody,
  createKnowledgeCommand,
  knowledgeDetailFields,
  knowledgeListColumns,
} from "../../src/commands/knowledge.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("multicurrencies command (v0.4.6)", () => {
  const cmd = createMulticurrenciesCommand();

  it("registers as 'multicurrencies' with the route-confirmed subcommands", () => {
    expect(cmd.name()).toBe("multicurrencies");
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "rates",
      "set-rate",
      "update",
    ]);
  });

  it("has no by-code lookup (no /multicurrencies/code/{code} route)", () => {
    expect(sub(cmd, "by-code")).toBeUndefined();
  });

  it("create exposes --code, --name and --rate", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of ["--code", "--name", "--rate", "--from-json"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("set-rate requires --rate and is confirmation-guarded", () => {
    const setRate = sub(cmd, "set-rate")!;
    const opt = setRate.options.find((o) => o.long === "--rate")!;
    expect(opt.required || opt.mandatory).toBeTruthy();
    expect(flags(setRate)).toContain("--confirm");
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });

  it("rates takes a currency id", () => {
    const args = (sub(cmd, "rates")! as unknown as { _args: { _name: string }[] })._args;
    expect(args[0]._name).toBe("id");
  });
});

describe("buildCurrencyBody", () => {
  it("keeps code and name and coerces the rate", () => {
    expect(buildCurrencyBody({ code: "USD", name: "US Dollar", rate: "1.08" })).toEqual({
      code: "USD",
      name: "US Dollar",
      rate: 1.08,
    });
  });

  it("omits an unset rate", () => {
    expect(buildCurrencyBody({ code: "GBP", name: "Pound" })).toEqual({
      code: "GBP",
      name: "Pound",
    });
  });
});

describe("currency column specs", () => {
  it("unwraps a nested rate object as well as a scalar rate", () => {
    const col = currencyListColumns.find((c) => c.key === "rate")!;
    expect(col.format!({ rate: { rate: 1.08 } })).toBe("1.08");
    expect(col.format!({ rate: 1.2 })).toBe("1.2");
    expect(col.format!({})).toBe("");
  });
});

describe("knowledge command (v0.4.6)", () => {
  const cmd = createKnowledgeCommand();

  it("registers as 'knowledge' with full CRUD", () => {
    expect(cmd.name()).toBe("knowledge");
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "update",
    ]);
  });

  it("create exposes the record fields and --from-json", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--question",
      "--answer",
      "--ref",
      "--lang",
      "--url",
      "--category",
      "--status",
      "--note-public",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("update carries the same field flags", () => {
    const f = flags(sub(cmd, "update")!);
    for (const flag of ["--question", "--answer", "--status", "--output", "--fields"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });
});

describe("buildKnowledgeBody", () => {
  it("maps flags to Dolibarr field names", () => {
    expect(
      buildKnowledgeBody({
        question: "How do I reset?",
        answer: "Click reset.",
        category: "3",
        status: "1",
        lang: "en_US",
      }),
    ).toEqual({
      question: "How do I reset?",
      answer: "Click reset.",
      fk_c_ticket_category: 3,
      status: 1,
      lang: "en_US",
    });
  });

  it("sends only the flags that were passed", () => {
    expect(buildKnowledgeBody({ answer: "a" })).toEqual({ answer: "a" });
    expect(buildKnowledgeBody({})).toEqual({});
  });
});

describe("knowledge column specs", () => {
  it("labels the status codes, including the non-sequential obsolete code", () => {
    const col = knowledgeListColumns.find((c) => c.key === "status")!;
    expect(col.format!({ status: 0 })).toBe("Draft");
    expect(col.format!({ status: 1 })).toBe("Validated");
    expect(col.format!({ status: 9 })).toBe("Obsolete");
  });

  it("truncates a long question in the list view but not the detail view", () => {
    const list = knowledgeListColumns.find((c) => c.key === "question")!;
    expect(list.format!({ question: "x".repeat(80) })).toHaveLength(50);
    const detail = knowledgeDetailFields.find((c) => c.key === "question")!;
    expect(detail.format).toBeUndefined();
  });
});
