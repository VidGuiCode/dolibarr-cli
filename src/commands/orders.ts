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

/** Build the PUT/POST body for an order line from parsed opts (only passed flags). */
export function buildOrderLineBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.desc !== undefined) body.desc = opts.desc;
  if (opts.subprice !== undefined) body.subprice = Number(opts.subprice);
  if (opts.qty !== undefined) body.qty = Number(opts.qty);
  if (opts.tvaTx !== undefined) body.tva_tx = Number(opts.tvaTx);
  if (opts.productId !== undefined) body.fk_product = Number(opts.productId);
  if (opts.productType !== undefined) body.product_type = Number(opts.productType);
  if (opts.remise !== undefined) body.remise_percent = Number(opts.remise);
  return body;
}

/** Contact-type codes valid for linking a contact to an order. */
export const ORDER_CONTACT_TYPES = ["BILLING", "SHIPPING", "CUSTOMER"] as const;

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
    .option("--product-type <n>", "0=product, 1=service", "0")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          desc: opts.desc,
          subprice: Number(opts.subprice),
          qty: Number(opts.qty),
          tva_tx: Number(opts.tvaTx),
          // Dolibarr's order-line insert rejects an empty product_type; default to 0.
          product_type: Number(opts.productType ?? 0),
        };
        if (opts.productId) body.fk_product = Number(opts.productId);
        if (dryRunJson("orders.addLine", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`orders/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update-line")
    .description("Edit a line on a draft order (recomputes order totals)")
    .argument("<id>", "Order ID")
    .argument("<lineid>", "Line ID")
    .option("--json", "Output as JSON")
    .option("--desc <text>", "Line description")
    .option("--subprice <n>", "Unit price excl. tax")
    .option("--qty <n>", "Quantity")
    .option("--tva-tx <n>", "VAT rate (e.g., 20)")
    .option("--product-id <id>", "Product ID")
    .option("--product-type <n>", "0=product, 1=service")
    .option("--remise <n>", "Discount percentage")
    .action(async (id, lineid, opts) => {
      try {
        const body = buildOrderLineBody(opts);
        if (dryRunJson("orders.updateLine", { id, lineid, body })) return;
        const client = createClient();
        await client.put<unknown>(`orders/${id}/lines/${lineid}`, body);
        if (opts.json) {
          printJson(await client.get(`orders/${id}/lines`));
          return;
        }
        printInfo(`Updated line ${lineid} on order ${id}`);
        await echoState(client, `orders/${id}`, opts, orderDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete-line")
    .description("Delete a line from a draft order (recomputes order totals)")
    .argument("<id>", "Order ID")
    .argument("<lineid>", "Line ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, lineid, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete line ${lineid} from order ${id}?`, opts))) return;
        if (dryRunJson("orders.deleteLine", { id, lineid })) return;
        const client = createClient();
        await client.delete(`orders/${id}/lines/${lineid}`);
        if (opts.json) { printJson({ deleted: lineid }); return; }
        printInfo(`Deleted line ${lineid} from order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("reopen")
    .description("Reopen a closed order")
    .argument("<id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("orders.reopen", { id })) return;
        const client = createClient();
        await client.post<unknown>(`orders/${id}/reopen`);
        await echoState(client, `orders/${id}`, opts, orderDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create-from-proposal")
    .description("Create an order from a commercial proposal")
    .argument("<proposal-id>", "Source proposal ID")
    .option("--json", "Output as JSON")
    .action(async (proposalId, opts) => {
      try {
        if (dryRunJson("orders.createFromProposal", { proposalId })) return;
        const client = createClient();
        const result = await client.post<number>(`orders/createfromproposal/${proposalId}`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created order ${result} from proposal ${proposalId}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("shipments")
      .description("List shipments generated from an order")
      .argument("<id>", "Order ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(`orders/${id}/shipment`);
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "date_delivery", label: "Delivery", format: (i) => tsToDate(i.date_delivery) },
            { key: "status", label: "Status" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create-shipment")
    .description("Create a shipment from an order (requires the Shipments/Expedition module)")
    .argument("<id>", "Order ID")
    .argument("<warehouse-id>", "Source warehouse ID")
    .option("--json", "Output as JSON")
    .action(async (id, warehouseId, opts) => {
      try {
        if (dryRunJson("orders.createShipment", { id, warehouseId })) return;
        const client = createClient();
        const result = await client.post<number>(`orders/${id}/shipment/${warehouseId}`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created shipment ${result} from order ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd.addCommand(createOrderContactsCommand());

  return cmd;
}

/** `orders contacts` — list/add/remove linked contacts (orders expose a list route). */
function createOrderContactsCommand(): Command {
  const grp = new Command("contacts").description("List, link, or unlink contacts on an order");

  addGetOptions(
    grp
      .command("list")
      .description("List an order's linked contacts")
      .argument("<id>", "Order ID"),
  )
    .option("--type <type>", "Filter by contact type")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          `orders/${id}/contacts`,
          opts.type ? { type: opts.type } : undefined,
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "code", label: "Type code" },
            { key: "libelle", label: "Type", format: (c) => String(c.libelle ?? c.code ?? "") },
            { key: "firstname", label: "First name" },
            { key: "lastname", label: "Last name" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  grp
    .command("add")
    .description("Link a contact to an order")
    .argument("<id>", "Order ID")
    .argument("<contact-id>", "Contact ID")
    .argument("[type]", `Contact type: ${ORDER_CONTACT_TYPES.join(" | ")}`, "BILLING")
    .option("--json", "Output as JSON")
    .action(async (id, contactId, type, opts) => {
      try {
        const t = String(type).toUpperCase();
        if (dryRunJson("orders.contacts.add", { id, contactId, type: t })) return;
        const client = createClient();
        const result = await client.post<unknown>(`orders/${id}/contact/${contactId}/${t}`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Linked contact ${contactId} to order ${id} as ${t}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("remove")
    .description("Unlink a contact from an order")
    .argument("<id>", "Order ID")
    .argument("<contact-id>", "Contact ID")
    .argument("[type]", `Contact type: ${ORDER_CONTACT_TYPES.join(" | ")}`, "BILLING")
    .option("--json", "Output as JSON")
    .action(async (id, contactId, type, opts) => {
      try {
        const t = String(type).toUpperCase();
        if (dryRunJson("orders.contacts.remove", { id, contactId, type: t })) return;
        const client = createClient();
        await client.delete(`orders/${id}/contact/${contactId}/${t}`);
        if (opts.json) { printJson({ removed: contactId }); return; }
        printInfo(`Unlinked contact ${contactId} (${t}) from order ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}
