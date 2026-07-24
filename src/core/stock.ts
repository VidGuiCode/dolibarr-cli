import { toEpochSeconds } from "./dates.js";
import type { ColumnSpec } from "./resource-helpers.js";

/**
 * Shared stock vocabulary for the two surfaces that touch `/stockmovements`:
 *  - `products stock-movements` / `products correct-stock` (product-centric, v0.3.8)
 *  - `stock movements list` / `stock movements create` (warehouse-centric, v0.4.3)
 *
 * Both go through the same endpoint, so the body builder and column specs live here
 * rather than being duplicated in either command file.
 */

/** Dolibarr stock movement types. */
export const MOVEMENT_TYPE_MAP: Record<string, string> = {
  "0": "Input",
  "1": "Output",
  "2": "Transfer in",
  "3": "Transfer out",
};

/**
 * Build the POST body for `/stockmovements`.
 *
 * `product_id`, `warehouse_id` and `qty` are mandatory — confirmed against the live
 * API's validator on Dolibarr 20.0.4. A negative `qty` is an outbound movement.
 */
export function buildStockMovementBody(
  productId: string,
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    product_id: Number(productId),
    warehouse_id: Number(opts.warehouse),
    qty: Number(opts.qty),
  };
  if (opts.type !== undefined) body.type = Number(opts.type);
  if (opts.lot !== undefined) body.lot = opts.lot;
  if (opts.label !== undefined) body.movementlabel = opts.label;
  if (opts.code !== undefined) body.movementcode = opts.code;
  if (opts.price !== undefined) body.price = Number(opts.price);
  if (opts.date !== undefined) body.datem = toEpochSeconds(opts.date as string);
  if (opts.originType !== undefined) body.origin_type = opts.originType;
  if (opts.originId !== undefined) body.origin_id = Number(opts.originId);
  return body;
}

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

/** Columns for a stock-movement list, shared by both surfaces. */
export const stockMovementColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  {
    key: "fk_product",
    label: "Product",
    format: (i) => String(i.fk_product ?? i.product_id ?? ""),
  },
  {
    key: "fk_entrepot",
    label: "Warehouse",
    format: (i) => String(i.fk_entrepot ?? i.warehouse_id ?? ""),
  },
  { key: "qty", label: "Qty" },
  {
    key: "type",
    label: "Type",
    format: (i) => {
      const t = i.type ?? i.type_mouvement;
      return MOVEMENT_TYPE_MAP[String(t)] ?? String(t ?? "");
    },
  },
  { key: "datem", label: "Date", format: (i) => tsToDate(i.datem ?? i.datec) },
  {
    key: "label",
    label: "Label",
    format: (i) => String(i.label ?? i.movementlabel ?? "").slice(0, 40),
  },
];

/**
 * Build the `sqlfilters` expression for a stock-movement list from the product and
 * warehouse filters. Returns undefined when neither is set, so the caller's own
 * `--filter` is used instead.
 */
export function buildStockMovementFilter(opts: {
  product?: unknown;
  warehouse?: unknown;
}): string | undefined {
  const filters: string[] = [];
  if (opts.product) filters.push(`(t.fk_product:=:${Number(opts.product)})`);
  if (opts.warehouse) filters.push(`(t.fk_entrepot:=:${Number(opts.warehouse)})`);
  return filters.length ? filters.join(" and ") : undefined;
}
