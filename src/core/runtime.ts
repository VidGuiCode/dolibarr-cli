export function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

export function hasOption(name: string): boolean {
  return process.argv.some((arg) => arg === name || arg.startsWith(`${name}=`));
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
