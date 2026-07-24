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
import { toEpochSeconds } from "../core/dates.js";

const STATUS_MAP: Record<string, string> = {
  "-1": "Canceled",
  "0": "Draft",
  "1": "Validated",
  "2": "Shipment started",
  "3": "Delivered",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

/** Detail-view fields shared by `get` and the `update` state echo. */
export const orderDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "socid", label: "Thirdparty ID" },
  { key: "date", label: "Date", format: (i) => tsToDate(i.date ?? i.date_commande) },
  {
    key: "delivery_date",
    label: "Delivery date",
    format: (i) => tsToDate(i.delivery_date ?? i.date_livraison),
  },
  { key: "cond_reglement_id", label: "Payment terms ID" },
  { key: "mode_reglement_id", label: "Payment mode ID" },
  { key: "ref_client", label: "Customer ref" },
  { key: "total_ht", label: "Total HT" },
  { key: "total_ttc", label: "Total TTC" },
  {
    key: "status",
    label: "Status",
    format: (i) => STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
  },
];

/**
 * Build the PUT body for `orders update`. Only passed flags become keys. Field
 * names match what a Dolibarr order (commande) header PUT actually persists
 * (verified live against Dolibarr 20.0.4): the order date is `date_commande`
 * (the `date` key is ignored on PUT) and the delivery date is `delivery_date`
 * (not `date_livraison`). Amount is not editable here — change it via order lines.
 */
export function buildOrderUpdateBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.date !== undefined) body.date_commande = toEpochSeconds(opts.date as string);
  if (opts.deliveryDate !== undefined)
    body.delivery_date = toEpochSeconds(opts.deliveryDate as string);
  if (opts.socid !== undefined) body.socid = Number(opts.socid);
  if (opts.condReglement !== undefined) body.cond_reglement_id = Number(opts.condReglement);
  if (opts.modeReglement !== undefined) body.mode_reglement_id = Number(opts.modeReglement);
  if (opts.refClient !== undefined) body.ref_client = opts.refClient;
  if (opts.project !== undefined) body.fk_project = Number(opts.project);
  if (opts.notePublic !== undefined) body.note_public = opts.notePublic;
  if (opts.notePrivate !== undefined) body.note_private = opts.notePrivate;
  return body;
}

export function createOrdersCommand(): Command {
  const cmd = new Command("orders").description("Manage customer orders");

  addListOptions(
    cmd
      .command("list")
      .description("List customer orders"),
  )
    .option("--status <n>", "Filter by status")
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "orders",
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
      .description("Get order details (accepts numeric id or ref)")
      .argument("<id-or-ref>", "Order ID or ref"),
  )
    .action(async (idOrRef, opts) => {
      try {
        const client = createClient();
        const item = await client.getByRefOrId<Record<string, unknown>>("orders", idOrRef);
        renderGet(item, { opts, fields: orderDetailFields });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
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
        if (dryRunJson("orders.create", { body })) return;
        const result = await client.post<number>("orders", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created order with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("update")
      .description("Update a customer order (date, thirdparty, delivery, terms, notes)")
      .argument("<id>", "Order ID"),
  )
    .option("--date <date>", "Order date (YYYY-MM-DD or epoch)")
    .option("--delivery-date <date>", "Delivery date (YYYY-MM-DD or epoch)")
    .option("--socid <id>", "Thirdparty ID")
    .option("--cond-reglement <id>", "Payment terms ID")
    .option("--mode-reglement <id>", "Payment mode ID")
    .option("--ref-client <ref>", "Customer reference")
    .option("--project <id>", "Project ID")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const body = buildOrderUpdateBody(opts);
        if (dryRunJson("orders.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`orders/${id}`, body);
        await echoState(client, `orders/${id}`, opts, orderDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("delete")
    .description("Delete a customer order")
    .argument("<id>", "Order ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete order ${id}?`, opts))) return;
        if (dryRunJson("orders.delete", { id })) return;
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
        if (dryRunJson("orders.validate", { id })) return;
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
        if (dryRunJson("orders.close", { id })) return;
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
        if (dryRunJson("orders.addLine", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`orders/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
