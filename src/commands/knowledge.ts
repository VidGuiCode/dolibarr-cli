import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
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

/** The knowledge-record REST base path — nested under the module name. */
const BASE = "knowledgemanagement/knowledgerecords";

/** Knowledge record statuses per Dolibarr's KnowledgeRecord class. */
const STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "9": "Obsolete",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const statusLabel = (i: Record<string, unknown>): string => {
  const s = i.status ?? i.statut;
  return STATUS_MAP[String(s)] ?? String(s ?? "");
};

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const knowledgeListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  {
    key: "question",
    label: "Question",
    format: (i) => String(i.question ?? i.label ?? "").slice(0, 50),
  },
  { key: "lang", label: "Lang" },
  { key: "fk_c_ticket_category", label: "Category" },
  { key: "date_creation", label: "Created", format: (i) => tsToDate(i.date_creation) },
  { key: "status", label: "Status", format: statusLabel },
];

export const knowledgeDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "question", label: "Question" },
  { key: "answer", label: "Answer" },
  { key: "lang", label: "Language" },
  { key: "fk_c_ticket_category", label: "Ticket category ID" },
  { key: "url", label: "URL" },
  { key: "date_creation", label: "Created", format: (i) => tsToDate(i.date_creation) },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "status", label: "Status", format: statusLabel },
];

/**
 * Build the POST/PUT body for a knowledge record. Only passed flags become part of the
 * body, so the same builder serves `create` and `update`.
 */
export function buildKnowledgeBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    ref: opts.ref,
    question: opts.question,
    answer: opts.answer,
    lang: opts.lang,
    url: opts.url,
    fk_c_ticket_category:
      opts.category === undefined ? undefined : Number(opts.category),
    status: opts.status === undefined ? undefined : Number(opts.status),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
}

export function createKnowledgeCommand(): Command {
  const cmd = new Command("knowledge").description(
    "Manage knowledge-base articles (knowledge management)",
  );

  addListOptions(cmd.command("list").description("List knowledge records")).action(
    async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(BASE, buildListQuery(opts));
        renderList(items, { opts, columns: knowledgeListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    },
  );

  addGetOptions(
    cmd
      .command("get")
      .description("Get a knowledge record")
      .argument("<id>", "Knowledge record ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`${BASE}/${id}`);
      renderGet(item, { opts, fields: knowledgeDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const recordFieldOptions = (c: Command): Command =>
    c
      .option("--answer <text>", "Answer body")
      .option("--lang <code>", "Language code, e.g. en_US")
      .option("--url <url>", "Related URL")
      .option("--category <id>", "Ticket category ID")
      .option("--status <n>", "Status: 0 draft, 1 validated, 9 obsolete")
      .option("--note-public <text>", "Public note")
      .option("--note-private <text>", "Private note");

  recordFieldOptions(
    addGetOptions(cmd.command("create").description("Create a knowledge record"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--question <text>", "Question / title (required)")
      .option("--ref <ref>", "Reference"),
  ).action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.fromJson) {
        body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
      } else {
        if (!opts.question) {
          printInfo("Error: --question is required (or use --from-json)");
          process.exit(1);
        }
        body = buildKnowledgeBody(opts);
      }
      if (dryRunJson("knowledge.create", { body })) return;
      const client = createClient();
      const id = await client.post<number>(BASE, body);
      announce(opts, `Created knowledge record with ID: ${id}`);
      await echoState(client, `${BASE}/${id}`, opts, knowledgeDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  recordFieldOptions(
    addGetOptions(
      cmd
        .command("update")
        .description("Update a knowledge record (only the flags you pass are sent)")
        .argument("<id>", "Knowledge record ID"),
    )
      .option("--question <text>", "Question / title")
      .option("--ref <ref>", "Reference"),
  ).action(async (id, opts) => {
    try {
      const body = buildKnowledgeBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("knowledge.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`${BASE}/${id}`, body);
      announce(opts, `Updated knowledge record ${id}`);
      await echoState(client, `${BASE}/${id}`, opts, knowledgeDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  cmd
    .command("delete")
    .description("Delete a knowledge record")
    .argument("<id>", "Knowledge record ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("knowledge.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete knowledge record ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`${BASE}/${id}`);
        announce(opts, `Deleted knowledge record ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  cmd.addHelpText(
    "after",
    "\nPath quirk: these records live at `knowledgemanagement/knowledgerecords` — a nested," +
      "\nmodule-prefixed path. A bare `knowledgemanagement` or `knowledgerecords` returns" +
      "\n404/501, so the module name cannot be dropped." +
      "\n\nNo /ref/{ref} route exists, so `get` takes a numeric ID. The routes are confirmed" +
      "\nbut permission-gated on the reference instance (403), so request bodies are" +
      "\ndocs-sourced and were not exercised live.",
  );

  return cmd;
}
