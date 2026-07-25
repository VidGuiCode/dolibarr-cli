import type { Command } from "commander";

/**
 * Every leaf subcommand of `root`, paired with its full space-joined path
 * (e.g. `mrp boms validate`).
 *
 * Lives in its own dependency-free module because the 0.5.x wiring layers all
 * need it, including ones the API client imports — keeping it here avoids an
 * import cycle back through `batch.ts` / `config-store.ts`.
 */
export function walkLeaves(root: Command, prefix = ""): { path: string; cmd: Command }[] {
  const out: { path: string; cmd: Command }[] = [];
  for (const sub of root.commands) {
    const full = `${prefix} ${sub.name()}`.trim();
    if (sub.commands.length > 0) out.push(...walkLeaves(sub, full));
    else out.push({ path: full, cmd: sub });
  }
  return out;
}
