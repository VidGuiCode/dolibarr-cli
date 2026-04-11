import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";

export function createUsersCommand(): Command {
  const cmd = new Command("users").description("Manage users");

  cmd
    .command("list")
    .description("List users")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .option("--sort <field>", "Sort field")
    .option("--order <dir>", "Sort order (ASC|DESC)")
    .option("--filter <expr>", "SQL filter expression")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("users", {
          limit: opts.limit,
          page: opts.page,
          sortfield: opts.sort ? `t.${opts.sort}` : undefined,
          sortorder: opts.order,
          sqlfilters: opts.filter,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.login ?? ""),
          String(i.lastname ?? ""),
          String(i.firstname ?? ""),
          String(i.email ?? ""),
          Number(i.admin) === 1 ? "Yes" : "No",
        ]);
        printTable(rows, ["ID", "Login", "Lastname", "Firstname", "Email", "Admin"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get user details")
    .argument("<id>", "User ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`users/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Login", String(item.login ?? "")],
          ["Lastname", String(item.lastname ?? "")],
          ["Firstname", String(item.firstname ?? "")],
          ["Email", String(item.email ?? "")],
          ["Admin", Number(item.admin) === 1 ? "Yes" : "No"],
          ["Status", String(item.statut ?? item.status ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("me")
    .description("Show current API user info")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>("users/info");
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Login", String(item.login ?? "")],
          ["Lastname", String(item.lastname ?? "")],
          ["Firstname", String(item.firstname ?? "")],
          ["Email", String(item.email ?? "")],
          ["Admin", Number(item.admin) === 1 ? "Yes" : "No"],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
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
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "users.create", body: { ...body, password: body.password ? "****" : undefined } }); return; }
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
        if (isDryRunEnabled()) { printJson({ dryRun: true, action: "users.update", id, body }); return; }
        const result = await client.put<unknown>(`users/${id}`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Updated user ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
