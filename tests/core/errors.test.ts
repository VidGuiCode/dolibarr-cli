import { describe, it, expect } from "vitest";
import {
  classifyFailureStage,
  DolibarrApiError,
  DolibarrAuthError,
  DolibarrParseError,
  explainApiError,
  getErrorMessage,
  getExitCode,
  NonInteractiveError,
  ValidationError,
} from "../../src/core/errors.js";

/** Real `debug.source` strings observed from a live Dolibarr 20.0.4 instance. */
const ROUTE_MISSING = "Routes.php:457 at route stage";
const CALL_STAGE = "api_products.class.php:212 at call stage";
const VALIDATE_STAGE = "Validator.php:436 at validate stage";
const EXPORT_FORMAT = "api_accountancy.class.php:131 at call stage";

describe("classifyFailureStage", () => {
  it("reads the stage out of Dolibarr's debug.source", () => {
    expect(classifyFailureStage(ROUTE_MISSING)).toBe("route");
    expect(classifyFailureStage(CALL_STAGE)).toBe("call");
    expect(classifyFailureStage(VALIDATE_STAGE)).toBe("validate");
    expect(classifyFailureStage("Foo.php:1 at authenticate stage")).toBe("auth");
  });

  it("falls back to unknown when there is no usable signal", () => {
    expect(classifyFailureStage(undefined)).toBe("unknown");
    expect(classifyFailureStage("something else entirely")).toBe("unknown");
  });
});

describe("explainApiError", () => {
  it("echoes the exact request path and parameters that were sent", () => {
    const err = new DolibarrApiError(403, "Forbidden", "GET", "products?limit=1", {}, CALL_STAGE);
    const lines = explainApiError(err);
    expect(lines[0]).toBe("Request: GET /api/index.php/products?limit=1");
    expect(lines[1]).toBe(`Server:  ${CALL_STAGE}`);
  });

  /**
   * The distinction that matters most: a 404 because the module is off looks
   * identical to a 404 because the id is wrong, unless you read the stage.
   */
  it("treats a route-stage 404 as a disabled module, naming the module", () => {
    const err = new DolibarrApiError(404, "Not Found", "GET", "tickets?limit=1", {}, ROUTE_MISSING);
    const text = explainApiError(err).join("\n");
    expect(text).toContain("does not exist on this Dolibarr instance");
    expect(text).toContain('"tickets" module is disabled');
    expect(text).toContain("dolibarr setup modules");
  });

  it("treats a call-stage 404 as a missing record, not a missing module", () => {
    const err = new DolibarrApiError(404, "Not Found", "GET", "invoices/999", {}, CALL_STAGE);
    const text = explainApiError(err).join("\n");
    expect(text).toContain("found no matching record");
    expect(text).not.toContain("module is disabled");
  });

  it("gives the accountancy export its specific cause", () => {
    const err = new DolibarrApiError(
      404,
      "Not Found: Accountancy export format not found",
      "GET",
      "accountancy/exportdata?period=lastmonth&format=FEC",
      {},
      EXPORT_FORMAT,
    );
    const text = explainApiError(err).join("\n");
    expect(text).toContain("NUMERIC export-model id");
    expect(text).toContain("dolibarr accounting formats");
  });

  it("tells a 403 apart from a missing route and says where to grant rights", () => {
    const err = new DolibarrApiError(403, "Forbidden", "GET", "stock?limit=1", {}, CALL_STAGE);
    const text = explainApiError(err).join("\n");
    expect(text).toContain("not permitted");
    expect(text).toContain('Grant rights on "stock"');
    expect(text).toContain("Users & Groups");
  });

  it("explains a validate-stage 400 as a parameter rejection", () => {
    const err = new DolibarrApiError(
      400,
      "Bad Request: `period` is required.",
      "GET",
      "accountancy/exportdata",
      {},
      VALIDATE_STAGE,
    );
    expect(explainApiError(err).join("\n")).toContain("rejected the request parameters");
  });

  it("still produces guidance with no debug.source at all", () => {
    const err = new DolibarrApiError(500, "Server Error", "GET", "invoices");
    expect(explainApiError(err).join("\n")).toContain("Dolibarr server logs");
  });
});

describe("getErrorMessage", () => {
  it("indents the diagnostic block under the message", () => {
    const err = new DolibarrApiError(403, "Forbidden", "GET", "products", {}, CALL_STAGE);
    const lines = getErrorMessage(err).split("\n");
    expect(lines[0]).toBe("API error 403: Forbidden");
    expect(lines.slice(1).every((l) => l.startsWith("  "))).toBe(true);
  });

  it("marks a parse failure as the CLI's fault, not the API's", () => {
    const msg = getErrorMessage(
      new DolibarrParseError("unreadable body", "GET", "accountancy/exportdata"),
    );
    expect(msg).toContain("CLI-side failure");
    expect(msg).toContain("not an error returned by Dolibarr");
  });

  it("passes a plain Error through untouched", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("getExitCode", () => {
  it("keeps the documented exit-code contract", () => {
    expect(getExitCode(new DolibarrApiError(429, "x"))).toBe(4);
    expect(getExitCode(new DolibarrApiError(403, "x"))).toBe(2);
    expect(getExitCode(new DolibarrAuthError())).toBe(2);
    expect(getExitCode(new ValidationError("x"))).toBe(3);
    expect(getExitCode(new NonInteractiveError("x"))).toBe(3);
    expect(getExitCode(new Error("x"))).toBe(1);
    expect(getExitCode(new DolibarrParseError("x"))).toBe(1);
  });
});
