import { spawn } from "node:child_process";
import {
  compareVersions,
  isCacheStale,
  readCache,
  type UpdateCache,
} from "./updater.js";

/**
 * Returns true if the update-available banner should be printed.
 * All rules must pass: TTY stdout, no --json flag, no opt-out env, cache is outdated,
 * and the invoked subcommand is not itself "upgrade".
 */
export function shouldPrintBanner(
  cache: UpdateCache | null,
  currentVersion: string,
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (!isTTY) return false;
  if (argv.includes("--json")) return false;
  if (env.DOLIBARR_NO_UPDATE_CHECK === "1") return false;
  // Skip banner when user is already interacting with the upgrade command.
  if (argv.slice(2).some((arg) => arg === "upgrade")) return false;
  if (!cache) return false;
  return compareVersions(cache.latestVersion, currentVersion) > 0;
}

/**
 * If a newer version is cached, print a one-line notice to stderr. Pure read,
 * never fetches. Safe to call in a finally / exit handler.
 */
export function maybePrintBanner(currentVersion: string): void {
  let cache: UpdateCache | null;
  try {
    cache = readCache();
  } catch {
    return;
  }
  if (!shouldPrintBanner(cache, currentVersion)) return;
  const latest = cache!.latestVersion;
  console.error(
    `\u2139  dolibarr-cli v${latest} is available (you're on v${currentVersion}). Run \`dolibarr upgrade install\` to upgrade.`,
  );
}

/**
 * If the cache is stale (>24h) and the user hasn't opted out, fire-and-forget a
 * detached child that runs `dolibarr upgrade check` to refresh the cache for the
 * next invocation. Never blocks or throws.
 */
export function scheduleBackgroundCheckIfStale(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.DOLIBARR_NO_UPDATE_CHECK === "1") return;

  let cache: UpdateCache | null;
  try {
    cache = readCache();
  } catch {
    return;
  }
  if (!isCacheStale(cache)) return;

  const entry = process.argv[1];
  if (!entry) return;

  try {
    const child = spawn(
      process.execPath,
      [entry, "upgrade", "check"],
      {
        detached: true,
        stdio: "ignore",
        env: { ...env, DOLIBARR_UPDATE_CHECK_BACKGROUND: "1" },
      },
    );
    child.unref();
  } catch {
    // Never let a failed background spawn impact the user's command.
  }
}
