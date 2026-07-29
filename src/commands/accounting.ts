import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printNotice, printTable } from "../core/output.js";
import { withProgress } from "../core/progress.js";
import { exitWithError, ValidationError } from "../core/errors.js";
import {
  ACCOUNTING_EXPORT_FORMATS,
  exportFormatNames,
  findExportFormatById,
  resolveExportFormat,
} from "../core/accounting-formats.js";

export function createAccountingCommand(): Command {
  const cmd = new Command("accounting").description("Accounting and bookkeeping operations");

  cmd
    .command("formats")
    .description("List the accounting export formats accepted by Dolibarr")
    .option("--json", "Output as JSON")
    .action((opts) => {
      if (opts.json) {
        printJson(
          ACCOUNTING_EXPORT_FORMATS.map((f) => ({ name: f.name, id: f.id, label: f.label })),
        );
        return;
      }
      printTable(
        ACCOUNTING_EXPORT_FORMATS.map((f) => [f.name, String(f.id), f.label]),
        ["Format", "Id", "Description"],
      );
      printNotice(
        "\nPass a name or a numeric id to --format, e.g. `--format fec` or `--format 1000`.\n" +
          "Whether a model produces output depends on the instance's accounting configuration.",
      );
    });

  cmd
    .command("ledger")
    .description("Export accounting data (bookkeeping ledger)")
    .requiredOption("--period <period>", "Time period (lastmonth, currentmonth, currentyear, lastyear, custom, etc.)")
    .option("--from <date>", "Start date (YYYY-MM-DD, required for period=custom)")
    .option("--to <date>", "End date (YYYY-MM-DD, required for period=custom)")
    .option(
      "--format <format>",
      `Export format name or numeric Dolibarr model id (${exportFormatNames().slice(0, 4).join(", ")}, …). See \`dolibarr accounting formats\`.`,
    )
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        if (!opts.format) {
          throw new ValidationError(
            "--format is required for `accounting ledger`.\n" +
              `  Accepted formats: ${exportFormatNames().join(", ")} (or a numeric Dolibarr model id).\n` +
              "  Run `dolibarr accounting formats` for the full list. `--format fec` is the usual choice.",
          );
        }
        // Dolibarr expects the numeric export-model id here; sending the name is
        // what produced "Accountancy export format not found" up to v0.5.6.
        const formatId = resolveExportFormat(opts.format);

        const known = findExportFormatById(formatId);
        const client = createClient();
        const params: Record<string, string | number | undefined> = {
          period: opts.period,
          date_min: opts.from,
          date_max: opts.to,
          format: formatId,
        };
        const result = await withProgress(
          `Exporting ${opts.period} ledger (${known?.name ?? formatId})`,
          () => client.get<unknown>("accountancy/exportdata", params),
        );

        if (result === null || result === "") {
          if (opts.json) {
            printJson({
              period: opts.period,
              format: known?.name ?? String(formatId),
              format_id: formatId,
              content: null,
              empty: true,
            });
            return;
          }
          printNotice(
            `No accounting entries were exported for period "${opts.period}" ` +
              `with format ${known?.name ?? formatId} (id ${formatId}).\n` +
              "  Dolibarr returned an empty body. That usually means the period holds no bound\n" +
              "  bookkeeping entries, or this export model is not configured on the instance.\n" +
              "  Try `--format fec`, a wider `--period`, or check Accounting > Bindings in Dolibarr.",
          );
          return;
        }

        if (opts.json) {
          printJson(result);
          return;
        }
        // Export data is raw CSV/FEC content; emit it verbatim so it can be redirected.
        if (typeof result === "string") {
          printInfo(result);
        } else {
          printJson(result);
        }
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  return cmd;
}
