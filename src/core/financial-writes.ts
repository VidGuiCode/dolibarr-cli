import { timingSafeEqual } from "node:crypto";
import type { Command } from "commander";
import {
  NonInteractiveError,
  ReadOnlyError,
  ValidationError,
  exitWithError,
  getExitCode,
} from "./errors.js";
import { printError, printJson, printNotice } from "./output.js";
import { ask } from "./prompt.js";
import { isDryRunEnabled, isNonInteractiveMode, isReadOnlyMode } from "./runtime.js";
import { walkLeaves } from "./command-tree.js";
import {
  duplicateError,
  findDuplicate,
  fingerprint,
  readLedger,
  recordMovement,
} from "./idempotency.js";

/**
 * Mandatory confirmation on writes that move money or change a document's legal
 * state (v0.6.0).
 *
 * Before this, `bank transfer`, `bank add-transaction`, `invoices pay` and every
 * `validate` fired the API call straight after argument parsing — a mistyped or
 * copy-pasted command moved real money with nothing in between. Deletes already
 * confirmed; these did not.
 *
 * The rule matches how `delete` has always behaved, so there is ONE rule across the
 * CLI: interactively you are prompted, non-interactively you must pass `--confirm`.
 * `DOLIBARR_ASSUME_YES=1` is the blanket opt-out for trusted automation.
 *
 * `--dry-run` is deliberately NOT a substitute for approval — it is a preview, and
 * previewing is not approving. A dry run skips the gate because it changes nothing.
 *
 * Wired ONCE from `cli.ts` over the whole command tree, so all 33 groups inherit it
 * and any future group does too.
 */

export type WriteRisk = "money" | "state" | "overwrite" | "raw";

/** Verbs that move money or record a monetary fact. */
export const MONEY_VERBS = new Set([
  "pay",
  "unpay",
  "transfer",
  "add-transaction",
  "update-transaction",
  "delete-transaction",
  "apply-credit-note",
]);

/** Verbs that change a document's official state — refs get locked, numbering burns. */
export const STATE_VERBS = new Set(["validate", "close", "reopen", "set-draft", "approve"]);

export interface FinancialWriteSpec {
  risk: WriteRisk;
  /** Plain-language statement of what is about to happen. */
  effect: string;
}

/**
 * Classify a leaf command path. Verb-based rather than a hardcoded path list, so a
 * resource group added later is covered without touching this file.
 */
export function financialWriteSpec(path: string): FinancialWriteSpec | null {
  const verb = path.split(" ").pop() ?? "";

  if (path === "raw") {
    return { risk: "raw", effect: "Send an unchecked write straight to the Dolibarr API" };
  }
  if (path === "documents upload") {
    return { risk: "overwrite", effect: "Overwrite an existing document on the server" };
  }
  if (MONEY_VERBS.has(verb)) {
    return { risk: "money", effect: "Move or record money. This cannot be undone from the CLI" };
  }
  if (STATE_VERBS.has(verb)) {
    return {
      risk: "state",
      effect: "Change a document's official state (refs and numbering are affected)",
    };
  }
  return null;
}

/** `DOLIBARR_ASSUME_YES=1` — the documented opt-out for trusted automation. */
export function isAssumeYes(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.DOLIBARR_ASSUME_YES ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface ConfirmContext {
  path: string;
  hasConfirmFlag: boolean;
  assumeYes: boolean;
  dryRun: boolean;
  nonInteractive: boolean;
  /** What the command actually does, so the refusal names the real risk. */
  effect?: string;
  /** Value of `--approve <token>`, when given. */
  approveToken?: string;
  /** Value of DOLIBARR_APPROVAL_TOKEN, when configured. */
  expectedToken?: string;
}

export type ConfirmDecision =
  | { action: "proceed"; reason: "dry-run" | "confirm-flag" | "assume-yes" | "approve-token" }
  | { action: "prompt" }
  | { action: "refuse"; message: string };

/**
 * The approval token an unattended run must present (v0.6.3).
 *
 * `--approve <token>` is checked against `DOLIBARR_APPROVAL_TOKEN`. The point is that an
 * agent or script can only approve a financial write if it has been handed the secret out
 * of band — unlike `--confirm`, which anything that can build a command line can pass.
 */
export function expectedApprovalToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const t = (env.DOLIBARR_APPROVAL_TOKEN ?? "").trim();
  return t === "" ? undefined : t;
}

/** Constant-time comparison, so a wrong token cannot be discovered by timing. */
export function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The whole gate as a pure function, so every branch is testable without moving a
 * single euro.
 */
