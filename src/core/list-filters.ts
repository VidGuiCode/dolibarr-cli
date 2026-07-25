import type { Command } from "commander";
import { exitWithError, NonInteractiveError, ValidationError } from "./errors.js";
import { printError, printJson } from "./output.js";
import { walkLeaves } from "./batch.js";

/**
 * Server-side `list` filters (v0.5.2): `--from` / `--to` on a date column and
 * `--min-amount` / `--max-amount` on an amount column, compiled to Dolibarr
 * `sqlfilters` so an agent can narrow a query at the source instead of pulling
 * everything and filtering locally.
 *
 * Both the date column and the amount column vary per resource, and plenty of
 * resources have neither. A flag is only offered where the column actually
 * exists — emitting a predicate on a missing field would 503 the request.
 */
export interface ResourceFilterSpec {
  /** SQL date column, used as `t.<dateColumn>`. Omitted when the resource has none. */
  dateColumn?: string;
  /** SQL amount column, used as `t.<amountColumn>`. Omitted when the resource has none. */
  amountColumn?: string;
  /** True when both columns were confirmed against the live reference instance. */
  verified: boolean;
}

/**
 * Keyed by command path prefix, resolved longest-first like the status specs.
 *
 * Columns marked `verified` were probed on Dolibarr 20.0.4 by issuing a real
 * sqlfilters query per candidate and keeping the ones that did not 503. The
 * unverified entries belong to permission-gated modules and follow Dolibarr's
 * table conventions; a wrong guess fails loudly rather than filtering wrongly.
 */
export const RESOURCE_FILTERS: Record<string, ResourceFilterSpec> = {
  // ---- verified live ----
  invoices: { dateColumn: "datef", amountColumn: "total_ttc", verified: true },
  "supplier-invoices": { dateColumn: "datef", amountColumn: "total_ttc", verified: true },
  orders: { dateColumn: "date_commande", amountColumn: "total_ttc", verified: true },
  "supplier-orders": { dateColumn: "date_commande", amountColumn: "total_ttc", verified: true },
  proposals: { dateColumn: "datep", amountColumn: "total_ttc", verified: true },
  projects: { dateColumn: "dateo", amountColumn: "opp_amount", verified: true },
  tasks: { dateColumn: "dateo", verified: true },
  contracts: { dateColumn: "date_contrat", verified: true },
  expensereports: { dateColumn: "date_debut", amountColumn: "total_ttc", verified: true },
  thirdparties: { dateColumn: "datec", verified: true },
  contacts: { dateColumn: "datec", verified: true },
  users: { dateColumn: "datec", verified: true },

  // ---- permission-gated on the reference instance: convention-based ----
  "supplier-proposals": { dateColumn: "datec", amountColumn: "total_ttc", verified: false },
  tickets: { dateColumn: "datec", verified: false },
  interventions: { dateColumn: "datec", verified: false },
  members: { dateColumn: "datec", verified: false },
  products: { dateColumn: "datec", amountColumn: "price", verified: false },
  shipments: { dateColumn: "datec", verified: false },
  receptions: { dateColumn: "datec", verified: false },
  agenda: { dateColumn: "datep", verified: false },
};

/** Look up the filter spec for a command path, preferring the longer group key. */
export function filterSpecForPath(commandPath: string): ResourceFilterSpec | undefined {
  const parts = commandPath.split(" ");
  for (let take = Math.min(2, parts.length - 1); take >= 1; take--) {
    const spec = RESOURCE_FILTERS[parts.slice(0, take).join(" ")];
    if (spec) return spec;
  }
  return undefined;
}

