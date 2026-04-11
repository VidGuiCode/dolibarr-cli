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
  .option("--compact", "Output compact JSON (no indentation)")
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

configureHelp(program);
program.parseAsync(process.argv);
