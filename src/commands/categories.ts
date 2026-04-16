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

  addListOptions(
    cmd
      .command("list")
      .description("List categories"),
  )
    .option("--type <n>", "Filter by type (0=products, 1=suppliers, 2=customers, etc.)")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "categories",
          buildListQuery(opts, { type: opts.type }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "label", label: "Label" },
            {
              key: "type",
              label: "Type",
              format: (i) => TYPE_MAP[String(i.type)] ?? String(i.type ?? ""),
            },
            {
              key: "description",
              label: "Description",
              format: (i) => String(i.description ?? "").substring(0, 40),
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get category details (accepts numeric id or ref)")
      .argument("<id-or-ref>", "Category ID or ref"),
  )
    .action(async (idOrRef, opts) => {
      try {
        const client = createClient();
        const item = await client.getByRefOrId<Record<string, unknown>>("categories", idOrRef);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "label", label: "Label" },
            {
              key: "type",
              label: "Type",
              format: (i) => TYPE_MAP[String(i.type)] ?? String(i.type ?? ""),
            },
            { key: "description", label: "Description" },
            { key: "color", label: "Color" },
            { key: "fk_parent", label: "Parent ID" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
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
        if (dryRunJson("categories.create", { body })) return;
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
        if (dryRunJson("categories.update", { id, body })) return;
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
        if (!(await confirmOrCancel(`Delete category ${id}?`, opts))) return;
        if (dryRunJson("categories.delete", { id })) return;
        const client = createClient();
        await client.delete(`categories/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted category ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("objects")
      .description("List objects in a category")
      .argument("<id>", "Category ID")
      .requiredOption("--type <type>", "Object type (customer, supplier, product, contact, member)")
      .option("--limit <n>", "Results per page", "50"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(`categories/${id}/objects`, {
          type: opts.type,
          limit: opts.limit,
        });
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            {
              key: "ref",
              label: "Name/Ref",
              format: (i) => String(i.ref ?? i.name ?? i.label ?? i.lastname ?? ""),
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  return cmd;
}
