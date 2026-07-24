import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import {
  buildStockMovementBody,
  buildStockMovementFilter,
  stockMovementColumns,
} from "../core/stock.js";
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

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const warehouseListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref", format: (i) => String(i.ref ?? i.label ?? "") },
  { key: "label", label: "Label" },
  { key: "lieu", label: "Location" },
  { key: "fk_parent", label: "Parent" },
  {
    key: "statut",
    label: "Status",
    format: (i) => {
      const s = i.statut ?? i.status;
      if (String(s) === "1") return "Open";
      if (String(s) === "0") return "Closed";
      return String(s ?? "");
    },
  },
];

export const warehouseDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref", format: (i) => String(i.ref ?? i.label ?? "") },
  { key: "label", label: "Label" },
  { key: "lieu", label: "Location" },
  { key: "description", label: "Description" },
  { key: "address", label: "Address" },
  { key: "zip", label: "Zip" },
  { key: "town", label: "Town" },
  { key: "country_id", label: "Country ID" },
  { key: "phone", label: "Phone" },
  { key: "fk_parent", label: "Parent warehouse" },
  { key: "stock_reel", label: "Stock qty" },
  { key: "stock_theorique", label: "Theoretical qty" },
  {
    key: "statut",
    label: "Status",
    format: (i) => (String(i.statut ?? i.status) === "1" ? "Open" : "Closed"),
  },
];

/** Build the POST/PUT body for a warehouse. Only passed flags become part of the body. */
export function buildWarehouseBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    label: opts.label,
    lieu: opts.location,
    description: opts.description,
    address: opts.address,
    zip: opts.zip,
    town: opts.town,
    country_id: opts.country === undefined ? undefined : Number(opts.country),
    phone: opts.phone,
    fk_parent: opts.parent === undefined ? undefined : Number(opts.parent),
    statut: opts.status === undefined ? undefined : Number(opts.status),
  });
}

export function createStockCommand(): Command {
  const cmd = new Command("stock").description(
    "Manage warehouses and stock movements (warehouse-centric view)",
  );

  cmd.addCommand(createWarehousesCommand());
  cmd.addCommand(createMovementsCommand());

  cmd.addHelpText(
    "after",
    "\nRelationship to the `products` group (same endpoints, different entry point):" +
      "\n  • `stock movements list`      ≈ `products stock-movements`" +
      "\n  • `stock movements create`    ≈ `products correct-stock <product-id>`" +
      "\n  • per-product stock per warehouse lives on `products get --includestockdata`." +
      "\nUse whichever reads better; both call GET/POST /stockmovements via shared helpers." +
      "\n\nDolibarr 20.0.4 exposes no GET/PUT/DELETE on a single stock movement — the" +
      "\nledger is append-only, so there is no `movements get/update/delete`.",
  );

  return cmd;
}