export function decideConfirmation(ctx: ConfirmContext): ConfirmDecision {
  // A dry run changes nothing, so it needs no approval.
  if (ctx.dryRun) return { action: "proceed", reason: "dry-run" };

  // An explicitly supplied token is checked before anything else can wave it through,
  // so a wrong token is always an error rather than being masked by --confirm.
  if (ctx.approveToken !== undefined) {
    if (!ctx.expectedToken) {
      return {
        action: "refuse",
        message:
          `--approve was given but no approval token is configured.\n` +
          `  Set DOLIBARR_APPROVAL_TOKEN to the expected value, or use --confirm instead.`,
      };
    }
    if (!tokenMatches(ctx.approveToken, ctx.expectedToken)) {
      return {
        action: "refuse",
        message:
          `--approve token does not match DOLIBARR_APPROVAL_TOKEN.\n` +
          `  Refusing \`${ctx.path}\`.`,
      };
    }
    return { action: "proceed", reason: "approve-token" };
  }

  if (ctx.hasConfirmFlag) return { action: "proceed", reason: "confirm-flag" };
  if (ctx.assumeYes) return { action: "proceed", reason: "assume-yes" };
  if (ctx.nonInteractive) {
    return {
      action: "refuse",
      message:
        `Refusing to run \`${ctx.path}\` without confirmation in non-interactive mode.\n` +
        `  ${ctx.effect ?? "This command moves money or changes a document's official state"}.\n` +
        `  Add --confirm to approve this call, or set DOLIBARR_ASSUME_YES=1 to approve\n` +
        `  every such call in a trusted automated environment.`,
    };
  }
  return { action: "prompt" };
}

/**
 * Options that describe the CLI run rather than the write itself, and are therefore
 * not worth showing in the confirmation.
 *
 * `approve` is in here for a stronger reason than noise: it holds a SECRET. Echoing it
 * would print the approval token to the terminal and into any transcript or CI log.
 */
const NOISE_OPTS = new Set([
  "confirm",
  "approve",
  "allowDuplicate",
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
  "all",
  "maxRecords",
  "readOnly",
  "auditLog",
]);

/**
 * Render what is about to happen, so the user approves a specific act rather than a
 * yes/no with no content. Values come from the parsed command, so this needs no
 * per-command wiring.
 */
export function describeWrite(
  path: string,
  spec: FinancialWriteSpec,
  positionals: unknown[],
  opts: Record<string, unknown>,
): string[] {
  const lines = [
    spec.risk === "money"
      ? "!!  FINANCIAL WRITE"
      : spec.risk === "raw"
        ? "!!  RAW API WRITE"
        : spec.risk === "overwrite"
          ? "!!  FILE OVERWRITE"
          : "!!  DOCUMENT STATE CHANGE",
    `    ${spec.effect}.`,
    `    Command: ${path}`,
  ];

  const args = positionals.filter((a) => a !== undefined && a !== null).map(String);
  if (args.length > 0) lines.push(`    Arguments: ${args.join(" ")}`);

  for (const [k, v] of Object.entries(opts)) {
    if (NOISE_OPTS.has(k) || v === undefined || v === false) continue;
    lines.push(`    --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${String(v)}`);
  }
  return lines;
}

function isJsonMode(opts: Record<string, unknown>): boolean {
  return Boolean(opts.json || opts.output === "json");
}

/**
 * Run the gate for one invocation. Returns false when the caller must stop.
 * Exported so tests can drive it directly.
 */
export async function gateWrite(
  path: string,
  spec: FinancialWriteSpec,
  positionals: unknown[],
  opts: Record<string, unknown>,
): Promise<boolean> {
  // Fail fast: read-only is enforced at the API client regardless, but there is no
  // point prompting for approval of a write that can never be sent.
  if (isReadOnlyMode() && !isDryRunEnabled()) {
    throw ReadOnlyError.forCommand(path);
  }

  // Duplicate protection runs before approval: re-approving a payment that already
  // went through is exactly the mistake this is here to catch, so asking first would
  // invite the user to wave it past.
  if (spec.risk === "money" && !isDryRunEnabled() && !opts.allowDuplicate) {
    const fp = fingerprint(path, positionals, opts);
    const previous = findDuplicate(readLedger(), fp, new Date());
    if (previous) throw duplicateError(path, previous);
  }

  const decision = decideConfirmation({
    path,
    hasConfirmFlag: Boolean(opts.confirm),
    assumeYes: isAssumeYes(),
    dryRun: isDryRunEnabled(),
    nonInteractive: isNonInteractiveMode(),
    effect: spec.effect,
    approveToken: typeof opts.approve === "string" ? opts.approve : undefined,
    expectedToken: expectedApprovalToken(),
  });

  if (decision.action === "proceed") {
    if (decision.reason === "assume-yes") {
      // Never let a blanket opt-out be silent — the audit trail starts here.
      printNotice(`(DOLIBARR_ASSUME_YES is set — approving \`${path}\` without prompting.)`);
    }
    return true;
  }

  if (decision.action === "refuse") {
    throw new NonInteractiveError(decision.message);
  }

  for (const line of describeWrite(path, spec, positionals, opts)) printNotice(line);
  const answer = await ask('Type "yes" to proceed (yes/no)');
  if (answer.trim().toLowerCase() !== "yes") {
    if (isJsonMode(opts)) printJson({ status: "cancelled", command: path });
    else printNotice("Cancelled.");
    return false;
  }
  return true;
}

