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

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const currencyListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  {
    key: "rate",
    label: "Rate",
    format: (i) => {
      const r = i.rate as Record<string, unknown> | undefined;
      if (r && typeof r === "object") return String(r.rate ?? "");
      return String(i.rate ?? "");
    },
  },
  { key: "date_creation", label: "Created", format: (i) => tsToDate(i.date_creation) },
];

export const currencyDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "entity", label: "Entity" },
  {
    key: "rate",
    label: "Current rate",
    format: (i) => {
      const r = i.rate as Record<string, unknown> | undefined;
      if (r && typeof r === "object") return String(r.rate ?? "");
      return String(i.rate ?? "");
    },
  },
  { key: "date_creation", label: "Created", format: (i) => tsToDate(i.date_creation) },
];

export const currencyRateColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "rate", label: "Rate" },
  {
    key: "date_sync",
    label: "Synced",
    format: (i) => tsToDate(i.date_sync ?? i.date_creation),
  },
  { key: "fk_multicurrency", label: "Currency ID" },
];

/**
 * Build the POST body for a currency.
 * `code` and `name` are both mandatory — confirmed by the live API's validator.
 */
export function buildCurrencyBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    code: opts.code,
    name: opts.name,
    rate: opts.rate === undefined ? undefined : Number(opts.rate),
  });
}

export function createMulticurrenciesCommand(): Command {
  const cmd = new Command("multicurrencies").description(
    "Manage multi-currency definitions and their FX rates",
  );

  addListOptions(cmd.command("list").description("List currencies")).action(async (opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        "multicurrencies",
        buildListQuery(opts),
      );
      renderList(items, { opts, columns: currencyListColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    cmd.command("get").description("Get currency details").argument("<id>", "Currency ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`multicurrencies/${id}`);
      renderGet(item, { opts, fields: currencyDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addListOptions(
    cmd
      .command("rates")
      .description("List the recorded FX rates of a currency")
      .argument("<id>", "Currency ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(`multicurrencies/${id}/rates`);
      renderList(Array.isArray(items) ? items : [], { opts, columns: currencyRateColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(cmd.command("create").description("Create a currency"))
    .option("--from-json <file>", "Create from a JSON file")
    .option("--code <code>", "ISO currency code, e.g. USD (required)")
    .option("--name <name>", "Currency name (required)")
    .option("--rate <n>", "Initial FX rate")
    .action(async (opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.code || !opts.name) {
            printInfo("Error: --code and --name are both required (or use --from-json)");
            process.exit(1);
          }
          body = buildCurrencyBody(opts);
        }
        if (dryRunJson("multicurrencies.create", { body })) return;
        const client = createClient();
        const id = await client.post<number>("multicurrencies", body);
        announce(opts, `Created currency with ID: ${id}`);
        await echoState(client, `multicurrencies/${id}`, opts, currencyDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("update")
      .description("Update a currency (only the flags you pass are sent)")
      .argument("<id>", "Currency ID"),
  )
    .option("--code <code>", "ISO currency code")
    .option("--name <name>", "Currency name")
    .action(async (id, opts) => {
      try {
        const body = prunePayload({ code: opts.code, name: opts.name });
        if (Object.keys(body).length === 0) {
          printInfo("Nothing to update — pass at least one field flag.");
          return;
        }
        if (dryRunJson("multicurrencies.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`multicurrencies/${id}`, body);
        announce(opts, `Updated currency ${id}`);
        await echoState(client, `multicurrencies/${id}`, opts, currencyDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd
      .command("set-rate")
      .description("Record a new FX rate for a currency")
      .argument("<id>", "Currency ID"),
  )
    .requiredOption("--rate <n>", "New FX rate")
    .option("--confirm", "Skip confirmation prompt")
    .addHelpText(
      "after",
      "\n⚠️  The rate drives how every multi-currency amount is converted, so this is" +
        "\nguarded: preview with --dry-run, and a confirmation (or --confirm) is required." +
        "\nThe route (PUT /multicurrencies/{id}/rates) is confirmed but was not exercised —" +
        "\nthe reference instance returns 403 \"Insufficient rights to update currency rate\".",
    )
    .action(async (id, opts) => {
      try {
        const body = { rate: Number(opts.rate) };
        if (dryRunJson("multicurrencies.setRate", { id, body })) return;
        if (!(await confirmOrCancel(`Set the FX rate of currency ${id} to ${opts.rate}?`, opts)))
          return;
        const client = createClient();
        await client.put<unknown>(`multicurrencies/${id}/rates`, body);
        announce(opts, `Set the FX rate of currency ${id} to ${opts.rate}`);
        await echoState(client, `multicurrencies/${id}`, opts, currencyDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  cmd
    .command("delete")
    .description("Delete a currency")
    .argument("<id>", "Currency ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("multicurrencies.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete currency ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`multicurrencies/${id}`);
        announce(opts, `Deleted currency ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  cmd.addHelpText(
    "after",
    "\nNotes (Dolibarr 20.0.4, verified by probing the router):" +
      "\n  • `code` and `name` are both mandatory on a create (per the API's validator)." +
      "\n  • The rate is updated with PUT /multicurrencies/{id}/rates — there is no" +
      "\n    POST /{id}/rates and no DELETE on an individual rate." +
      "\n  • No /multicurrencies/code/{code} lookup route exists, so `get` takes an ID." +
      "\n  • Reads and writes are permission-gated on the reference instance, so request" +
      "\n    bodies are docs-sourced and were not exercised live.",
  );

  return cmd;
}
