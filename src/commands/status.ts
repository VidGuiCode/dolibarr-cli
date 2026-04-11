import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";

export function createStatusCommand(): Command {
  const cmd = new Command("status")
    .description("Check connection and show server info")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const status = await client.get<Record<string, unknown>>("status");

        if (opts.json) {
          printJson(status);
          return;
        }

        const info = (status as { success?: Record<string, unknown> })?.success ?? status;
        const rows: string[][] = [];
        if (info.dolibarr_version) rows.push(["Dolibarr version", String(info.dolibarr_version)]);
        if (info.php_version) rows.push(["PHP version", String(info.php_version)]);
        if (info.server_url) rows.push(["Server URL", String(info.server_url)]);
        if (info.db_version) rows.push(["Database", String(info.db_version)]);
        rows.push(["API URL", client.baseUrl]);

        printTable(rows, ["Property", "Value"]);
        printInfo("\nConnection OK.");
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  return cmd;
}
