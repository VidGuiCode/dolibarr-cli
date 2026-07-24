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
  renderList,
  renderGet,
} from "../core/resource-helpers.js";

/** Build the PUT/POST body for a proposal line from parsed opts (only passed flags). */
export function buildProposalLineBody(opts: Record<string, unknown>): Record<string, unknown> {
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

const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Signed",
  "3": "Refused",
  "4": "Billed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

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
      .description("Get proposal details (accepts numeric id or ref)")
      .argument("<id-or-ref>", "Proposal ID or ref"),
  )
    .action(async (idOrRef, opts) => {
      try {
        const client = createClient();
        const item = await client.getByRefOrId<Record<string, unknown>>("proposals", idOrRef);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "socid", label: "Thirdparty ID" },
            { key: "date", label: "Date", format: (i) => tsToDate(i.date) },
            { key: "fin_validite", label: "Valid until", format: (i) => tsToDate(i.fin_validite) },
            { key: "total_ht", label: "Total HT" },
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
    .option("--product-type <n>", "0=product, 1=service", "0")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {
          desc: opts.desc,
          subprice: Number(opts.subprice),
          qty: Number(opts.qty),
          tva_tx: Number(opts.tvaTx),
          // Dolibarr's proposal-line insert rejects an empty product_type; default to 0.
          product_type: Number(opts.productType ?? 0),
        };
        if (opts.productId) body.fk_product = Number(opts.productId);
        if (dryRunJson("proposals.addLine", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`proposals/${id}/lines`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added line to proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update-line")
    .description("Edit a line on a draft proposal (recomputes totals)")
    .argument("<id>", "Proposal ID")
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
        const body = buildProposalLineBody(opts);
        if (dryRunJson("proposals.updateLine", { id, lineid, body })) return;
        const client = createClient();
        await client.put<unknown>(`proposals/${id}/lines/${lineid}`, body);
        if (opts.json) {
          printJson(await client.get(`proposals/${id}/lines`));
          return;
        }
        printInfo(`Updated line ${lineid} on proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete-line")
    .description("Delete a line from a draft proposal (recomputes totals)")
    .argument("<id>", "Proposal ID")
    .argument("<lineid>", "Line ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, lineid, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete line ${lineid} from proposal ${id}?`, opts))) return;
        if (dryRunJson("proposals.deleteLine", { id, lineid })) return;
        const client = createClient();
        await client.delete(`proposals/${id}/lines/${lineid}`);
        if (opts.json) { printJson({ deleted: lineid }); return; }
        printInfo(`Deleted line ${lineid} from proposal ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
