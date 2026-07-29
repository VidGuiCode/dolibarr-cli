import type { Command } from "commander";
import { walkLeaves } from "./command-tree.js";
import { financialWriteSpec, isAssumeYes } from "./financial-writes.js";
import { isAuditEnabled } from "./audit.js";
import { printInfo, printJson } from "./output.js";
import { isDryRunEnabled, isNonInteractiveMode, isReadOnlyMode } from "./runtime.js";
import { isSensitiveKey, redactValue } from "./views.js";

/**
 * `--explain` (v0.6.8): say what this invocation would do, and stop.
 *
 * `--dry-run` answers "what body would be sent?". `--explain` answers the question a
 * user actually has before running something unfamiliar: *what is about to happen to me* —
 * which record, which safety gates apply, whether it will prompt, whether it can even
 * write at all in the current mode.
 *
 * Everything reported is derived centrally from the wiring layers, so no command file
 * needs to describe itself and no command can drift out of sync with its own explanation.
 */

/** Flags that describe the run rather than the operation. */
const RUN_FLAGS = new Set([
  "explain",
  "json",
  "output",
  "dryRun",
  "noInteractive",
  "compact",
  "quiet",
  "fields",
  "field",
  "template",
  "view",
  "redact",
  "header",
  "all",
  "maxRecords",
  "readOnly",
  "auditLog",
  "color",
]);

/** Never printed: a secret the user passed on the command line. */
const SECRET_FLAGS = new Set(["approve"]);

export interface Explanation {
  command: string;
  description: string;
  /** money | state | overwrite | raw, or "read" when nothing is written. */
  classification: string;
  effect: string;
  arguments: string[];
  options: Record<string, unknown>;
  /** Human-readable statements about what will gate or shape this run. */
  gates: string[];
  willExecute: boolean;
}

export interface ExplainEnv {
  dryRun?: boolean;
  readOnly?: boolean;
  nonInteractive?: boolean;
  assumeYes?: boolean;
  auditing?: boolean;
  hasConfirm?: boolean;
  hasApprove?: boolean;
}

/** Strip run-control flags and secrets, and redact sensitive values. */
export function displayOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (RUN_FLAGS.has(k) || SECRET_FLAGS.has(k)) continue;
    if (v === undefined || v === false) continue;
    out[k] = isSensitiveKey(k)
      ? (redactValue({ [k]: v }) as Record<string, unknown>)[k]
      : v;
  }
  return out;
}

/**
 * Work out which gates apply, in the order they would actually fire. The ordering is
 * the point: read-only stops a write before anything asks for approval.
 */
export function describeGates(path: string, env: ExplainEnv): string[] {
  const spec = financialWriteSpec(path);
  const gates: string[] = [];

  if (env.readOnly) {
    gates.push("BLOCKED: read-only mode is active — any write will be refused (exit 6).");
  }
  if (env.dryRun) {
    gates.push("Dry run: the request is shown but never sent.");
  }

  if (!spec) {
    gates.push("No confirmation required: this command does not write.");
    return gates;
  }

  if (spec.risk === "money") {
    gates.push(
      "Duplicate check: an identical movement already performed by this CLI would be refused " +
        "(override with --allow-duplicate).",
    );
  }

  if (env.dryRun) {
    gates.push("Approval is not requested for a dry run, because nothing is sent.");
  } else if (env.hasApprove) {
    gates.push("Approval: --approve is checked against DOLIBARR_APPROVAL_TOKEN.");
  } else if (env.hasConfirm) {
    gates.push("Approval: satisfied by --confirm.");
  } else if (env.assumeYes) {
    gates.push("Approval: satisfied automatically by DOLIBARR_ASSUME_YES.");
  } else if (env.nonInteractive) {
    gates.push("Approval: WILL BE REFUSED — --confirm is required in non-interactive mode.");
  } else {
    gates.push("Approval: you will be prompted to type \"yes\" before anything is sent.");
  }

  if (env.auditing) {
    gates.push("Audit: this write will be appended to the audit log.");
  }

  return gates;
}

export function buildExplanation(
  path: string,
  description: string,
  positionals: unknown[],
  opts: Record<string, unknown>,
  env: ExplainEnv,
): Explanation {
  const spec = financialWriteSpec(path);
  return {
    command: path,
    description,
    classification: spec ? spec.risk : "read",
    effect: spec ? spec.effect : "Reads data; makes no change",
    arguments: positionals.filter((p) => p !== undefined && p !== null).map(String),
    options: displayOptions(opts),
    gates: describeGates(path, env),
    willExecute: false,
  };
}

export function renderExplanation(e: Explanation): string[] {
  const lines = [
    `Command:        dolibarr ${e.command}`,
    `Does:           ${e.description}`,
    `Classification: ${e.classification}`,
    `Effect:         ${e.effect}`,
  ];
  if (e.arguments.length > 0) lines.push(`Arguments:      ${e.arguments.join(" ")}`);
  const opts = Object.entries(e.options);
  if (opts.length > 0) {
    lines.push("Options:");
    for (const [k, v] of opts) {
      lines.push(`  --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${String(v)}`);
    }
  }
  lines.push("Gates:");
  for (const g of e.gates) lines.push(`  - ${g}`);
  lines.push("");
  lines.push("Nothing was executed. Re-run without --explain to perform it.");
  return lines;
}

/**
 * Add `--explain` to every leaf and short-circuit the action when it is passed.
 * Wired once from `cli.ts`; returns the wired paths for the reach test.
 */
export function enableExplain(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __explainWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function" || internal.__explainWired) continue;
    internal.__explainWired = true;

    if (!cmd.options.some((o) => o.long === "--explain")) {
      cmd.option("--explain", "Describe what this would do, including safety gates, and stop");
    }

    internal._actionHandler = async (args: unknown[]) => {
      const opts = cmd.opts() as Record<string, unknown>;
      if (!opts.explain) return original(args);

      const positionals = args.slice(0, Math.max(0, cmd.registeredArguments.length));
      const explanation = buildExplanation(path, cmd.description(), positionals, opts, {
        dryRun: isDryRunEnabled(),
        readOnly: isReadOnlyMode(),
        nonInteractive: isNonInteractiveMode(),
        assumeYes: isAssumeYes(),
        auditing: isAuditEnabled(),
        hasConfirm: Boolean(opts.confirm),
        hasApprove: typeof opts.approve === "string",
      });

      if (opts.json || opts.output === "json") printJson(explanation);
      else for (const line of renderExplanation(explanation)) printInfo(line);
      return undefined;
    };

    wired.push(path);
  }

  return wired;
}
