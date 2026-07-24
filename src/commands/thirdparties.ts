import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
import { DolibarrApiError, exitWithError } from "../core/errors.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  type ColumnSpec,
  confirmOrCancel,
  dryRunJson,
  prunePayload,
  renderGet,
  renderList,
} from "../core/resource-helpers.js";

function thirdpartyType(item: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Number(item.client) === 1 || Number(item.client) === 3) parts.push("Customer");
  if (Number(item.client) === 2 || Number(item.client) === 3) parts.push("Prospect");
  if (Number(item.fournisseur) === 1) parts.push("Supplier");
  return parts.join(", ") || "-";
}

/**
 * Build a thirdparty (company) bank-account body from parsed opts, shared by the
 * bank-accounts create/update actions. Covers the standard RIB fields and the SEPA
 * mandate fields. Only passed flags become keys.
 */
export function buildThirdpartyBankAccountBody(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.label !== undefined) body.label = opts.label;
  if (opts.bankName !== undefined) body.bank = opts.bankName;
  if (opts.iban !== undefined) body.iban = opts.iban;
  if (opts.bic !== undefined) body.bic = opts.bic;
  if (opts.codeBanque !== undefined) body.code_banque = opts.codeBanque;
  if (opts.codeGuichet !== undefined) body.code_guichet = opts.codeGuichet;
  if (opts.number !== undefined) body.number = opts.number;
  if (opts.cleRib !== undefined) body.cle_rib = opts.cleRib;
  if (opts.owner !== undefined) body.proprio = opts.owner;
  if (opts.ownerAddress !== undefined) body.owner_address = opts.ownerAddress;
  if (opts.rum !== undefined) body.rum = opts.rum;
  if (opts.currency !== undefined) body.currency_code = opts.currency;
  return body;
}

export const thirdpartyBankAccountColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "label", label: "Label" },
  { key: "bank", label: "Bank" },
  { key: "iban", label: "IBAN", format: (i) => String(i.iban ?? i.iban_prefix ?? "") },
  { key: "bic", label: "BIC" },
  { key: "default_rib", label: "Default" },
];

/**
 * Map the `--type`/`--mode` options of `thirdparties outstanding` to the Dolibarr
 * sub-resource path. `mode=supplier` reads supplier-side outstanding amounts.
 */
export function outstandingPath(id: string, opts: Record<string, unknown>): string {
  const type = (opts.type as string) ?? "invoices";
  const resource =
    type === "orders"
      ? "outstandingorders"
      : type === "proposals"
        ? "outstandingproposals"
        : "outstandinginvoices";
  const mode = opts.mode === "supplier" ? "?mode=supplier" : "";
  return `thirdparties/${id}/${resource}${mode}`;
}

