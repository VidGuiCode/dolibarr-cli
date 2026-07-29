import { describe, it, expect } from "vitest";
import {
  ACCOUNTING_EXPORT_FORMATS,
  exportFormatNames,
  findExportFormatById,
  resolveExportFormat,
} from "../../src/core/accounting-formats.js";
import { ValidationError } from "../../src/core/errors.js";

describe("accounting export formats", () => {
  describe("the format table", () => {
    /**
     * These ids are Dolibarr's AccountancyExport::$EXPORT_TYPE_* constants. They were
     * verified against Dolibarr 20.0.4 source AND probed against a live 20.0.4 server,
     * which accepts exactly this set and 404s on anything else. Sending a name instead
     * of an id is the v0.5.6 bug this table exists to prevent.
     */
    const EXPECTED_IDS = [
      1, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 100, 110, 120, 130, 135, 200, 1000, 1010,
    ];

    it("matches the export-model ids Dolibarr 20.x accepts", () => {
      expect(ACCOUNTING_EXPORT_FORMATS.map((f) => f.id)).toEqual(EXPECTED_IDS);
    });

    it("has unique names and ids", () => {
      const names = ACCOUNTING_EXPORT_FORMATS.map((f) => f.name);
      const ids = ACCOUNTING_EXPORT_FORMATS.map((f) => f.id);
      expect(new Set(names).size).toBe(names.length);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("never collides a name with another entry's alias", () => {
      const names = new Set(ACCOUNTING_EXPORT_FORMATS.map((f) => f.name));
      for (const f of ACCOUNTING_EXPORT_FORMATS) {
        for (const alias of f.aliases) {
          expect(names.has(alias)).toBe(false);
        }
      }
    });

    it("exposes canonical names", () => {
      expect(exportFormatNames()).toContain("fec");
      expect(exportFormatNames()).toContain("fec2");
    });
  });

  describe("resolveExportFormat", () => {
    it("resolves the FEC formats to their numeric ids", () => {
      expect(resolveExportFormat("fec")).toBe(1000);
      expect(resolveExportFormat("fec2")).toBe(1010);
    });

    it("is case-insensitive, matching what users type from the old docs", () => {
      expect(resolveExportFormat("FEC")).toBe(1000);
      expect(resolveExportFormat("FEC2")).toBe(1010);
    });

    it("maps the legacy CSV alias onto the configurable model", () => {
      expect(resolveExportFormat("CSV")).toBe(1);
      expect(resolveExportFormat("configurable")).toBe(1);
    });

    it("accepts aliases and normalizes separators", () => {
      expect(resolveExportFormat("sage50")).toBe(45);
      expect(resolveExportFormat("sage50-swiss")).toBe(45);
      expect(resolveExportFormat("gestimum_v3")).toBe(130);
      expect(resolveExportFormat("gestimumv5")).toBe(135);
    });

    it("trims surrounding whitespace", () => {
      expect(resolveExportFormat("  fec  ")).toBe(1000);
    });

    it("passes a raw numeric id straight through", () => {
      expect(resolveExportFormat("1000")).toBe(1000);
      // Unknown to this table, but a future Dolibarr model id must still be usable.
      expect(resolveExportFormat("4242")).toBe(4242);
    });

    it("rejects an unknown name with a ValidationError listing the options", () => {
      expect(() => resolveExportFormat("nope")).toThrow(ValidationError);
      try {
        resolveExportFormat("nope");
      } catch (err) {
        expect((err as Error).message).toContain("fec");
        expect((err as Error).message).toContain("accounting formats");
      }
    });

    it("rejects an empty value", () => {
      expect(() => resolveExportFormat("")).toThrow(ValidationError);
      expect(() => resolveExportFormat("   ")).toThrow(ValidationError);
    });
  });

  describe("findExportFormatById", () => {
    it("finds a known id", () => {
      expect(findExportFormatById(1000)?.name).toBe("fec");
    });

    it("returns undefined for an unknown id", () => {
      expect(findExportFormatById(4242)).toBeUndefined();
    });
  });
});
