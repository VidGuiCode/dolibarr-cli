import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { toDateTimeString, toEpochSeconds } from "../core/dates.js";
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

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

/** Seconds → `Hh Mm`, since Dolibarr stores task workload/effort in seconds. */
const durationLabel = (v: unknown): string => {
  const secs = Number(v ?? 0);
  if (!Number.isFinite(secs) || secs === 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const taskListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "fk_project", label: "Project" },
  { key: "progress", label: "Progress %" },
  {
    key: "planned_workload",
    label: "Planned",
    format: (i) => durationLabel(i.planned_workload),
  },
  {
    key: "duration_effective",
    label: "Spent",
    format: (i) => durationLabel(i.duration_effective),
  },
  { key: "date_start", label: "Start", format: (i) => tsToDate(i.date_start) },
  { key: "date_end", label: "End", format: (i) => tsToDate(i.date_end) },
];

export const taskDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "fk_project", label: "Project ID" },
  { key: "fk_task_parent", label: "Parent task ID" },
  { key: "description", label: "Description" },
  { key: "progress", label: "Progress %" },
  { key: "priority", label: "Priority" },
  {
    key: "planned_workload",
    label: "Planned workload",
    format: (i) => durationLabel(i.planned_workload),
  },
  {
    key: "duration_effective",
    label: "Time spent",
    format: (i) => durationLabel(i.duration_effective),
  },
  { key: "date_start", label: "Start", format: (i) => tsToDate(i.date_start) },
  { key: "date_end", label: "End", format: (i) => tsToDate(i.date_end) },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "status", label: "Status" },
];

/**
 * Build the POST/PUT body for a task. Only passed flags become part of the body, so the
 * same builder serves `create` and `update`.
 *
 * Every field here was confirmed to persist against a live Dolibarr 20.0.4 task.
 * `fk_statut` is deliberately absent — a PUT carrying it is silently ignored.
 */
export function buildTaskBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    ref: opts.ref,
    label: opts.label,
    fk_project: opts.project === undefined ? undefined : Number(opts.project),
    fk_task_parent: opts.parent === undefined ? undefined : Number(opts.parent),
    description: opts.description,
    progress: opts.progress === undefined ? undefined : Number(opts.progress),
    priority: opts.priority === undefined ? undefined : Number(opts.priority),
    planned_workload:
      opts.workloadHours !== undefined
        ? Math.round(Number(opts.workloadHours) * 3600)
        : opts.workload === undefined
          ? undefined
          : Number(opts.workload),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
  if (opts.dateStart !== undefined) body.date_start = toEpochSeconds(opts.dateStart as string);
  if (opts.dateEnd !== undefined) body.date_end = toEpochSeconds(opts.dateEnd as string);
  return body;
}

/**
 * Build the body for a time-spent entry.
 *
 * ⚠️ `date` must be a `YYYY-MM-DD HH:MM:SS` string here — this endpoint rejects an epoch
 * ("Expecting date and time in `YYYY-MM-DD HH:MM:SS` format"), unlike every other date
 * field in the API. Confirmed live on Dolibarr 20.0.4.
 */
export function buildTimespentBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    date: toDateTimeString(opts.date as string),
  };
  const duration =
    opts.hours !== undefined
      ? Math.round(Number(opts.hours) * 3600)
      : opts.duration === undefined
        ? undefined
        : Number(opts.duration);
  if (duration !== undefined) body.duration = duration;
  if (opts.user !== undefined) body.user_id = Number(opts.user);
  if (opts.note !== undefined) body.note = opts.note;
  return body;
}

