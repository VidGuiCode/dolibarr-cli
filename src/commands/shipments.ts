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
  renderGet,
  renderList,
} from "../core/resource-helpers.js";

// Shipment (expedition) statuses per Dolibarr.
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Processed",
  "3": "Closed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

export function createShipmentsCommand(): Command {
  const cmd = new Command("shipments").description("Manage shipments (expeditions)");

  addListOptions(
    cmd
      .command("list")
      .description("List shipments"),
  )
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "shipments",
          buildListQuery(opts, {
            thirdparty_ids: opts.thirdparty,
          }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "socid", label: "Thirdparty" },
            { key: "date_expedition", label: "Date", format: (i) => tsToDate(i.date_expedition) },
            {
              key: "statut",
              label: "Status",
              format: (i) => {
                const s = i.statut ?? i.status;
                return STATUS_MAP[String(s)] ?? String(s ?? "");
              },
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get shipment details")
      .argument("<id>", "Shipment ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`shipments/${id}`);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "socid", label: "Thirdparty ID" },
            { key: "fk_origin", label: "Origin ID" },
            { key: "date_expedition", label: "Date", format: (i) => tsToDate(i.date_expedition) },
            { key: "tracking_number", label: "Tracking" },
            { key: "weight", label: "Weight" },
            {
              key: "statut",
              label: "Status",
              format: (i) => {
                const s = i.statut ?? i.status;
                return STATUS_MAP[String(s)] ?? String(s ?? "");
              },
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create")
    .description("Create a shipment")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Thirdparty ID (required)")
    .option("--order <id>", "Source order ID (fk_origin/origin_id)")
    .option("--date <date>", "Shipment date (YYYY-MM-DD)")
    .option("--tracking <number>", "Tracking number")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.socid) { printInfo("Error: --socid is required"); process.exit(1); }
          body = { socid: Number(opts.socid) };
          if (opts.order) {
            body.origin = "commande";
            body.origin_id = Number(opts.order);
          }
          if (opts.date) body.date_expedition = Math.floor(new Date(opts.date).getTime() / 1000);
          if (opts.tracking) body.tracking_number = opts.tracking;
        }
        if (dryRunJson("shipments.create", { body })) return;
        const result = await client.post<number>("shipments", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created shipment with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a shipment")
    .argument("<id>", "Shipment ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete shipment ${id}?`, opts))) return;
        if (dryRunJson("shipments.delete", { id })) return;
        const client = createClient();
        await client.delete(`shipments/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted shipment ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft shipment")
    .argument("<id>", "Shipment ID")
    .option("--json", "Output as JSON")
    .option("--no-trigger", "Do not execute triggers after action")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {};
        // commander maps --no-trigger to opts.trigger = false
        if (opts.trigger === false) body.notrigger = 1;
        if (dryRunJson("shipments.validate", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`shipments/${id}/validate`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated shipment ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("close")
    .description("Close a shipment")
    .argument("<id>", "Shipment ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("shipments.close", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`shipments/${id}/close`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Closed shipment ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
