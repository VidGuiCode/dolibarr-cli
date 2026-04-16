import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import {
  addListOptions,
  buildListQuery,
  dryRunJson,
} from "../core/resource-helpers.js";

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
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          String(i.label ?? ""),
          String(i.number ?? ""),
          String(i.solde ?? i.balance ?? ""),
          String(i.currency_code ?? ""),
        ]);
        printTable(rows, ["ID", "Label", "Number", "Balance", "Currency"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("get")
    .description("Get bank account details")
    .argument("<id>", "Bank account ID")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>(`bankaccounts/${id}`);
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [
          ["ID", String(item.id ?? "")],
          ["Label", String(item.label ?? "")],
          ["Number", String(item.number ?? "")],
          ["IBAN", String(item.iban ?? "")],
          ["BIC", String(item.bic ?? "")],
          ["Balance", String(item.solde ?? item.balance ?? "")],
          ["Currency", String(item.currency_code ?? "")],
          ["Status", String(item.status ?? "")],
        ];
        printTable(rows, ["Field", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
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
        if (opts.number) body.number = opts.number;
        if (opts.iban) body.iban = opts.iban;
        if (opts.bic) body.bic = opts.bic;
        if (opts.currency) body.currency_code = opts.currency;
        if (dryRunJson("bank.create", { body })) return;
        const client = createClient();
        const result = await client.post<number>("bankaccounts", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Created bank account with ID: ${result}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("transactions")
    .description("List transactions for a bank account")
    .argument("<account-id>", "Bank account ID")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Results per page", "50")
    .option("--page <n>", "Page number (0-indexed)", "0")
    .action(async (accountId, opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(`bankaccounts/${accountId}/lines`, {
          limit: opts.limit,
          page: opts.page,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.id ?? ""),
          i.dateo ? new Date(Number(i.dateo) * 1000).toISOString().split("T")[0] : String(i.dateo ?? ""),
          String(i.label ?? ""),
          String(i.amount ?? ""),
          String(i.fk_type ?? ""),
        ]);
        printTable(rows, ["ID", "Date", "Label", "Amount", "Type"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("transfer")
    .description("Transfer between bank accounts")
    .option("--json", "Output as JSON")
    .requiredOption("--from <id>", "Source bank account ID")
    .requiredOption("--to <id>", "Destination bank account ID")
    .requiredOption("--amount <n>", "Transfer amount")
    .requiredOption("--date <date>", "Transfer date (YYYY-MM-DD)")
    .requiredOption("--description <text>", "Transfer description")
    .action(async (opts) => {
      try {
        const body: Record<string, unknown> = {
          bankaccount_from_id: Number(opts.from),
          bankaccount_to_id: Number(opts.to),
          amount: Number(opts.amount),
          date: opts.date,
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