export function createTasksCommand(): Command {
  const cmd = new Command("tasks").description(
    "Manage project tasks and their time spent (top-level task resource)",
  );

  addListOptions(cmd.command("list").description("List tasks"))
    .option("--project <id>", "Filter by project ID")
    .option("--with-timespent", "Include time-spent data")
    .addHelpText(
      "after",
      "\nSee also: `dolibarr projects tasks <project-id>` — the project-scoped listing.",
    )
    .action(async (opts) => {
      try {
        const filter = opts.project ? `(t.fk_projet:=:${Number(opts.project)})` : opts.filter;
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "tasks",
          buildListQuery(
            { ...opts, filter },
            { includetimespent: opts.withTimespent ? 1 : undefined },
          ),
        );
        renderList(items, { opts, columns: taskListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd.command("get").description("Get task details").argument("<id>", "Task ID"),
  )
    .option("--with-timespent", "Include time-spent data")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`tasks/${id}`, {
          includetimespent: opts.withTimespent ? 1 : undefined,
        });
        renderGet(item, { opts, fields: taskDetailFields });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  const taskFieldOptions = (c: Command): Command =>
    c
      .option("--description <text>", "Description")
      .option("--parent <id>", "Parent task ID")
      .option("--date-start <date>", "Start date (YYYY-MM-DD or epoch)")
      .option("--date-end <date>", "End date (YYYY-MM-DD or epoch)")
      .option("--workload-hours <n>", "Planned workload in hours (converted to seconds)")
      .option("--workload <secs>", "Planned workload in seconds (alternative)")
      .option("--progress <pct>", "Progress percentage")
      .option("--priority <n>", "Priority")
      .option("--note-public <text>", "Public note")
      .option("--note-private <text>", "Private note");

  taskFieldOptions(
    addGetOptions(cmd.command("create").description("Create a task"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--ref <ref>", "Task reference (required)")
      .option("--label <text>", "Task label (required)")
      .option("--project <id>", "Project ID (required)"),
  )
    .addHelpText(
      "after",
      "\nDolibarr requires all three of --ref, --label and --project on a create" +
        "\n(confirmed by the API's own validator) — a task cannot exist outside a project.",
    )
    .action(async (opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.ref || !opts.label || !opts.project) {
            printInfo("Error: --ref, --label and --project are all required (or --from-json)");
            process.exit(1);
          }
          body = buildTaskBody(opts);
        }
        if (dryRunJson("tasks.create", { body })) return;
        const client = createClient();
        const id = await client.post<number>("tasks", body);
        announce(opts, `Created task with ID: ${id}`);
        await echoState(client, `tasks/${id}`, opts, taskDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  taskFieldOptions(
    addGetOptions(
      cmd
        .command("update")
        .description("Update a task (only the flags you pass are sent)")
        .argument("<id>", "Task ID"),
    )
      .option("--ref <ref>", "Task reference")
      .option("--label <text>", "Task label")
      .option("--project <id>", "Project ID"),
  )
    .addHelpText(
      "after",
      "\nThere is no status flag: Dolibarr silently ignores `fk_statut` on this PUT" +
        "\n(verified live — the stored status does not change). Close a task from the web UI.",
    )
    .action(async (id, opts) => {
      try {
        const body = buildTaskBody(opts);
        if (Object.keys(body).length === 0) {
          printInfo("Nothing to update — pass at least one field flag.");
          return;
        }
        if (dryRunJson("tasks.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`tasks/${id}`, body);
        announce(opts, `Updated task ${id}`);
        await echoState(client, `tasks/${id}`, opts, taskDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd
    .command("delete")
    .description("Delete a task")
    .argument("<id>", "Task ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      "\nA task with time-spent lines cannot be deleted — Dolibarr returns" +
        "\n`ErrorRecordHasChildren`. Remove its lines first with `tasks timespent delete`.",
    )
    .action(async (id, opts) => {
      try {
        if (dryRunJson("tasks.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete task ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`tasks/${id}`);
        announce(opts, `Deleted task ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  addGetOptions(
    cmd
      .command("roles")
      .description("List the user roles assigned on a task")
      .argument("<id>", "Task ID"),
  )
    .option("--user <id>", "Restrict to one user ID")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(`tasks/${id}/roles`, {
          userid: opts.user,
        });
        renderList(Array.isArray(items) ? items : [], {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "fk_user", label: "User" },
            { key: "fk_c_type_contact", label: "Contact type" },
            { key: "code", label: "Code" },
            { key: "libelle", label: "Label" },
          ],
        });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd.addCommand(createTimespentCommand());

  cmd.addHelpText(
    "after",
    "\nNotes (Dolibarr 20.0.4, verified live):" +
      "\n  • No /tasks/ref/{ref} route — `get` takes a numeric ID." +
      "\n  • Time spent is added at /tasks/{id}/addtimespent; there is no GET or POST on" +
      "\n    /tasks/{id}/timespent, so read totals via `get --with-timespent`." +
      "\n  • The time-spent `date` is a `YYYY-MM-DD HH:MM:SS` string, not an epoch — this" +
      "\n    CLI converts whatever you pass, including plain YYYY-MM-DD.",
  );

  return cmd;
}

/** `tasks timespent` — time-spent entries on a task. */
function createTimespentCommand(): Command {
  const grp = new Command("timespent").description("Record and adjust time spent on a task");

  addGetOptions(
    grp
      .command("add")
      .description("Add a time-spent entry to a task")
      .argument("<id>", "Task ID"),
  )
    .requiredOption("--date <datetime>", "When the time was spent (YYYY-MM-DD [HH:MM:SS])")
    .option("--hours <n>", "Duration in hours (converted to seconds)")
    .option("--duration <secs>", "Duration in seconds (alternative to --hours)")
    .option("--user <id>", "User the time belongs to (defaults to the API user)")
    .option("--note <text>", "Note")
    .action(async (id, opts) => {
      try {
        const body = buildTimespentBody(opts);
        if (dryRunJson("tasks.timespent.add", { id, body })) return;
        const client = createClient();
        await client.post<unknown>(`tasks/${id}/addtimespent`, body);
        announce(opts, `Added time spent to task ${id}`);
        await echoState(client, `tasks/${id}`, opts, taskDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    grp
      .command("update")
      .description("Update a time-spent entry")
      .argument("<id>", "Task ID")
      .argument("<line-id>", "Time-spent line ID"),
  )
    .requiredOption("--date <datetime>", "When the time was spent (YYYY-MM-DD [HH:MM:SS])")
    .option("--hours <n>", "Duration in hours (converted to seconds)")
    .option("--duration <secs>", "Duration in seconds (alternative to --hours)")
    .option("--user <id>", "User the time belongs to")
    .option("--note <text>", "Note")
    .action(async (id, lineId, opts) => {
      try {
        const body = buildTimespentBody(opts);
        if (dryRunJson("tasks.timespent.update", { id, lineId, body })) return;
        const client = createClient();
        await client.put<unknown>(`tasks/${id}/timespent/${lineId}`, body);
        announce(opts, `Updated time-spent line ${lineId} on task ${id}`);
        await echoState(client, `tasks/${id}`, opts, taskDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  grp
    .command("delete")
    .description("Delete a time-spent entry")
    .argument("<id>", "Task ID")
    .argument("<line-id>", "Time-spent line ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, lineId, opts) => {
      try {
        if (dryRunJson("tasks.timespent.delete", { id, lineId })) return;
        if (
          !(await confirmOrCancel(
            `Delete time-spent line ${lineId} on task ${id}?`,
            opts,
          ))
        )
          return;
        const client = createClient();
        await client.delete(`tasks/${id}/timespent/${lineId}`);
        announce(opts, `Deleted time-spent line ${lineId} on task ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  return grp;
}
