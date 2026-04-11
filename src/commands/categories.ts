import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

const TYPE_MAP: Record<string, string> = {
  "0": "Products",
  "1": "Suppliers",
  "2": "Customers",
  "3": "Members",
  "4": "Contacts",
  "5": "Bank accounts",
  "6": "Projects",
  "7": "Users",
  "8": "Bank lines",
  "9": "Warehouses",
  "10": "Tickets",
};

export function createCategoriesCommand(): Command {
  const cmd = new Command("categories").description("Manage categories");

  cmd
    .command("list")
    .description("List categories")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .option("--type <n>", "Filter by type (0=products, 1=suppliers, 2=customers, etc.)")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("categories", {
          limit: opts.limit,
          page: opts.page,
          sortfield: opts.sort ? `t.${opts.sort}` : undefined,
          sortorder: opts.order,
          sqlfilters: opts.filter,
          type: opts.type,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.label ?? ""),
          TYPE_MAP[String(i.type)] ?? String(i.type ?? ""),
          String(i.description ?? "").substring(0, 40),
        ]);
        printTable(rows, ["ID", "Label", "Type", "Description"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get category details")
    .argument("<id>", "Category ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`categories/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Label", String(item.label ?? "")],
          ["Type", TYPE_MAP[String(item.type)] ?? String(item.type ?? "")],
          ["Description", String(item.description ?? "")],
          ["Color", String(item.color ?? "")],
          ["Parent ID", String(item.fk_parent ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("create")
    .description("Create a category")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .requiredOption("--label <label>", "Category name")
    .requiredOption("--type <n>", "Category type (0=products, 1=suppliers, 2=customers, etc.)")
    .option("--description <text>", "Description")
    .option("--color <hex>", "Color hex code")
    .option("--parent <id>", "Parent category ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          body = {
            label: opts.label,
            type: Number(opts.type),
          };
          if (opts.description) body.description = opts.description;
          if (opts.color) body.color = opts.color;
          if (opts.parent) body.fk_parent = Number(opts.parent);
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "categories.create", body }); return; }
        const result = await client.post<number>("categories", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created category with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a category")
    .argument("<id>", "Category ID")
    .option("--json", "Output as JSON")
    .option("--label <label>", "Category name")
    .option("--description <text>", "Description")
    .option("--color <hex>", "Color hex code")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.label) body.label = opts.label;
        if (opts.description) body.description = opts.description;
        if (opts.color) body.color = opts.color;
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "categories.update", id, body }); return; }
        const result = await client.put<unknown>(`categories/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated category ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a category")
    .argument("<id>", "Category ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete category ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "categories.delete", id }); return; }
        const client = createClient();
        await client.delete(`categories/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted category ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("objects")
    .description("List objects in a category")
    .argument("<id>", "Category ID")
    .requiredOption("--type <type>", "Object type (customer, supplier, product, contact, member)")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(`categories/${id}/objects`, {
          type: opts.type,
          limit: opts.limit,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.ref ?? i.name ?? i.label ?? i.lastname ?? ""),
        ]);
        printTable(rows, ["ID", "Name/Ref"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
