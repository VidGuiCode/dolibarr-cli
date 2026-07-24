import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { toEpochSeconds } from "../core/dates.js";
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

/** BOM statuses per Dolibarr's BOM class. */
const BOM_STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "9": "Cancelled",
};

/** Manufacturing-order statuses per Dolibarr's Mo class. */
const MO_STATUS_MAP: Record<string, string> = {
  "0": "Draft",
  "1": "Validated",
  "2": "In progress",
  "3": "Produced",
  "9": "Cancelled",
};

/** BOM / MO type: manufacturing vs. disassemble. */
const TYPE_MAP: Record<string, string> = {
  "0": "Manufacturing",
  "1": "Disassemble",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const labelFrom =
  (map: Record<string, string>, ...keys: string[]) =>
  (i: Record<string, unknown>): string => {
    for (const k of keys) {
      if (i[k] !== undefined && i[k] !== null) return map[String(i[k])] ?? String(i[k]);
    }
    return "";
  };

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const bomListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "fk_product", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "bomtype", label: "Type", format: labelFrom(TYPE_MAP, "bomtype") },
  { key: "status", label: "Status", format: labelFrom(BOM_STATUS_MAP, "status", "statut") },
];

export const bomDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "fk_product", label: "Product ID" },
  { key: "qty", label: "Qty produced" },
  { key: "bomtype", label: "Type", format: labelFrom(TYPE_MAP, "bomtype") },
  { key: "duration", label: "Duration" },
  { key: "efficiency", label: "Efficiency" },
  { key: "fk_warehouse", label: "Warehouse ID" },
  { key: "description", label: "Description" },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "status", label: "Status", format: labelFrom(BOM_STATUS_MAP, "status", "statut") },
];

export const bomLineColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "position", label: "Pos", format: (i) => String(i.position ?? i.rang ?? "") },
  { key: "fk_product", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "qty_frozen", label: "Frozen" },
  { key: "disable_stock_change", label: "No stock change" },
  { key: "efficiency", label: "Efficiency" },
];

export const moListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "fk_product", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "fk_bom", label: "BOM" },
  {
    key: "date_start_planned",
    label: "Planned start",
    format: (i) => tsToDate(i.date_start_planned),
  },
  { key: "status", label: "Status", format: labelFrom(MO_STATUS_MAP, "status", "statut") },
];

export const moDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "fk_product", label: "Product ID" },
  { key: "qty", label: "Qty to produce" },
  { key: "fk_bom", label: "BOM ID" },
  { key: "fk_warehouse", label: "Warehouse ID" },
  { key: "mrptype", label: "Type", format: labelFrom(TYPE_MAP, "mrptype") },
  {
    key: "date_start_planned",
    label: "Planned start",
    format: (i) => tsToDate(i.date_start_planned),
  },
  {
    key: "date_end_planned",
    label: "Planned end",
    format: (i) => tsToDate(i.date_end_planned),
  },
  { key: "fk_project", label: "Project ID" },
  { key: "fk_soc", label: "Thirdparty ID" },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "status", label: "Status", format: labelFrom(MO_STATUS_MAP, "status", "statut") },
];

export const workstationColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "label", label: "Label" },
  { key: "type", label: "Type" },
  { key: "nb_operators_required", label: "Operators" },
  { key: "thm_operator_estimated", label: "Operator €/h" },
  { key: "thm_machine_estimated", label: "Machine €/h" },
  { key: "status", label: "Status" },
];

/** Build the POST/PUT body for a BOM. Only passed flags become part of the body. */
export function buildBomBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    label: opts.label,
    ref: opts.ref,
    fk_product: opts.product === undefined ? undefined : Number(opts.product),
    qty: opts.qty === undefined ? undefined : Number(opts.qty),
    bomtype: opts.type === undefined ? undefined : Number(opts.type),
    fk_warehouse: opts.warehouse === undefined ? undefined : Number(opts.warehouse),
    duration: opts.duration === undefined ? undefined : Number(opts.duration),
    efficiency: opts.efficiency === undefined ? undefined : Number(opts.efficiency),
    description: opts.description,
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
}

/** Build the POST body for a BOM component line. */
export function buildBomLineBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    fk_product: opts.product === undefined ? undefined : Number(opts.product),
    qty: opts.qty === undefined ? undefined : Number(opts.qty),
    qty_frozen: opts.qtyFrozen === undefined ? undefined : Number(opts.qtyFrozen),
    disable_stock_change:
      opts.disableStockChange === undefined ? undefined : Number(opts.disableStockChange),
    efficiency: opts.efficiency === undefined ? undefined : Number(opts.efficiency),
    position: opts.position === undefined ? undefined : Number(opts.position),
    fk_bom_child: opts.childBom === undefined ? undefined : Number(opts.childBom),
    fk_unit: opts.unit === undefined ? undefined : Number(opts.unit),
  });
}

