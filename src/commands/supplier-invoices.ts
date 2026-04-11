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

export function createSupplierInvoicesCommand(): Command {
  const cmd = new Command("supplier-invoices").description("Manage supplier invoices");

  cmd
    .command("list")
    .description("List supplier invoices")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .option("--status <n>", "Filter by status")
    .option("--thirdparty <id>", "Filter by supplier ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("supplierinvoices", {
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
          String(i.ref_supplier ?? ""),
          String(i.socid ?? ""),
          String(i.total_ttc ?? ""),
          STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
        ]);
        printTable(rows, ["ID", "Ref", "Supplier Ref", "Supplier", "Total TTC", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get supplier invoice details")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`supplierinvoices/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Ref", String(item.ref ?? "")],
          ["Supplier Ref", String(item.ref_supplier ?? "")],
          ["Supplier ID", String(item.socid ?? "")],
          ["Date", item.date ? new Date(Number(item.date) * 1000).toISOString().split("T")[0] : ""],
          ["Total HT", String(item.total_ht ?? "")],
          ["Total TTC", String(item.total_ttc ?? "")],
          ["Status", STATUS_MAP[String(item.status)] ?? String(item.status ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
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

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "supplier-invoices.create", body });
          return;
        }
        const result = await client.post<number>("supplierinvoices", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created supplier invoice with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a supplier invoice")
    .argument("<id>", "Invoice ID")
    .option("--json", "Output as JSON")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .option("--ref-supplier <ref>", "Supplier reference number")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.notePublic) body.note_public = opts.notePublic;
        if (opts.notePrivate) body.note_private = opts.notePrivate;
        if (opts.refSupplier) body.ref_supplier = opts.refSupplier;

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "supplier-invoices.update", id, body });
          return;
        }
        const result = await client.put<unknown>(`supplierinvoices/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a supplier invoice")
    .argument("<id>", "Invoice ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete supplier invoice ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "supplier-invoices.delete", id });
          return;
        }
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
        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "supplier-invoices.validate", id });
          return;
        }
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
    .requiredOption("--payment-type <id>", "Payment mode ID")
    .option("--amount <n>", "Payment amount")
    .option("--bank-account <id>", "Bank account ID")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          datepaye: opts.date,
          paymentid: Number(opts.paymentType),
        };
        if (opts.amount) body.amount = Number(opts.amount);
        if (opts.bankAccount) body.accountid = Number(opts.bankAccount);

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "supplier-invoices.pay", id, body });
          return;
        }
        const client = createClient();
        const result = await client.post<unknown>(`supplierinvoices/${id}/payments`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Payment registered on supplier invoice ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
