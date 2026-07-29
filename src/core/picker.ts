import type { Command } from "commander";
import type { DolibarrApiClient } from "./api-client.js";
import { NonInteractiveError, ValidationError, exitWithError, getExitCode } from "./errors.js";
import { printError, printNotice } from "./output.js";
import { ask } from "./prompt.js";
import { isNonInteractiveMode } from "./runtime.js";
import { walkLeaves } from "./command-tree.js";

/**
 * Interactive fuzzy pickers (v0.6.6).
 *
 * When an id is omitted at an interactive terminal, fetch the candidates and let the
 * user narrow them by typing, instead of making them go and run a `list` first.
 *
 * Hand-rolled scoring — no `inquirer`, no `fuzzy`. `commander` stays the only runtime
 * dep, and the matcher is a pure function so it is testable without a terminal.
 *
 * Strictly an interactive convenience. In `--no-interactive` mode a missing id is
 * still an error, because a script silently picking a record for itself is precisely
 * the behaviour this project's safety work exists to prevent.
 */

export interface PickerItem {
  id: string;
  /** What the user reads and types against, e.g. "IN2401-0001 — Acme Corp". */
  label: string;
}

export interface ScoredItem extends PickerItem {
  score: number;
}

/**
 * Subsequence fuzzy match, scored so the most "intentional" matches rank first.
 *
 * Returns null when the query is not a subsequence at all. An empty query matches
 * everything with a neutral score, so an empty input lists the candidates unchanged.
 */
export function fuzzyScore(query: string, label: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const l = label.toLowerCase();

  // A plain substring hit is always a better match than a scattered subsequence.
  const idx = l.indexOf(q);
  if (idx !== -1) {
    // Earlier is better, and a prefix match is best of all.
    return 1000 - idx + (idx === 0 ? 500 : 0);
  }

  let li = 0;
  let score = 0;
  let lastHit = -1;
  for (const ch of q) {
    const found = l.indexOf(ch, li);
    if (found === -1) return null;
    // Consecutive characters score higher than scattered ones.
    if (lastHit !== -1 && found === lastHit + 1) score += 10;
    else score += 1;
    lastHit = found;
    li = found + 1;
  }
  return score;
}

/** Rank candidates against a query, dropping non-matches. Ties keep input order. */
export function filterItems(items: PickerItem[], query: string): ScoredItem[] {
  const scored: ScoredItem[] = [];
  items.forEach((item, i) => {
    const score = fuzzyScore(query, item.label);
    if (score === null) return;
    // Subtract the index as a tiny tiebreak so equal scores keep their original order.
    scored.push({ ...item, score: score * 1000 - i });
  });
  return scored.sort((a, b) => b.score - a.score);
}

export const PICKER_PAGE = 10;

/** Render the numbered choices the user picks from. */
export function formatChoices(items: ScoredItem[], limit = PICKER_PAGE): string[] {
  return items.slice(0, limit).map((item, i) => `  ${i + 1}. ${item.label}`);
}

/**
 * Ask the user to choose one of `items`.
 *
 * Typing a number selects directly; typing anything else re-filters. Returns the
 * chosen id.
 */
export async function pickFrom(items: PickerItem[], what: string): Promise<string> {
  if (isNonInteractiveMode()) {
    throw new NonInteractiveError(
      `No ${what} id given, and one cannot be chosen in non-interactive mode.\n` +
        `  Pass the id explicitly.`,
    );
  }
  if (items.length === 0) {
    throw new ValidationError(`No ${what} records are available to choose from.`);
  }

  let matches = filterItems(items, "");
  for (;;) {
    printNotice(`\nSelect a ${what} (${matches.length} match${matches.length === 1 ? "" : "es"}):`);
    for (const line of formatChoices(matches)) printNotice(line);
    if (matches.length > PICKER_PAGE) {
      printNotice(`  … ${matches.length - PICKER_PAGE} more — type to narrow`);
    }

    const answer = (await ask("Number, or text to filter (blank to cancel)")).trim();
    if (answer === "") throw new ValidationError("Cancelled — no selection made.");

    if (/^\d+$/.test(answer)) {
      const n = Number(answer);
      const visible = matches.slice(0, PICKER_PAGE);
      if (n >= 1 && n <= visible.length) return visible[n - 1].id;
      printNotice(`Enter a number between 1 and ${visible.length}, or text to filter.`);
      continue;
    }

    const next = filterItems(items, answer);
    if (next.length === 0) {
      printNotice(`Nothing matched "${answer}". Showing the previous list again.`);
      continue;
    }
    matches = next;
    // A single match after filtering is unambiguous, so take it.
    if (matches.length === 1) return matches[0].id;
  }
}

