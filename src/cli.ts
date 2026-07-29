#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { configureHelp } from "./core/help.js";
import { createConfigCommand } from "./commands/config.js";
import { createStatusCommand } from "./commands/status.js";
import { createRawCommand } from "./commands/raw.js";
import { createThirdpartiesCommand } from "./commands/thirdparties.js";
import { createInvoicesCommand } from "./commands/invoices.js";
import { createSupplierInvoicesCommand } from "./commands/supplier-invoices.js";
import { createOrdersCommand } from "./commands/orders.js";
import { createSupplierOrdersCommand } from "./commands/supplier-orders.js";
import { createProposalsCommand } from "./commands/proposals.js";
import { createProductsCommand } from "./commands/products.js";
import { createContactsCommand } from "./commands/contacts.js";
import { createBankCommand } from "./commands/bank.js";
import { createCategoriesCommand } from "./commands/categories.js";
import { createDocumentsCommand } from "./commands/documents.js";
import { createUsersCommand } from "./commands/users.js";
import { createSetupCommand } from "./commands/setup.js";
import { createAccountingCommand } from "./commands/accounting.js";
import { createProjectsCommand } from "./commands/projects.js";
import { createTicketsCommand } from "./commands/tickets.js";
import { createContractsCommand } from "./commands/contracts.js";
import { createShipmentsCommand } from "./commands/shipments.js";
import { createReceptionsCommand } from "./commands/receptions.js";
import { createInterventionsCommand } from "./commands/interventions.js";
import { createExpenseReportsCommand } from "./commands/expensereports.js";
import { createMembersCommand } from "./commands/members.js";
import { createStockCommand } from "./commands/stock.js";
import { createSupplierProposalsCommand } from "./commands/supplier-proposals.js";
import { createTasksCommand } from "./commands/tasks.js";
import { createAgendaCommand } from "./commands/agenda.js";
import { createMulticurrenciesCommand } from "./commands/multicurrencies.js";
import { createKnowledgeCommand } from "./commands/knowledge.js";
import { createMrpCommand } from "./commands/mrp.js";
import { createUpgradeCommand } from "./commands/upgrade.js";
import {
  ensureFreshCacheOnColdStart,
  maybePrintBanner,
  scheduleBackgroundCheckIfStale,
} from "./core/update-notifier.js";
import { enableBatchIds } from "./core/batch.js";
import { enableListFilters } from "./core/list-filters.js";
import { enableAutoPaginate } from "./core/paginate.js";
import { enableBulkInput } from "./core/bulk-input.js";
import { enableOutputFormats } from "./core/formats.js";
import { enableFinancialConfirmation } from "./core/financial-writes.js";
import { enableViews } from "./core/views.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const SPLASH = `
  dolibarr-cli v${pkg.version}
  Unofficial CLI for Dolibarr ERP

  Run "dolibarr --help" for available commands.
`;

const program = new Command();

program
  .name("dolibarr")
  .description("Unofficial CLI for Dolibarr ERP")
  .option("--dry-run", "Show what would happen without executing")
  .option("--no-interactive", "Fail instead of prompting for input")
  .option("--compact", "Minify JSON output (strip whitespace only; does not reduce fields)")
  .option(
    "--read-only",
    "Block every write (POST/PUT/DELETE) for this run, including raw. Exits 6 if one is attempted",
  )
  .version(pkg.version)
  .helpCommand(true)
  .action(() => {
    console.log(SPLASH);
  });

// Foundation commands
program.addCommand(createConfigCommand());
program.addCommand(createStatusCommand());
program.addCommand(createRawCommand());

// Business resource commands
program.addCommand(createThirdpartiesCommand());
program.addCommand(createInvoicesCommand());
program.addCommand(createSupplierInvoicesCommand());
program.addCommand(createOrdersCommand());
program.addCommand(createSupplierOrdersCommand());
program.addCommand(createProposalsCommand());
program.addCommand(createProductsCommand());
program.addCommand(createContactsCommand());
program.addCommand(createBankCommand());
program.addCommand(createCategoriesCommand());
program.addCommand(createDocumentsCommand());
program.addCommand(createUsersCommand());
program.addCommand(createSetupCommand());
program.addCommand(createAccountingCommand());
program.addCommand(createProjectsCommand());
program.addCommand(createTicketsCommand());
program.addCommand(createContractsCommand());
program.addCommand(createShipmentsCommand());
program.addCommand(createReceptionsCommand());
program.addCommand(createInterventionsCommand());
program.addCommand(createExpenseReportsCommand());
program.addCommand(createMembersCommand());
program.addCommand(createStockCommand());
program.addCommand(createSupplierProposalsCommand());
program.addCommand(createTasksCommand());
program.addCommand(createAgendaCommand());
program.addCommand(createMulticurrenciesCommand());
program.addCommand(createKnowledgeCommand());
program.addCommand(createMrpCommand());
program.addCommand(createUpgradeCommand());

// Innermost of all: the financial-write gate must sit INSIDE the batch wrapper.
// A batch run confirms once for the whole selection and sets --confirm on the
// command, which this gate then sees — so batch and financial protections compose
// instead of prompting twice for the same approval.
enableFinancialConfirmation(program);

// Splits an array/NDJSON payload into single-record runs, so an
// outer batch over ids applies every record to each id.
enableBulkInput(program);

// One edit, all 33 groups: wire comma-separated batch ids into every mutating
// subcommand whose sole required positional is <id>.
enableBatchIds(program);

// Wrapped after the batch layer so it runs first and the composed --filter is
// already in place when a list query or a status selection reads it.
enableListFilters(program);

// Outermost: --all must be active before the list query is issued.
enableAutoPaginate(program);

// Adds the pipeline output flags to everything that renders output.
enableOutputFormats(program);

// Named field presets + redaction, on the same set of output-rendering commands.
enableViews(program);

configureHelp(program);

(async () => {
  try {
    await program.parseAsync(process.argv);
  } finally {
    await ensureFreshCacheOnColdStart(pkg.version);
    maybePrintBanner(pkg.version);
    scheduleBackgroundCheckIfStale();
  }
})();
