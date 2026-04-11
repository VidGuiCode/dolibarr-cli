import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

export function createProductsCommand(): Command {
  const cmd = new Command("products").description("Manage products and services");

  cmd
    .command("list")
    .description("List products and services")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .option("--type <type>", "Filter by type (product or service)")
    .option("--category <id>", "Filter by category ID")
    .option("--include-stock", "Include stock data")
    .action(async (opts) => {
      try {
        const client = createClient();
        let mode: string | undefined;
        if (opts.type === "product") mode = "1";
        else if (opts.type === "service") mode = "2";

        const items = await client.get<Record<string, unknown>[]>("products", {
          limit: opts.limit,
          page: opts.page,
          sortfield: opts.sort ? `t.${opts.sort}` : undefined,
          sortorder: opts.order,
          sqlfilters: opts.filter,
          mode,
          category: opts.category,
          includestockdata: opts.includeStock ? 1 : undefined,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.ref ?? ""),
          String(i.label ?? ""),
          String(i.price ?? ""),
          Number(i.type) === 1 ? "Service" : "Product",
          String(i.status ?? ""),
        ]);
        printTable(rows, ["ID", "Ref", "Label", "Price", "Type", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get product details")
    .argument("<id>", "Product ID")
    .option("--json", "Output as JSON")
    .option("--include-stock", "Include stock data")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`products/${id}`, {
          includestockdata: opts.includeStock ? 1 : undefined,
        });
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Ref", String(item.ref ?? "")],
          ["Label", String(item.label ?? "")],
          ["Type", Number(item.type) === 1 ? "Service" : "Product"],
          ["Price", String(item.price ?? "")],
          ["Price TTC", String(item.price_ttc ?? "")],
          ["VAT rate", String(item.tva_tx ?? "")],
          ["Barcode", String(item.barcode ?? "")],
          ["Description", String(item.description ?? "").substring(0, 80)],
          ["Status (sell)", String(item.status ?? "")],
          ["Status (buy)", String(item.status_buy ?? "")],
          ["Stock", String(item.stock_reel ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("create")
    .description("Create a product or service")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--label <label>", "Product label (required)")
    .option("--ref <ref>", "Product reference")
    .option("--type <n>", "0=product, 1=service", "0")
    .option("--price <n>", "Selling price excl. tax")
    .option("--tva-tx <n>", "VAT rate")
    .option("--description <text>", "Description")
    .option("--barcode <code>", "Barcode")
    .option("--status <n>", "Sell status (0=disabled, 1=enabled)", "1")
    .option("--status-buy <n>", "Buy status (0=disabled, 1=enabled)", "1")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.label) { printInfo("Error: --label is required"); process.exit(1); }
          body = {
            label: opts.label,
            type: Number(opts.type),
            status: Number(opts.status),
            status_buy: Number(opts.statusBuy),
          };
          if (opts.ref) body.ref = opts.ref;
          if (opts.price) body.price = Number(opts.price);
          if (opts.tvaTx) body.tva_tx = Number(opts.tvaTx);
          if (opts.description) body.description = opts.description;
          if (opts.barcode) body.barcode = opts.barcode;
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "products.create", body }); return; }
        const result = await client.post<number>("products", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created product with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a product or service")
    .argument("<id>", "Product ID")
    .option("--json", "Output as JSON")
    .option("--label <label>", "Product label")
    .option("--price <n>", "Selling price excl. tax")
    .option("--description <text>", "Description")
    .option("--status <n>", "Sell status")
    .option("--status-buy <n>", "Buy status")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.label) body.label = opts.label;
        if (opts.price) body.price = Number(opts.price);
        if (opts.description) body.description = opts.description;
        if (opts.status) body.status = Number(opts.status);
        if (opts.statusBuy) body.status_buy = Number(opts.statusBuy);
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "products.update", id, body }); return; }
        const result = await client.put<unknown>(`products/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated product ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a product or service")
    .argument("<id>", "Product ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete product ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "products.delete", id }); return; }
        const client = createClient();
        await client.delete(`products/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted product ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("stock")
    .description("Show stock levels for a product")
    .argument("<id>", "Product ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`products/${id}`, {
          includestockdata: 1,
        });
        if (opts.json) { printJson({ id: item.id, ref: item.ref, label: item.label, stock_reel: item.stock_reel, stock_warehouses: item.stock_warehouses }); return; }

        printInfo(`Stock for ${item.ref ?? item.label ?? id}:`);
        printInfo(`  Total: ${item.stock_reel ?? 0}`);

        const warehouses = item.stock_warehouses as Record<string, Record<string, unknown>> | undefined;
        if (warehouses && typeof warehouses === "object") {
          const rows: string[][] = [];
          for (const [whId, wh] of Object.entries(warehouses)) {
            rows.push([whId, String(wh.real ?? 0)]);
          }
          if (rows.length > 0) {
            printTable(rows, ["Warehouse ID", "Stock"]);
          }
        }
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
