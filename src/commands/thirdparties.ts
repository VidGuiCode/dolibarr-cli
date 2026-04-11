import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

function thirdpartyType(item: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Number(item.client) === 1 || Number(item.client) === 3) parts.push("Customer");
  if (Number(item.client) === 2 || Number(item.client) === 3) parts.push("Prospect");
  if (Number(item.fournisseur) === 1) parts.push("Supplier");
  return parts.join(", ") || "-";
}

export function createThirdpartiesCommand(): Command {
  const cmd = new Command("thirdparties").description(
    "Manage thirdparties (customers, suppliers, prospects)",
  );

  cmd
    .command("list")
    .description("List thirdparties")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .option("--customer", "Show customers only")
    .option("--prospect", "Show prospects only")
    .option("--supplier", "Show suppliers only")
    .option("--category <id>", "Filter by category ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        let mode: string | undefined;
        if (opts.customer) mode = "1";
        else if (opts.prospect) mode = "2";
        else if (opts.supplier) mode = "4";

        const items = await client.get<Record<string, unknown>[]>("thirdparties", {
          limit: opts.limit,
          page: opts.page,
          sortfield: opts.sort ? `t.${opts.sort}` : undefined,
          sortorder: opts.order,
          sqlfilters: opts.filter,
          mode,
          category: opts.category,
        });

        if (opts.json) { printJson(items); return; }

        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.name ?? ""),
          thirdpartyType(i),
          String(i.town ?? ""),
          String(i.status ?? ""),
        ]);
        printTable(rows, ["ID", "Name", "Type", "Town", "Status"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get thirdparty details")
    .argument("<id>", "Thirdparty ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`thirdparties/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Name", String(item.name ?? "")],
          ["Type", thirdpartyType(item)],
          ["Email", String(item.email ?? "")],
          ["Phone", String(item.phone ?? "")],
          ["Town", String(item.town ?? "")],
          ["Zip", String(item.zip ?? "")],
          ["Country", String(item.country ?? "")],
          ["Status", String(item.status ?? "")],
          ["Code client", String(item.code_client ?? "")],
          ["Code fournisseur", String(item.code_fournisseur ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("create")
    .description("Create a thirdparty")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--name <name>", "Company name")
    .option("--client <n>", "Client type (0=none, 1=customer, 2=prospect, 3=customer+prospect)")
    .option("--supplier", "Set as supplier")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--town <town>", "City")
    .option("--zip <zip>", "Postal code")
    .option("--country-id <id>", "Country ID")
    .option("--code-client <code>", "Customer code")
    .option("--code-fournisseur <code>", "Supplier code")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;

        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.name) {
            printInfo("Error: --name is required");
            process.exit(1);
          }
          body = {
            name: opts.name,
            client: opts.client ? Number(opts.client) : undefined,
            fournisseur: opts.supplier ? 1 : undefined,
            email: opts.email,
            phone: opts.phone,
            town: opts.town,
            zip: opts.zip,
            country_id: opts.countryId ? Number(opts.countryId) : undefined,
            code_client: opts.codeClient,
            code_fournisseur: opts.codeFournisseur,
          };
          // Remove undefined values
          Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
        }

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "thirdparties.create", body });
          return;
        }

        const result = await client.post<number>("thirdparties", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created thirdparty with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a thirdparty")
    .argument("<id>", "Thirdparty ID")
    .option("--json", "Output as JSON")
    .option("--name <name>", "Company name")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--town <town>", "City")
    .option("--zip <zip>", "Postal code")
    .option("--client <n>", "Client type")
    .option("--supplier", "Set as supplier")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.name) body.name = opts.name;
        if (opts.email) body.email = opts.email;
        if (opts.phone) body.phone = opts.phone;
        if (opts.town) body.town = opts.town;
        if (opts.zip) body.zip = opts.zip;
        if (opts.client) body.client = Number(opts.client);
        if (opts.supplier) body.fournisseur = 1;

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "thirdparties.update", id, body });
          return;
        }

        const result = await client.put<unknown>(`thirdparties/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated thirdparty ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a thirdparty")
    .argument("<id>", "Thirdparty ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete thirdparty ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "thirdparties.delete", id });
          return;
        }

        const client = createClient();
        await client.delete(`thirdparties/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted thirdparty ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("merge")
    .description("Merge a thirdparty into another")
    .argument("<id>", "Target thirdparty ID (kept)")
    .argument("<id-to-delete>", "Source thirdparty ID (merged and deleted)")
    .option("--json", "Output as JSON")
    .action(async (id, idToDelete, opts) => {
      try {
        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "thirdparties.merge", id, idToDelete });
          return;
        }

        const client = createClient();
        const result = await client.put<unknown>(`thirdparties/${id}/merge/${idToDelete}`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Merged thirdparty ${idToDelete} into ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
