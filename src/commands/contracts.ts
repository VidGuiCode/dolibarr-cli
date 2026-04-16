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

// Contract header statuses per Dolibarr.
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Closed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

export function createContractsCommand(): Command {
  const cmd = new Command("contracts").description("Manage contracts");

  addListOptions(
    cmd
      .command("list")
      .description("List contracts"),
  )
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "contracts",
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
            { key: "date_contrat", label: "Date", format: (i) => tsToDate(i.date_contrat) },
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
      .description("Get contract details")
      .argument("<id>", "Contract ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`contracts/${id}`);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "ref_ext", label: "Ref Ext" },
            { key: "socid", label: "Thirdparty ID" },
            { key: "date_contrat", label: "Date", format: (i) => tsToDate(i.date_contrat) },
            { key: "note_public", label: "Public note" },
            { key: "note_private", label: "Private note" },
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
    .description("Create a contract")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Thirdparty ID (required)")
    .option("--date <date>", "Contract date (YYYY-MM-DD)")
    .option("--ref-ext <ref>", "External reference")
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
          if (opts.date) body.date_contrat = Math.floor(new Date(opts.date).getTime() / 1000);
          if (opts.refExt) body.ref_ext = opts.refExt;
          if (opts.notePublic) body.note_public = opts.notePublic;
          if (opts.notePrivate) body.note_private = opts.notePrivate;
        }
        if (dryRunJson("contracts.create", { body })) return;
        const result = await client.post<number>("contracts", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created contract with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a contract")
    .argument("<id>", "Contract ID")
    .option("--json", "Output as JSON")
    .option("--ref-ext <ref>", "External reference")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.refExt) body.ref_ext = opts.refExt;
        if (opts.notePublic) body.note_public = opts.notePublic;
        if (opts.notePrivate) body.note_private = opts.notePrivate;
        if (dryRunJson("contracts.update", { id, body })) return;
        const result = await client.put<unknown>(`contracts/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated contract ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a contract")
    .argument("<id>", "Contract ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete contract ${id}?`, opts))) return;
        if (dryRunJson("contracts.delete", { id })) return;
        const client = createClient();
        await client.delete(`contracts/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted contract ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft contract")
    .argument("<id>", "Contract ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("contracts.validate", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`contracts/${id}/validate`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated contract ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("close")
    .description("Close a contract")
    .argument("<id>", "Contract ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("contracts.close", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`contracts/${id}/close`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Closed contract ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("list-lines")
      .description("List lines for a contract")
      .argument("<id>", "Contract ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const lines = await client.get<Record<string, unknown>[]>(`contracts/${id}/lines`);
        renderList(lines, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "fk_product", label: "Product ID" },
            { key: "description", label: "Description" },
            { key: "qty", label: "Qty" },
            { key: "subprice", label: "Unit price" },
            {
              key: "date_start",
              label: "Start",
              format: (i) => tsToDate(i.date_start ?? i.date_ouverture),
            },
            {
              key: "date_end",
              label: "End",
              format: (i) => tsToDate(i.date_end ?? i.date_fin_validite),
            },
            { key: "statut", label: "Status" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("activate-line")
    .description("Activate a contract line")
    .argument("<id>", "Contract ID")
    .argument("<line-id>", "Line ID")
    .option("--json", "Output as JSON")
    .option("--date-start <date>", "Activation start date (YYYY-MM-DD, required)")
    .option("--date-end <date>", "Activation end date (YYYY-MM-DD)")
    .option("--comment <text>", "Comment")
    .action(async (id, lineId, opts) => {
      try {
        if (!opts.dateStart) {
          printInfo("Error: --date-start is required");
          process.exit(1);
        }
        const body: Record<string, unknown> = {
          datestart: Math.floor(new Date(opts.dateStart).getTime() / 1000),
        };
        if (opts.dateEnd) body.dateend = Math.floor(new Date(opts.dateEnd).getTime() / 1000);
        if (opts.comment) body.comment = opts.comment;
        if (dryRunJson("contracts.activate-line", { id, lineId, body })) return;
        const client = createClient();
        const result = await client.put<unknown>(
          `contracts/${id}/lines/${lineId}/activate`,
          body,
        );
        if (opts.json) { printJson(result); return; }
        printInfo(`Activated line ${lineId} on contract ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("deactivate-line")
    .description("Deactivate (unactivate) a contract line")
    .argument("<id>", "Contract ID")
    .argument("<line-id>", "Line ID")
    .option("--json", "Output as JSON")
    .option("--date-start <date>", "Deactivation date (YYYY-MM-DD, required)")
    .option("--comment <text>", "Comment")
    .action(async (id, lineId, opts) => {
      try {
        if (!opts.dateStart) {
          printInfo("Error: --date-start is required");
          process.exit(1);
        }
        const body: Record<string, unknown> = {
          datestart: Math.floor(new Date(opts.dateStart).getTime() / 1000),
        };
        if (opts.comment) body.comment = opts.comment;
        if (dryRunJson("contracts.deactivate-line", { id, lineId, body })) return;
        const client = createClient();
        const result = await client.put<unknown>(
          `contracts/${id}/lines/${lineId}/unactivate`,
          body,
        );
        if (opts.json) { printJson(result); return; }
        printInfo(`Deactivated line ${lineId} on contract ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
