import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
import { exitWithError, ValidationError } from "../core/errors.js";
import { toEpochSeconds } from "../core/dates.js";
import { resolvePaymentTypeId } from "../core/payment-types.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  confirmOrCancel,
  dryRunJson,
  echoState,
  prunePayload,
  renderGet,
  renderList,
  resolveOutput,
  type ColumnSpec,
} from "../core/resource-helpers.js";

/**
 * Print a human confirmation line, but stay silent in JSON mode so the echoed
 * state remains parseable.
 */
const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

/**
 * Expense-report statuses per Dolibarr's ExpenseReport class. Note the gaps —
 * these are the real constant values, not a 0..n sequence.
 */
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "2": "Validated",
  "4": "Cancelled",
  "5": "Approved",
  "6": "Paid",
  "99": "Refused",
};

/** Human status names accepted by `set-status --status`, mapped to the numeric code. */
export const STATUS_CODES: Record<string, number> = {
  draft: 0,
  validated: 2,
  cancelled: 4,
  canceled: 4,
  approved: 5,
  paid: 6,
  refused: 99,
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const statusLabel = (i: Record<string, unknown>): string => {
  const s = i.status ?? i.fk_statut ?? i.statut;
  return STATUS_MAP[String(s)] ?? String(s ?? "");
};

export const expenseReportListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "fk_user_author", label: "Author" },
  { key: "date_debut", label: "From", format: (i) => tsToDate(i.date_debut) },
  { key: "date_fin", label: "To", format: (i) => tsToDate(i.date_fin) },
  { key: "total_ttc", label: "Total TTC" },
  { key: "status", label: "Status", format: statusLabel },
];

export const expenseReportDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "fk_user_author", label: "Author user ID" },
  { key: "user_author_infos", label: "Author" },
  { key: "fk_user_validator", label: "Validator user ID" },
  { key: "user_validator_infos", label: "Validator" },
  { key: "date_debut", label: "Period from", format: (i) => tsToDate(i.date_debut) },
  { key: "date_fin", label: "Period to", format: (i) => tsToDate(i.date_fin) },
  { key: "total_ht", label: "Total HT" },
  { key: "total_tva", label: "Total VAT" },
  { key: "total_ttc", label: "Total TTC" },
  { key: "paid", label: "Paid" },
  { key: "date_valid", label: "Validated", format: (i) => tsToDate(i.date_valid) },
  { key: "date_approve", label: "Approved", format: (i) => tsToDate(i.date_approve) },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "status", label: "Status", format: statusLabel },
];

export const expenseReportPaymentColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  {
    key: "fk_expensereport",
    label: "Report",
    format: (i) => String(i.fk_expensereport ?? i.fk_expense_report ?? ""),
  },
  { key: "datep", label: "Date", format: (i) => tsToDate(i.datep ?? i.datepaid) },
  { key: "amount", label: "Amount" },
  { key: "fk_typepayment", label: "Type" },
  { key: "num_payment", label: "Num" },
];

/** Build the POST body for `expensereports create`. Live-verified on Dolibarr 20.0.4. */
export function buildExpenseReportCreateBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    fk_user_author: Number(opts.user),
    fk_user_validator: opts.validator === undefined ? undefined : Number(opts.validator),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
  if (opts.dateStart !== undefined) body.date_debut = toEpochSeconds(opts.dateStart as string);
  if (opts.dateEnd !== undefined) body.date_fin = toEpochSeconds(opts.dateEnd as string);
  return body;
}

/**
 * Build the PUT body for `expensereports update` — only flags actually passed become
 * part of the body.
 *
 * Only the fields verified to persist on Dolibarr 20.0.4 are exposed. `ref_ext` is
 * deliberately absent: the API echoes it back on the PUT response but it does not
 * persist (a re-GET still reports null).
 */
export function buildExpenseReportUpdateBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    fk_user_validator: opts.validator === undefined ? undefined : Number(opts.validator),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
  if (opts.dateStart !== undefined) body.date_debut = toEpochSeconds(opts.dateStart as string);
  if (opts.dateEnd !== undefined) body.date_fin = toEpochSeconds(opts.dateEnd as string);
  return body;
}

/**
 * Resolve a `--status` value (numeric code or human name) to the numeric code
 * Dolibarr's `fk_statut` field expects.
 */
export function resolveStatusCode(input: string): number {
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!(String(n) in STATUS_MAP)) {
      throw new ValidationError(
        `Unknown status code ${trimmed}. Known codes: ${Object.keys(STATUS_MAP).join(", ")}.`,
      );
    }
    return n;
  }
  const code = STATUS_CODES[trimmed.toLowerCase()];
  if (code === undefined) {
    throw new ValidationError(
      `Unknown status "${input}". Use one of: ${Object.keys(STATUS_CODES).join(", ")} — or a numeric code.`,
    );
  }
  return code;
}

