import { describe, it, expect, vi, afterEach } from "vitest";
import {
  COLORS,
  RESET,
  STATUS_COLORS,
  colorize,
  colorizeStatus,
  isColorEnabled,
  isStatusColumn,
  stripAnsi,
  visibleLength,
} from "../../src/core/color.js";
import { printTable } from "../../src/core/output.js";

describe("colour gating", () => {
  const tty = { output: "table", isTty: true, env: {} as NodeJS.ProcessEnv, noColor: false };

  it("is on for an interactive table", () => {
    expect(isColorEnabled(tty)).toBe(true);
  });

  /** A colour escape in piped output corrupts the consumer's data. */
  it("is off when stdout is piped", () => {
    expect(isColorEnabled({ ...tty, isTty: false })).toBe(false);
  });

  it("is off for every machine-readable output format", () => {
    for (const output of ["json", "csv", "ndjson", "yaml"]) {
      expect(isColorEnabled({ ...tty, output }), output).toBe(false);
    }
  });

  it("honours NO_COLOR by presence, whatever its value", () => {
    expect(isColorEnabled({ ...tty, env: { NO_COLOR: "1" } })).toBe(false);
    expect(isColorEnabled({ ...tty, env: { NO_COLOR: "0" } })).toBe(false);
  });

  it("ignores an empty NO_COLOR", () => {
    expect(isColorEnabled({ ...tty, env: { NO_COLOR: "" } })).toBe(true);
  });

  it("honours --no-color", () => {
    expect(isColorEnabled({ ...tty, noColor: true })).toBe(false);
  });

  it("is off on a dumb terminal", () => {
    expect(isColorEnabled({ ...tty, env: { TERM: "dumb" } })).toBe(false);
  });

  it("reads --no-color from argv, since it is a program-level flag", () => {
    vi.spyOn(process, "argv", "get").mockReturnValue(["node", "dolibarr", "--no-color"]);
    expect(isColorEnabled({ output: "table", isTty: true, env: {} })).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("status colouring", () => {
  it("colours the documented lifecycle states", () => {
    expect(colorizeStatus("Draft")).toContain(COLORS.yellow);
    expect(colorizeStatus("Validated")).toContain(COLORS.blue);
    expect(colorizeStatus("Paid")).toContain(COLORS.green);
    expect(colorizeStatus("Abandoned")).toContain(COLORS.red);
  });

  it("is case-insensitive and tolerant of padding", () => {
    expect(colorizeStatus("  PAID  ")).toContain(COLORS.green);
  });

  it("leaves an unrecognised status completely untouched", () => {
    expect(colorizeStatus("Something Else")).toBe("Something Else");
    expect(colorizeStatus("")).toBe("");
  });

  it("always closes the escape it opens", () => {
    expect(colorizeStatus("Draft").endsWith(RESET)).toBe(true);
  });

  it("uses one colour per meaning across resources", () => {
    // Terminal-success states share green wherever they appear.
    for (const s of ["paid", "closed", "delivered", "billed"]) {
      expect(STATUS_COLORS[s], s).toBe("green");
    }
  });

  it("identifies status columns by key or label", () => {
    expect(isStatusColumn({ key: "status", label: "Status" })).toBe(true);
    expect(isStatusColumn({ key: "statut", label: "Etat" })).toBe(true);
    expect(isStatusColumn({ key: "anything", label: "Status" })).toBe(true);
    expect(isStatusColumn({ key: "ref", label: "Ref" })).toBe(false);
    expect(isStatusColumn({ key: "total_ttc", label: "Total TTC" })).toBe(false);
  });
});

describe("ANSI helpers", () => {
  it("strips escapes", () => {
    expect(stripAnsi(colorize("Draft", "yellow"))).toBe("Draft");
  });

  it("measures what the user actually sees", () => {
    expect(visibleLength(colorize("Draft", "yellow"))).toBe(5);
    expect(visibleLength("Draft")).toBe(5);
  });
});

/**
 * Alignment is the thing colour most easily breaks: escapes add characters the
 * terminal never draws, so measuring raw length pushes every later column out.
 */
describe("table alignment with coloured cells", () => {
  afterEach(() => vi.restoreAllMocks());

  function render(rows: string[][], headers: string[]): string[] {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => lines.push(a.join(" ")));
    printTable(rows, headers);
    return lines;
  }

  it("aligns columns after a coloured cell", () => {
    const plain = render(
      [
        ["1", "Draft", "x"],
        ["2", "Paid", "y"],
      ],
      ["ID", "Status", "Note"],
    );
    const colored = render(
      [
        ["1", colorize("Draft", "yellow"), "x"],
        ["2", colorize("Paid", "green"), "y"],
      ],
      ["ID", "Status", "Note"],
    );

    // Once escapes are stripped, the coloured table must be byte-identical.
    expect(colored.map(stripAnsi)).toEqual(plain);
  });

  it("keeps the header rule matching the visible column width", () => {
    const lines = render([["1", colorize("Validated", "blue")]], ["ID", "Status"]);
    const rule = stripAnsi(lines[1]).split("   ");
    expect(rule[1].length).toBe("Validated".length);
  });
});
