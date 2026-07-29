import { describe, it, expect, vi, afterEach } from "vitest";
import {
  paginateClientSide,
  parseIntFlag,
  reportClientPagination,
} from "../../src/core/client-paginate.js";
import { ValidationError } from "../../src/core/errors.js";

const rows = Array.from({ length: 8 }, (_, i) => ({ id: i + 1 }));

describe("client-side pagination", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseIntFlag", () => {
    it("accepts an integer at or above the minimum", () => {
      expect(parseIntFlag("3", "--limit", 1)).toBe(3);
      expect(parseIntFlag(0, "--page", 0)).toBe(0);
    });

    it("rejects values below the minimum", () => {
      expect(() => parseIntFlag("0", "--limit", 1)).toThrow(ValidationError);
      expect(() => parseIntFlag("-1", "--page", 0)).toThrow(ValidationError);
    });

    it("rejects non-integers and junk instead of coercing to NaN", () => {
      expect(() => parseIntFlag("2.5", "--limit", 1)).toThrow(ValidationError);
      expect(() => parseIntFlag("abc", "--limit", 1)).toThrow(ValidationError);
      expect(() => parseIntFlag("", "--limit", 1)).toThrow(ValidationError);
    });

    it("names the offending flag in the message", () => {
      expect(() => parseIntFlag("abc", "--limit", 1)).toThrow(/--limit/);
    });
  });

  describe("paginateClientSide", () => {
    /** The exact case from the 2026-07-29 report: both returned all 8 rows. */
    it("honours --limit 1 and --limit 3 differently", () => {
      expect(paginateClientSide(rows, { limit: "1" }).rows).toHaveLength(1);
      expect(paginateClientSide(rows, { limit: "3" }).rows).toHaveLength(3);
    });

    it("returns distinct, non-overlapping pages", () => {
      const p0 = paginateClientSide(rows, { limit: "3", page: "0" }).rows;
      const p1 = paginateClientSide(rows, { limit: "3", page: "1" }).rows;
      expect(p0.map((r) => r.id)).toEqual([1, 2, 3]);
      expect(p1.map((r) => r.id)).toEqual([4, 5, 6]);
    });

    it("returns a short final page", () => {
      const last = paginateClientSide(rows, { limit: "3", page: "2" });
      expect(last.rows.map((r) => r.id)).toEqual([7, 8]);
      expect(last.hasMore).toBe(false);
    });

    it("returns nothing past the end rather than wrapping", () => {
      expect(paginateClientSide(rows, { limit: "3", page: "9" }).rows).toEqual([]);
    });

    it("reports the true total regardless of the slice", () => {
      expect(paginateClientSide(rows, { limit: "2" }).total).toBe(8);
    });

    it("flags that more rows exist", () => {
      expect(paginateClientSide(rows, { limit: "2" }).hasMore).toBe(true);
      expect(paginateClientSide(rows, { limit: "50" }).hasMore).toBe(false);
    });

    it("--all bypasses the slice entirely", () => {
      const all = paginateClientSide(rows, { limit: "1", all: true });
      expect(all.rows).toHaveLength(8);
      expect(all.limit).toBeNull();
      expect(all.hasMore).toBe(false);
    });

    it("defaults to 50 per page from page 0", () => {
      const r = paginateClientSide(rows, {});
      expect(r.rows).toHaveLength(8);
      expect(r.limit).toBe(50);
      expect(r.page).toBe(0);
    });

    it("tolerates a non-array payload", () => {
      expect(paginateClientSide(null as unknown as unknown[], {}).rows).toEqual([]);
      expect(paginateClientSide([], {}).total).toBe(0);
    });

    it("propagates a bad --limit as a ValidationError", () => {
      expect(() => paginateClientSide(rows, { limit: "0" })).toThrow(ValidationError);
    });
  });

  describe("reportClientPagination", () => {
    it("writes the truncation notice to stderr, never stdout", () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = vi.spyOn(console, "log").mockImplementation(() => {});

      reportClientPagination(paginateClientSide(rows, { limit: "2" }));

      expect(err).toHaveBeenCalledOnce();
      expect(err.mock.calls[0][0]).toContain("Showing 1-2 of 8");
      expect(out).not.toHaveBeenCalled();
    });

    it("stays silent when nothing was withheld", () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      reportClientPagination(paginateClientSide(rows, { limit: "50" }));
      expect(err).not.toHaveBeenCalled();
    });

    it("stays silent under --all", () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      reportClientPagination(paginateClientSide(rows, { all: true }));
      expect(err).not.toHaveBeenCalled();
    });

    it("points at the next page number", () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      reportClientPagination(paginateClientSide(rows, { limit: "2", page: "1" }));
      expect(err.mock.calls[0][0]).toContain("--page 2");
    });
  });
});