/** `stock warehouses` — warehouse CRUD (`/warehouses`). */
function createWarehousesCommand(): Command {
  const grp = new Command("warehouses").description("Manage warehouses");

  addListOptions(grp.command("list").description("List warehouses"))
    .option("--category <id>", "Filter by category ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "warehouses",
          buildListQuery(opts, { category: opts.category }),
        );
        renderList(items, { opts, columns: warehouseListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    grp.command("get").description("Get warehouse details").argument("<id>", "Warehouse ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`warehouses/${id}`);
      renderGet(item, { opts, fields: warehouseDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const warehouseFieldOptions = (c: Command): Command =>
    c
      .option("--location <text>", "Location (lieu)")
      .option("--description <text>", "Description")
      .option("--address <text>", "Address")
      .option("--zip <zip>", "Postal code")
      .option("--town <town>", "Town")
      .option("--country <id>", "Country ID")
      .option("--phone <phone>", "Phone number")
      .option("--parent <id>", "Parent warehouse ID")
      .option("--status <0|1>", "Status: 1 open, 0 closed");

  warehouseFieldOptions(
    addGetOptions(grp.command("create").description("Create a warehouse"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--label <text>", "Warehouse label (required)"),
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
        body = buildWarehouseBody(opts);
      }
      if (dryRunJson("stock.warehouses.create", { body })) return;
      const client = createClient();
      const id = await client.post<number>("warehouses", body);
      announce(opts, `Created warehouse with ID: ${id}`);
      await echoState(client, `warehouses/${id}`, opts, warehouseDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  warehouseFieldOptions(
    addGetOptions(
      grp
        .command("update")
        .description("Update a warehouse (only the flags you pass are sent)")
        .argument("<id>", "Warehouse ID"),
    ).option("--label <text>", "Warehouse label"),
  ).action(async (id, opts) => {
    try {
      const body = buildWarehouseBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("stock.warehouses.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`warehouses/${id}`, body);
      announce(opts, `Updated warehouse ${id}`);
      await echoState(client, `warehouses/${id}`, opts, warehouseDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  grp
    .command("delete")
    .description("Delete a warehouse")
    .argument("<id>", "Warehouse ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("stock.warehouses.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete warehouse ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`warehouses/${id}`);
        announce(opts, `Deleted warehouse ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  grp.addHelpText(
    "after",
    "\nNo /warehouses/ref/{ref} route exists on Dolibarr 20.0.4, so `get` takes a" +
      "\nnumeric ID only.",
  );

  return grp;
}

/** `stock movements` — the append-only stock movement ledger (`/stockmovements`). */
function createMovementsCommand(): Command {
  const grp = new Command("movements").description("List and record stock movements");

  addListOptions(grp.command("list").description("List stock movements"))
    .option("--product <id>", "Filter by product ID")
    .option("--warehouse <id>", "Filter by warehouse ID")
    .addHelpText(
      "after",
      "\nSame endpoint as `products stock-movements` — this is the warehouse-first entry point.",
    )
    .action(async (opts) => {
      try {
        const sqlfilters = buildStockMovementFilter(opts) ?? opts.filter;
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "stockmovements",
          buildListQuery({ ...opts, filter: sqlfilters }),
        );
        renderList(items, { opts, columns: stockMovementColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  grp
    .command("create")
    .description("Record a stock movement in or out of a warehouse (MUTATES stock)")
    .requiredOption("--warehouse <id>", "Warehouse ID")
    .requiredOption("--product <id>", "Product ID")
    .requiredOption("--qty <n>", "Quantity delta (positive=in, negative=out)")
    .option("--type <n>", "Movement type (0=input, 1=output, 2=transfer in, 3=transfer out)")
    .option("--lot <lot>", "Batch/lot number")
    .option("--label <text>", "Movement label")
    .option("--code <code>", "Movement code")
    .option("--price <n>", "Unit price")
    .option("--date <date>", "Movement date (YYYY-MM-DD or epoch)")
    .option("--origin-type <type>", "Origin object type (e.g. order)")
    .option("--origin-id <id>", "Origin object ID")
    .option("--from-json <file>", "Send a raw JSON body instead of building one")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      "\n⚠️  This changes real inventory levels via POST /stockmovements. It is guarded:" +
        "\npreview with --dry-run, and a confirmation (or --confirm) is required — in a" +
        "\nnon-interactive shell without --confirm it refuses to proceed." +
        "\n\nThe route and its three mandatory fields (product_id, warehouse_id, qty) were" +
        "\nconfirmed against the live API's validator, but the write could NOT be exercised" +
        "\n— the reference instance's API user lacks stock permissions." +
        "\n\nSee also: `dolibarr products correct-stock <product-id>` — the same endpoint," +
        "\nproduct-first.",
    )
    .action(async (opts) => {
      try {
        const body = opts.fromJson
          ? (JSON.parse(fs.readFileSync(opts.fromJson, "utf-8")) as Record<string, unknown>)
          : buildStockMovementBody(String(opts.product), opts);
        if (dryRunJson("stock.movements.create", { body })) return;
        if (
          !(await confirmOrCancel(
            `Move ${opts.qty} of product ${opts.product} in warehouse ${opts.warehouse}? This changes real inventory.`,
            opts,
          ))
        )
          return;
        const client = createClient();
        const id = await client.post<number>("stockmovements", body);
        announce(opts, `Recorded stock movement ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  return grp;
}
