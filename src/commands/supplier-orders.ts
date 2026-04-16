import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import {
  addListOptions,
  buildListQuery,
  confirmOrCancel,
  dryRunJson,
} from "../core/resource-helpers.js";

const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Approved",
  "3": "Ordered",
  "4": "Partially received",
  "5": "Received",
  "6": "Canceled",
  "9": "Refused",
};

export function createSupplierOrdersCommand(): Command {
  const cmd = new Command("supplier-orders").description("Manage supplier orders");

  addListOptions(
    cmd
      .command("list")
      .description("List supplier orders"),
  )
    .option("--status <n>", "Filter by status")
    .option("--thirdparty <id>", "Filter by supplier ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "supplier_orders",
          buildListQuery(opts, {
            status: opts.status,
            thirdparty_ids: opts.thirdparty,
          }),
        );
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.ref ?? ""),
          String(i.socid ?? ""),
          String(i.total_ttc ?? ""),
          STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
        ]);
        printTable(rows, ["ID", "Ref", "Supplier", "Total TTC", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get supplier order details")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`supplier_orders/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Ref", String(item.ref ?? "")],
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
    .description("Create a supplier order")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Supplier thirdparty ID (required)")
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
        if (dryRunJson("supplier-orders.create", { body })) return;
        const result = await client.post<number>("supplier_orders", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created supplier order with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a supplier order")
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
        if (dryRunJson("supplier-orders.update", { id, body })) return;
        const result = await client.put<unknown>(`supplier_orders/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated supplier order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a supplier order")
    .argument("<id>", "Order ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete supplier order ${id}?`, opts))) return;
        if (dryRunJson("supplier-orders.delete", { id })) return;
        const client = createClient();
        await client.delete(`supplier_orders/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted supplier order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft supplier order")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("supplier-orders.validate", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`supplier_orders/${id}/validate`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated supplier order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("approve")
    .description("Approve a supplier order")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("supplier-orders.approve", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`supplier_orders/${id}/approve`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Approved supplier order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
