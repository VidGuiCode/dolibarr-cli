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
 * `--quiet` suppresses non-data output: table headers and the batch reporter's
 * selection list, per-item lines and summary. It deliberately does NOT suppress
 * a command's actual result, so a create still prints its new id.
 */
export function isQuiet(): boolean {
  return hasArg("--quiet");
}
