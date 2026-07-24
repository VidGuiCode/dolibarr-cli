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

/**
 * Build the POST/PUT body for a supplier-invoice line. Supplier-invoice lines use
 * `pu_ht` for the unit price (NOT `subprice`, which is silently ignored on this
 * endpoint — verified live vs Dolibarr 20.0.4) and require an integer `product_type`.
 */
export function buildSupplierInvoiceLineBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.desc !== undefined) body.desc = opts.desc;
  if (opts.subprice !== undefined) body.pu_ht = Number(opts.subprice);
  if (opts.qty !== undefined) body.qty = Number(opts.qty);
  if (opts.tvaTx !== undefined) body.tva_tx = Number(opts.tvaTx);
  if (opts.productId !== undefined) body.fk_product = Number(opts.productId);
  if (opts.remise !== undefined) body.remise_percent = Number(opts.remise);
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
    .option("--close", "Mark fully-paid invoices as paid (closepaidinvoices=yes)")
    .option("--bank-account <id>", "Bank account ID")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        // The supplier-invoice payments endpoint expects `payment_mode_id`
        // (the customer-invoice endpoint uses `paymentid`).
        const body: Record<string, unknown> = {
          datepaye: toEpochSeconds(opts.date),
          payment_mode_id: await resolvePaymentTypeId(client, opts.paymentType),
          closepaidinvoices: opts.close ? "yes" : "no",
        };
        if (opts.amount) body.amount = Number(opts.amount);
        if (opts.bankAccount) body.accountid = Number(opts.bankAccount);

        if (dryRunJson("supplier-invoices.pay", { id, body })) return;
        const result = await client.post<unknown>(`supplierinvoices/${id}/payments`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Payment registered on supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("list-lines")
      .description("List lines of a supplier invoice")
      .argument("<id>", "Invoice ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const lines = await client.get<Record<string, unknown>[]>(`supplierinvoices/${id}/lines`);
        renderList(lines, {
          opts,
          columns: [
            { key: "id", label: "Line ID" },
            {
              key: "desc",
              label: "Description",
              format: (l) => String(l.desc ?? l.description ?? "").substring(0, 40),
            },
            { key: "qty", label: "Qty" },
            { key: "pu_ht", label: "Unit Price", format: (l) => String(l.pu_ht ?? l.subprice ?? "") },
            { key: "tva_tx", label: "VAT %" },
            { key: "total_ht", label: "Total HT" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("add-line")
    .description("Add a line to a supplier invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .requiredOption("--desc <text>", "Line description")
    .requiredOption("--subprice <n>", "Unit price excl. tax (maps to pu_ht)")
    .requiredOption("--qty <n>", "Quantity")
    .requiredOption("--tva-tx <n>", "VAT rate (e.g., 20)")
    .option("--product-id <id>", "Product ID")
    .option("--product-type <n>", "0=product, 1=service", "0")
    .action(async (id, opts) => {
      try {
        const body = buildSupplierInvoiceLineBody(opts);
        body.product_type = Number(opts.productType ?? 0);
        if (dryRunJson("supplier-invoices.addLine", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`supplierinvoices/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update-line")
    .description("Edit a line on a draft supplier invoice (recomputes totals)")
    .argument("<id>", "Invoice ID")
    .argument("<lineid>", "Line ID")
    .option("--json", "Output as JSON")
    .option("--desc <text>", "Line description")
    .option("--subprice <n>", "Unit price excl. tax (maps to pu_ht)")
    .option("--qty <n>", "Quantity")
    .option("--tva-tx <n>", "VAT rate (e.g., 20)")
    .option("--product-id <id>", "Product ID")
    .option("--remise <n>", "Discount percentage")
    .action(async (id, lineid, opts) => {
      try {
        const body = buildSupplierInvoiceLineBody(opts);
        if (dryRunJson("supplier-invoices.updateLine", { id, lineid, body })) return;
        const client = createClient();
        await client.put<unknown>(`supplierinvoices/${id}/lines/${lineid}`, body);
        if (opts.json) {
          printJson(await client.get(`supplierinvoices/${id}/lines`));
          return;
        }
        printInfo(`Updated line ${lineid} on supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete-line")
    .description("Delete a line from a draft supplier invoice (recomputes totals)")
    .argument("<id>", "Invoice ID")
    .argument("<lineid>", "Line ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, lineid, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete line ${lineid} from supplier invoice ${id}?`, opts)))
          return;
        if (dryRunJson("supplier-invoices.deleteLine", { id, lineid })) return;
        const client = createClient();
        await client.delete(`supplierinvoices/${id}/lines/${lineid}`);
        if (opts.json) { printJson({ deleted: lineid }); return; }
        printInfo(`Deleted line ${lineid} from supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
