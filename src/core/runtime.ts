export function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

export function isDryRunEnabled(): boolean {
  return hasArg("--dry-run");
}

export function isNonInteractiveMode(): boolean {
  return hasArg("--no-interactive") || !process.stdin.isTTY || !process.stdout.isTTY;
}

export function isCompactMode(): boolean {
  return hasArg("--compact");
}

/**
 * Global read-only mode (v0.6.1) — `--read-only` or `DOLIBARR_READ_ONLY=1`.
 *
 * Turns "I hope this script doesn't change anything" into a provable guarantee: every
 * POST/PUT/DELETE is refused at the API-client choke point, so it cannot be bypassed
 * by `raw POST` or by any command added later.
 *
 * Deliberately distinct from `--dry-run`. Dry run is per-command and shows what a
 * mutation *would* do; read-only is a property of the whole process and is the thing
 * you hand to a cron job or an agent.
 */
export function isReadOnlyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (hasArg("--read-only")) return true;
  const v = (env.DOLIBARR_READ_ONLY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * `--quiet` suppresses non-data output: table headers and the batch reporter's
 * selection list, per-item lines and summary. It deliberately does NOT suppress
 * a command's actual result, so a create still prints its new id.
 */
export function isQuiet(): boolean {
  return hasArg("--quiet");
}
