import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import {
  enableOutputFormats,
  headersSuppressed,
  lookupPath,
  renderField,
  resolveFieldOpt,
  renderNdjson,
  renderTemplate,
  renderTemplateLine,
  renderYaml,
  templateValue,
  toYaml,
  validateTemplate,
} from "../../src/core/formats.js";
import { renderGet, renderList, resolveOutput } from "../../src/core/resource-helpers.js";
import { ValidationError } from "../../src/core/errors.js";

afterEach(() => vi.restoreAllMocks());

/** Capture everything written to stdout by a render call. */
function capture(fn: () => void): string {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map((a) => String(a)).join(" ") + "\n");
  });
  fn();
  return chunks.join("");
}

describe("renderNdjson", () => {
  it("emits one compact JSON object per line", () => {
    expect(renderNdjson([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}');
  });

  it("emits nothing for an empty list", () => {
    expect(renderNdjson([])).toBe("");
  });

  it("round-trips exactly", () => {
    const rows = [{ id: "16", ref: "X-1", nested: { a: [1, 2] } }, { id: "17", ref: null }];
    expect(renderNdjson(rows).split("\n").map((l) => JSON.parse(l))).toEqual(rows);
  });
});

describe("toYaml", () => {
  it("quotes every string, always", () => {
    expect(toYaml("plain")).toBe('"plain"');
  });

  it("quotes strings that would otherwise change type when read back", () => {
    // This is the whole reason strings are unconditionally quoted: unquoted,
    // each of these would parse as a number/boolean/null/date, silently
    // changing the data mid-pipeline.
    for (const risky of ["1.0", "007", "yes", "no", "true", "null", "~", "2024-01-01", "on"]) {
      expect(toYaml(risky), risky).toBe(`"${risky}"`);
    }
  });

  it("leaves real numbers and booleans unquoted", () => {
    expect(toYaml(42)).toBe("42");
    expect(toYaml(1.5)).toBe("1.5");
    expect(toYaml(true)).toBe("true");
  });

  it("renders null for null, undefined and non-finite numbers", () => {
    expect(toYaml(null)).toBe("null");
    expect(toYaml(undefined)).toBe("null");
    expect(toYaml(Number.NaN)).toBe("null");
  });

  it("escapes quotes, backslashes and newlines", () => {
    expect(toYaml('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(toYaml("a\\b")).toBe('"a\\\\b"');
    expect(toYaml("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("renders a flat object", () => {
    expect(toYaml({ id: "16", total: 11.7 })).toBe('id: "16"\ntotal: 11.7');
  });

  it("renders empty containers inline", () => {
    expect(toYaml([])).toBe("[]");
    expect(toYaml({})).toBe("{}");
    expect(toYaml({ lines: [], meta: {} })).toBe("lines: []\nmeta: {}");
  });

  it("nests an object under its key", () => {
    expect(toYaml({ outer: { inner: "v" } })).toBe('outer:\n  inner: "v"');
  });

  it("renders an array of scalars", () => {
    expect(toYaml({ tags: ["a", "b"] })).toBe('tags:\n  - "a"\n  - "b"');
  });

  it("renders the nested lines array Dolibarr actually returns", () => {
    const doc = { ref: "IN-1", lines: [{ qty: 1 }, { qty: 2 }] };
    expect(toYaml(doc)).toBe('ref: "IN-1"\nlines:\n  -\n    qty: 1\n  -\n    qty: 2');
  });

  it("quotes keys that are not plain identifiers", () => {
    expect(toYaml({ "a b": 1 })).toBe('"a b": 1');
  });
});

describe("renderYaml", () => {
  it("renders a sequence of records", () => {
    expect(renderYaml([{ id: "1" }, { id: "2" }])).toBe('-\n  id: "1"\n-\n  id: "2"');
  });

  it("renders an empty list as an empty sequence", () => {
    expect(renderYaml([])).toBe("[]");
  });
});

describe("lookupPath / templateValue", () => {
  it("resolves a top-level key", () => {
    expect(lookupPath({ ref: "X" }, "ref")).toBe("X");
  });

  it("resolves a nested path", () => {
    expect(lookupPath({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3);
  });

  it("returns undefined for a missing path instead of throwing", () => {
    expect(lookupPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(lookupPath(null, "a")).toBeUndefined();
  });

  it("stringifies values for output", () => {
    expect(templateValue(null)).toBe("");
    expect(templateValue(undefined)).toBe("");
    expect(templateValue(0)).toBe("0");
    expect(templateValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("templates", () => {
  it("substitutes a single field", () => {
    expect(renderTemplateLine({ ref: "X-1" }, "{{.ref}}")).toBe("X-1");
  });

  it("substitutes several fields with surrounding literal text", () => {
    expect(renderTemplateLine({ id: 1, ref: "X" }, "id={{.id}} ref={{.ref}}")).toBe(
      "id=1 ref=X",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplateLine({ ref: "X" }, "{{ .ref }}")).toBe("X");
  });

  it("renders a missing field as empty rather than failing the row", () => {
    expect(renderTemplateLine({ id: 1 }, "{{.id}}:{{.nope}}")).toBe("1:");
  });

  it("renders one line per item", () => {
    expect(renderTemplate([{ a: 1 }, { a: 2 }], "{{.a}}")).toBe("1\n2");
  });

  it("rejects a template with no placeholder", () => {
    expect(() => validateTemplate("just text")).toThrow(ValidationError);
  });

  it("rejects a placeholder missing its leading dot", () => {
    expect(() => validateTemplate("{{ref}}")).toThrow(/leading dot/);
  });

  it("accepts a valid template and is safe to call repeatedly", () => {
    expect(validateTemplate("{{.ref}}")).toBe("{{.ref}}");
    expect(validateTemplate("{{.ref}}")).toBe("{{.ref}}");
  });
});

describe("resolveFieldOpt (the --field / --fields collision)", () => {
  it("returns the key when unambiguous", () => {
    expect(resolveFieldOpt({ field: "ref" })).toBe("ref");
    expect(resolveFieldOpt({ field: "  ref  " })).toBe("ref");
  });

  it("is undefined when --field is absent", () => {
    expect(resolveFieldOpt({})).toBeUndefined();
    expect(resolveFieldOpt({ fields: "id,ref" })).toBeUndefined();
  });

  it("rejects an empty key", () => {
    expect(() => resolveFieldOpt({ field: "  " })).toThrow(/needs a key/);
  });

  it("catches the likely typo and names --fields", () => {
    // The whole point: `--field id,ref` must not silently do something odd.
    expect(() => resolveFieldOpt({ field: "id,ref" })).toThrow(/did you mean --fields id,ref/);
  });

  it("rejects combining --field with --fields", () => {
    expect(() => resolveFieldOpt({ field: "id", fields: "id,ref" })).toThrow(ValidationError);
  });

  it("rejects combining --field with --template", () => {
    expect(() => resolveFieldOpt({ field: "id", template: "{{.id}}" })).toThrow(ValidationError);
  });
});

describe("renderField", () => {
  it("prints one raw value per row, unquoted and headerless", () => {
    expect(renderField([{ id: "16" }, { id: "17" }], "id")).toBe("16\n17");
  });

  it("renders a missing key as an empty line rather than failing", () => {
    expect(renderField([{ id: 1 }, {}], "id")).toBe("1\n");
  });

  it("walks a nested path", () => {
    expect(renderField([{ a: { b: "x" } }], "a.b")).toBe("x");
  });

  it("serialises an object value as JSON", () => {
    expect(renderField([{ a: { b: 1 } }], "a")).toBe('{"b":1}');
  });

  it("returns an empty string for no rows", () => {
    expect(renderField([], "id")).toBe("");
  });
});

describe("headersSuppressed", () => {
  it("is true for --no-header (commander stores header:false) and for --quiet", () => {
    expect(headersSuppressed({ header: false })).toBe(true);
    expect(headersSuppressed({ quiet: true })).toBe(true);
  });

  it("is false by default", () => {
    expect(headersSuppressed({})).toBe(false);
    expect(headersSuppressed({ header: true })).toBe(false);
  });
});

describe("resolveOutput accepts the new formats", () => {
  it("resolves ndjson and yaml", () => {
    expect(resolveOutput({ output: "ndjson" })).toBe("ndjson");
    expect(resolveOutput({ output: "yaml" })).toBe("yaml");
  });

  it("still falls back to table on a genuinely unknown value", () => {
    // Unchanged since v0.2.0 — an existing contract test covers this too.
    expect(resolveOutput({ output: "xml" })).toBe("table");
  });

  it("keeps the legacy --json alias working", () => {
    expect(resolveOutput({ json: true })).toBe("json");
  });
});

const ROWS = [
  { id: "1", ref: "A", total_ttc: "10.00" },
  { id: "2", ref: "B", total_ttc: "20.00" },
];
const COLUMNS = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "total_ttc", label: "Total" },
];

describe("renderList honours the new formats", () => {
  it("emits ndjson", () => {
    const out = capture(() => renderList(ROWS, { columns: COLUMNS, opts: { output: "ndjson" } }));
    expect(out.trim().split("\n").map((l) => JSON.parse(l))).toEqual(ROWS);
  });

  it("emits yaml", () => {
    const out = capture(() => renderList(ROWS, { columns: COLUMNS, opts: { output: "yaml" } }));
    expect(out).toContain('id: "1"');
    expect(out).toContain('ref: "B"');
  });

  it("applies --fields to ndjson", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { output: "ndjson", fields: "id" } }),
    );
    expect(out.trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("applies a template, one line per row", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { template: "{{.id}}-{{.ref}}" } }),
    );
    expect(out.trim().split("\n")).toEqual(["1-A", "2-B"]);
  });

  it("lets --template win over --output", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { output: "json", template: "{{.ref}}" } }),
    );
    expect(out.trim().split("\n")).toEqual(["A", "B"]);
  });

  it("drops the header for csv with --no-header", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { output: "csv", header: false } }),
    );
    expect(out).not.toContain("id,ref");
    expect(out.trim().split(/\r?\n/)).toEqual(["1,A,10.00", "2,B,20.00"]);
  });

  it("drops the header for the table with --no-header", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { header: false } }),
    );
    expect(out).not.toContain("ID");
    expect(out).not.toContain("─");
  });

  it("keeps the header by default", () => {
    const out = capture(() => renderList(ROWS, { columns: COLUMNS, opts: {} }));
    expect(out).toContain("ID");
  });

  it("emits one raw value per row for --field", () => {
    const out = capture(() => renderList(ROWS, { columns: COLUMNS, opts: { field: "ref" } }));
    expect(out.trim().split("\n")).toEqual(["A", "B"]);
  });

  it("lets --field win over --output", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { field: "id", output: "json" } }),
    );
    expect(out.trim().split("\n")).toEqual(["1", "2"]);
  });

  it("keeps --fields meaning column projection, untouched by --field's arrival", () => {
    const out = capture(() =>
      renderList(ROWS, { columns: COLUMNS, opts: { fields: "id,ref" } }),
    );
    expect(out).toContain("id");
    expect(out).toContain("ref");
    expect(out).toContain("A");
  });

  it("prints nothing at all for an empty ndjson result", () => {
    expect(capture(() => renderList([], { columns: COLUMNS, opts: { output: "ndjson" } }))).toBe(
      "",
    );
  });
});

