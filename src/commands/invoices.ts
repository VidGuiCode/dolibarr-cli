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
export const invoiceDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "socid", label: "Thirdparty ID" },
  { key: "date", label: "Date", format: (i) => tsToDate(i.date) },
  {
    key: "date_lim_reglement",
    label: "Due date",
    format: (i) => tsToDate(i.date_lim_reglement),
  },
  { key: "cond_reglement_id", label: "Payment terms ID" },
  { key: "mode_reglement_id", label: "Payment mode ID" },
  { key: "ref_client", label: "Customer ref" },
  { key: "total_ht", label: "Total HT" },
  { key: "total_tva", label: "Total VAT" },
  { key: "total_ttc", label: "Total TTC" },
  {
    key: "status",
    label: "Status",
    format: (i) => STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
  },
  { key: "note_public", label: "Note public" },
];

/**
 * Build the PUT body for `invoices update` from parsed opts. Only flags actually
 * passed become keys. Fields limited to those a Dolibarr header PUT genuinely
 * persists (verified live against Dolibarr 20.0.4) — amount/total is deliberately
 * NOT editable here because writing it directly desyncs the recomputed totals;
 * change amounts via `update-line` instead.
 */
export function buildInvoiceUpdateBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.date !== undefined) body.date = toEpochSeconds(opts.date as string);
  if (opts.dueDate !== undefined)
    body.date_lim_reglement = toEpochSeconds(opts.dueDate as string);
  if (opts.socid !== undefined) body.socid = Number(opts.socid);
  if (opts.condReglement !== undefined) body.cond_reglement_id = Number(opts.condReglement);
  if (opts.modeReglement !== undefined) body.mode_reglement_id = Number(opts.modeReglement);
  if (opts.refClient !== undefined) body.ref_client = opts.refClient;
  if (opts.refExt !== undefined) body.ref_ext = opts.refExt;
  if (opts.project !== undefined) body.fk_project = Number(opts.project);
  if (opts.notePublic !== undefined) body.note_public = opts.notePublic;
  if (opts.notePrivate !== undefined) body.note_private = opts.notePrivate;
  return body;
}

/** Build the PUT/POST body for an invoice line from parsed opts (only passed flags). */
export function buildInvoiceLineBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.desc !== undefined) body.desc = opts.desc;
  if (opts.subprice !== undefined) body.subprice = Number(opts.subprice);
  if (opts.qty !== undefined) body.qty = Number(opts.qty);
  if (opts.tvaTx !== undefined) body.tva_tx = Number(opts.tvaTx);
  if (opts.productId !== undefined) body.fk_product = Number(opts.productId);
  if (opts.remise !== undefined) body.remise_percent = Number(opts.remise);
  return body;
}

