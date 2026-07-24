import { describe, it, expect } from "vitest";
import { normalizeApiPath, isAllNullObject } from "../../src/core/api-path.js";

describe("normalizeApiPath", () => {
  it("leaves a plain relative path untouched", () => {
    expect(normalizeApiPath("thirdparties").path).toBe("thirdparties");
    expect(normalizeApiPath("thirdparties").warning).toBeUndefined();
  });

  it("strips a leading slash", () => {
    const r = normalizeApiPath("/invoices/18");
    expect(r.path).toBe("invoices/18");
    expect(r.warning).toBeUndefined();
  });

  it("strips an accidental api/index.php/ prefix", () => {
    expect(normalizeApiPath("/api/index.php/thirdparties").path).toBe("thirdparties");
    expect(normalizeApiPath("api/index.php/orders").path).toBe("orders");
  });

  it("recovers a MSYS-mangled path using EXEPATH", () => {
    const env = { EXEPATH: "C:\\Program Files\\Git" } as NodeJS.ProcessEnv;
    const r = normalizeApiPath("C:/Program Files/Git/supplierinvoices/18/payments", env);
    expect(r.path).toBe("supplierinvoices/18/payments");
    expect(r.warning).toMatch(/MSYS_NO_PATHCONV/);
  });

  it("recovers a MSYS-mangled path via the /Git/ marker when EXEPATH is absent", () => {
    const r = normalizeApiPath("C:/Program Files/Git/thirdparties", {} as NodeJS.ProcessEnv);
    expect(r.path).toBe("thirdparties");
    expect(r.warning).toBeDefined();
  });

  it("recovers via a mingw64 marker", () => {
    const r = normalizeApiPath("C:/tools/msys/mingw64/orders/5", {} as NodeJS.ProcessEnv);
    expect(r.path).toBe("orders/5");
  });

  it("still warns when a Windows-absolute path cannot be un-mangled", () => {
    const r = normalizeApiPath("D:/weird/location/invoices", {} as NodeJS.ProcessEnv);
    expect(r.warning).toMatch(/could\s+not\s+be\s+un-mangled/);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeApiPath("  /orders  ").path).toBe("orders");
  });
});

describe("isAllNullObject", () => {
  it("is true for a non-empty object of all nulls", () => {
    expect(isAllNullObject({ id: null, ref: null, entity: null })).toBe(true);
  });

  it("is false when any value is non-null", () => {
    expect(isAllNullObject({ id: 5, ref: null })).toBe(false);
  });

  it("is false for an empty object", () => {
    expect(isAllNullObject({})).toBe(false);
  });

  it("is false for arrays, null, primitives", () => {
    expect(isAllNullObject([null, null])).toBe(false);
    expect(isAllNullObject(null)).toBe(false);
    expect(isAllNullObject("x")).toBe(false);
    expect(isAllNullObject(0)).toBe(false);
  });
});
