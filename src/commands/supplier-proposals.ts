import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { toEpochSeconds } from "../core/dates.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  confirmOrCancel,
  dryRunJson,
  echoState,
  prunePayload,
  renderGet,
  renderList,
  resolveOutput,
  type ColumnSpec,
} from "../core/resource-helpers.js";

/** Supplier proposal (price request) statuses per Dolibarr's SupplierProposal class. */
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Signed",
  "3": "Not signed",
  "4": "Closed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const statusLabel = (i: Record<string, unknown>): string => {
  const s = i.status ?? i.statut ?? i.fk_statut;
  return STATUS_MAP[String(s)] ?? String(s ?? "");
};

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const supplierProposalListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "socid", label: "Supplier" },
  { key: "date", label: "Date", format: (i) => tsToDate(i.date ?? i.date_creation) },
  { key: "total_ht", label: "Total HT" },
  { key: "total_ttc", label: "Total TTC" },
  { key: "status", label: "Status", format: statusLabel },
];

export const supplierProposalDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "ref_fourn", label: "Supplier ref" },
  { key: "socid", label: "Supplier ID" },
  { key: "fk_project", label: "Project ID" },
  { key: "date", label: "Date", format: (i) => tsToDate(i.date ?? i.date_creation) },
  {
    key: "date_livraison",
    label: "Delivery date",
    format: (i) => tsToDate(i.date_livraison ?? i.delivery_date),
  },
  { key: "total_ht", label: "Total HT" },
  { key: "total_tva", label: "Total VAT" },
  { key: "total_ttc", label: "Total TTC" },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "status", label: "Status", format: statusLabel },
];

export const supplierProposalLineColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "rang", label: "Rank" },
  { key: "fk_product", label: "Product" },
  {
    key: "desc",
    label: "Description",
    format: (i) => String(i.desc ?? i.description ?? "").slice(0, 40),
  },
  { key: "qty", label: "Qty" },
  { key: "subprice", label: "Unit price" },
  { key: "tva_tx", label: "VAT %" },
  { key: "total_ht", label: "Total HT" },
];

/**
 * Build the POST/PUT body for a supplier proposal. Only passed flags become part of the
 * body, so the same builder serves `create` and `update`.
 */
export function buildSupplierProposalBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    socid: opts.socid === undefined ? undefined : Number(opts.socid),
    ref_fourn: opts.refSupplier,
    fk_project: opts.project === undefined ? undefined : Number(opts.project),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
    cond_reglement_id:
      opts.condReglement === undefined ? undefined : Number(opts.condReglement),
    mode_reglement_id:
      opts.modeReglement === undefined ? undefined : Number(opts.modeReglement),
  });
  if (opts.date !== undefined) body.date = toEpochSeconds(opts.date as string);
  if (opts.deliveryDate !== undefined) {
    body.date_livraison = toEpochSeconds(opts.deliveryDate as string);
  }
  return body;
}

export function createSupplierProposalsCommand(): Command {
  const cmd = new Command("supplier-proposals").description(
    "Manage supplier proposals (price requests)",
  );

  addListOptions(cmd.command("list").description("List supplier proposals"))
    .option("--thirdparty <ids>", "Filter by supplier thirdparty ID(s), comma-separated")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "supplierproposals",
          buildListQuery(opts, { thirdparty_ids: opts.thirdparty }),
        );
        renderList(items, { opts, columns: supplierProposalListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get supplier proposal details")
      .argument("<id>", "Supplier proposal ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`supplierproposals/${id}`);
      renderGet(item, { opts, fields: supplierProposalDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const proposalFieldOptions = (c: Command): Command =>
    c
      .option("--date <date>", "Proposal date (YYYY-MM-DD or epoch)")
      .option("--delivery-date <date>", "Delivery date (YYYY-MM-DD or epoch)")
      .option("--ref-supplier <ref>", "Supplier reference")
      .option("--project <id>", "Project ID")
      .option("--cond-reglement <id>", "Payment terms ID")
      .option("--mode-reglement <id>", "Payment mode ID")
      .option("--note-public <text>", "Public note")
      .option("--note-private <text>", "Private note");

  proposalFieldOptions(
    addGetOptions(cmd.command("create").description("Create a supplier proposal"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--socid <id>", "Supplier thirdparty ID (required)"),
  ).action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.fromJson) {
        body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
      } else {
        if (!opts.socid) {
          printInfo("Error: --socid is required (or use --from-json)");
          process.exit(1);
        }
        body = buildSupplierProposalBody(opts);
      }
      if (dryRunJson("supplierProposals.create", { body })) return;
      const client = createClient();
      const id = await client.post<number>("supplierproposals", body);
      announce(opts, `Created supplier proposal with ID: ${id}`);
      await echoState(client, `supplierproposals/${id}`, opts, supplierProposalDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  proposalFieldOptions(
    addGetOptions(
      cmd
        .command("update")
        .description("Update a supplier proposal (only the flags you pass are sent)")
        .argument("<id>", "Supplier proposal ID"),
    ).option("--socid <id>", "Supplier thirdparty ID"),
  ).action(async (id, opts) => {
    try {
      const body = buildSupplierProposalBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("supplierProposals.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`supplierproposals/${id}`, body);
      announce(opts, `Updated supplier proposal ${id}`);
      await echoState(client, `supplierproposals/${id}`, opts, supplierProposalDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  cmd
    .command("delete")
    .description("Delete a supplier proposal")
    .argument("<id>", "Supplier proposal ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("supplierProposals.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete supplier proposal ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`supplierproposals/${id}`);
        announce(opts, `Deleted supplier proposal ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  addGetOptions(
    cmd
      .command("lines")
      .description("List the lines of a supplier proposal")
      .argument("<id>", "Supplier proposal ID"),
  )
    .addHelpText(
      "after",
      "\nRead from the `lines` array embedded in the proposal object — Dolibarr 20.0.4" +
        "\nexposes no /supplierproposals/{id}/lines route in any method.",
    )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`supplierproposals/${id}`);
        const lines = (item.lines ?? []) as Record<string, unknown>[];
        renderList(Array.isArray(lines) ? lines : [], {
          opts,
          columns: supplierProposalLineColumns,
        });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd.addHelpText(
    "after",
    "\nThe API path is `supplierproposals` — one word. `supplier_proposals` returns a 501," +
      "\nthe same quirk as `supplierorders`." +
      "\n\nNot available on Dolibarr 20.0.4 (all verified as route-stage 404s):" +
      "\n  • ref-lookup — no /supplierproposals/ref/{ref}, so `get` takes a numeric ID." +
      "\n  • line add / edit / delete — no /{id}/lines routes; `lines` is read-only." +
      "\n  • validate / close / contacts — no dedicated routes. Dolibarr's REST surface for" +
      "\n    this resource is plain CRUD; for a status change use the web UI, or" +
      "\n    `dolibarr raw PUT supplierproposals/{id}` if your instance honors the field.",
  );

  return cmd;
}
