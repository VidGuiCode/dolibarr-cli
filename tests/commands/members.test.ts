import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildMemberBody,
  buildMemberTypeBody,
  buildSubscriptionBody,
  createMembersCommand,
  memberListColumns,
  subscriptionColumns,
} from "../../src/commands/members.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function flags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

describe("members command (v0.4.2)", () => {
  const cmd = createMembersCommand();

  it("registers as 'members' with a description", () => {
    expect(cmd.name()).toBe("members");
    expect(cmd.description()).toMatch(/member/i);
  });

  it("exposes the route-confirmed subcommands", () => {
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual([
      "by-barcode",
      "by-email",
      "by-thirdparty",
      "categories",
      "create",
      "delete",
      "get",
      "list",
      "subscriptions",
      "types",
      "update",
    ]);
  });

  it("list supports --type and --category plus the shared flags", () => {
    const f = flags(sub(cmd, "list")!);
    for (const flag of ["--type", "--category", "--limit", "--output", "--fields"]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("create exposes the documented member fields", () => {
    const f = flags(sub(cmd, "create")!);
    for (const flag of [
      "--lastname",
      "--firstname",
      "--type",
      "--login",
      "--email",
      "--socid",
      "--address",
      "--zip",
      "--town",
      "--country",
      "--from-json",
    ]) {
      expect(f, flag).toContain(flag);
    }
  });

  it("update carries the same field flags as create", () => {
    const c = new Set(flags(sub(cmd, "create")!));
    const u = new Set(flags(sub(cmd, "update")!));
    for (const flag of ["--lastname", "--type", "--email", "--town"]) {
      expect(c.has(flag) && u.has(flag), flag).toBe(true);
    }
  });

  it("delete requires explicit confirmation", () => {
    expect(flags(sub(cmd, "delete")!)).toContain("--confirm");
  });

  it("the thirdparty lookups each take one positional", () => {
    for (const [name, arg] of [
      ["by-thirdparty", "thirdparty-id"],
      ["by-email", "email"],
      ["by-barcode", "barcode"],
    ] as const) {
      const args = (sub(cmd, name)! as unknown as { _args: { _name: string }[] })._args;
      expect(args[0]._name, name).toBe(arg);
    }
  });

  it("subscriptions subgroup has list/list-all/get/add/update", () => {
    const grp = sub(cmd, "subscriptions")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual([
      "add",
      "get",
      "list",
      "list-all",
      "update",
    ]);
  });

  it("subscriptions add is guarded and requires the fields the API demands", () => {
    const add = sub(sub(cmd, "subscriptions")!, "add")!;
    const f = flags(add);
    for (const flag of ["--start", "--end", "--amount", "--confirm"]) {
      expect(f, flag).toContain(flag);
    }
    for (const long of ["--start", "--end", "--amount"]) {
      const opt = add.options.find((o) => o.long === long)!;
      expect(opt.required || opt.mandatory, long).toBeTruthy();
    }
  });

  it("types subgroup has full CRUD", () => {
    const grp = sub(cmd, "types")!;
    expect(grp.commands.map((c) => c.name()).sort()).toEqual([
      "create",
      "delete",
      "get",
      "list",
      "update",
    ]);
    expect(flags(sub(grp, "delete")!)).toContain("--confirm");
  });
});

describe("buildMemberBody", () => {
  it("maps flags to Dolibarr field names", () => {
    expect(
      buildMemberBody({
        lastname: "Doe",
        firstname: "Jane",
        type: "2",
        email: "jane@example.com",
        socid: "9",
        country: "1",
        nature: "phy",
        public: "1",
      }),
    ).toEqual({
      lastname: "Doe",
      firstname: "Jane",
      typeid: 2,
      email: "jane@example.com",
      socid: 9,
      country_id: 1,
      morphy: "phy",
      public: 1,
    });
  });

  it("sends only the flags that were passed (update semantics)", () => {
    expect(buildMemberBody({ town: "Springfield" })).toEqual({ town: "Springfield" });
    expect(buildMemberBody({})).toEqual({});
  });
});

describe("buildSubscriptionBody", () => {
  it("normalizes both dates and coerces the amount", () => {
    expect(
      buildSubscriptionBody({ start: "2026-01-01", end: "2026-12-31", amount: "50" }),
    ).toEqual({
      start_date: Date.UTC(2026, 0, 1) / 1000,
      end_date: Date.UTC(2026, 11, 31) / 1000,
      amount: 50,
    });
  });

  it("includes the optional label", () => {
    const body = buildSubscriptionBody({
      start: "2026-01-01",
      end: "2026-12-31",
      amount: "1",
      label: "annual",
    });
    expect(body.label).toBe("annual");
  });
});

describe("buildMemberTypeBody", () => {
  it("coerces the numeric fields and keeps duration as a spec string", () => {
    expect(
      buildMemberTypeBody({ label: "Gold", subscription: "1", amount: "120", duration: "1y", vote: "1" }),
    ).toEqual({ label: "Gold", subscription: 1, amount: 120, duration: "1y", vote: 1 });
  });

  it("omits unset fields", () => {
    expect(buildMemberTypeBody({ label: "Basic" })).toEqual({ label: "Basic" });
  });
});

describe("member column specs", () => {
  it("renders the negative status codes as labels", () => {
    const col = memberListColumns.find((c) => c.key === "statut")!;
    expect(col.format!({ statut: 1 })).toBe("Validated");
    expect(col.format!({ statut: -1 })).toBe("Resiliated");
    expect(col.format!({ statut: -2 })).toBe("Excluded");
    expect(col.format!({ statut: 0 })).toBe("Draft");
  });

  it("joins first and last name, tolerating a missing firstname", () => {
    const col = memberListColumns.find((c) => c.key === "lastname")!;
    expect(col.format!({ firstname: "Jane", lastname: "Doe" })).toBe("Jane Doe");
    expect(col.format!({ lastname: "Doe" })).toBe("Doe");
  });

  it("reads subscription dates from either naming", () => {
    const from = subscriptionColumns.find((c) => c.key === "dateh")!;
    const ts = Date.UTC(2026, 0, 1) / 1000;
    expect(from.format!({ dateh: ts })).toBe("2026-01-01");
    expect(from.format!({ date_start: ts })).toBe("2026-01-01");
  });
});
