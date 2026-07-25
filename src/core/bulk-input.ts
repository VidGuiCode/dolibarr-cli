import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Command } from "commander";
import { exitWithError, NonInteractiveError, ValidationError } from "./errors.js";
import { printError, printJson } from "./output.js";
import { walkLeaves } from "./command-tree.js";
import { runBatch } from "./batch.js";

/**
 * Bulk create/update input (v0.5.4).
 *
 * `--from-json <file>` may now hold a JSON **array**, and `--stdin` reads records
 * from a pipe as NDJSON (or a JSON array / single object). Each record runs the
 * command's existing single-record path once, so bodies are built exactly as
 * before and every group inherits this from one wiring call.
 */

/**
 * Commands whose `--from-json` array already means something else.
 *
 * `supplier-orders receive <id> --from-json lines.json` reads an array of *lines
 * for one receipt* into `body.lines`. Splitting that into one call per line
 * would silently change what the command does, so it keeps its old behaviour.
 */
export const BULK_INPUT_EXCLUDED = new Set(["supplier-orders receive"]);

/**
 * Parse bulk input into records.
 *
 * Accepts a JSON array, a single JSON object (including pretty-printed across
 * lines), or NDJSON — one JSON object per line.
 *
 * @throws ValidationError with the offending line number on malformed input.
 */
export function parseRecords(text: string, source: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ValidationError(`${source} contained no data.`);
  }

  // Whole-document parse first, so pretty-printed JSON works on stdin.
  try {
    const value: unknown = JSON.parse(trimmed);
    const records = Array.isArray(value) ? value : [value];
    return records.map((r, i) => assertRecord(r, `${source} entry ${i + 1}`));
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    // Not a single JSON document — fall through to NDJSON.
  }

  const out: Record<string, unknown>[] = [];
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ValidationError(`${source} line ${i + 1} is not valid JSON: ${line.slice(0, 80)}`);
    }
    out.push(assertRecord(value, `${source} line ${i + 1}`));
  }

  if (out.length === 0) throw new ValidationError(`${source} contained no records.`);
  return out;
}

function assertRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${where} must be a JSON object, got ${describe(value)}.`);
  }
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** Read all of stdin. Returns undefined when stdin is a TTY (nothing piped). */
export function readStdin(): string {
  if (process.stdin.isTTY) {
    throw new ValidationError("--stdin was passed but nothing is piped into the command.");
  }
  try {
    return fs.readFileSync(0, "utf-8");
  } catch {
    throw new ValidationError("Could not read records from stdin.");
  }
}

/**
 * Read `--from-json` and decide whether it is a bulk payload.
 *
 * A single JSON object is **not** bulk: it returns undefined so the command's
 * original code path runs completely untouched.
 */
export function recordsFromFile(file: string): Record<string, unknown>[] | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    throw new ValidationError(`Could not read --from-json file: ${file}`);
  }
  if (!text.trim().startsWith("[")) return undefined;
  return parseRecords(text, `--from-json ${path.basename(file)}`);
}

/** A short, stable label for one record in the outcome report. */
export function recordLabel(record: Record<string, unknown>, index: number): string {
  for (const key of ["ref", "name", "label", "title", "lastname"]) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return `#${index + 1} ${v.trim().slice(0, 40)}`;
  }
  return `#${index + 1}`;
}

/**
 * Scratch directory holding one file per record, so each invocation of the
 * command's original `--from-json` path sees exactly one object.
 *
 * Registered for cleanup on process exit because `runBatch` finishes by calling
 * `process.exit`, which would skip a `finally`.
 */
function makeScratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dolibarr-bulk-"));
  process.on("exit", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return dir;
}

/** True when a command takes bulk input at all. */
export function acceptsBulkInput(cmd: Command, path: string): boolean {
  return (
    cmd.commands.length === 0 &&
    cmd.options.some((o) => o.long === "--from-json") &&
    !BULK_INPUT_EXCLUDED.has(path)
  );
}

/**
 * Wire array `--from-json` and `--stdin` into every command that takes
 * `--from-json`, from one call in `cli.ts`. Returns the wired paths.
 */
export function enableBulkInput(program: Command): string[] {
  const wired: string[] = [];

  for (const { path: cmdPath, cmd } of walkLeaves(program)) {
    if (!acceptsBulkInput(cmd, cmdPath)) continue;

    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __bulkInputWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function" || internal.__bulkInputWired) continue;
    internal.__bulkInputWired = true;

    if (!cmd.options.some((o) => o.long === "--stdin")) {
      cmd.option("--stdin", "Read records from stdin (NDJSON or a JSON array)");
    }
    // A multi-record run is a bulk mutation, so it needs the same confirmation
    // gate as every other one in this line.
    if (!cmd.options.some((o) => o.long === "--confirm")) {
      cmd.option("--confirm", "Skip confirmation prompt");
    }
    cmd.addHelpText(
      "after",
      "\nBulk: --from-json may hold a JSON array, and --stdin reads NDJSON from a" +
        "\npipe. Multiple records run one at a time with a per-item outcome report," +
        "\nrequire --confirm, and exit 5 when only some succeeded.",
    );

    internal._actionHandler = async (args: unknown[]) => {
      const opts = cmd.opts() as Record<string, unknown>;
      const json = Boolean(opts.json || opts.output === "json");

      try {
        let records: Record<string, unknown>[] | undefined;
        if (opts.stdin) {
          records = parseRecords(readStdin(), "stdin");
        } else if (typeof opts.fromJson === "string") {
          records = recordsFromFile(opts.fromJson);
        }

        // Not a bulk payload — original behaviour, byte for byte.
        if (!records) return original(args);

        const scratch = makeScratch();
        const runOne = async (record: Record<string, unknown>, i: number): Promise<unknown> => {
          const file = path.join(scratch, `record-${i}.json`);
          fs.writeFileSync(file, JSON.stringify(record));
          cmd.setOptionValue("fromJson", file);
          return original(args);
        };

        // A one-record payload behaves exactly like a single-record run.
        if (records.length === 1) return await runOne(records[0], 0);

        const labels = records.map((r, i) => recordLabel(r, i));
        const byLabel = new Map(labels.map((l, i) => [l, i]));
        return await runBatch(
          cmdPath,
          labels,
          opts,
          () => cmd.setOptionValue("confirm", true),
          (label) => runOne(records[byLabel.get(label)!], byLabel.get(label)!),
        );
      } catch (err) {
        // Covers both malformed input and runBatch's own refusals, so neither
        // ever surfaces as an unhandled rejection.
        if (err instanceof ValidationError || err instanceof NonInteractiveError) {
          if (json) printJson({ status: "error", code: err.name, message: err.message });
          else printError(err.message);
          return process.exit(3);
        }
        return exitWithError(err, json);
      }
    };

    wired.push(cmdPath);
  }

  return wired;
}