/** How to fetch and label the candidates for each pickable resource. */
export interface PickerSource {
  path: string;
  params: Record<string, string | number>;
  label: (row: Record<string, unknown>) => string;
}

export const PICKER_SOURCES: Record<string, PickerSource> = {
  thirdparty: {
    path: "thirdparties",
    params: { limit: 200, sortfield: "t.nom", sortorder: "ASC" },
    label: (r) => [r.name ?? r.nom, r.code_client ? `(${r.code_client})` : ""].filter(Boolean).join(" ").trim(),
  },
  product: {
    path: "products",
    params: { limit: 200, sortfield: "t.ref", sortorder: "ASC" },
    label: (r) => [r.ref, r.label].filter(Boolean).join(" — "),
  },
  account: {
    path: "bankaccounts",
    params: { limit: 200 },
    label: (r) => [r.label, r.bank].filter(Boolean).join(" — "),
  },
};

/**
 * Commands whose id may be omitted interactively, and what to pick for them.
 *
 * Deliberately a short allowlist of READ commands. A picker that fires on a mutation
 * would mean an omitted id silently resolves to whatever the user clicked — the
 * opposite of the explicitness the 0.6.0–0.6.3 safety work established.
 */
export const PICKER_COMMANDS: Record<string, keyof typeof PICKER_SOURCES> = {
  "thirdparties get": "thirdparty",
  "products get": "product",
  "bank get": "account",
  "bank transactions": "account",
};

/** Fetch candidates and run the picker. */
export async function pickResource(
  client: DolibarrApiClient,
  kind: keyof typeof PICKER_SOURCES,
): Promise<string> {
  const source = PICKER_SOURCES[kind];
  if (!source) throw new ValidationError(`No picker is defined for "${kind}".`);

  // Fail before spending an API call on a list nobody can choose from.
  if (isNonInteractiveMode()) {
    throw new NonInteractiveError(
      `No ${kind} id given, and one cannot be chosen in non-interactive mode.\n` +
        `  Pass the id explicitly.`,
    );
  }

  const rows = await client.get<Record<string, unknown>[]>(source.path, source.params);
  const items: PickerItem[] = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ id: String(r.id ?? ""), label: source.label(r) || String(r.id ?? "") }))
    .filter((i) => i.id !== "");

  return pickFrom(items, kind);
}

/**
 * Make the id optional on the allowlisted commands and resolve it interactively when
 * omitted. Wired once from `cli.ts`; returns the wired paths for the reach test.
 *
 * In non-interactive mode this reproduces commander's own missing-argument error and
 * exit code exactly, so scripts that relied on that failure see no change.
 */
export function enablePickers(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    const kind = PICKER_COMMANDS[path];
    if (!kind) continue;

    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __pickerWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function" || internal.__pickerWired) continue;
    internal.__pickerWired = true;

    const idArg = cmd.registeredArguments[0];
    if (!idArg) continue;
    idArg.required = false;
    idArg.description = `${idArg.description || "Record ID"} (omit to choose interactively)`;

    cmd.addHelpText(
      "after",
      "\nOmit the id at an interactive terminal to pick from a searchable list." +
        "\nType to filter, or enter a number to select. Non-interactive runs still" +
        "\nrequire the id.",
    );

    internal._actionHandler = async (args: unknown[]) => {
      const given = args[0];
      if (given !== undefined && given !== null && given !== "") return original(args);

      if (isNonInteractiveMode()) {
        // Reproduce commander's original error and exit code verbatim.
        (cmd as unknown as { missingArgument(name: string): never }).missingArgument(
          idArg.name(),
        );
      }

      const opts = cmd.opts() as Record<string, unknown>;
      try {
        const { createClient } = await import("./config-store.js");
        const id = await pickResource(createClient(), kind);
        return original([id, ...args.slice(1)]);
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NonInteractiveError) {
          printError(err.message);
          return process.exit(getExitCode(err));
        }
        return exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    };

    wired.push(path);
  }

  return wired;
}
