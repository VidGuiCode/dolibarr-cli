import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  dryRunJson,
  renderGet,
  renderList,
} from "../core/resource-helpers.js";

export function createUsersCommand(): Command {
  const cmd = new Command("users").description("Manage users");

  addListOptions(
    cmd
      .command("list")
      .description("List users"),
  )
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "users",
          buildListQuery(opts),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "login", label: "Login" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
            { key: "email", label: "Email" },
            {
              key: "admin",
              label: "Admin",
              format: (i) => (Number(i.admin) === 1 ? "Yes" : "No"),
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get user details")
      .argument("<id>", "User ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`users/${id}`);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "login", label: "Login" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
            { key: "email", label: "Email" },
            {
              key: "admin",
              label: "Admin",
              format: (i) => (Number(i.admin) === 1 ? "Yes" : "No"),
            },
            {
              key: "statut",
              label: "Status",
              format: (i) => String(i.statut ?? i.status ?? ""),
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("me")
      .description("Show current API user info"),
  )
    .action(async (opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>("users/info");
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "login", label: "Login" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
            { key: "email", label: "Email" },
            {
              key: "admin",
              label: "Admin",
              format: (i) => (Number(i.admin) === 1 ? "Yes" : "No"),
            },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create")
    .description("Create a user")
    .option("--json", "Output as JSON")
    .option("--from-json <file>", "Create from JSON file")
    .requiredOption("--login <login>", "Login name")
    .requiredOption("--lastname <name>", "Last name")
    .option("--firstname <name>", "First name")
    .option("--email <email>", "Email")
    .option("--password <pass>", "Password")
    .option("--admin <n>", "Admin flag (0 or 1)", "0")
    .action(async (opts) => {
      try {
        const client = createClient();
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          body = {
            login: opts.login,
            lastname: opts.lastname,
            admin: Number(opts.admin),
          };
          if (opts.firstname) body.firstname = opts.firstname;
          if (opts.email) body.email = opts.email;
          if (opts.password) body.password = opts.password;
        }
        if (dryRunJson("users.create", { body: { ...body, password: body.password ? "****" : undefined } })) return;
        const result = await client.post<number>("users", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created user with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("update")
    .description("Update a user")
    .argument("<id>", "User ID")
    .option("--json", "Output as JSON")
    .option("--lastname <name>", "Last name")
    .option("--firstname <name>", "First name")
    .option("--email <email>", "Email")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const body: Record<string, unknown> = {};
        if (opts.lastname) body.lastname = opts.lastname;
        if (opts.firstname) body.firstname = opts.firstname;
        if (opts.email) body.email = opts.email;
        if (dryRunJson("users.update", { id, body })) return;
        const result = await client.put<unknown>(`users/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated user ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
