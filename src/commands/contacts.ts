import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

export function createContactsCommand(): Command {
  const cmd = new Command("contacts").description("Manage contacts");

  cmd
    .command("list")
    .description("List contacts")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("contacts", {
          limit: opts.limit,
          page: opts.page,
          sortfield: opts.sort ? `t.${opts.sort}` : undefined,
          sortorder: opts.order,
          sqlfilters: opts.filter,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.lastname ?? ""),
          String(i.firstname ?? ""),
          String(i.email ?? ""),
          String(i.socid ?? ""),
          String(i.town ?? ""),
        ]);
        printTable(rows, ["ID", "Lastname", "Firstname", "Email", "Thirdparty", "Town"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get contact details")
    .argument("<id>", "Contact ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`contacts/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Lastname", String(item.lastname ?? "")],
          ["Firstname", String(item.firstname ?? "")],
          ["Email", String(item.email ?? "")],
          ["Phone", String(item.phone_pro ?? "")],
          ["Mobile", String(item.phone_mobile ?? "")],
          ["Thirdparty ID", String(item.socid ?? "")],
          ["Address", String(item.address ?? "")],
          ["Town", String(item.town ?? "")],
          ["Zip", String(item.zip ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("create")
    .description("Create a contact")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .option("--lastname <name>", "Last name (required)")
    .option("--firstname <name>", "First name")
    .option("--socid <id>", "Thirdparty ID")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--address <addr>", "Address")
    .option("--zip <zip>", "Postal code")
    .option("--town <town>", "City")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.lastname) { printInfo("Error: --lastname is required"); process.exit(1); }
          body = { lastname: opts.lastname };
          if (opts.firstname) body.firstname = opts.firstname;
          if (opts.socid) body.socid = Number(opts.socid);
          if (opts.email) body.email = opts.email;
          if (opts.phone) body.phone_pro = opts.phone;
          if (opts.address) body.address = opts.address;
          if (opts.zip) body.zip = opts.zip;
          if (opts.town) body.town = opts.town;
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "contacts.create", body }); return; }
        const result = await client.post<number>("contacts", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created contact with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a contact")
    .argument("<id>", "Contact ID")
    .option("--json", "Output as JSON")
    .option("--lastname <name>", "Last name")
    .option("--firstname <name>", "First name")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--town <town>", "City")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.lastname) body.lastname = opts.lastname;
        if (opts.firstname) body.firstname = opts.firstname;
        if (opts.email) body.email = opts.email;
        if (opts.phone) body.phone_pro = opts.phone;
        if (opts.town) body.town = opts.town;
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "contacts.update", id, body }); return; }
        const result = await client.put<unknown>(`contacts/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated contact ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a contact")
    .argument("<id>", "Contact ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete contact ${id}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "contacts.delete", id }); return; }
        const client = createClient();
        await client.delete(`contacts/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted contact ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
