import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildExpenseReportCreateBody,
  buildExpenseReportPaymentBody,
  buildExpenseReportUpdateBody,
  createExpenseReportsCommand,
  expenseReportDetailFields,
  expenseReportListColumns,
  resolveStatusCode,
  STATUS_CODES,
} from "../../src/commands/expensereports.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("expensereports command (v0.4.1)", () => {
  const cmd = createExpenseReportsCommand();

  it("registers as 'expensereports' with a description", () => {
    expect(cmd.name()).toBe("expensereports");
    expect(cmd.description()).toMatch(/expense report/i);
  });

  it("exposes the route-confirmed subcommands", () => {
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "payments",
      "set-status",
      "update",
    ]);
  });

  it("has no lines subcommand (no /expensereports/{id}/lines route exists)", () => {
    expect(sub(cmd, "lines")).toBeUndefined();
    expect(sub(cmd, "add-line")).toBeUndefined();
  });

  it("list supports the shared list flags plus --user", () => {
    const f = flags(sub(cmd, "list")!);
    for (const flag of ["--limit", "--page", "--output", "--json", "--fields", "--user"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("create exposes the live-verified fields and --from-json", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--user",
      "--date-start",
      "--date-end",
      "--validator",
      "--note-public",
      "--note-private",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("update omits --ref-ext because Dolibarr does not persist it", () => {
    expect(flags(sub(cmd, "update")!)).not.toContain("--ref-ext");
  });

  it("delete and set-status both require explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
    expect(flags(sub(cmd, "set-status")!)).toContain("--confirm");
  });

  it("set-status requires --status", () => {
    const opt = sub(cmd, "set-status")!.options.find((o) => o.long === "--status")!;
    expect(opt.required || opt.mandatory).toBeTruthy();
  });

  it("state-echoing mutations accept the detail-view flags so the echo is projectable", () => {
    for (const name of ["create", "update", "set-status"]) {
      const f = flags(sub(cmd, name)!);
      expect(f, `${name} --output`).toContain("--output");
      expect(f, `${name} --fields`).toContain("--fields");
      expect(f, `${name} --json`).toContain("--json");
    }
  });

  it("payments subgroup has list/get/add/update", () => {
    const grp = sub(cmd, "payments")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual(["add", "get", "list", "update"]);
  });

  it("payments add is guarded and requires the money-relevant fields", () => {
    const add = sub(sub(cmd, "payments")!, "add")!;
    const f = flags(add);
    for (const flag of ["--amount", "--date", "--payment-type", "--confirm", "--account"]) {
      expect(f, flag).toContain(flag);
    }
  });
});

describe("buildExpenseReportCreateBody", () => {
  it("maps flags to the live-verified field names", () => {
    expect(
      buildExpenseReportCreateBody({
        user: "2",
        dateStart: "2026-03-01",
        dateEnd: "2026-03-31",
        validator: "1",
        notePublic: "trip",
      }),
    ).toEqual({
      fk_user_author: 2,
      fk_user_validator: 1,
      note_public: "trip",
      date_debut: Date.UTC(2026, 2, 1) / 1000,
      date_fin: Date.UTC(2026, 2, 31) / 1000,
    });
  });

  it("omits unset optional fields", () => {
    expect(buildExpenseReportCreateBody({ user: "7" })).toEqual({ fk_user_author: 7 });
  });
});

describe("buildExpenseReportUpdateBody", () => {
  it("sends only the flags that were passed", () => {
    expect(buildExpenseReportUpdateBody({ notePrivate: "x" })).toEqual({ note_private: "x" });
  });

  it("returns an empty body when nothing was passed", () => {
    expect(buildExpenseReportUpdateBody({})).toEqual({});
  });

  it("never emits ref_ext (not persisted by Dolibarr)", () => {
    const body = buildExpenseReportUpdateBody({ refExt: "X", notePublic: "y" });
    expect(body).not.toHaveProperty("ref_ext");
    expect(body).toEqual({ note_public: "y" });
  });
});

describe("resolveStatusCode", () => {
  it("accepts human status names", () => {
    expect(resolveStatusCode("draft")).toBe(0);
    expect(resolveStatusCode("Validated")).toBe(2);
    expect(resolveStatusCode("approved")).toBe(5);
    expect(resolveStatusCode("refused")).toBe(99);
  });

  it("accepts both cancelled spellings", () => {
    expect(resolveStatusCode("cancelled")).toBe(4);
    expect(resolveStatusCode("canceled")).toBe(4);
  });

  it("passes known numeric codes through", () => {
    expect(resolveStatusCode("6")).toBe(6);
    expect(resolveStatusCode("99")).toBe(99);
  });

  it("rejects an unknown name or code", () => {
    expect(() => resolveStatusCode("shipped")).toThrow(/Unknown status/);
    expect(() => resolveStatusCode("7")).toThrow(/Unknown status code/);
  });

  it("covers every documented status name", () => {
    for (const [name, code] of Object.entries(STATUS_CODES)) {
      expect(resolveStatusCode(name)).toBe(code);
    }
  });
});

describe("buildExpenseReportPaymentBody", () => {
  it("keys amounts by the expense report id", () => {
    expect(
      buildExpenseReportPaymentBody("12", { amount: "42.5", date: "2026-04-01" }, 3),
    ).toEqual({
      fk_typepayment: 3,
      datepaid: Date.UTC(2026, 3, 1) / 1000,
      amounts: { "12": 42.5 },
    });
  });

  it("adds the optional bank account, num and note", () => {
    const body = buildExpenseReportPaymentBody(
      "5",
      { amount: "10", date: "2026-04-01", account: "2", num: "CHQ-1", notePublic: "n" },
      7,
    );
    expect(body.accountid).toBe(2);
    expect(body.num_payment).toBe("CHQ-1");
    expect(body.note_public).toBe("n");
  });
});

describe("expensereport column specs", () => {
  it("maps the real (non-sequential) status codes to labels", () => {
    const col = expenseReportListColumns.find((c) => c.key === "status")!;
    expect(col.format!({ status: 0 })).toBe("Draft");
    expect(col.format!({ status: 5 })).toBe("Approved");
    expect(col.format!({ status: 99 })).toBe("Refused");
  });

  it("falls back to fk_statut when status is absent", () => {
    const col = expenseReportDetailFields.find((c) => c.key === "status")!;
    expect(col.format!({ fk_statut: 6 })).toBe("Paid");
  });
});
