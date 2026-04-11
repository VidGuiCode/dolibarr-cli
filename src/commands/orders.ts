import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

const STATUS_MAP: Record<string, string> = {
  "-1": "Canceled",
  "0": "Draft",
  "1": "Validated",
  "2": "Shipment started",
  "3": "Delivered",
};

export function createOrdersCommand(): Command {
  const cmd = new Command("orders").description("Manage customer orders");

  cmd
    .command("list")
    .description("List customer orders")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .option("--status <n>", "Filter by status")
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("orders", {
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
          String(i.total_ttc ?? ""),
          STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
        ]);
        printTable(rows, ["ID", "Ref", "Thirdparty", "Total TTC", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get order details")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`orders/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Ref", String(item.ref ?? "")],
          ["Thirdparty ID", String(item.socid ?? "")],
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
    .description("Create a customer order")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Thirdparty ID (required)")
    .option("--date <date>", "Order date (YYYY-MM-DD)")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.socid) { printInfo("Error: --socid is required"); process.exit(1); }
          body = { socid: Number(opts.socid) };
          if (opts.date) body.date = Math.floor(new Date(opts.date).getTime() / 1000);
          if (opts.notePublic) body.note_public = opts.notePublic;
          if (opts.notePrivate) body.note_private = opts.notePrivate;
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "orders.create", body }); return; }
        const result = await client.post<number>("orders", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created order with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a customer order")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.notePublic) body.note_public = opts.notePublic;
        if (opts.notePrivate) body.note_private = opts.notePrivate;
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "orders.update", id, body }); return; }
        const result = await client.put<unknown>(`orders/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a customer order")
    .argument("<id>", "Order ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete order ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "orders.delete", id }); return; }
        const client = createClient();
        await client.delete(`orders/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft order")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .option("--warehouse <id>", "Warehouse ID for stock movement")
    .action(async (id, opts) => {
      try {
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "orders.validate", id }); return; }
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.warehouse) body.idwarehouse = Number(opts.warehouse);
        const result = await client.post<unknown>(`orders/${id}/validate`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("close")
    .description("Close an order (mark as delivered)")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "orders.close", id }); return; }
        const client = createClient();
        const result = await client.post<unknown>(`orders/${id}/close`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Closed order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("add-line")
    .description("Add a line to an order")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .requiredOption("--desc <text>", "Line description")
    .requiredOption("--subprice <n>", "Unit price excl. tax")
    .requiredOption("--qty <n>", "Quantity")
    .requiredOption("--tva-tx <n>", "VAT rate (e.g., 20)")
    .option("--product-id <id>", "Product ID")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          desc: opts.desc,
          subprice: Number(opts.subprice),
          qty: Number(opts.qty),
          tva_tx: Number(opts.tvaTx),
        };
        if (opts.productId) body.fk_product = Number(opts.productId);
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "orders.addLine", id, body }); return; }
        const client = createClient();
        const result = await client.post<unknown>(`orders/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
