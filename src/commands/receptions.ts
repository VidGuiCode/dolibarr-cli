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

// Reception statuses per Dolibarr.
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Processed",
  "3": "Closed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

export function createReceptionsCommand(): Command {
  const cmd = new Command("receptions").description("Manage supplier receptions");

  addListOptions(
    cmd
      .command("list")
      .description("List receptions"),
  )
    .option("--thirdparty <id>", "Filter by supplier ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "receptions",
          buildListQuery(opts, {
            thirdparty_ids: opts.thirdparty,
          }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "socid", label: "Supplier" },
            { key: "date_reception", label: "Date", format: (i) => tsToDate(i.date_reception) },
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
      .description("Get reception details")
      .argument("<id>", "Reception ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`receptions/${id}`);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "socid", label: "Supplier ID" },
            { key: "fk_origin", label: "Origin ID" },
            { key: "date_reception", label: "Date", format: (i) => tsToDate(i.date_reception) },
            { key: "tracking_number", label: "Tracking" },
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
    .description("Create a reception")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Supplier thirdparty ID (required)")
    .option("--order <id>", "Source supplier order ID (fk_origin/origin_id)")
    .option("--date <date>", "Reception date (YYYY-MM-DD)")
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
            body.origin = "supplier_order";
            body.origin_id = Number(opts.order);
          }
          if (opts.date) body.date_reception = Math.floor(new Date(opts.date).getTime() / 1000);
          if (opts.tracking) body.tracking_number = opts.tracking;
        }
        if (dryRunJson("receptions.create", { body })) return;
        const result = await client.post<number>("receptions", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created reception with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a reception")
    .argument("<id>", "Reception ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete reception ${id}?`, opts))) return;
        if (dryRunJson("receptions.delete", { id })) return;
        const client = createClient();
        await client.delete(`receptions/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted reception ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft reception")
    .argument("<id>", "Reception ID")
    .option("--json", "Output as JSON")
    .option("--no-trigger", "Do not execute triggers after action")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {};
        if (opts.trigger === false) body.notrigger = 1;
        if (dryRunJson("receptions.validate", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`receptions/${id}/validate`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated reception ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("close")
    .description("Close a reception")
    .argument("<id>", "Reception ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("receptions.close", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`receptions/${id}/close`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Closed reception ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