/** Methods that change server state and therefore need approval via `raw`. */
const RAW_WRITE_METHODS = new Set(["POST", "PUT", "DELETE"]);

/**
 * Wire the gate onto every financial-write leaf, from one call in `cli.ts`.
 * Returns the wired paths so the reach test can assert full coverage.
 *
 * MUST be wired BEFORE `enableBatchIds` so this handler ends up *inside* the batch
 * wrapper: a batch run confirms once for the whole selection and sets `confirm` on
 * the command, which this gate then sees, so batch and financial protections
 * compose instead of double-prompting.
 */
export function enableFinancialConfirmation(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    const spec = financialWriteSpec(path);
    if (!spec) continue;

    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __financialWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function" || internal.__financialWired) continue;
    internal.__financialWired = true;

    const longs = cmd.options.map((o) => o.long);
    if (!longs.includes("--confirm")) {
      cmd.option("--confirm", "Approve this write without an interactive prompt");
    }
    if (!longs.includes("--approve")) {
      cmd.option(
        "--approve <token>",
        "Approve using the token in DOLIBARR_APPROVAL_TOKEN (for unattended runs)",
      );
    }
    // Only money movements are fingerprinted, so only they get the override.
    if (spec.risk === "money" && !longs.includes("--allow-duplicate")) {
      cmd.option(
        "--allow-duplicate",
        "Permit a movement identical to one this CLI already performed",
      );
    }
    cmd.addHelpText(
      "after",
      `\nThis command ${spec.risk === "money" ? "moves money" : "changes server state"} and` +
        "\nrequires confirmation: you are prompted interactively, and --confirm is" +
        "\nmandatory in non-interactive mode. Set DOLIBARR_ASSUME_YES=1 to approve" +
        "\nautomatically in trusted automation, or pass --approve <token> matching" +
        "\nDOLIBARR_APPROVAL_TOKEN. --dry-run previews without approving." +
        (spec.risk === "money"
          ? "\n\nDuplicate protection: an identical movement (same account, amount, date" +
            "\nand reference) already performed by this CLI is refused. Override with" +
            "\n--allow-duplicate. This only sees writes made by this CLI on this machine."
          : ""),
    );

    internal._actionHandler = async (args: unknown[]) => {
      const opts = cmd.opts() as Record<string, unknown>;
      // `raw` takes the method as its first argument; reads need no approval.
      if (path === "raw") {
        const method = String(args[0] ?? "").toUpperCase();
        if (!RAW_WRITE_METHODS.has(method)) return original(args);
      }
      // Only an actual overwrite is destructive; a plain upload is not.
      if (path === "documents upload" && !opts.overwrite) return original(args);

      // Drop commander's trailing (options, command) pair from the display.
      const positionals = args.slice(0, Math.max(0, cmd.registeredArguments.length));

      try {
        if (!(await gateWrite(path, spec, positionals, opts))) {
          return process.exit(0);
        }
      } catch (err) {
        if (
          err instanceof ValidationError ||
          err instanceof NonInteractiveError ||
          err instanceof ReadOnlyError
        ) {
          if (isJsonMode(opts)) printJson({ status: "error", code: err.name, message: err.message });
          else printError(err.message);
          return process.exit(getExitCode(err));
        }
        return exitWithError(err, isJsonMode(opts));
      }

      const result = await original(args);

      // Record only after the command returned without throwing. Recording before
      // would block a legitimate retry of a payment that never actually happened —
      // the opposite of the mistake this is guarding against.
      if (spec.risk === "money" && !isDryRunEnabled()) {
        recordMovement(path, fingerprint(path, positionals, opts), new Date());
      }
      return result;
    };

    wired.push(path);
  }

  return wired;
}
