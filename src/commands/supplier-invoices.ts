import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  confirmOrCancel,
  dryRunJson,
  echoState,
  renderGet,
  renderList,
  type ColumnSpec,
} from "../core/resource-helpers.js";
import { resolvePaymentTypeId } from "../core/payment-types.js";
import { toEpochSeconds } from "../core/dates.js";

const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Paid",
  "3": "Abandoned",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

/** Detail-view fields shared by `get` and the `update` state echo. */
export const supplierInvoiceDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "ref_supplier", label: "Supplier Ref" },
  { key: "socid", label: "Supplier ID" },
  { key: "date", label: "Date", format: (i) => tsToDate(i.date) },
  { key: "date_echeance", label: "Due date", format: (i) => tsToDate(i.date_echeance) },
  { key: "cond_reglement_id", label: "Payment terms ID" },
  { key: "mode_reglement_id", label: "Payment mode ID" },
  { key: "total_ht", label: "Total HT" },
  { key: "total_ttc", label: "Total TTC" },
  {
    key: "status",
    label: "Status",
    format: (i) => STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
  },
];

/**
 * Build the PUT body for `supplier-invoices update`. Only passed flags become keys.
 * Fields limited to those a Dolibarr header PUT genuinely persists (verified live
 * against Dolibarr 20.0.4). Amount/total is deliberately NOT editable here (writing
 * it directly desyncs the recomputed totals).
 */
export function buildSupplierInvoiceUpdateBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.date !== undefined) body.date = toEpochSeconds(opts.date as string);
  if (opts.dueDate !== undefined) body.date_echeance = toEpochSeconds(opts.dueDate as string);
  if (opts.socid !== undefined) body.socid = Number(opts.socid);
  if (opts.refSupplier !== undefined) body.ref_supplier = opts.refSupplier;
  if (opts.condReglement !== undefined) body.cond_reglement_id = Number(opts.condReglement);
  if (opts.modeReglement !== undefined) body.mode_reglement_id = Number(opts.modeReglement);
  if (opts.project !== undefined) body.fk_project = Number(opts.project);
  if (opts.notePublic !== undefined) body.note_public = opts.notePublic;
  if (opts.notePrivate !== undefined) body.note_private = opts.notePrivate;
  return body;
}

export function createSupplierInvoicesCommand(): Command {
  const cmd = new Command("supplier-invoices").description("Manage supplier invoices");

  addListOptions(
    cmd
      .command("list")
      .description("List supplier invoices"),
  )
    .option("--status <n>", "Filter by status")
    .option("--thirdparty <id>", "Filter by supplier ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "supplierinvoices",
          buildListQuery(opts, {
            status: opts.status,
            thirdparty_ids: opts.thirdparty,
          }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "ref_supplier", label: "Supplier Ref" },
            { key: "socid", label: "Supplier" },
            { key: "total_ttc", label: "Total TTC" },
            {
              key: "status",
              label: "Status",
              format: (i) => STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get supplier invoice details")
      .argument("<id>", "Invoice ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`supplierinvoices/${id}`);
        renderGet(item, { opts, fields: supplierInvoiceDetailFields });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create")
    .description("Create a supplier invoice")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Supplier thirdparty ID (required)")
    .option("--ref-supplier <ref>", "Supplier reference number")
    .option("--date <date>", "Invoice date (YYYY-MM-DD)")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;

        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.socid) {
            printInfo("Error: --socid is required");
            process.exit(1);
          }
          body = { socid: Number(opts.socid) };
          if (opts.refSupplier) body.ref_supplier = opts.refSupplier;
          if (opts.date) body.date = Math.floor(new Date(opts.date).getTime() / 1000);
          if (opts.notePublic) body.note_public = opts.notePublic;
          if (opts.notePrivate) body.note_private = opts.notePrivate;
        }

        if (dryRunJson("supplier-invoices.create", { body })) return;
        const result = await client.post<number>("supplierinvoices", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created supplier invoice with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("update")
      .description("Update a supplier invoice (date, supplier, ref, terms, notes)")
      .argument("<id>", "Invoice ID"),
  )
    .option("--date <date>", "Invoice date (YYYY-MM-DD or epoch)")
    .option("--due-date <date>", "Due date (YYYY-MM-DD or epoch)")
    .option("--socid <id>", "Supplier thirdparty ID")
    .option("--ref-supplier <ref>", "Supplier reference number")
    .option("--cond-reglement <id>", "Payment terms ID")
    .option("--mode-reglement <id>", "Payment mode ID")
    .option("--project <id>", "Project ID")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const body = buildSupplierInvoiceUpdateBody(opts);
        if (dryRunJson("supplier-invoices.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`supplierinvoices/${id}`, body);
        await echoState(client, `supplierinvoices/${id}`, opts, supplierInvoiceDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("delete")
    .description("Delete a supplier invoice")
    .argument("<id>", "Invoice ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete supplier invoice ${id}?`, opts))) return;
        if (dryRunJson("supplier-invoices.delete", { id })) return;
        const client = createClient();
        await client.delete(`supplierinvoices/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft supplier invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("supplier-invoices.validate", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`supplierinvoices/${id}/validate`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("pay")
    .description("Register a payment on a supplier invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .requiredOption("--date <date>", "Payment date (YYYY-MM-DD)")
    .requiredOption(
      "--payment-type <id-or-code>",
      "Payment mode: numeric dictionary id or code (CB, VIR, LIQ, CHQ, ...)",
    )
    .option("--amount <n>", "Payment amount")
    .option("--bank-account <id>", "Bank account ID")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {
          datepaye: opts.date,
          paymentid: await resolvePaymentTypeId(client, opts.paymentType),
        };
        if (opts.amount) body.amount = Number(opts.amount);
        if (opts.bankAccount) body.accountid = Number(opts.bankAccount);

        if (dryRunJson("supplier-invoices.pay", { id, body })) return;
        const result = await client.post<unknown>(`supplierinvoices/${id}/payments`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Payment registered on supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
