import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  auditEntry,
  auditLogPath,
  formatAuditLine,
  isAuditEnabled,
  recordAudit,
  resetAuditPath,
  sanitizeAuditEntry,
} from "../../src/core/audit.js";
import { REDACTED } from "../../src/core/views.js";
import {
  decideConfirmation,
  describeWrite,
  expectedApprovalToken,
  financialWriteSpec,
  tokenMatches,
} from "../../src/core/financial-writes.js";

describe("audit log path resolution", () => {
  afterEach(() => resetAuditPath());

  it("is off when nothing configured it", () => {
    expect(auditLogPath([], {})).toBeNull();
    expect(auditLogPath([], { DOLIBARR_AUDIT_LOG: "  " })).toBeNull();
  });

  it("reads --audit-log from argv", () => {
    expect(auditLogPath(["node", "cli", "--audit-log", "/tmp/a.ndjson"], {})).toBe("/tmp/a.ndjson");
  });

  it("reads DOLIBARR_AUDIT_LOG", () => {
    expect(auditLogPath([], { DOLIBARR_AUDIT_LOG: "/tmp/b.ndjson" })).toBe("/tmp/b.ndjson");
  });

  it("does not treat a following flag as the path", () => {
    expect(auditLogPath(["node", "cli", "--audit-log", "--confirm"], {})).toBeNull();
  });
});

describe("audit entries", () => {
  it("records method, path, outcome and status", () => {
    const e = auditEntry("POST", "/invoices/5/validate", {}, "success", { status: 200 });
    expect(e).toMatchObject({
      method: "POST",
      path: "invoices/5/validate",
      outcome: "success",
      status: 200,
    });
    expect(Date.parse(e.ts)).not.toBeNaN();
  });

  /**
   * An audit log that leaks an IBAN is worse than no audit log. Redaction here is
   * unconditional — it does not depend on the user having passed --redact.
   */
  it("redacts sensitive body fields unconditionally", () => {
    const line = formatAuditLine(
      auditEntry("POST", "thirdparties", { name: "Acme", iban: "XX00 1111", email: "a@b.c" }, "success"),
    );
    expect(line).not.toContain("XX00 1111");
    expect(line).not.toContain("a@b.c");
    expect(line).toContain(REDACTED);
    expect(line).toContain("Acme");
  });

  it("redacts nested sensitive fields", () => {
    const line = formatAuditLine(
      auditEntry("POST", "x", { outer: { note_private: "confidential" } }, "success"),
    );
    expect(line).not.toContain("confidential");
  });

  it("normalizes a missing body to null", () => {
    expect(sanitizeAuditEntry(auditEntry("DELETE", "invoices/1", undefined, "success")).body).toBeNull();
  });

  it("emits one JSON object per line", () => {
    const line = formatAuditLine(auditEntry("POST", "x", { a: 1 }, "success"));
    expect(line).not.toContain("\n");
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it("records a blocked write, not just successful ones", () => {
    const e = auditEntry("POST", "invoices", {}, "blocked", { error: "read-only" });
    expect(e.outcome).toBe("blocked");
  });
});

describe("writing the audit log", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolibarr-audit-"));
    resetAuditPath();
  });

  afterEach(() => {
    resetAuditPath();
    delete process.env.DOLIBARR_AUDIT_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("appends entries as NDJSON, creating the directory", () => {
    const file = path.join(dir, "nested", "audit.ndjson");
    process.env.DOLIBARR_AUDIT_LOG = file;
    expect(isAuditEnabled()).toBe(true);

    recordAudit(auditEntry("POST", "invoices/1/validate", {}, "success", { status: 200 }));
    recordAudit(auditEntry("DELETE", "invoices/2", undefined, "error", { status: 404 }));

    const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).method).toBe("POST");
    expect(JSON.parse(lines[1]).outcome).toBe("error");
  });

  it("writes nothing when auditing is off", () => {
    const file = path.join(dir, "audit.ndjson");
    expect(isAuditEnabled()).toBe(false);
    recordAudit(auditEntry("POST", "x", {}, "success"));
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("approval token", () => {
  it("reads DOLIBARR_APPROVAL_TOKEN", () => {
    expect(expectedApprovalToken({ DOLIBARR_APPROVAL_TOKEN: " s3cret " })).toBe("s3cret");
    expect(expectedApprovalToken({ DOLIBARR_APPROVAL_TOKEN: "  " })).toBeUndefined();
    expect(expectedApprovalToken({})).toBeUndefined();
  });

  it("compares tokens without leaking length or content by timing", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches("", "")).toBe(true);
  });

  const base = {
    path: "invoices pay",
    hasConfirmFlag: false,
    assumeYes: false,
    dryRun: false,
    nonInteractive: true,
  };

  it("approves a matching token", () => {
    expect(
      decideConfirmation({ ...base, approveToken: "tok", expectedToken: "tok" }),
    ).toEqual({ action: "proceed", reason: "approve-token" });
  });

  it("refuses a mismatched token", () => {
    const d = decideConfirmation({ ...base, approveToken: "bad", expectedToken: "tok" });
    expect(d.action).toBe("refuse");
  });

  it("refuses --approve when no token is configured, rather than ignoring it", () => {
    const d = decideConfirmation({ ...base, approveToken: "tok" });
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") expect(d.message).toContain("DOLIBARR_APPROVAL_TOKEN");
  });

  /** A wrong token must be an error, never masked by another approval route. */
  it("does not let --confirm rescue a wrong token", () => {
    const d = decideConfirmation({
      ...base,
      hasConfirmFlag: true,
      assumeYes: true,
      approveToken: "bad",
      expectedToken: "tok",
    });
    expect(d.action).toBe("refuse");
  });

  /** The token is a secret; echoing it would put it in terminals and CI logs. */
  it("is never echoed in the confirmation display", () => {
    const spec = financialWriteSpec("invoices pay")!;
    const text = describeWrite("invoices pay", spec, ["42"], {
      amount: "100",
      approve: "s3cret-token",
    }).join("\n");
    expect(text).not.toContain("s3cret-token");
    expect(text).toContain("--amount: 100");
  });
});
