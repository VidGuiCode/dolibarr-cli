import * as fs from "node:fs";
import { Command } from "commander";
import { loadConfig, saveConfig, createClient, getConfigPath } from "../core/config-store.js";
import { printInfo, printJson, printTable, printError } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { ask } from "../core/prompt.js";

export function createConfigCommand(): Command {
  const cmd = new Command("config").description("Manage CLI configuration");

  cmd
    .command("init")
    .description("Interactive setup: configure URL and API key")
    .action(async () => {
      try {
        const baseUrl = await ask("Dolibarr base URL (e.g. https://erp.example.com)");
        const apiKey = await ask("API key");

        if (!apiKey) {
          printError("API key is required.");
          process.exit(1);
        }

        printInfo("Testing connection...");
        const client = createClient({ baseUrl, apiKey });
        const status = await client.get<Record<string, unknown>>("status");
        printInfo(
          `Connected to Dolibarr ${(status as { success?: { dolibarr_version?: string } })?.success?.dolibarr_version ?? "unknown"}`,
        );

        saveConfig({ baseUrl: baseUrl.replace(/\/$/, ""), apiKey });
        printInfo(`Configuration saved to ${getConfigPath()}`);
      } catch (err) {
        exitWithError(err);
      }
    });

  cmd
    .command("show")
    .description("Show current configuration")
    .option("--json", "Output as JSON")
    .action((opts) => {
      try {
        const config = loadConfig();
        if (!config) {
          printError("No configuration found. Run: dolibarr config init");
          process.exit(1);
        }
        if (opts.json) {
          printJson({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey.substring(0, 4) + "****",
            configPath: getConfigPath(),
          });
          return;
        }
        printTable(
          [
            ["Base URL", config.baseUrl],
            ["API Key", config.apiKey.substring(0, 4) + "****"],
            ["Config file", getConfigPath()],
          ],
          ["Setting", "Value"],
        );
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  cmd
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Config key (baseUrl or apiKey)")
    .argument("<value>", "Config value")
    .action((key: string, value: string) => {
      try {
        const validKeys = ["baseUrl", "apiKey"];
        if (!validKeys.includes(key)) {
          printError(`Invalid key: ${key}. Valid keys: ${validKeys.join(", ")}`);
          process.exit(1);
        }
        const config = loadConfig() ?? { baseUrl: "", apiKey: "" };
        (config as unknown as Record<string, string>)[key] = key === "baseUrl" ? value.replace(/\/$/, "") : value;
        saveConfig(config);
        printInfo(`Set ${key} successfully.`);
      } catch (err) {
        exitWithError(err);
      }
    });

  cmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      const configPath = getConfigPath();
      const exists = fs.existsSync(configPath);
      printInfo(`${configPath}${exists ? "" : " (not found)"}`);
    });

  return cmd;
}
