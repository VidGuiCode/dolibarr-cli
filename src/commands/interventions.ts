import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
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

/**
 * Print a human confirmation line, but stay silent in JSON mode so the echoed
 * state remains parseable.
 */
const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

/**
 * Intervention (fichinter) statuses per Dolibarr.
 * 0 draft, 1 validated, 2 billed, 3 closed/done.
 */
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Billed",
  "3": "Closed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const statusLabel = (i: Record<string, unknown>): string => {
  const s = i.statut ?? i.status ?? i.fk_statut;
  return STATUS_MAP[String(s)] ?? String(s ?? "");
};

/** Seconds → `Hh Mm`, since Dolibarr stores intervention durations in seconds. */
const durationLabel = (v: unknown): string => {
  const secs = Number(v ?? 0);
  if (!Number.isFinite(secs) || secs === 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const interventionListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "socid", label: "Thirdparty" },
  { key: "duration", label: "Duration", format: (i) => durationLabel(i.duration) },
  { key: "datec", label: "Created", format: (i) => tsToDate(i.datec ?? i.date_creation) },
  { key: "statut", label: "Status", format: statusLabel },
];

export const interventionDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "ref_client", label: "Customer ref" },
  { key: "socid", label: "Thirdparty ID" },
  { key: "fk_project", label: "Project ID" },
  { key: "fk_contrat", label: "Contract ID" },
  { key: "description", label: "Description" },
  { key: "duration", label: "Duration", format: (i) => durationLabel(i.duration) },
  { key: "datec", label: "Created", format: (i) => tsToDate(i.datec ?? i.date_creation) },
  { key: "date_valid", label: "Validated", format: (i) => tsToDate(i.date_valid) },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "statut", label: "Status", format: statusLabel },
];

export const interventionLineColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "rang", label: "Rank" },
  { key: "desc", label: "Description", format: (i) => String(i.desc ?? i.description ?? "") },
  { key: "datei", label: "Date", format: (i) => tsToDate(i.datei ?? i.date) },
  { key: "duration", label: "Duration", format: (i) => durationLabel(i.duration ?? i.duree) },
];

/** Build the POST body for `interventions create`. */
export function buildInterventionCreateBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    socid: Number(opts.socid),
    ref: opts.ref,
    ref_client: opts.refClient,
    description: opts.description,
    fk_project: opts.project === undefined ? undefined : Number(opts.project),
    fk_contrat: opts.contract === undefined ? undefined : Number(opts.contract),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
  if (opts.date !== undefined) body.datei = toEpochSeconds(opts.date as string);
  return body;
}

/**
 * Build the POST body for `interventions add-line`.
 *
 * Dolibarr's `Fichinter::addline()` takes `desc`, `date` and `duration` (seconds);
 * `--hours` is a convenience that converts to seconds so callers don't hand-compute.
 */
export function buildInterventionLineBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    desc: opts.description,
    duration:
      opts.hours !== undefined
        ? Math.round(Number(opts.hours) * 3600)
        : opts.duration === undefined
          ? undefined
          : Number(opts.duration),
  });
  if (opts.date !== undefined) body.date = toEpochSeconds(opts.date as string);
  return body;
}

