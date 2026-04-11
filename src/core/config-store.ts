import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DolibarrConfig } from "./types.js";
import { DolibarrApiClient } from "./api-client.js";
import { DolibarrConfigError } from "./errors.js";

export function getConfigDir(): string {
  return path.join(os.homedir(), ".config", "dolibarr-cli");
}

export function getConfigPath(): string {
  if (process.env.DOLIBARR_CONFIG) {
    return process.env.DOLIBARR_CONFIG;
  }
  return path.join(getConfigDir(), "config.json");
}

export function loadConfig(): DolibarrConfig | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as DolibarrConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: DolibarrConfig): void {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function createClient(config?: DolibarrConfig): DolibarrApiClient {
  const envUrl = process.env.DOLIBARR_URL;
  const envKey = process.env.DOLIBARR_API_KEY;

  if (envUrl && envKey) {
    return new DolibarrApiClient({ baseUrl: envUrl, apiKey: envKey });
  }

  const cfg = config ?? loadConfig();
  if (!cfg) {
    throw new DolibarrConfigError(
      "No configuration found. Run `dolibarr config init` to set up the CLI.",
    );
  }

  return new DolibarrApiClient({
    baseUrl: envUrl ?? cfg.baseUrl,
    apiKey: envKey ?? cfg.apiKey,
  });
}
