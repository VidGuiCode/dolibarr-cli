import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  type ColumnSpec,
  dryRunJson,
  renderGet,
  renderList,
} from "../core/resource-helpers.js";

export const bankAccountColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "label", label: "Label" },
  {
    key: "account_number",
    label: "Number",
    format: (i) => String(i.account_number ?? i.number ?? ""),
  },
  { key: "currency_code", label: "Currency" },
];

export const bankAccountFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "label", label: "Label" },
  {
    key: "account_number",
    label: "Number",
    format: (i) => String(i.account_number ?? i.number ?? ""),
  },
  {
    key: "iban_prefix",
    label: "IBAN",
    format: (i) => String(i.iban_prefix ?? i.iban ?? ""),
  },
  { key: "bic", label: "BIC" },
  {
    key: "balance",
    label: "Reported Balance",
    format: (i) => String(i.balance ?? i.solde ?? ""),
  },
  { key: "currency_code", label: "Currency" },
  { key: "status", label: "Status" },
];

export function sanitizeBankAccountListItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const safeItem = { ...item };
  delete safeItem.balance;
  delete safeItem.solde;
  return safeItem;
}

export function parseBankTransferDate(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error("Transfer date must be YYYY-MM-DD or a Unix timestamp.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Transfer date must be a valid calendar date.");
  }

  return Math.floor(date.getTime() / 1000);
}

export function createBankCommand(): Command {
  const cmd = new Command("bank").description("Manage bank accounts and transactions");

  addListOptions(
    cmd
      .command("list")
      .description("List bank accounts"),
  )
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "bankaccounts",
          buildListQuery(opts),
        );
        renderList(items.map(sanitizeBankAccountListItem), {
          opts,
          columns: bankAccountColumns,
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  addGetOptions(
    cmd
      .command("get")
      .description("Get bank account details")
      .argument("<id>", "Bank account ID"),
  )
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`bankaccounts/${id}`);
        renderGet(item, {
          opts,
          fields: bankAccountFields,
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("create")
    .description("Create a bank account")
    .option("--json", "Output as JSON")
    .requiredOption("--label <label>", "Account label")
    .option("--number <num>", "Account number")
    .option("--iban <iban>", "IBAN")
    .option("--bic <bic>", "BIC/SWIFT")
    .option("--currency <code>", "Currency code (e.g., EUR)")
    .action(async (opts) => {
      try {
        const body: Record<string, unknown> = { label: opts.label };
        if (opts.number) body.account_number = opts.number;
        if (opts.iban) body.iban_prefix = opts.iban;
        if (opts.bic) body.bic = opts.bic;
        if (opts.currency) body.currency_code = opts.currency;
        if (dryRunJson("bank.create", { body })) return;
        const client = createClient();
        const result = await client.post<number>("bankaccounts", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created bank account with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  addGetOptions(
    cmd
      .command("transactions")
      .description("List transactions for a bank account")
      .argument("<account-id>", "Bank account ID")
      .option("--limit <n>", "Results per page", "50")
      .option("--page <n>", "Page number (0-indexed)", "0"),
  )
    .action(async (accountId, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(`bankaccounts/${accountId}/lines`, {
          limit: opts.limit,
          page: opts.page,
        });
        renderList(items, {
          opts,
          columns: [
            { key: "id", label: "ID" },
            {
              key: "dateo",
              label: "Date",
              format: (i) =>
                i.dateo
                  ? new Date(Number(i.dateo) * 1000).toISOString().split("T")[0]
                  : String(i.dateo ?? ""),
            },
            { key: "label", label: "Label" },
            { key: "amount", label: "Amount" },
            { key: "fk_type", label: "Type" },
          ],
        });
      } catch (err) { exitWithError(err, Boolean(opts.json || opts.output === "json")); }
    });

  cmd
    .command("transfer")
    .description("Transfer between bank accounts")
    .option("--json", "Output as JSON")
    .requiredOption("--from <id>", "Source bank account ID")
    .requiredOption("--to <id>", "Destination bank account ID")
    .requiredOption("--amount <n>", "Transfer amount")
    .requiredOption("--date <date>", "Transfer date (YYYY-MM-DD or Unix timestamp)")
    .requiredOption("--description <text>", "Transfer description")
    .action(async (opts) => {
      try {
        const body: Record<string, unknown> = {
          bankaccount_from_id: Number(opts.from),
          bankaccount_to_id: Number(opts.to),
          amount: Number(opts.amount),
          date: parseBankTransferDate(opts.date),
          description: opts.description,
        };
        if (dryRunJson("bank.transfer", { body })) return;
        const client = createClient();
        const result = await client.post<unknown>("bankaccounts/transfer", body);
        if (opts.json) { printJson(result); return; }
        printInfo("Transfer completed.");
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