export function createThirdpartiesCommand(): Command {
  const cmd = new Command("thirdparties").description(
    "Manage thirdparties (customers, suppliers, prospects)",
  );

  addListOptions(
    cmd
      .command("list")
      .description("List thirdparties"),
  )
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

        const items = await client.get<Record<string, unknown>[]>(
          "thirdparties",
          buildListQuery(opts, { mode, category: opts.category }),
        );

        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "name", label: "Name" },
            { key: "client", label: "Type", format: thirdpartyType },
            { key: "town", label: "Town" },
            { key: "status", label: "Status" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get thirdparty details")
      .argument("<id>", "Thirdparty ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`thirdparties/${id}`);
        renderGet(item, {
          opts,
          fields: [
            { key: "id", label: "ID" },
            { key: "name", label: "Name" },
            { key: "client", label: "Type", format: thirdpartyType },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "town", label: "Town" },
            { key: "zip", label: "Zip" },
            { key: "country", label: "Country" },
            { key: "status", label: "Status" },
            { key: "code_client", label: "Code client" },
            { key: "code_fournisseur", label: "Code fournisseur" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
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
          body = prunePayload({
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
          });
        }

        if (dryRunJson("thirdparties.create", { body })) return;

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

        if (dryRunJson("thirdparties.update", { id, body })) return;

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
        if (!(await confirmOrCancel(`Delete thirdparty ${id}?`, opts))) return;

        if (dryRunJson("thirdparties.delete", { id })) return;

        const client = createClient();
        await client.delete(`thirdparties/${id}`);
        if (opts.json) { printJson({ deleted: id }); return; }
        printInfo(`Deleted thirdparty ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("merge")
    .description("Merge a thirdparty into another (the source is permanently deleted)")
    .argument("<id>", "Target thirdparty ID (kept)")
    .argument("<id-to-delete>", "Source thirdparty ID (merged and deleted)")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, idToDelete, opts) => {
      try {
        if (
          !(await confirmOrCancel(
            `Merge thirdparty ${idToDelete} into ${id}? The source ${idToDelete} is permanently deleted.`,
            opts,
          ))
        )
          return;
        if (dryRunJson("thirdparties.merge", { id, idToDelete })) return;

        const client = createClient();
        const result = await client.put<unknown>(`thirdparties/${id}/merge/${idToDelete}`);
        if (opts.json) { printJson(result); return; }
        printInfo(`Merged thirdparty ${idToDelete} into ${id}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd.addCommand(createThirdpartyBankAccountsCommand());
  cmd.addCommand(createThirdpartyGatewaysCommand());
  cmd.addCommand(createThirdpartyCategoriesCommand());
  cmd.addCommand(createThirdpartyRepresentativesCommand());

  addGetOptions(
    cmd
      .command("contacts")
      .description("List a thirdparty's contacts")
      .argument("<id>", "Thirdparty ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        let items: Record<string, unknown>[] = [];
        try {
          items = await client.get<Record<string, unknown>[]>("contacts", {
            thirdparty_ids: id,
          });
        } catch (err) {
          // Dolibarr's contacts filter 404s when the thirdparty has no contacts.
          if (!(err instanceof DolibarrApiError && err.status === 404)) throw err;
        }
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
            { key: "email", label: "Email" },
            { key: "phone_pro", label: "Phone" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("outstanding")
      .description("Show outstanding (unpaid) amounts for a thirdparty")
      .argument("<id>", "Thirdparty ID"),
  )
    .option("--type <type>", "invoices | orders | proposals", "invoices")
    .option("--mode <mode>", "customer | supplier (supplier reads purchase-side)", "customer")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const result = await client.get<Record<string, unknown>>(outstandingPath(id, opts));
        printJson(result);
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  return cmd;
}

/** `thirdparties bank-accounts` — company (RIB/SEPA) bank accounts CRUD. */
function createThirdpartyBankAccountsCommand(): Command {
  const grp = new Command("bank-accounts").description(
    "Manage a thirdparty's bank accounts (RIB / IBAN / SEPA)",
  );

  addListOptions(
    grp
      .command("list")
      .description("List a thirdparty's bank accounts")
      .argument("<id>", "Thirdparty ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      let items: Record<string, unknown>[] = [];
      try {
        items = await client.get<Record<string, unknown>[]>(`thirdparties/${id}/bankaccounts`);
      } catch (err) {
        // Dolibarr returns 404 when the thirdparty simply has no bank accounts.
        if (!(err instanceof DolibarrApiError && err.status === 404)) throw err;
      }
      renderList(items, { opts, columns: thirdpartyBankAccountColumns });
    } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
  });

  const withBankFlags = (c: Command): Command =>
    c
      .option("--bank-name <name>", "Bank name")
      .option("--iban <iban>", "IBAN")
      .option("--bic <bic>", "BIC/SWIFT")
      .option("--code-banque <code>", "Bank code")
      .option("--code-guichet <code>", "Branch/desk code")
      .option("--number <num>", "Account number")
      .option("--cle-rib <key>", "RIB key")
      .option("--owner <name>", "Account owner (proprio)")
      .option("--owner-address <text>", "Owner address")
      .option("--rum <mandate>", "SEPA mandate reference (RUM)")
      .option("--currency <code>", "Currency code");

  withBankFlags(
    grp
      .command("create")
      .description("Add a bank account to a thirdparty")
      .argument("<id>", "Thirdparty ID")
      .requiredOption("--label <label>", "Account label")
      .option("--json", "Output as JSON"),
  ).action(async (id, opts) => {
    try {
      const body = buildThirdpartyBankAccountBody(opts);
      if (dryRunJson("thirdparties.bankAccounts.create", { id, body })) return;
      const client = createClient();
      const result = await client.post<unknown>(`thirdparties/${id}/bankaccounts`, body);
      if (opts.json) { printJson(result); return; }
      printInfo(`Added bank account to thirdparty ${id}.`);
    } catch (err) { exitWithError(err, Boolean(opts.json)); }
  });

  withBankFlags(
    grp
      .command("update")
      .description("Update a thirdparty bank account")
      .argument("<id>", "Thirdparty ID")
      .argument("<bank-id>", "Bank account ID")
      .option("--label <label>", "Account label")
      .option("--json", "Output as JSON"),
  ).action(async (id, bankId, opts) => {
    try {
      const body = buildThirdpartyBankAccountBody(opts);
      if (dryRunJson("thirdparties.bankAccounts.update", { id, bankId, body })) return;
      const client = createClient();
      const result = await client.put<unknown>(
        `thirdparties/${id}/bankaccounts/${bankId}`,
        body,
      );
      if (opts.json) { printJson(result); return; }
      printInfo(`Updated bank account ${bankId} on thirdparty ${id}.`);
    } catch (err) { exitWithError(err, Boolean(opts.json)); }
  });

  grp
    .command("delete")
    .description("Delete a thirdparty bank account")
    .argument("<id>", "Thirdparty ID")
    .argument("<bank-id>", "Bank account ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, bankId, opts) => {
      try {
        if (
          !(await confirmOrCancel(
            `Delete bank account ${bankId} from thirdparty ${id}?`,
            opts,
          ))
        )
          return;
        if (dryRunJson("thirdparties.bankAccounts.delete", { id, bankId })) return;
        const client = createClient();
        await client.delete(`thirdparties/${id}/bankaccounts/${bankId}`);
        if (opts.json) { printJson({ deleted: bankId }); return; }
        printInfo(`Deleted bank account ${bankId} from thirdparty ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `thirdparties gateways` — external site / payment-gateway accounts (societe accounts). */
function createThirdpartyGatewaysCommand(): Command {
  const grp = new Command("gateways").description(
    "Manage a thirdparty's external site accounts (e.g. Stripe/PayPal gateway keys)",
  );

  addListOptions(
    grp
      .command("list")
      .description("List a thirdparty's gateway accounts")
      .argument("<id>", "Thirdparty ID"),
  )
    .option("--site <name>", "Filter by site name")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        let items: Record<string, unknown>[] = [];
        try {
          items = await client.get<Record<string, unknown>[]>(
            `thirdparties/${id}/accounts`,
            { site: opts.site },
          );
        } catch (err) {
          if (!(err instanceof DolibarrApiError && err.status === 404)) throw err;
        }
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "site", label: "Site" },
            { key: "key_account", label: "Key" },
            { key: "login", label: "Login" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  grp
    .command("create")
    .description("Add a gateway account to a thirdparty")
    .argument("<id>", "Thirdparty ID")
    .requiredOption("--site <name>", "Site name (e.g. Stripe, PayPal)")
    .option("--key <key>", "Account key/id at the site")
    .option("--login <login>", "Login")
    .option("--from-json <file>", "Create from JSON file")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          body = prunePayload({ site: opts.site, key_account: opts.key, login: opts.login });
        }
        if (dryRunJson("thirdparties.gateways.create", { id, body })) return;
        const client = createClient();
        const result = await client.post<unknown>(`thirdparties/${id}/accounts`, body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Added gateway account (${opts.site}) to thirdparty ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("delete")
    .description("Delete a thirdparty gateway account by site")
    .argument("<id>", "Thirdparty ID")
    .argument("<site>", "Site name")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, site, opts) => {
      try {
        if (!(await confirmOrCancel(`Delete gateway account "${site}" from thirdparty ${id}?`, opts)))
          return;
        if (dryRunJson("thirdparties.gateways.delete", { id, site })) return;
        const client = createClient();
        await client.delete(`thirdparties/${id}/accounts/${encodeURIComponent(site)}`);
        if (opts.json) { printJson({ deleted: site }); return; }
        printInfo(`Deleted gateway account "${site}" from thirdparty ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `thirdparties categories` — link/unlink a thirdparty to customer or supplier categories. */
function createThirdpartyCategoriesCommand(): Command {
  const grp = new Command("categories").description(
    "List, add, or remove a thirdparty's categories (use --supplier for supplier categories)",
  );

  const path = (id: string, supplier: boolean): string =>
    `thirdparties/${id}/${supplier ? "supplier_categories" : "categories"}`;

  addListOptions(
    grp
      .command("list")
      .description("List a thirdparty's categories")
      .argument("<id>", "Thirdparty ID"),
  )
    .option("--supplier", "Use supplier categories instead of customer categories")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          path(id, Boolean(opts.supplier)),
          buildListQuery(opts),
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "label", label: "Label" },
            { key: "description", label: "Description" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  grp
    .command("add")
    .description("Add a thirdparty to a category")
    .argument("<id>", "Thirdparty ID")
    .argument("<category-id>", "Category ID")
    .option("--supplier", "Use supplier categories")
    .option("--json", "Output as JSON")
    .action(async (id, categoryId, opts) => {
      try {
        if (dryRunJson("thirdparties.categories.add", { id, categoryId, supplier: Boolean(opts.supplier) }))
          return;
        const client = createClient();
        await client.put<unknown>(`${path(id, Boolean(opts.supplier))}/${categoryId}`);
        if (opts.json) { printJson({ added: categoryId }); return; }
        printInfo(`Added thirdparty ${id} to category ${categoryId}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("remove")
    .description("Remove a thirdparty from a category")
    .argument("<id>", "Thirdparty ID")
    .argument("<category-id>", "Category ID")
    .option("--supplier", "Use supplier categories")
    .option("--json", "Output as JSON")
    .action(async (id, categoryId, opts) => {
      try {
        if (dryRunJson("thirdparties.categories.remove", { id, categoryId, supplier: Boolean(opts.supplier) }))
          return;
        const client = createClient();
        await client.delete(`${path(id, Boolean(opts.supplier))}/${categoryId}`);
        if (opts.json) { printJson({ removed: categoryId }); return; }
        printInfo(`Removed thirdparty ${id} from category ${categoryId}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}

/** `thirdparties representatives` — list/add/remove sales representatives. */
function createThirdpartyRepresentativesCommand(): Command {
  const grp = new Command("representatives").description(
    "List, add, or remove a thirdparty's sales representatives",
  );

  addGetOptions(
    grp
      .command("list")
      .description("List a thirdparty's sales representatives")
      .argument("<id>", "Thirdparty ID"),
  )
    .option("--mode <n>", "0=internal users, 1=external", "0")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          `thirdparties/${id}/representatives`,
          { mode: opts.mode },
        );
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            { key: "login", label: "Login" },
            { key: "lastname", label: "Lastname" },
            { key: "firstname", label: "Firstname" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  grp
    .command("add")
    .description("Assign a sales representative to a thirdparty")
    .argument("<id>", "Thirdparty ID")
    .argument("<rep-id>", "Representative (user) ID")
    .option("--json", "Output as JSON")
    .action(async (id, repId, opts) => {
      try {
        if (dryRunJson("thirdparties.representatives.add", { id, repId })) return;
        const client = createClient();
        await client.post<unknown>(`thirdparties/${id}/representative/${repId}`);
        if (opts.json) { printJson({ added: repId }); return; }
        printInfo(`Assigned representative ${repId} to thirdparty ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  grp
    .command("remove")
    .description("Remove a sales representative from a thirdparty")
    .argument("<id>", "Thirdparty ID")
    .argument("<rep-id>", "Representative (user) ID")
    .option("--json", "Output as JSON")
    .action(async (id, repId, opts) => {
      try {
        if (dryRunJson("thirdparties.representatives.remove", { id, repId })) return;
        const client = createClient();
        await client.delete(`thirdparties/${id}/representative/${repId}`);
        if (opts.json) { printJson({ removed: repId }); return; }
        printInfo(`Removed representative ${repId} from thirdparty ${id}.`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return grp;
}
