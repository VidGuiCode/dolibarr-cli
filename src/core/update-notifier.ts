import { spawn } from "node:child_process";
import {
  compareVersions,
  fetchLatestRelease,
  isCacheStale,
  readCache,
  writeCache,
  type UpdateCache,
} from "./updater.js";

const COLD_START_TIMEOUT_MS = 1500;

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
 * Returns true if the cold-start synchronous check should run. All rules must
 * pass: TTY stdout, no --json, no opt-out env, not inside the `upgrade`
 * subcommand, and there's no cache at all (fresh install).
 */
export function shouldColdStartCheck(
  cache: UpdateCache | null,
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (!isTTY) return false;
  if (argv.includes("--json")) return false;
  if (env.DOLIBARR_NO_UPDATE_CHECK === "1") return false;
  if (argv.slice(2).some((arg) => arg === "upgrade")) return false;
  return cache === null;
}

/**
 * On a fresh install (no cache file at all), attempt a tight synchronous fetch
 * of the latest release so the banner can appear on the very first run. If the
 * fetch exceeds the timeout or fails for any reason, fall through silently —
 * the detached background scheduler will still populate the cache for the next
 * invocation.
 *
 * Worst-case added latency on first-ever `dolibarr` call: ~1.5s. All subsequent
 * calls are untouched because the cache is then non-null.
 */
export async function ensureFreshCacheOnColdStart(
  currentVersion: string,
  timeoutMs: number = COLD_START_TIMEOUT_MS,
): Promise<void> {
  let cache: UpdateCache | null;
  try {
    cache = readCache();
  } catch {
    return;
  }
  if (!shouldColdStartCheck(cache)) return;

  try {
    const latest = await fetchLatestRelease(timeoutMs);
    writeCache({
      lastCheck: new Date().toISOString(),
      latestVersion: latest.version,
      currentVersion,
      assetUrl: latest.assetUrl,
    });
  } catch {
    // Timeout / network / parse error — fall through. The detached scheduler
    // will retry on this run, and the next invocation will show the banner
    // once the cache lands.
  }
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
