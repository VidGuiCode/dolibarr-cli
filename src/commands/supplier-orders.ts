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
} from "../core/resource-helpers.js";
import { toEpochSeconds } from "../core/dates.js";

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

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

/** Detail-view fields shared by `get` and the reception/make-order state echo. */
export const supplierOrderDetailFields = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "socid", label: "Supplier ID" },
  { key: "date", label: "Date", format: (i: Record<string, unknown>) => tsToDate(i.date) },
  { key: "total_ht", label: "Total HT" },
  { key: "total_ttc", label: "Total TTC" },
  {
    key: "status",
    label: "Status",
    format: (i: Record<string, unknown>) =>
      STATUS_MAP[String(i.status)] ?? String(i.status ?? ""),
  },
];

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
          "supplierorders",
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
      .description("Get supplier order details")
      .argument("<id>", "Order ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`supplierorders/${id}`);
        renderGet(item, { opts, fields: supplierOrderDetailFields });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
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
        const result = await client.post<number>("supplierorders", body);
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
        const result = await client.put<unknown>(`supplierorders/${id}`, body);
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
        await client.delete(`supplierorders/${id}`);
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
        const result = await client.post<unknown>(`supplierorders/${id}/validate`);
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
        const result = await client.post<unknown>(`supplierorders/${id}/approve`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Approved supplier order ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("make-order")
      .description("Send an approved supplier order to the supplier (mark as ordered)")
      .argument("<id>", "Order ID"),
  )
    .option("--date <date>", "Date sent (YYYY-MM-DD or epoch)")
    .option("--method <id>", "Ordering method ID")
    .option("--comment <text>", "Comment")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {};
        body.date = opts.date ? toEpochSeconds(opts.date) : 0;
        if (opts.method) body.method = Number(opts.method);
        if (opts.comment) body.comment = opts.comment;
        if (dryRunJson("supplier-orders.makeOrder", { id, body })) return;
        const client = createClient();
        await client.post<unknown>(`supplierorders/${id}/makeorder`, body);
        await echoState(client, `supplierorders/${id}`, opts, supplierOrderDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("receive")
      .description("Record reception of a supplier order")
      .argument("<id>", "Order ID"),
  )
    .option("--close", "Close the order after reception (closeopenorder=1)")
    .option("--comment <text>", "Reception comment")
    .option(
      "--from-json <file>",
      "JSON file with a lines array [{ id, qty, comment }] for partial reception",
    )
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          closeopenorder: opts.close ? 1 : 0,
          comment: opts.comment ?? "",
        };
        body.lines = opts.fromJson ? JSON.parse(fs.readFileSync(opts.fromJson, "utf-8")) : [];
        if (dryRunJson("supplier-orders.receive", { id, body })) return;
        const client = createClient();
        await client.post<unknown>(`supplierorders/${id}/receive`, body);
        await echoState(client, `supplierorders/${id}`, opts, supplierOrderDetailFields);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("contacts")
      .description("List a supplier order's linked contacts")
      .argument("<id>", "Order ID"),
  )
    .option("--source <source>", "Contact source: internal | external", "external")
    .option("--type <type>", "Filter by contact type")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          `supplierorders/${id}/contacts`,
          { source: opts.source, type: opts.type },
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

  return cmd;
}