export function createInterventionsCommand(): Command {
  const cmd = new Command("interventions").description(
    "Manage interventions (fichinter) and their time lines",
  );

  addListOptions(cmd.command("list").description("List interventions"))
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "interventions",
          buildListQuery(opts, { thirdparty_ids: opts.thirdparty }),
        );
        renderList(items, { opts, columns: interventionListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get intervention details")
      .argument("<id>", "Intervention ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`interventions/${id}`);
      renderGet(item, { opts, fields: interventionDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(cmd.command("create").description("Create an intervention"))
    .option("--from-json <file>", "Create from a JSON file")
    .option("--socid <id>", "Thirdparty ID (required)")
    .option("--ref <ref>", "Reference (auto-numbered when omitted)")
    .option("--ref-client <ref>", "Customer reference")
    .option("--description <text>", "Description")
    .option("--date <date>", "Intervention date (YYYY-MM-DD or epoch)")
    .option("--project <id>", "Project ID")
    .option("--contract <id>", "Contract ID")
    .option("--note-public <text>", "Public note")
    .option("--note-private <text>", "Private note")
    .action(async (opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.socid) {
            printInfo("Error: --socid is required (or use --from-json)");
            process.exit(1);
          }
          body = buildInterventionCreateBody(opts);
        }
        if (dryRunJson("interventions.create", { body })) return;
        const client = createClient();
        const id = await client.post<number>("interventions", body);
        announce(opts, `Created intervention with ID: ${id}`);
        await echoState(client, `interventions/${id}`, opts, interventionDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd
    .command("delete")
    .description("Delete an intervention")
    .argument("<id>", "Intervention ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("interventions.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete intervention ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`interventions/${id}`);
        if (opts.json) {
          printJson({ deleted: id });
          return;
        }
        printInfo(`Deleted intervention ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  addGetOptions(
    cmd
      .command("validate")
      .description("Validate a draft intervention")
      .argument("<id>", "Intervention ID"),
  )
    .option("--no-trigger", "Do not execute triggers after the action")
    .action(async (id, opts) => {
      try {
        // Dolibarr rejects an empty body here (400 at validate stage), so notrigger
        // is always sent. commander maps --no-trigger to opts.trigger === false.
        const body = { notrigger: opts.trigger === false ? 1 : 0 };
        if (dryRunJson("interventions.validate", { id, body })) return;
        const client = createClient();
        await client.post<unknown>(`interventions/${id}/validate`, body);
        announce(opts, `Validated intervention ${id}`);
        await echoState(client, `interventions/${id}`, opts, interventionDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("close")
      .description("Close a validated intervention")
      .argument("<id>", "Intervention ID"),
  ).action(async (id, opts) => {
    try {
      if (dryRunJson("interventions.close", { id })) return;
      const client = createClient();
      await client.post<unknown>(`interventions/${id}/close`);
      announce(opts, `Closed intervention ${id}`);
      await echoState(client, `interventions/${id}`, opts, interventionDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    cmd
      .command("lines")
      .description("List the time lines of an intervention")
      .argument("<id>", "Intervention ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      // The API has no GET /interventions/{id}/lines — lines are embedded in the object.
      const item = await client.get<Record<string, unknown>>(`interventions/${id}`);
      const lines = (item.lines ?? []) as Record<string, unknown>[];
      renderList(lines, { opts, columns: interventionLineColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    cmd
      .command("add-line")
      .description("Add a time line to an intervention")
      .argument("<id>", "Intervention ID"),
  )
    .option("--from-json <file>", "Add from a JSON file")
    .option("--description <text>", "Line description")
    .option("--date <date>", "Line date (YYYY-MM-DD or epoch)")
    .option("--hours <n>", "Duration in hours (converted to seconds)")
    .option("--duration <secs>", "Duration in seconds (alternative to --hours)")
    .action(async (id, opts) => {
      try {
        const body = opts.fromJson
          ? (JSON.parse(fs.readFileSync(opts.fromJson, "utf-8")) as Record<string, unknown>)
          : buildInterventionLineBody(opts);
        if (dryRunJson("interventions.addLine", { id, body })) return;
        const client = createClient();
        const lineId = await client.post<number>(`interventions/${id}/lines`, body);
        announce(opts, `Added line ${lineId} to intervention ${id}`);
        await echoState(client, `interventions/${id}`, opts, interventionDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd.addHelpText(
    "after",
    "\nNotes:" +
      "\n  • Dolibarr exposes no PUT on /interventions — there is no `update` subcommand." +
      "\n    Lines cannot be edited or removed via the API either; only added." +
      "\n  • No /interventions/ref/{ref} route exists, so `get` takes a numeric ID only.",
  );

  return cmd;
}
