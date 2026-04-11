import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Paid",
  "3": "Abandoned",
};

export function createInvoicesCommand(): Command {
  const cmd = new Command("invoices").description("Manage customer invoices");

  cmd
    .command("list")
    .description("List customer invoices")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .option("--status <n>", "Filter by status (0=draft, 1=validated, 2=paid, 3=abandoned)")
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("invoices", {
          limit: opts.limit,
          page: opts.page,
          sortfield: opts.sort ? `t.${opts.sort}` : undefined,
          sortorder: opts.order,
          sqlfilters: opts.filter,
          status: opts.status,
          thirdparty_ids: opts.thirdparty,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.ref ?? ""),
          String(i.socid ?? ""),
          String(i.total_ht ?? ""),
          String(i.total_ttc ?? ""),
          STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
        ]);
        printTable(rows, ["ID", "Ref", "Thirdparty", "Total HT", "Total TTC", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get invoice details")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`invoices/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Ref", String(item.ref ?? "")],
          ["Thirdparty ID", String(item.socid ?? "")],
          ["Date", item.date ? new Date(Number(item.date) * 1000).toISOString().split("T")[0] : ""],
          ["Total HT", String(item.total_ht ?? "")],
          ["Total VAT", String(item.total_tva ?? "")],
          ["Total TTC", String(item.total_ttc ?? "")],
          ["Status", STATUS_MAP[String(item.status)] ?? String(item.status ?? "")],
          ["Note public", String(item.note_public ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
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

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "invoices.create", body });
          return;
        }

        const result = await client.post<number>("invoices", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created invoice with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a customer invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.notePublic) body.note_public = opts.notePublic;
        if (opts.notePrivate) body.note_private = opts.notePrivate;

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "invoices.update", id, body });
          return;
        }

        const result = await client.put<unknown>(`invoices/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a customer invoice")
    .argument("<id>", "Invoice ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete invoice ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "invoices.delete", id });
          return;
        }
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
        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "invoices.validate", id });
          return;
        }
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
    .requiredOption("--payment-type <id>", "Payment mode ID")
    .option("--amount <n>", "Payment amount")
    .option("--close-code <code>", "Close code")
    .option("--close-note <note>", "Close note")
    .option("--bank-account <id>", "Bank account ID")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          datepaye: opts.date,
          paymentid: Number(opts.paymentType),
        };
        if (opts.amount) body.amount = Number(opts.amount);
        if (opts.closeCode) body.close_code = opts.closeCode;
        if (opts.closeNote) body.close_note = opts.closeNote;
        if (opts.bankAccount) body.accountid = Number(opts.bankAccount);

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "invoices.pay", id, body });
          return;
        }
        const client = createClient();
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

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "invoices.addLine", id, body });
          return;
        }
        const client = createClient();
        const result = await client.post<unknown>(`invoices/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("list-lines")
    .description("List lines of an invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const lines = await client.get<Record<string, unknown>[]>(`invoices/${id}/lines`);
        if (opts.json) { printJson(lines); return; }
        const rows = lines.map((l) => [
          String(l.id ?? ""),
          String(l.desc ?? l.description ?? "").substring(0, 40),
          String(l.qty ?? ""),
          String(l.subprice ?? ""),
          String(l.tva_tx ?? ""),
          String(l.total_ttc ?? ""),
        ]);
        printTable(rows, ["Line ID", "Description", "Qty", "Unit Price", "VAT %", "Total TTC"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