export function createInvoicesCommand(): Command {
  const cmd = new Command("invoices").description("Manage customer invoices");

  addListOptions(
    cmd
      .command("list")
      .description("List customer invoices"),
  )
    .option("--status <n>", "Filter by status (0=draft, 1=validated, 2=paid, 3=abandoned)")
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "invoices",
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
            { key: "socid", label: "Thirdparty" },
            { key: "total_ht", label: "Total HT" },
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
      .description("Get invoice details (accepts numeric id or ref, e.g. FA2501-0001)")
      .argument("<id-or-ref>", "Invoice ID or ref"),
  )
    .action(async (idOrRef, opts) => {
      try {
        const client = createClient();
        const item = await client.getByRefOrId<Record<string, unknown>>("invoices", idOrRef);
        renderGet(item, { opts, fields: invoiceDetailFields });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create")
    .description("Create a customer invoice")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Thirdparty ID (required)")
    .option("--date <date>", "Invoice date (YYYY-MM-DD)")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .option("--cond-reglement <id>", "Payment terms ID")
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
          if (opts.date) body.date = Math.floor(new Date(opts.date).getTime() / 1000);
          if (opts.notePublic) body.note_public = opts.notePublic;
          if (opts.notePrivate) body.note_private = opts.notePrivate;
          if (opts.condReglement) body.cond_reglement_id = Number(opts.condReglement);
        }

        if (dryRunJson("invoices.create", { body })) return;

        const result = await client.post<number>("invoices", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created invoice with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("update")
      .description("Update a customer invoice (date, thirdparty, terms, notes)")
      .argument("<id>", "Invoice ID"),
  )
    .option("--date <date>", "Invoice date (YYYY-MM-DD or epoch)")
    .option("--due-date <date>", "Payment due date (YYYY-MM-DD or epoch)")
    .option("--socid <id>", "Thirdparty ID")
    .option("--cond-reglement <id>", "Payment terms ID")
    .option("--mode-reglement <id>", "Payment mode ID")
    .option("--ref-client <ref>", "Customer reference")
    .option("--ref-ext <ref>", "External reference")
    .option("--project <id>", "Project ID")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const body = buildInvoiceUpdateBody(opts);
        if (dryRunJson("invoices.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`invoices/${id}`, body);
        await echoState(client, `invoices/${id}`, opts, invoiceDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("delete")
    .description("Delete a customer invoice")
    .argument("<id>", "Invoice ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete invoice ${id}?`, opts))) return;
        if (dryRunJson("invoices.delete", { id })) return;
        const client = createClient();
        await client.delete(`invoices/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .option("--force-number <ref>", "Force a specific reference number")
    .option("--warehouse <id>", "Warehouse ID for stock movement")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("invoices.validate", { id })) return;
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.forceNumber) body.force_number = opts.forceNumber;
        if (opts.warehouse) body.idwarehouse = Number(opts.warehouse);
        const result = await client.post<unknown>(`invoices/${id}/validate`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("pay")
    .description("Register a payment on an invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .requiredOption("--date <date>", "Payment date (YYYY-MM-DD)")
    .requiredOption(
      "--payment-type <id-or-code>",
      "Payment mode: numeric dictionary id or code (CB, VIR, LIQ, CHQ, ...)",
    )
    .option("--amount <n>", "Payment amount")
    .option("--close-code <code>", "Close code")
    .option("--close-note <note>", "Close note")
    .option("--bank-account <id>", "Bank account ID")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {
          datepaye: opts.date,
          paymentid: await resolvePaymentTypeId(client, opts.paymentType),
        };
        if (opts.amount) body.amount = Number(opts.amount);
        if (opts.closeCode) body.close_code = opts.closeCode;
        if (opts.closeNote) body.close_note = opts.closeNote;
        if (opts.bankAccount) body.accountid = Number(opts.bankAccount);

        if (dryRunJson("invoices.pay", { id, body })) return;
        const result = await client.post<unknown>(`invoices/${id}/payments`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Payment registered on invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("add-line")
    .description("Add a line to an invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .requiredOption("--desc <text>", "Line description")
    .requiredOption("--subprice <n>", "Unit price excl. tax")
    .requiredOption("--qty <n>", "Quantity")
    .requiredOption("--tva-tx <n>", "VAT rate (e.g., 20)")
    .option("--product-id <id>", "Product ID")
    .option("--product-type <n>", "0=product, 1=service")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          desc: opts.desc,
          subprice: Number(opts.subprice),
          qty: Number(opts.qty),
          tva_tx: Number(opts.tvaTx),
        };
        if (opts.productId) body.fk_product = Number(opts.productId);
        if (opts.productType) body.product_type = Number(opts.productType);

        if (dryRunJson("invoices.addLine", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`invoices/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update-line")
    .description("Edit a line on a draft invoice (recomputes invoice totals)")
    .argument("<id>", "Invoice ID")
    .argument("<lineid>", "Line ID")
    .option("--json", "Output as JSON")
    .option("--desc <text>", "Line description")
    .option("--subprice <n>", "Unit price excl. tax")
    .option("--qty <n>", "Quantity")
    .option("--tva-tx <n>", "VAT rate (e.g., 20)")
    .option("--product-id <id>", "Product ID")
    .option("--remise <n>", "Discount percentage")
    .action(async (id, lineid, opts) => {
      try {
        const body = buildInvoiceLineBody(opts);
        if (dryRunJson("invoices.updateLine", { id, lineid, body })) return;
        const client = createClient();
        await client.put<unknown>(`invoices/${id}/lines/${lineid}`, body);
        if (opts.json) {
          printJson(await client.get(`invoices/${id}/lines`));
          return;
        }
        printInfo(`Updated line ${lineid} on invoice ${id}`);
        await echoState(client, `invoices/${id}`, opts, invoiceDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete-line")
    .description("Delete a line from a draft invoice (recomputes invoice totals)")
    .argument("<id>", "Invoice ID")
    .argument("<lineid>", "Line ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, lineid, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete line ${lineid} from invoice ${id}?`, opts))) return;
        if (dryRunJson("invoices.deleteLine", { id, lineid })) return;
        const client = createClient();
        await client.delete(`invoices/${id}/lines/${lineid}`);
        if (opts.json) { printJson({ deleted: lineid }); return; }
        printInfo(`Deleted line ${lineid} from invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("list-lines")
      .description("List lines of an invoice")
      .argument("<id>", "Invoice ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const lines = await client.get<Record<string, unknown>[]>(`invoices/${id}/lines`);
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
            { key: "subprice", label: "Unit Price" },
            { key: "tva_tx", label: "VAT %" },
            { key: "total_ttc", label: "Total TTC" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  return cmd;
}
