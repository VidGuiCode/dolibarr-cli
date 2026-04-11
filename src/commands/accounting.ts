import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson } from "../core/output.js";
import { exitWithError } from "../core/errors.js";

export function createAccountingCommand(): Command {
  const cmd = new Command("accounting").description("Accounting and bookkeeping operations");

  cmd
    .command("ledger")
    .description("Export accounting data")
    .requiredOption("--period <period>", "Time period (lastmonth, currentmonth, currentyear, lastyear, custom, etc.)")
    .option("--from <date>", "Start date (YYYY-MM-DD, required for period=custom)")
    .option("--to <date>", "End date (YYYY-MM-DD, required for period=custom)")
    .option("--format <format>", "Export format (CSV, FEC, FEC2)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const params: Record<string, string | undefined> = {
          period: opts.period,
          date_min: opts.from,
          date_max: opts.to,
          format: opts.format,
        };
        const result = await client.get<unknown>("accountancy/exportdata", params);
        if (opts.json) { printJson(result); return; }
        // Export data is typically raw CSV/FEC content
        if (typeof result === "string") {
          printInfo(result);
        } else {
          printJson(result);
        }
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