/** Combine sqlfilters fragments with `and`, dropping empties. Order is preserved. */
export function combineFilters(...parts: (string | undefined | null)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return kept.map((p) => `(${p})`).join(" and ");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a `YYYY-MM-DD` input and return it unchanged.
 *
 * Deliberately strict: a silently-misparsed date on a bulk selection would pick
 * the wrong records, so anything that is not an exact calendar date is rejected.
 */
export function parseFilterDate(value: string, flag: string): string {
  if (!DATE_RE.test(value)) {
    throw new ValidationError(`${flag} must be a date in YYYY-MM-DD form, got "${value}".`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ValidationError(`${flag} is not a real calendar date: "${value}".`);
  }
  return value;
}

/**
 * The day after `value`, as `YYYY-MM-DD`.
 *
 * `--to` is documented as inclusive of the whole day it names. Expressing that
 * as `< nextDay` rather than `<= day` keeps it correct for DATETIME columns too
 * (where `<= '2026-03-31'` would mean midnight and drop that day's records), and
 * avoids putting a time — and therefore a `:` — inside an sqlfilters value.
 */
export function nextDay(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/** Validate a numeric amount bound. */
export function parseFilterAmount(value: string, flag: string): number {
  // Number("") and Number("  ") are 0, which would silently widen the filter.
  const n = value.trim() === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${flag} must be a number, got "${value}".`);
  }
  return n;
}

/**
 * Compile `--from` / `--to` / `--min-amount` / `--max-amount` into an sqlfilters
 * fragment for `spec`, or undefined when none were supplied.
 *
 * @throws ValidationError when a flag was supplied for a column this resource
 * does not have, or when a bound is malformed or inverted.
 */
export function buildListFilters(
  opts: Record<string, unknown>,
  spec: ResourceFilterSpec | undefined,
): string | undefined {
  const parts: string[] = [];

  const from = opts.from as string | undefined;
  const to = opts.to as string | undefined;
  const min = opts.minAmount as string | undefined;
  const max = opts.maxAmount as string | undefined;

  if ((from !== undefined || to !== undefined) && !spec?.dateColumn) {
    throw new ValidationError("This resource has no date column, so --from/--to do not apply.");
  }
  if ((min !== undefined || max !== undefined) && !spec?.amountColumn) {
    throw new ValidationError(
      "This resource has no amount column, so --min-amount/--max-amount do not apply.",
    );
  }

  if (from !== undefined) {
    parts.push(`(t.${spec!.dateColumn}:>=:'${parseFilterDate(from, "--from")}')`);
  }
  if (to !== undefined) {
    const day = parseFilterDate(to, "--to");
    if (from !== undefined && day < from) {
      throw new ValidationError(`--to (${day}) is before --from (${from}).`);
    }
    // Inclusive of the whole --to day; see nextDay().
    parts.push(`(t.${spec!.dateColumn}:<:'${nextDay(day)}')`);
  }
  if (min !== undefined) {
    parts.push(`(t.${spec!.amountColumn}:>=:${parseFilterAmount(min, "--min-amount")})`);
  }
  if (max !== undefined) {
    const hi = parseFilterAmount(max, "--max-amount");
    if (min !== undefined && hi < parseFilterAmount(min, "--min-amount")) {
      throw new ValidationError(`--max-amount (${hi}) is below --min-amount (${min}).`);
    }
    parts.push(`(t.${spec!.amountColumn}:<=:${hi})`);
  }

  return parts.length > 0 ? parts.join(" and ") : undefined;
}

/** True when any of the v0.5.2 filter flags was supplied. */
export function hasListFilterOpts(opts: Record<string, unknown>): boolean {
  return (
    opts.from !== undefined ||
    opts.to !== undefined ||
    opts.minAmount !== undefined ||
    opts.maxAmount !== undefined
  );
}

/**
 * Which of the filter dimensions a command may safely take on.
 *
 * A command that already owns `--from`/`--to` means something else by them —
 * `bank transfer --from <account> --to <account>` is the live example — so the
 * date filters are dropped for it rather than shadowing an existing flag and
 * silently reinterpreting an account id as a date. Same for `--min-amount`.
 */
export function availableDimensions(
  cmd: Command,
  spec: ResourceFilterSpec,
): { date: boolean; amount: boolean } {
  const longs = cmd.options.map((o) => o.long);
  return {
    date: Boolean(spec.dateColumn) && !longs.includes("--from") && !longs.includes("--to"),
    amount:
      Boolean(spec.amountColumn) &&
      !longs.includes("--min-amount") &&
      !longs.includes("--max-amount"),
  };
}

/** Register the date/amount flags a resource can actually support. */
export function addFilterOptions(cmd: Command, spec: ResourceFilterSpec): void {
  const can = availableDimensions(cmd, spec);
  if (can.date) {
    cmd.option("--from <date>", "Only records on/after YYYY-MM-DD");
    cmd.option("--to <date>", "Only records on/before YYYY-MM-DD");
  }
  if (can.amount) {
    cmd.option("--min-amount <n>", "Minimum amount");
    cmd.option("--max-amount <n>", "Maximum amount");
  }
}

/**
 * True when a command participates in server-side filtering.
 *
 * `--filter` is the structural signal: commands built with `addListOptions`
 * (the real list endpoints) and the status-scoped mutations from v0.5.1 have it,
 * while sub-resource listings built with `addGetOptions` — which hit a different
 * endpoint whose columns these specs do not describe — do not.
 */
export function isFilterable(cmd: Command): boolean {
  return cmd.commands.length === 0 && cmd.options.some((o) => o.long === "--filter");
}

/**
 * Wire `--from` / `--to` / `--min-amount` / `--max-amount` into every filterable
 * command, from one call in `cli.ts`.
 *
 * The compiled predicate is folded into the command's own `--filter` value
 * before its action runs, so `buildListQuery` — and v0.5.1's status selection —
 * pick it up with no change to either.
 *
 * Returns the wired paths for the reach test.
 */
export function enableListFilters(program: Command): string[] {
  const wired: string[] = [];

  for (const { path, cmd } of walkLeaves(program)) {
    if (!isFilterable(cmd)) continue;
    const spec = filterSpecForPath(path);
    if (!spec || (!spec.dateColumn && !spec.amountColumn)) continue;
    // Nothing left to offer once pre-existing flags are respected.
    const can = availableDimensions(cmd, spec);
    if (!can.date && !can.amount) continue;
    // Only compile the dimensions this command actually took on.
    const effective: ResourceFilterSpec = {
      dateColumn: can.date ? spec.dateColumn : undefined,
      amountColumn: can.amount ? spec.amountColumn : undefined,
      verified: spec.verified,
    };

    const internal = cmd as unknown as {
      _actionHandler: ((args: unknown[]) => unknown) | null;
      __filtersWired?: boolean;
    };
    const original = internal._actionHandler;
    if (typeof original !== "function" || internal.__filtersWired) continue;
    internal.__filtersWired = true;

    addFilterOptions(cmd, spec);

    internal._actionHandler = async (args: unknown[]) => {
      const opts = cmd.opts() as Record<string, unknown>;
      try {
        // Read only the dimensions this command actually took on, so a
        // pre-existing --from belonging to another feature is left alone
        // rather than being parsed as a date.
        const extra = buildListFilters(
          {
            from: can.date ? opts.from : undefined,
            to: can.date ? opts.to : undefined,
            minAmount: can.amount ? opts.minAmount : undefined,
            maxAmount: can.amount ? opts.maxAmount : undefined,
          },
          effective,
        );
        if (extra) {
          cmd.setOptionValue("filter", combineFilters(opts.filter as string | undefined, extra));
        }
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NonInteractiveError) {
          const json = Boolean(opts.json || opts.output === "json");
          if (json) printJson({ status: "error", code: err.name, message: err.message });
          else printError(err.message);
          return process.exit(3);
        }
        return exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
      return original(args);
    };

    wired.push(path);
  }

  return wired;
}
