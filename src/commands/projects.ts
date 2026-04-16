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

const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "Closed",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

export function createProjectsCommand(): Command {
  const cmd = new Command("projects").description("Manage projects");

  addListOptions(
    cmd
      .command("list")
      .description("List projects"),
  )
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .option("--status <n>", "Filter by status (0=draft, 1=validated, 2=closed)")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "projects",
          buildListQuery(opts, {
            thirdparty_ids: opts.thirdparty,
            status: opts.status,
          }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "title", label: "Title" },
            { key: "socid", label: "Thirdparty" },
            { key: "date_start", label: "Start", format: (i) => tsToDate(i.date_start) },
            { key: "date_end", label: "End", format: (i) => tsToDate(i.date_end) },
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
      .description("Get project details (accepts numeric id or ref)")
      .argument("<id-or-ref>", "Project ID or ref"),
  )
    .action(async (idOrRef, opts) => {
      try {
        const client = createClient();
        const item = await client.getByRefOrId<Record<string, unknown>>("projects", idOrRef);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "title", label: "Title" },
            { key: "socid", label: "Thirdparty ID" },
            { key: "description", label: "Description" },
            { key: "date_start", label: "Start", format: (i) => tsToDate(i.date_start) },
            { key: "date_end", label: "End", format: (i) => tsToDate(i.date_end) },
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
    .description("Create a project")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--ref <ref>", "Project ref (required)")
    .option("--title <title>", "Project title (required)")
    .option("--socid <id>", "Thirdparty ID")
    .option("--description <text>", "Project description")
    .option("--date-start <date>", "Start date (YYYY-MM-DD)")
    .option("--date-end <date>", "End date (YYYY-MM-DD)")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;

        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.ref || !opts.title) {
            printInfo("Error: --ref and --title are required");
            process.exit(1);
          }
          body = { ref: opts.ref, title: opts.title };
          if (opts.socid) body.socid = Number(opts.socid);
          if (opts.description) body.description = opts.description;
          if (opts.dateStart) body.date_start = Math.floor(new Date(opts.dateStart).getTime() / 1000);
          if (opts.dateEnd) body.date_end = Math.floor(new Date(opts.dateEnd).getTime() / 1000);
        }

        if (dryRunJson("projects.create", { body })) return;

        const result = await client.post<number>("projects", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created project with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a project")
    .argument("<id>", "Project ID")
    .option("--json", "Output as JSON")
    .option("--title <title>", "New title")
    .option("--description <text>", "New description")
    .option("--date-start <date>", "Start date (YYYY-MM-DD)")
    .option("--date-end <date>", "End date (YYYY-MM-DD)")
    .option("--status <n>", "Status (0=draft, 1=validated, 2=closed)")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.title) body.title = opts.title;
        if (opts.description) body.description = opts.description;
        if (opts.dateStart) body.date_start = Math.floor(new Date(opts.dateStart).getTime() / 1000);
        if (opts.dateEnd) body.date_end = Math.floor(new Date(opts.dateEnd).getTime() / 1000);
        if (opts.status !== undefined) body.status = Number(opts.status);

        if (dryRunJson("projects.update", { id, body })) return;

        const result = await client.put<unknown>(`projects/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated project ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a project")
    .argument("<id>", "Project ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete project ${id}?`, opts))) return;
        if (dryRunJson("projects.delete", { id })) return;
        const client = createClient();
        await client.delete(`projects/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted project ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("tasks")
      .description("List tasks for a project")
      .argument("<project-id>", "Project ID"),
  )
    .option("--with-timespent", "Include time spent per task")
    .action(async (projectId, opts) => {
      try {
        const client = createClient();
        const tasks = await client.get<Record<string, unknown>[]>(
          `projects/${projectId}/tasks`,
          { includetimespent: opts.withTimespent ? 1 : undefined },
        );
        renderList(tasks, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "label", label: "Label" },
            { key: "progress", label: "Progress" },
            { key: "duration_effective", label: "Duration (s)" },
            { key: "date_start", label: "Start", format: (t) => tsToDate(t.date_start) },
            { key: "date_end", label: "End", format: (t) => tsToDate(t.date_end) },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  return cmd;
}