describe("renderGet honours the new formats", () => {
  const FIELDS = [
    { key: "id", label: "ID" },
    { key: "ref", label: "Ref" },
  ];

  it("emits yaml for a single record", () => {
    const out = capture(() => renderGet(ROWS[0], { fields: FIELDS, opts: { output: "yaml" } }));
    expect(out).toContain('id: "1"');
  });

  it("emits a single ndjson line", () => {
    const out = capture(() => renderGet(ROWS[0], { fields: FIELDS, opts: { output: "ndjson" } }));
    expect(JSON.parse(out.trim())).toEqual(ROWS[0]);
  });

  it("applies a template", () => {
    const out = capture(() => renderGet(ROWS[0], { fields: FIELDS, opts: { template: "{{.ref}}" } }));
    expect(out.trim()).toBe("A");
  });

  it("emits a single raw value for --field", () => {
    const out = capture(() => renderGet(ROWS[0], { fields: FIELDS, opts: { field: "ref" } }));
    expect(out.trim()).toBe("A");
  });

  it("keeps the default two-column table unchanged", () => {
    const out = capture(() => renderGet(ROWS[0], { fields: FIELDS, opts: {} }));
    expect(out).toContain("Field");
    expect(out).toContain("Value");
  });
});

describe("enableOutputFormats wiring", () => {
  function fixture() {
    const program = new Command("root").exitOverride();
    const group = new Command("things");
    group.command("list").option("--output <fmt>", "fmt", "table").action(() => {});
    // Batch-style command: renders through --json, not --output.
    group.command("delete").option("--json", "json").action(() => {});
    program.addCommand(group);
    return program;
  }

  it("adds the rendering flags only where there is --output", () => {
    const program = fixture();
    expect(enableOutputFormats(program)).toEqual(["things list"]);
    const list = program.commands[0].commands[0];
    const del = program.commands[0].commands[1];
    expect(list.options.map((o) => o.long)).toEqual(
      expect.arrayContaining(["--template", "--no-header", "--quiet"]),
    );
    expect(del.options.map((o) => o.long)).not.toContain("--template");
  });

  it("adds --quiet everywhere, including batch-style commands", () => {
    const program = fixture();
    enableOutputFormats(program);
    const del = program.commands[0].commands[1];
    expect(del.options.map((o) => o.long)).toContain("--quiet");
  });

  it("is idempotent", () => {
    const program = fixture();
    expect(enableOutputFormats(program)).toEqual(["things list"]);
    expect(enableOutputFormats(program)).toEqual([]);
  });
});
