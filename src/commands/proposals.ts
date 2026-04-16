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
  "2": "Signed",
  "3": "Refused",
  "4": "Billed",
};

export function createProposalsCommand(): Command {
  const cmd = new Command("proposals").description("Manage proposals (quotes)");

  addListOptions(
    cmd
      .command("list")
      .description("List proposals"),
  )
    .option("--status <n>", "Filter by status")
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "proposals",
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
        printTable(rows, ["ID", "Ref", "Thirdparty", "Total TTC", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get proposal details")
    .argument("<id>", "Proposal ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`proposals/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Ref", String(item.ref ?? "")],
          ["Thirdparty ID", String(item.socid ?? "")],
          ["Date", item.date ? new Date(Number(item.date) * 1000).toISOString().split("T")[0] : ""],
          ["Valid until", item.fin_validite ? new Date(Number(item.fin_validite) * 1000).toISOString().split("T")[0] : ""],
          ["Total HT", String(item.total_ht ?? "")],
          ["Total TTC", String(item.total_ttc ?? "")],
          ["Status", STATUS_MAP[String(item.status)] ?? String(item.status ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("create")
    .description("Create a proposal")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--socid <id>", "Thirdparty ID (required)")
    .option("--date <date>", "Proposal date (YYYY-MM-DD)")
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
        if (dryRunJson("proposals.create", { body })) return;
        const result = await client.post<number>("proposals", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created proposal with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a proposal")
    .argument("<id>", "Proposal ID")
    .option("--json", "Output as JSON")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.notePublic) body.note_public = opts.notePublic;
        if (opts.notePrivate) body.note_private = opts.notePrivate;
        if (dryRunJson("proposals.update", { id, body })) return;
        const result = await client.put<unknown>(`proposals/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a proposal")
    .argument("<id>", "Proposal ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete proposal ${id}?`, opts))) return;
        if (dryRunJson("proposals.delete", { id })) return;
        const client = createClient();
        await client.delete(`proposals/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("validate")
    .description("Validate a draft proposal")
    .argument("<id>", "Proposal ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("proposals.validate", { id })) return;
        const client = createClient();
        const result = await client.post<unknown>(`proposals/${id}/validate`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Validated proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("close")
    .description("Close a proposal (sign, refuse, or mark billed)")
    .argument("<id>", "Proposal ID")
    .option("--json", "Output as JSON")
    .requiredOption("--status <n>", "Close status (2=signed, 3=refused, 4=billed)")
    .option("--note <text>", "Close note")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          status: Number(opts.status),
        };
        if (opts.note) body.note_private = opts.note;
        if (dryRunJson("proposals.close", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`proposals/${id}/close`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Closed proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("add-line")
    .description("Add a line to a proposal")
    .argument("<id>", "Proposal ID")
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
        if (dryRunJson("proposals.addLine", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`proposals/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
