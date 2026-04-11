import { describe, it, expect, vi, beforeEach } from "vitest";
import { printTable, printJson, printInfo, printError } from "../../src/core/output.js";

describe("output", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("printTable", () => {
    it("prints headers and rows with aligned columns", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTable(
        [
          ["1", "Alice", "alice@test.com"],
          ["2", "Bob", "bob@example.com"],
        ],
        ["ID", "Name", "Email"],
      );

      expect(logSpy).toHaveBeenCalledTimes(4); // header + separator + 2 rows
      const headerLine = logSpy.mock.calls[0][0] as string;
      expect(headerLine).toContain("ID");
      expect(headerLine).toContain("Name");
      expect(headerLine).toContain("Email");

      const separatorLine = logSpy.mock.calls[1][0] as string;
      expect(separatorLine).toContain("\u2500"); // ─ character
    });

    it("handles empty rows with headers", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTable([], ["ID", "Name"]);

      expect(logSpy).toHaveBeenCalledTimes(2); // header + separator only
    });

    it("does nothing with empty rows and no headers", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTable([]);

      expect(logSpy).not.toHaveBeenCalled();
    });

    it("pads columns to max width", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printTable(
        [
          ["1", "Short"],
          ["100", "Much longer name here"],
        ],
        ["ID", "Name"],
      );

      // The data rows should have consistent widths
      const row1 = logSpy.mock.calls[2][0] as string;
      const row2 = logSpy.mock.calls[3][0] as string;
      // Both rows have same structure with padding
      expect(row1.length).toBe(row2.length);
    });
  });

  describe("printJson", () => {
    it("prints pretty JSON by default", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printJson({ id: 1, name: "Test" });

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("\n"); // pretty-printed has newlines
      expect(JSON.parse(output)).toEqual({ id: 1, name: "Test" });
    });

    it("prints arrays correctly", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printJson([{ id: 1 }, { id: 2 }]);

      const output = logSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe("printInfo", () => {
    it("prints message to stdout", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      printInfo("Hello world");

      expect(logSpy).toHaveBeenCalledWith("Hello world");
    });
  });

  describe("printError", () => {
    it("prints message to stderr with cross prefix", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      printError("Something went wrong");

      expect(errorSpy).toHaveBeenCalledWith("\u2717  Something went wrong");
    });
  });
});
