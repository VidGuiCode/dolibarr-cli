import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";

export function createSetupCommand(): Command {
  const cmd = new Command("setup").description("Manage Dolibarr configuration");

  cmd
    .command("modules")
    .description("List Dolibarr modules and their status")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const result = await client.get<Record<string, unknown>>("setup/modules");

        if (opts.json) { printJson(result); return; }

        // Dolibarr returns modules as an object { modName: { ... } } or array
        if (Array.isArray(result)) {
          const rows = result.map((m: Record<string, unknown>) => [
            String(m.id ?? m.numero ?? ""),
            String(m.name ?? m.nom ?? ""),
            Number(m.enabled) === 1 ? "Enabled" : "Disabled",
          ]);
          printTable(rows, ["ID", "Module", "Status"]);
        } else if (typeof result === "object" && result !== null) {
          const rows: string[][] = [];
          for (const [key, val] of Object.entries(result)) {
            if (typeof val === "object" && val !== null) {
              const mod = val as Record<string, unknown>;
              rows.push([
                String(mod.id ?? mod.numero ?? key),
                String(mod.name ?? mod.nom ?? key),
                Number(mod.enabled) === 1 ? "Enabled" : "Disabled",
              ]);
            }
          }
          printTable(rows, ["ID", "Module", "Status"]);
        }
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("company")
    .description("Show company information")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const item = await client.get<Record<string, unknown>>("setup/company");
        if (opts.json) { printJson(item); return; }
        const rows: string[][] = [];
        for (const [key, val] of Object.entries(item)) {
          if (val !== null && val !== undefined && val !== "" && typeof val !== "object") {
            rows.push([key, String(val)]);
          }
        }
        printTable(rows, ["Setting", "Value"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("conf")
    .description("Get a configuration constant")
    .argument("<name>", "Constant name")
    .option("--json", "Output as JSON")
    .action(async (name, opts) => {
      try {
        const client = createClient();
        const result = await client.get<unknown>(`setup/conf/${encodeURIComponent(name)}`);
        if (opts.json) { printJson(result); return; }
        printInfo(String(result));
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