/** Build the POST/PUT body for a manufacturing order. */
export function buildMoBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = prunePayload({
    label: opts.label,
    ref: opts.ref,
    fk_product: opts.product === undefined ? undefined : Number(opts.product),
    qty: opts.qty === undefined ? undefined : Number(opts.qty),
    fk_bom: opts.bom === undefined ? undefined : Number(opts.bom),
    fk_warehouse: opts.warehouse === undefined ? undefined : Number(opts.warehouse),
    mrptype: opts.type === undefined ? undefined : Number(opts.type),
    fk_project: opts.project === undefined ? undefined : Number(opts.project),
    fk_soc: opts.socid === undefined ? undefined : Number(opts.socid),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
  if (opts.dateStart !== undefined) {
    body.date_start_planned = toEpochSeconds(opts.dateStart as string);
  }
  if (opts.dateEnd !== undefined) {
    body.date_end_planned = toEpochSeconds(opts.dateEnd as string);
  }
  return body;
}

export function createMrpCommand(): Command {
  const cmd = new Command("mrp").description(
    "Manage MRP: bills of materials, manufacturing orders and workstations",
  );

  cmd.addCommand(createBomsCommand());
  cmd.addCommand(createMosCommand());
  cmd.addCommand(createWorkstationsCommand());

  cmd.addHelpText(
    "after",
    "\nDeliberately NOT wrapped: MO production." +
      "\n  `POST /mos/{id}/produceandconsumeall` produces the finished product AND consumes" +
      "\n  every component's stock in one irreversible call — the API exposes no inverse" +
      "\n  operation. The route exists on Dolibarr 20.0.4 but is permission-gated on the" +
      "\n  reference instance (403 \"Not enough permission\"), so its request shape could not" +
      "\n  be verified. Rather than guess at a command that consumes real inventory, it is" +
      "\n  left to the escape hatch:" +
      "\n      dolibarr raw POST mos/{id}/produceandconsumeall --data '{...}'" +
      "\n  It will be wrapped once it can be exercised against a module-enabled instance." +
      "\n\nAlso absent on /mos (all route-stage 404s): validate, produce, consume, cancel," +
      "\nand a lines sub-resource. Workstations are read-only — POST returns 405, and" +
      "\nPUT/DELETE return 404.",
  );

  return cmd;
}

/** `mrp boms` — bills of materials (`/boms`). */
function createBomsCommand(): Command {
  const grp = new Command("boms").description("Manage bills of materials");

  addListOptions(grp.command("list").description("List bills of materials")).action(
    async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("boms", buildListQuery(opts));
        renderList(items, { opts, columns: bomListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    },
  );

  addGetOptions(
    grp.command("get").description("Get a bill of materials").argument("<id>", "BOM ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`boms/${id}`);
      renderGet(item, { opts, fields: bomDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const bomFieldOptions = (c: Command): Command =>
    c
      .option("--ref <ref>", "Reference")
      .option("--qty <n>", "Quantity produced by one run")
      .option("--type <0|1>", "Type: 0 manufacturing, 1 disassemble")
      .option("--warehouse <id>", "Default warehouse ID")
      .option("--duration <secs>", "Estimated duration in seconds")
      .option("--efficiency <n>", "Efficiency factor")
      .option("--description <text>", "Description")
      .option("--note-public <text>", "Public note")
      .option("--note-private <text>", "Private note");

  bomFieldOptions(
    addGetOptions(grp.command("create").description("Create a bill of materials"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--label <text>", "Label (required)")
      .option("--product <id>", "Manufactured product ID (required)"),
  ).action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.fromJson) {
        body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
      } else {
        if (!opts.label || !opts.product) {
          printInfo("Error: --label and --product are required (or use --from-json)");
          process.exit(1);
        }
        body = buildBomBody(opts);
      }
      if (dryRunJson("mrp.boms.create", { body })) return;
      const client = createClient();
      const id = await client.post<number>("boms", body);
      announce(opts, `Created BOM with ID: ${id}`);
      await echoState(client, `boms/${id}`, opts, bomDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  bomFieldOptions(
    addGetOptions(
      grp
        .command("update")
        .description("Update a bill of materials (only the flags you pass are sent)")
        .argument("<id>", "BOM ID"),
    )
      .option("--label <text>", "Label")
      .option("--product <id>", "Manufactured product ID"),
  ).action(async (id, opts) => {
    try {
      const body = buildBomBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("mrp.boms.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`boms/${id}`, body);
      announce(opts, `Updated BOM ${id}`);
      await echoState(client, `boms/${id}`, opts, bomDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  grp
    .command("delete")
    .description("Delete a bill of materials")
    .argument("<id>", "BOM ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("mrp.boms.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete BOM ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`boms/${id}`);
        announce(opts, `Deleted BOM ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  addListOptions(
    grp.command("lines").description("List a BOM's component lines").argument("<id>", "BOM ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(`boms/${id}/lines`);
      renderList(Array.isArray(items) ? items : [], { opts, columns: bomLineColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp
      .command("add-line")
      .description("Add a component line to a BOM")
      .argument("<id>", "BOM ID"),
  )
    .option("--from-json <file>", "Add from a JSON file")
    .option("--product <id>", "Component product ID (required)")
    .option("--qty <n>", "Quantity consumed (required)")
    .option("--qty-frozen <0|1>", "Quantity is fixed regardless of the produced qty")
    .option("--disable-stock-change <0|1>", "Do not move stock for this component")
    .option("--efficiency <n>", "Efficiency factor")
    .option("--position <n>", "Line position")
    .option("--child-bom <id>", "Child BOM ID (sub-assembly)")
    .option("--unit <id>", "Unit ID")
    .action(async (id, opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.product || opts.qty === undefined) {
            printInfo("Error: --product and --qty are required (or use --from-json)");
            process.exit(1);
          }
          body = buildBomLineBody(opts);
        }
        if (dryRunJson("mrp.boms.addLine", { id, body })) return;
        const client = createClient();
        const lineId = await client.post<number>(`boms/${id}/lines`, body);
        announce(opts, `Added line ${lineId} to BOM ${id}`);
        await echoState(client, `boms/${id}`, opts, bomDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  grp.addHelpText(
    "after",
    "\nBOM lines can be listed and added, but not edited or removed — Dolibarr 20.0.4" +
      "\nexposes no PUT or DELETE on /boms/{id}/lines/{lineid}.",
  );

  return grp;
}

/** `mrp mos` — manufacturing orders (`/mos`). */
function createMosCommand(): Command {
  const grp = new Command("mos").description("Manage manufacturing orders");

  addListOptions(grp.command("list").description("List manufacturing orders")).action(
    async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("mos", buildListQuery(opts));
        renderList(items, { opts, columns: moListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    },
  );

  addGetOptions(
    grp
      .command("get")
      .description("Get a manufacturing order")
      .argument("<id>", "Manufacturing order ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`mos/${id}`);
      renderGet(item, { opts, fields: moDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const moFieldOptions = (c: Command): Command =>
    c
      .option("--ref <ref>", "Reference")
      .option("--label <text>", "Label")
      .option("--bom <id>", "BOM ID to build from")
      .option("--warehouse <id>", "Target warehouse ID")
      .option("--type <0|1>", "Type: 0 manufacturing, 1 disassemble")
      .option("--date-start <date>", "Planned start (YYYY-MM-DD or epoch)")
      .option("--date-end <date>", "Planned end (YYYY-MM-DD or epoch)")
      .option("--project <id>", "Project ID")
      .option("--socid <id>", "Thirdparty ID")
      .option("--note-public <text>", "Public note")
      .option("--note-private <text>", "Private note");

  moFieldOptions(
    addGetOptions(grp.command("create").description("Create a manufacturing order"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--product <id>", "Product to manufacture (required)")
      .option("--qty <n>", "Quantity to produce (required)"),
  )
    .addHelpText(
      "after",
      "\nCreating an MO does not move stock — only production does, and that is not wrapped." +
        "\nSee `dolibarr mrp --help`.",
    )
    .action(async (opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.product || opts.qty === undefined) {
            printInfo("Error: --product and --qty are required (or use --from-json)");
            process.exit(1);
          }
          body = buildMoBody(opts);
        }
        if (dryRunJson("mrp.mos.create", { body })) return;
        const client = createClient();
        const id = await client.post<number>("mos", body);
        announce(opts, `Created manufacturing order with ID: ${id}`);
        await echoState(client, `mos/${id}`, opts, moDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  moFieldOptions(
    addGetOptions(
      grp
        .command("update")
        .description("Update a manufacturing order (only the flags you pass are sent)")
        .argument("<id>", "Manufacturing order ID"),
    )
      .option("--product <id>", "Product to manufacture")
      .option("--qty <n>", "Quantity to produce"),
  ).action(async (id, opts) => {
    try {
      const body = buildMoBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("mrp.mos.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`mos/${id}`, body);
      announce(opts, `Updated manufacturing order ${id}`);
      await echoState(client, `mos/${id}`, opts, moDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  grp
    .command("delete")
    .description("Delete a manufacturing order")
    .argument("<id>", "Manufacturing order ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("mrp.mos.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete manufacturing order ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`mos/${id}`);
        announce(opts, `Deleted manufacturing order ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  grp.addHelpText(
    "after",
    "\nProduction (`POST /mos/{id}/produceandconsumeall`) is intentionally not wrapped —" +
      "\nit consumes real component stock irreversibly and could not be verified. Use" +
      "\n`dolibarr raw POST mos/{id}/produceandconsumeall` if you need it today." +
      "\nThere are no validate / produce / consume / cancel / lines routes on this resource.",
  );

  return grp;
}

/** `mrp workstations` — read-only workstation list (`/workstations`). */
function createWorkstationsCommand(): Command {
  const grp = new Command("workstations").description("Browse workstations (read-only)");

  addListOptions(grp.command("list").description("List workstations")).action(async (opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        "workstations",
        buildListQuery(opts),
      );
      renderList(items, { opts, columns: workstationColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp.command("get").description("Get a workstation").argument("<id>", "Workstation ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`workstations/${id}`);
      renderGet(item, { opts, fields: workstationColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  grp.addHelpText(
    "after",
    "\nRead-only by design: Dolibarr 20.0.4 answers POST /workstations with 405 Method Not" +
      "\nAllowed and PUT/DELETE /workstations/{id} with 404, so no write subcommands exist.",
  );

  return grp;
}
