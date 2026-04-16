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

// Status codes per Dolibarr ticket lifecycle.
const STATUS_MAP: Record<string, string> = {
  "0": "Unread",
  "1": "Read",
  "3": "Assigned",
  "5": "In progress",
  "6": "Need more info",
  "7": "Waiting",
  "8": "Closed",
  "9": "Deleted",
};

export function createTicketsCommand(): Command {
  const cmd = new Command("tickets").description("Manage tickets (support / help desk)");

  addListOptions(
    cmd
      .command("list")
      .description("List tickets"),
  )
    .option("--thirdparty <id>", "Filter by thirdparty ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "tickets",
          buildListQuery(opts, {
            socid: opts.thirdparty,
          }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "track_id", label: "Track ID" },
            {
              key: "subject",
              label: "Subject",
              format: (t) => String(t.subject ?? "").substring(0, 40),
            },
            { key: "socid", label: "Thirdparty" },
            { key: "severity_code", label: "Severity" },
            {
              key: "fk_statut",
              label: "Status",
              format: (t) => {
                const s = t.fk_statut ?? t.status;
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
      .description("Get ticket details (accepts numeric id, ref, or --track-id)")
      .argument("[id-or-ref]", "Ticket ID or ref (omit when using --track-id)"),
  )
    .option("--track-id <track>", "Look up by public track ID instead of id/ref")
    .action(async (idOrRef, opts) => {
      try {
        const client = createClient();
        let item: Record<string, unknown>;
        if (opts.trackId) {
          item = await client.get<Record<string, unknown>>(
            `tickets/track_id/${encodeURIComponent(String(opts.trackId))}`,
          );
        } else {
          if (!idOrRef) {
            printInfo("Error: provide a ticket id/ref as the argument, or use --track-id");
            process.exit(1);
          }
          item = await client.getByRefOrId<Record<string, unknown>>("tickets", idOrRef);
        }
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "track_id", label: "Track ID" },
            { key: "subject", label: "Subject" },
            { key: "message", label: "Message" },
            { key: "socid", label: "Thirdparty ID" },
            { key: "type_code", label: "Type" },
            { key: "category_code", label: "Category" },
            { key: "severity_code", label: "Severity" },
            {
              key: "fk_statut",
              label: "Status",
              format: (t) => {
                const s = t.fk_statut ?? t.status;
                return STATUS_MAP[String(s)] ?? String(s ?? "");
              },
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create")
    .description("Create a ticket")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--subject <text>", "Ticket subject (required)")
    .option("--message <text>", "Initial message (required)")
    .option("--socid <id>", "Thirdparty ID")
    .option("--category <code>", "Category code")
    .option("--severity <code>", "Severity code")
    .option("--type <code>", "Type code")
    .option("--project <id>", "Linked project ID (fk_project)")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;

        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.subject || !opts.message) {
            printInfo("Error: --subject and --message are required");
            process.exit(1);
          }
          body = { subject: opts.subject, message: opts.message };
          if (opts.socid) body.socid = Number(opts.socid);
          if (opts.category) body.category_code = opts.category;
          if (opts.severity) body.severity_code = opts.severity;
          if (opts.type) body.type_code = opts.type;
          if (opts.project) body.fk_project = Number(opts.project);
        }

        if (dryRunJson("tickets.create", { body })) return;

        const result = await client.post<number>("tickets", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created ticket with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a ticket")
    .argument("<id>", "Ticket ID")
    .option("--json", "Output as JSON")
    .option("--subject <text>", "New subject")
    .option("--message <text>", "New message")
    .option("--severity <code>", "New severity code")
    .option("--status <n>", "New status code")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.subject) body.subject = opts.subject;
        if (opts.message) body.message = opts.message;
        if (opts.severity) body.severity_code = opts.severity;
        if (opts.status !== undefined) body.fk_statut = Number(opts.status);

        if (dryRunJson("tickets.update", { id, body })) return;

        const result = await client.put<unknown>(`tickets/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated ticket ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a ticket")
    .argument("<id>", "Ticket ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete ticket ${id}?`, opts))) return;
        if (dryRunJson("tickets.delete", { id })) return;
        const client = createClient();
        await client.delete(`tickets/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted ticket ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("reply")
    .description("Post a message to a ticket")
    .argument("<track-id>", "Public track ID of the ticket")
    .option("--json", "Output as JSON")
    .requiredOption("--message <text>", "Message body")
    .action(async (trackId, opts) => {
      try {
        const body: Record<string, unknown> = {
          track_id: trackId,
          message: opts.message,
        };
        if (dryRunJson("tickets.reply", { body })) return;
        const client = createClient();
        const result = await client.post<unknown>("tickets/messages", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Reply posted to ticket ${trackId}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
