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

export function createContactsCommand(): Command {
  const cmd = new Command("contacts").description("Manage contacts");

  addListOptions(
    cmd
      .command("list")
      .description("List contacts"),
  )
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "contacts",
          buildListQuery(opts),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
            { key: "email", label: "Email" },
            { key: "socid", label: "Thirdparty" },
            { key: "town", label: "Town" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get contact details")
      .argument("<id>", "Contact ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`contacts/${id}`);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
            { key: "email", label: "Email" },
            { key: "phone_pro", label: "Phone" },
            { key: "phone_mobile", label: "Mobile" },
            { key: "socid", label: "Thirdparty ID" },
            { key: "address", label: "Address" },
            { key: "town", label: "Town" },
            { key: "zip", label: "Zip" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
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
        if (dryRunJson("contacts.create", { body })) return;
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
        if (dryRunJson("contacts.update", { id, body })) return;
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
        if (!(await confirmOrCancel(`Delete contact ${id}?`, opts))) return;
        if (dryRunJson("contacts.delete", { id })) return;
        const client = createClient();
        await client.delete(`contacts/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted contact ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
