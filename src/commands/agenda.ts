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

const tsToDateTime = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().replace("T", " ").slice(0, 16) : "";

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const agendaEventListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "type_code", label: "Type", format: (i) => String(i.type_code ?? i.code ?? "") },
  { key: "datep", label: "Start", format: (i) => tsToDateTime(i.datep) },
  { key: "datef", label: "End", format: (i) => tsToDateTime(i.datef) },
  { key: "socid", label: "Thirdparty" },
  { key: "percentage", label: "Done %" },
];

export const agendaEventDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "type_code", label: "Type code", format: (i) => String(i.type_code ?? i.code ?? "") },
  { key: "datep", label: "Start", format: (i) => tsToDateTime(i.datep) },
  { key: "datef", label: "End", format: (i) => tsToDateTime(i.datef) },
  { key: "fulldayevent", label: "Full day" },
  { key: "location", label: "Location" },
  { key: "socid", label: "Thirdparty ID" },
  { key: "contact_id", label: "Contact ID" },
  { key: "fk_project", label: "Project ID" },
  { key: "userownerid", label: "Owner user ID" },
  { key: "percentage", label: "Done %" },
  { key: "priority", label: "Priority" },
  { key: "note", label: "Note" },
];

/**
 * Build the POST/PUT body for an agenda event (Dolibarr's `ActionComm`). Only passed flags
 * become part of the body, so the same builder serves `create` and `update`.
 *
 * Dolibarr names the start/end pair `datep` / `datef` — not `date_start`/`date_end`.
 */
export function buildAgendaEventBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    label: opts.label,
    type_code: opts.type,
    note: opts.note,
    location: opts.location,
    socid: opts.socid === undefined ? undefined : Number(opts.socid),
    contact_id: opts.contact === undefined ? undefined : Number(opts.contact),
    fk_project: opts.project === undefined ? undefined : Number(opts.project),
    userownerid: opts.owner === undefined ? undefined : Number(opts.owner),
    percentage: opts.percentage === undefined ? undefined : Number(opts.percentage),
    priority: opts.priority === undefined ? undefined : Number(opts.priority),
    fulldayevent: opts.fullDay === undefined ? undefined : Number(opts.fullDay),
  });
  if (opts.start !== undefined) body.datep = toEpochSeconds(opts.start as string);
  if (opts.end !== undefined) body.datef = toEpochSeconds(opts.end as string);
  return body;
}

export function createAgendaCommand(): Command {
  const cmd = new Command("agenda").description("Manage agenda (calendar) events");

  addListOptions(cmd.command("list").description("List agenda events"))
    .option("--user <id>", "Filter by owner user ID")
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "agendaevents",
          buildListQuery(opts, {
            user_ids: opts.user,
            thirdparty_ids: opts.thirdparty,
          }),
        );
        renderList(items, { opts, columns: agendaEventListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd.command("get").description("Get agenda event details").argument("<id>", "Event ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`agendaevents/${id}`);
      renderGet(item, { opts, fields: agendaEventDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const eventFieldOptions = (c: Command): Command =>
    c
      .option("--end <datetime>", "End date/time (YYYY-MM-DD or epoch)")
      .option("--type <code>", "Event type code (e.g. AC_RDV, AC_TEL, AC_EMAIL, AC_OTH)")
      .option("--location <text>", "Location")
      .option("--socid <id>", "Thirdparty ID")
      .option("--contact <id>", "Contact ID")
      .option("--project <id>", "Project ID")
      .option("--owner <id>", "Owner user ID")
      .option("--percentage <pct>", "Completion percentage (-1 = not applicable)")
      .option("--priority <n>", "Priority")
      .option("--full-day <0|1>", "Mark as an all-day event")
      .option("--note <text>", "Note / description");

  eventFieldOptions(
    addGetOptions(cmd.command("create").description("Create an agenda event"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--label <text>", "Event label (required)")
      .option("--start <datetime>", "Start date/time (YYYY-MM-DD or epoch)"),
  ).action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.fromJson) {
        body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
      } else {
        if (!opts.label) {
          printInfo("Error: --label is required (or use --from-json)");
          process.exit(1);
        }
        body = buildAgendaEventBody(opts);
      }
      if (dryRunJson("agenda.create", { body })) return;
      const client = createClient();
      const id = await client.post<number>("agendaevents", body);
      announce(opts, `Created agenda event with ID: ${id}`);
      await echoState(client, `agendaevents/${id}`, opts, agendaEventDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  eventFieldOptions(
    addGetOptions(
      cmd
        .command("update")
        .description("Update an agenda event (only the flags you pass are sent)")
        .argument("<id>", "Event ID"),
    )
      .option("--label <text>", "Event label")
      .option("--start <datetime>", "Start date/time (YYYY-MM-DD or epoch)"),
  ).action(async (id, opts) => {
    try {
      const body = buildAgendaEventBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("agenda.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`agendaevents/${id}`, body);
      announce(opts, `Updated agenda event ${id}`);
      await echoState(client, `agendaevents/${id}`, opts, agendaEventDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  cmd
    .command("delete")
    .description("Delete an agenda event")
    .argument("<id>", "Event ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("agenda.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete agenda event ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`agendaevents/${id}`);
        announce(opts, `Deleted agenda event ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  cmd.addHelpText(
    "after",
    "\nNotes (Dolibarr 20.0.4):" +
      "\n  • Dolibarr names the start/end pair `datep` / `datef`; `--start` / `--end` map to" +
      "\n    those. Event types are dictionary codes — list them with" +
      "\n    `dolibarr raw GET setup/dictionary/event_types`." +
      "\n  • No /agendaevents/ref/{ref} route, so `get` takes a numeric ID." +
      "\n  • The routes exist but are permission-gated on the reference instance" +
      "\n    (403 \"Insufficient rights to read an event\"), so bodies are docs-sourced.",
  );

  return cmd;
}