/** Build the POST body for `expensereports payments add`. */
export function buildExpenseReportPaymentBody(
  id: string,
  opts: Record<string, unknown>,
  paymentTypeId: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    fk_typepayment: paymentTypeId,
    datepaid: toEpochSeconds(opts.date as string),
    // Dolibarr's PaymentExpenseReport iterates `amounts` as a map keyed by report id.
    amounts: { [String(Number(id))]: Number(opts.amount) },
  };
  if (opts.account !== undefined) body.accountid = Number(opts.account);
  if (opts.num !== undefined) body.num_payment = opts.num;
  if (opts.notePublic !== undefined) body.note_public = opts.notePublic;
  return body;
}

export function createExpenseReportsCommand(): Command {
  const cmd = new Command("expensereports").description(
    "Manage expense reports and their payments",
  );

  addListOptions(cmd.command("list").description("List expense reports"))
    .option("--user <ids>", "Filter by author user ID(s), comma-separated")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "expensereports",
          buildListQuery(opts, { user_ids: opts.user }),
        );
        renderList(items, { opts, columns: expenseReportListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get expense report details")
      .argument("<id>", "Expense report ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`expensereports/${id}`);
      renderGet(item, { opts, fields: expenseReportDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(cmd.command("create").description("Create an expense report"))
    .option("--from-json <file>", "Create from a JSON file")
    .option("--user <id>", "Author user ID (required)")
    .option("--date-start <date>", "Period start (YYYY-MM-DD or epoch)")
    .option("--date-end <date>", "Period end (YYYY-MM-DD or epoch)")
    .option("--validator <id>", "Validator user ID")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .addHelpText(
      "after",
      "\nDolibarr rejects a create without a usable period, so pass --date-start and" +
        "\n--date-end together with --user.",
    )
    .action(async (opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.user) {
            printInfo("Error: --user is required (or use --from-json)");
            process.exit(1);
          }
          body = buildExpenseReportCreateBody(opts);
        }
        if (dryRunJson("expensereports.create", { body })) return;
        const client = createClient();
        const id = await client.post<number>("expensereports", body);
        announce(opts, `Created expense report with ID: ${id}`);
        await echoState(client, `expensereports/${id}`, opts, expenseReportDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("update")
      .description("Update an expense report (only the flags you pass are sent)")
      .argument("<id>", "Expense report ID"),
  )
    .option("--date-start <date>", "Period start (YYYY-MM-DD or epoch)")
    .option("--date-end <date>", "Period end (YYYY-MM-DD or epoch)")
    .option("--validator <id>", "Validator user ID")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .addHelpText(
      "after",
      "\n`ref_ext` is intentionally not exposed: Dolibarr echoes it on the PUT response" +
        "\nbut does not persist it. Use `set-status` to change the status.",
    )
    .action(async (id, opts) => {
      try {
        const body = buildExpenseReportUpdateBody(opts);
        if (Object.keys(body).length === 0) {
          printInfo("Nothing to update — pass at least one field flag.");
          return;
        }
        if (dryRunJson("expensereports.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`expensereports/${id}`, body);
        announce(opts, `Updated expense report ${id}`);
        await echoState(client, `expensereports/${id}`, opts, expenseReportDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd
    .command("delete")
    .description("Delete an expense report")
    .argument("<id>", "Expense report ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("expensereports.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete expense report ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`expensereports/${id}`);
        if (opts.json) {
          printJson({ deleted: id });
          return;
        }
        printInfo(`Deleted expense report ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  const statusHelp =
    "\n⚠️  Dolibarr exposes no /validate, /approve or /setstatus route on this resource." +
    "\nThis writes `fk_statut` through PUT /expensereports/{id}, which changes the stored" +
    "\nstatus but does NOT run Dolibarr's workflow: the draft reference is not replaced" +
    "\n(it stays `(PROVn)`), `date_valid`/`date_approve` are not stamped, and no triggers" +
    "\nfire. For a fully-processed approval use the Dolibarr web UI. Verified live on" +
    "\nDolibarr 20.0.4 — note `status` is ignored on PUT; only `fk_statut` is honored.";

  addGetOptions(
    cmd
      .command("set-status")
      .description("Set an expense report's status (writes fk_statut; see the caveat below)")
      .argument("<id>", "Expense report ID"),
  )
    .requiredOption(
      "--status <code>",
      `Status: ${Object.keys(STATUS_CODES).join("|")} or a numeric code`,
    )
    .option("--confirm", "Skip confirmation prompt")
    .addHelpText("after", statusHelp)
    .action(async (id, opts) => {
      try {
        const body = { fk_statut: resolveStatusCode(opts.status as string) };
        if (dryRunJson("expensereports.setStatus", { id, body })) return;
        if (
          !(await confirmOrCancel(
            `Set expense report ${id} status to ${opts.status} (${body.fk_statut})?`,
            opts,
          ))
        )
          return;
        const client = createClient();
        await client.put<unknown>(`expensereports/${id}`, body);
        announce(opts, `Set expense report ${id} status to ${opts.status}`);
        await echoState(client, `expensereports/${id}`, opts, expenseReportDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd.addCommand(createExpenseReportPaymentsCommand());

  cmd.addHelpText(
    "after",
    "\nNot available on Dolibarr 20.0.4 (verified by probing the router):" +
      "\n  • expense-report LINES — no /expensereports/{id}/lines route in any method." +
      "\n    Lines must be entered through the Dolibarr web UI." +
      "\n  • ref-lookup — no /expensereports/ref/{ref} route, so `get` takes a numeric ID." +
      "\n  • validate / approve — no dedicated routes; see `set-status --help`.",
  );

  return cmd;
}

/** `expensereports payments` — payment tracking against an expense report. */
function createExpenseReportPaymentsCommand(): Command {
  const grp = new Command("payments").description("List and record expense-report payments");

  addListOptions(
    grp.command("list").description("List every expense-report payment"),
  ).action(async (opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        "expensereports/payments",
        buildListQuery(opts),
      );
      renderList(items, { opts, columns: expenseReportPaymentColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp
      .command("get")
      .description("Get one expense-report payment")
      .argument("<payment-id>", "Payment ID"),
  ).action(async (pid, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`expensereports/payments/${pid}`);
      renderGet(item, { opts, fields: expenseReportPaymentColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp
      .command("add")
      .description("Record a payment against an expense report (MOVES MONEY)")
      .argument("<id>", "Expense report ID"),
  )
    .requiredOption("--amount <n>", "Amount paid")
    .requiredOption("--date <date>", "Payment date (YYYY-MM-DD or epoch)")
    .requiredOption("--payment-type <code>", "Payment type code (CB, VIR, LIQ, CHQ, …) or its id")
    .option("--account <id>", "Bank account ID to book the payment against")
    .option("--num <ref>", "Payment reference / cheque number")
    .option("--note-public <text>", "Public note")
    .option("--from-json <file>", "Send a raw JSON body instead of building one")
    .option("--confirm", "Skip confirmation prompt")
    .addHelpText(
      "after",
      "\n⚠️  This records a real payment and books a bank entry. It is guarded:" +
        "\npreview with --dry-run, and a confirmation (or --confirm) is required." +
        "\nThe route and its required fields (fk_typepayment, datepaid, amounts) were" +
        "\nconfirmed live, but a completed payment could NOT be exercised end-to-end on" +
        "\nthe reference instance — Dolibarr only accepts one against an approved report." +
        "\nUse --from-json if your instance expects a different `amounts` shape.",
    )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body = opts.fromJson
          ? (JSON.parse(fs.readFileSync(opts.fromJson, "utf-8")) as Record<string, unknown>)
          : buildExpenseReportPaymentBody(
              id,
              opts,
              await resolvePaymentTypeId(client, opts.paymentType as string),
            );
        if (dryRunJson("expensereports.payments.add", { id, body })) return;
        if (
          !(await confirmOrCancel(
            `Record a payment of ${opts.amount} against expense report ${id}? This moves money.`,
            opts,
          ))
        )
          return;
        const result = await client.post<number>(`expensereports/${id}/payments`, body);
        announce(opts, `Recorded payment ${result} on expense report ${id}`);
        await echoState(client, `expensereports/${id}`, opts, expenseReportDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  grp
    .command("update")
    .description("Update the payment recorded on an expense report")
    .argument("<id>", "Expense report ID")
    .option("--date <date>", "Payment date (YYYY-MM-DD or epoch)")
    .option("--num <ref>", "Payment reference / cheque number")
    .option("--note-public <text>", "Public note")
    .option("--from-json <file>", "Send a raw JSON body instead of building one")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = opts.fromJson
          ? (JSON.parse(fs.readFileSync(opts.fromJson, "utf-8")) as Record<string, unknown>)
          : prunePayload({
              num_payment: opts.num,
              note_public: opts.notePublic,
              datepaid: opts.date === undefined ? undefined : toEpochSeconds(opts.date as string),
            });
        if (dryRunJson("expensereports.payments.update", { id, body })) return;
        const client = createClient();
        const result = await client.put<unknown>(`expensereports/${id}/payments`, body);
        if (opts.json) {
          printJson(result);
          return;
        }
        printInfo(`Updated the payment on expense report ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  return grp;
}
