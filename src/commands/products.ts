import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
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
import { toEpochSeconds } from "../core/dates.js";
import {
  buildStockMovementBody,
  buildStockMovementFilter,
  stockMovementColumns,
} from "../core/stock.js";

export function createProductsCommand(): Command {
  const cmd = new Command("products").description("Manage products and services");

  addListOptions(
    cmd
      .command("list")
      .description("List products and services"),
  )
    .option("--type <type>", "Filter by type (product or service)")
    .option("--category <id>", "Filter by category ID")
    .option("--include-stock", "Include stock data")
    .action(async (opts) => {
      try {
        const client = createClient();
        let mode: string | undefined;
        if (opts.type === "product") mode = "1";
        else if (opts.type === "service") mode = "2";

        const items = await client.get<Record<string, unknown>[]>(
          "products",
          buildListQuery(opts, {
            mode,
            category: opts.category,
            includestockdata: opts.includeStock ? 1 : undefined,
          }),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "label", label: "Label" },
            { key: "price", label: "Price" },
            {
              key: "type",
              label: "Type",
              format: (i) => (Number(i.type) === 1 ? "Service" : "Product"),
            },
            { key: "status", label: "Status" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get product details")
      .argument("<id>", "Product ID")
      .option("--include-stock", "Include stock data"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`products/${id}`, {
          includestockdata: opts.includeStock ? 1 : undefined,
        });
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "label", label: "Label" },
            {
              key: "type",
              label: "Type",
              format: (i) => (Number(i.type) === 1 ? "Service" : "Product"),
            },
            { key: "price", label: "Price" },
            { key: "price_ttc", label: "Price TTC" },
            { key: "tva_tx", label: "VAT rate" },
            { key: "barcode", label: "Barcode" },
            {
              key: "description",
              label: "Description",
              format: (i) => String(i.description ?? "").substring(0, 80),
            },
            { key: "status", label: "Status (sell)" },
            { key: "status_buy", label: "Status (buy)" },
            { key: "stock_reel", label: "Stock" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
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
        if (dryRunJson("products.create", { body })) return;
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
        if (dryRunJson("products.update", { id, body })) return;
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
        if (!(await confirmOrCancel(`Delete product ${id}?`, opts))) return;
        if (dryRunJson("products.delete", { id })) return;
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

  cmd.addCommand(createProductAttributesCommand());
  cmd.addCommand(createProductAttributeValuesCommand());
  cmd.addCommand(createProductVariantsCommand());
  cmd.addCommand(createProductSubproductsCommand());
  cmd.addCommand(createProductPurchasePricesCommand());
  cmd.addCommand(createProductMultipricesCommand());
  cmd.addCommand(createProductPriceByQtyCommand());
  cmd.addCommand(createProductStockMovementsCommand());
  cmd.addCommand(createProductCorrectStockCommand());

  return cmd;
}

/**
 * Build the POST body for a stock movement / correction.
 * Re-exported from `core/stock.ts`, which the warehouse-centric `stock` group shares.
 */
export { buildStockMovementBody };

/**
 * `products stock-movements` — list warehouse stock movements, product-first.
 * The warehouse-first equivalent is `stock movements list`; both hit
 * `GET /stockmovements` through the shared helpers in `core/stock.ts`.
 */
function createProductStockMovementsCommand(): Command {
  const cmd = new Command("stock-movements").description("List warehouse stock movements");
  addListOptions(cmd)
    .option("--product <id>", "Filter by product ID")
    .option("--warehouse <id>", "Filter by warehouse ID")
    .addHelpText("after", "\nSee also: `dolibarr stock movements list` (warehouse-first view).")
    .action(async (opts) => {
      try {
        const sqlfilters = buildStockMovementFilter(opts) ?? opts.filter;
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "stockmovements",
          buildListQuery({ ...opts, filter: sqlfilters }),
        );
        renderList(items, { opts, columns: stockMovementColumns });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });
  return cmd;
}

/**
 * `products correct-stock` — record a stock movement to correct inventory.
 *
 * ⚠️ This MUTATES inventory levels. Built against the route-confirmed
 * `POST /stockmovements` shape but NOT exercised against a live movement (the
 * reference instance's API user lacks stock permissions → 403). It requires an
 * explicit confirmation (or `--confirm`) and honors `--dry-run`.
 */
function createProductCorrectStockCommand(): Command {
  const cmd = new Command("correct-stock")
    .description("Record a stock movement to correct a product's inventory (MUTATES stock)")
    .argument("<product-id>", "Product ID")
    .requiredOption("--warehouse <id>", "Warehouse ID")
    .requiredOption("--qty <n>", "Quantity delta (positive=in, negative=out)")
    .option("--type <n>", "Movement type (0=input, 1=output, 2=transfer, 3=correction)")
    .option("--lot <lot>", "Batch/lot number")
    .option("--label <text>", "Movement label")
    .option("--code <code>", "Movement code")
    .option("--price <n>", "Unit price")
    .option("--date <date>", "Movement date (YYYY-MM-DD or epoch)")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      "\n⚠️  This changes real inventory levels via POST /stockmovements. Preview with" +
        "\n--dry-run first. It was authored from the documented API shape and could not be" +
        "\nexercised live on the reference instance (stock permission gated)." +
        "\n\nSee also: `dolibarr stock movements create` — the same endpoint, warehouse-first.",
    );
  cmd.action(async (productId, opts) => {
    try {
      const body = buildStockMovementBody(productId, opts);
      if (dryRunJson("products.correctStock", { body })) return;
      if (
        !(await confirmOrCancel(
          `Adjust stock of product ${productId} in warehouse ${opts.warehouse} by ${opts.qty}? This changes real inventory.`,
          opts,
        ))
      )
        return;
      const client = createClient();
      const result = await client.post<number>("stockmovements", body);
      if (opts.json) { printJson(result); return; }
      printInfo(`Recorded stock movement ${result} for product ${productId}.`);
    } catch (err) { exitWithError(err, Boolean(opts.json)); }
  });
  return cmd;
}

/** Build the POST body for a supplier (purchase) price. */
export function buildPurchasePriceBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    qty: Number(opts.qty ?? 1),
    buyprice: Number(opts.buyprice),
    price_base_type: (opts.priceBase as string) ?? "HT",
    fourn_id: Number(opts.supplier),
  };
  if (opts.refFourn !== undefined) body.ref_fourn = opts.refFourn;
  if (opts.tvaTx !== undefined) body.tva_tx = Number(opts.tvaTx);
  if (opts.deliveryDays !== undefined) body.delivery_time_days = Number(opts.deliveryDays);
  if (opts.availability !== undefined) body.availability = Number(opts.availability);
  return body;
}

/** `products purchase-prices` — supplier buying prices. */
function createProductPurchasePricesCommand(): Command {
  const grp = new Command("purchase-prices").description("Manage supplier (purchase) prices");

  addListOptions(
    grp
      .command("list")
      .description("List purchase prices for a product, or across all suppliers")
      .argument("[product-id]", "Product ID (omit to list all supplier products)"),
  )
    .option("--supplier <id>", "Filter by supplier ID (all-products mode)")
    .action(async (productId, opts) => {
      try {
        const client = createClient();
        const path = productId
          ? `products/${productId}/purchase_prices`
          : "products/purchase_prices";
        const items = await client.get<Record<string, unknown>[]>(
          path,
          productId ? undefined : buildListQuery(opts, { supplier: opts.supplier }),
        );
        renderList(Array.isArray(items) ? items : [items], {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "ref_supplier", label: "Supplier Ref", format: (i) => String(i.ref_supplier ?? i.ref_fourn ?? "") },
            { key: "fourn_id", label: "Supplier", format: (i) => String(i.fourn_id ?? i.socid ?? "") },
            { key: "qty", label: "Min Qty" },
            { key: "fourn_price", label: "Buy Price", format: (i) => String(i.fourn_price ?? i.buyprice ?? "") },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  grp
    .command("set")
    .description("Add or update a supplier price (Dolibarr upserts by supplier — there is no separate update route)")
    .argument("<product-id>", "Product ID")
    .requiredOption("--supplier <id>", "Supplier thirdparty ID")
    .requiredOption("--buyprice <n>", "Purchase price")
    .option("--qty <n>", "Minimum quantity", "1")
    .option("--price-base <type>", "HT or TTC", "HT")
    .option("--ref-fourn <ref>", "Supplier's product reference")
    .option("--tva-tx <n>", "VAT rate")
    .option("--delivery-days <n>", "Delivery time in days")
    .option("--availability <id>", "Availability delay ID")
    .option("--json", "Output as JSON")
    .action(async (productId, opts) => {
      try {
        const body = buildPurchasePriceBody(opts);
        if (dryRunJson("products.purchasePrices.set", { productId, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`products/${productId}/purchase_prices`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Set supplier price on product ${productId} (supplier ${opts.supplier}).`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("delete")
    .description("Delete a supplier price")
    .argument("<product-id>", "Product ID")
    .argument("<price-id>", "Purchase price ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (productId, priceId, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete purchase price ${priceId} on product ${productId}?`, opts)))
          return;
        if (dryRunJson("products.purchasePrices.delete", { productId, priceId })) return;
        const client = createClient();
        await client.delete(`products/${productId}/purchase_prices/${priceId}`);
        if (opts.json) { printJson({ deleted: priceId }); return; }
        printInfo(`Deleted purchase price ${priceId} on product ${productId}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `products multiprices` — read selling multiprices (segment / customer / quantity). */
function createProductMultipricesCommand(): Command {
  const grp = new Command("multiprices").description(
    "Read a product's selling multiprices (read-only — Dolibarr exposes no REST setter)",
  );

  addGetOptions(
    grp
      .command("show")
      .description("Show selling multiprices for a product")
      .argument("<product-id>", "Product ID"),
  )
    .option("--by <mode>", "segment | customer | quantity", "segment")
    .option("--thirdparty <id>", "Thirdparty ID (customer mode)")
    .action(async (productId, opts) => {
      try {
        const mode =
          opts.by === "customer"
            ? "per_customer"
            : opts.by === "quantity"
              ? "per_quantity"
              : "per_segment";
        const client = createClient();
        const result = await client.get<unknown>(
          `products/${productId}/selling_multiprices/${mode}`,
          opts.thirdparty ? { thirdparty_id: opts.thirdparty } : undefined,
        );
        printJson(result);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  return grp;
}

/** `products price-by-qty` — read the per-quantity selling price grid. */
function createProductPriceByQtyCommand(): Command {
  const cmd = new Command("price-by-qty").description(
    "Read a product's per-quantity selling prices",
  );
  addGetOptions(cmd.argument("<product-id>", "Product ID")).action(async (productId, opts) => {
    try {
      const client = createClient();
      const result = await client.get<unknown>(
        `products/${productId}/selling_multiprices/per_quantity`,
      );
      printJson(result);
    } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
  });
  return cmd;
}

/**
 * Build the POST/PUT body for a product variant. `--feature attr:value` pairs
 * (repeatable) become the `features` map `{ attribute_id: value_id }`.
 */
export function buildVariantBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.priceImpact !== undefined) body.price_impact = Number(opts.priceImpact);
  if (opts.weightImpact !== undefined) body.weight_impact = Number(opts.weightImpact);
  if (opts.pricePercent !== undefined) body.price_impact_is_percent = Boolean(opts.pricePercent);
  if (opts.reference !== undefined) body.reference = opts.reference;
  const features = opts.feature as string[] | undefined;
  if (features && features.length > 0) {
    const map: Record<string, number> = {};
    for (const pair of features) {
      const [attr, value] = String(pair).split(":");
      if (attr && value) map[attr] = Number(value);
    }
    body.features = map;
  }
  return body;
}

/** `products attributes` — variant attribute definitions (e.g. Color, Size). */
function createProductAttributesCommand(): Command {
  const grp = new Command("attributes").description("Manage product variant attributes");

  addListOptions(
    grp.command("list").description("List product attributes"),
  ).action(async (opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        "products/attributes",
        buildListQuery(opts),
      );
      renderList(items, {
        opts,
        columns: [
          { key: "id", label: "ID" },
          { key: "ref", label: "Ref" },
          { key: "label", label: "Label" },
        ],
      });
    } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
  });

  addGetOptions(
    grp.command("get").description("Get a product attribute").argument("<id>", "Attribute ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`products/attributes/${id}`);
      renderGet(item, {
        opts,
        fields: [
          { key: "id", label: "ID" },
          { key: "ref", label: "Ref" },
          { key: "label", label: "Label" },
          { key: "rang", label: "Rank" },
        ],
      });
    } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
  });

  grp
    .command("create")
    .description("Create a product attribute")
    .requiredOption("--ref <ref>", "Attribute reference code")
    .requiredOption("--label <label>", "Attribute label")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const body = { ref: opts.ref, label: opts.label };
        if (dryRunJson("products.attributes.create", { body })) return;
        const client = createClient();
        const result = await client.post<number>("products/attributes", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created product attribute with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("update")
    .description("Update a product attribute")
    .argument("<id>", "Attribute ID")
    .option("--ref <ref>", "Attribute reference code")
    .option("--label <label>", "Attribute label")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = {};
        if (opts.ref !== undefined) body.ref = opts.ref;
        if (opts.label !== undefined) body.label = opts.label;
        if (dryRunJson("products.attributes.update", { id, body })) return;
        const client = createClient();
        const result = await client.put<unknown>(`products/attributes/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated product attribute ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("delete")
    .description("Delete a product attribute")
    .argument("<id>", "Attribute ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete product attribute ${id}?`, opts))) return;
        if (dryRunJson("products.attributes.delete", { id })) return;
        const client = createClient();
        await client.delete(`products/attributes/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted product attribute ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `products attribute-values` — the possible values of a variant attribute. */
function createProductAttributeValuesCommand(): Command {
  const grp = new Command("attribute-values").description(
    "Manage the possible values of a product attribute",
  );

  addListOptions(
    grp
      .command("list")
      .description("List values for an attribute")
      .argument("<attribute-id>", "Attribute ID"),
  ).action(async (attributeId, opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        `products/attributes/${attributeId}/values`,
      );
      renderList(items, {
        opts,
        columns: [
          { key: "id", label: "ID" },
          { key: "ref", label: "Ref" },
          { key: "value", label: "Value" },
        ],
      });
    } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
  });

  grp
    .command("create")
    .description("Add a value to an attribute")
    .argument("<attribute-id>", "Attribute ID")
    .requiredOption("--ref <ref>", "Value reference")
    .requiredOption("--value <text>", "Value display text")
    .option("--json", "Output as JSON")
    .action(async (attributeId, opts) => {
      try {
        const body = { ref: opts.ref, value: opts.value };
        if (dryRunJson("products.attributeValues.create", { attributeId, body })) return;
        const client = createClient();
        const result = await client.post<number>(
          `products/attributes/${attributeId}/values`,
          body,
        );
        if (opts.json) { printJson(result); return; }
        printInfo(`Created attribute value with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("delete")
    .description("Delete an attribute value by ID")
    .argument("<value-id>", "Value ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (valueId, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete attribute value ${valueId}?`, opts))) return;
        if (dryRunJson("products.attributeValues.delete", { valueId })) return;
        const client = createClient();
        await client.delete(`products/attributes/values/${valueId}`);
        if (opts.json) { printJson({ deleted: valueId }); return; }
        printInfo(`Deleted attribute value ${valueId}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `products variants` — concrete variant products built from attribute values. */
function createProductVariantsCommand(): Command {
  const grp = new Command("variants").description("Manage a product's variants");

  addListOptions(
    grp
      .command("list")
      .description("List variants of a product")
      .argument("<product-id>", "Parent product ID"),
  )
    .option("--include-stock", "Include stock data")
    .action(async (productId, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          `products/${productId}/variants`,
          opts.includeStock ? { includestock: 1 } : undefined,
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "ref", label: "Ref" },
            { key: "label", label: "Label" },
            { key: "price_impact", label: "Price impact" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  grp
    .command("create")
    .description("Create a variant from attribute values")
    .argument("<product-id>", "Parent product ID")
    .requiredOption("--price-impact <n>", "Price difference vs. parent", "0")
    .option("--weight-impact <n>", "Weight difference vs. parent", "0")
    .option("--price-percent", "Treat price impact as a percentage")
    .option("--reference <ref>", "Variant reference")
    .option(
      "--feature <attr:value>",
      "Attribute-id:value-id pair (repeatable)",
      (v: string, acc: string[]) => { acc.push(v); return acc; },
      [] as string[],
    )
    .option("--json", "Output as JSON")
    .action(async (productId, opts) => {
      try {
        const body = buildVariantBody(opts);
        if (dryRunJson("products.variants.create", { productId, body })) return;
        const client = createClient();
        const result = await client.post<number>(`products/${productId}/variants`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created variant with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("update")
    .description("Update a variant")
    .argument("<variant-id>", "Variant ID")
    .option("--price-impact <n>", "Price difference vs. parent")
    .option("--weight-impact <n>", "Weight difference vs. parent")
    .option("--price-percent", "Treat price impact as a percentage")
    .option("--reference <ref>", "Variant reference")
    .option("--json", "Output as JSON")
    .action(async (variantId, opts) => {
      try {
        const body = buildVariantBody(opts);
        if (dryRunJson("products.variants.update", { variantId, body })) return;
        const client = createClient();
        const result = await client.put<unknown>(`products/variants/${variantId}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated variant ${variantId}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("delete")
    .description("Delete a variant")
    .argument("<variant-id>", "Variant ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (variantId, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete variant ${variantId}?`, opts))) return;
        if (dryRunJson("products.variants.delete", { variantId })) return;
        const client = createClient();
        await client.delete(`products/variants/${variantId}`);
        if (opts.json) { printJson({ deleted: variantId }); return; }
        printInfo(`Deleted variant ${variantId}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `products subproducts` — BOM/kit children of a product. */
function createProductSubproductsCommand(): Command {
  const grp = new Command("subproducts").description("Manage a product's subproducts (BOM/kit)");

  addGetOptions(
    grp
      .command("list")
      .description("List a product's subproducts")
      .argument("<product-id>", "Parent product ID"),
  ).action(async (productId, opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        `products/${productId}/subproducts`,
      );
      renderList(items, {
        opts,
        columns: [
          { key: "id", label: "ID" },
          { key: "ref", label: "Ref" },
          { key: "label", label: "Label" },
          { key: "qty", label: "Qty" },
        ],
      });
    } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
  });

  grp
    .command("add")
    .description("Add a subproduct to a product")
    .argument("<product-id>", "Parent product ID")
    .argument("<subproduct-id>", "Child product ID")
    .option("--qty <n>", "Quantity", "1")
    .option("--incdec <n>", "1=increment parent stock, -1=decrement")
    .option("--json", "Output as JSON")
    .action(async (productId, subproductId, opts) => {
      try {
        const body: Record<string, unknown> = {
          subproduct_id: Number(subproductId),
          qty: Number(opts.qty ?? 1),
        };
        if (opts.incdec !== undefined) body.incdec = Number(opts.incdec);
        if (dryRunJson("products.subproducts.add", { productId, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`products/${productId}/subproducts/add`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added subproduct ${subproductId} to product ${productId}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("remove")
    .description("Remove a subproduct from a product")
    .argument("<product-id>", "Parent product ID")
    .argument("<subproduct-id>", "Child product ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (productId, subproductId, opts) => {
      try {
        if (!(await confirmOrCancel(`Remove subproduct ${subproductId} from product ${productId}?`, opts)))
          return;
        if (dryRunJson("products.subproducts.remove", { productId, subproductId })) return;
        const client = createClient();
        await client.delete(`products/${productId}/subproducts/remove/${subproductId}`);
        if (opts.json) { printJson({ removed: subproductId }); return; }
        printInfo(`Removed subproduct ${subproductId} from product ${productId}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}
