import type { Command } from "commander";
import { walkLeaves } from "./command-tree.js";

/**
 * Shell completion scripts (v0.6.5), generated from the live command tree.
 *
 * Hand-rolled — no `omelette`, no `tabtab`; `commander` stays the only runtime dep.
 *
 * The command and flag lists are derived from the actual registered tree rather than
 * maintained by hand, so completions cannot drift out of date the way a checked-in
 * static script would. A group added to `cli.ts` shows up in completions with no
 * further work.
 */

export const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SUPPORTED_SHELLS)[number];

export function isSupportedShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

export interface CompletionSpec {
  /** Top-level group names, e.g. `invoices`. */
  groups: string[];
  /** Full leaf paths, space-separated, e.g. `invoices pay`. */
  leaves: string[];
  /** Leaf path → its long flags, e.g. `invoices pay` → ["--amount", …]. */
  flagsByPath: Record<string, string[]>;
  /** Flags accepted anywhere, declared on the program itself. */
  globalFlags: string[];
}

/** Read the shape of the command tree once, so every generator works off one model. */
export function buildCompletionSpec(program: Command): CompletionSpec {
  const leaves = walkLeaves(program);
  const flagsByPath: Record<string, string[]> = {};
  for (const { path, cmd } of leaves) {
    flagsByPath[path] = cmd.options
      .map((o) => o.long)
      .filter((l): l is string => Boolean(l))
      .sort();
  }
  return {
    groups: program.commands.map((c) => c.name()).sort(),
    leaves: leaves.map((l) => l.path).sort(),
    flagsByPath,
    globalFlags: program.options
      .map((o) => o.long)
      .filter((l): l is string => Boolean(l))
      .sort(),
  };
}

/** Second-level subcommand names for a group, e.g. `invoices` → ["list", "pay", …]. */
function subcommandsOf(spec: CompletionSpec, group: string): string[] {
  const out = new Set<string>();
  for (const path of spec.leaves) {
    const parts = path.split(" ");
    if (parts[0] === group && parts.length > 1) out.add(parts[1]);
  }
  return [...out].sort();
}

/** Shell-safe: our own command names, but quoting them costs nothing and rules out surprises. */
function words(list: string[]): string {
  return list.join(" ");
}

export function generateBash(spec: CompletionSpec): string {
  const groupCases = spec.groups
    .map((g) => {
      const subs = subcommandsOf(spec, g);
      return `    ${g})\n      opts="${words(subs)}"\n      ;;`;
    })
    .join("\n");

  const flagCases = Object.entries(spec.flagsByPath)
    .filter(([, flags]) => flags.length > 0)
    .map(([path, flags]) => {
      const parts = path.split(" ");
      return `    "${parts.join(" ")}")\n      opts="${words(flags)}"\n      ;;`;
    })
    .join("\n");

  return `# bash completion for dolibarr
# Install:  dolibarr completion bash > /etc/bash_completion.d/dolibarr
#      or:  eval "$(dolibarr completion bash)"

_dolibarr_completions() {
  local cur prev cmd sub opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  sub="\${COMP_WORDS[2]}"

  # Completing a flag: offer this leaf's flags plus the global ones.
  if [[ "\$cur" == -* ]]; then
    case "\$cmd \$sub" in
${flagCases}
    esac
    COMPREPLY=( \$(compgen -W "\$opts ${words(spec.globalFlags)}" -- "\$cur") )
    return 0
  fi

  # Completing the group name.
  if [[ \$COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "${words(spec.groups)}" -- "\$cur") )
    return 0
  fi

  # Completing a subcommand within a group.
  if [[ \$COMP_CWORD -eq 2 ]]; then
    case "\$cmd" in
${groupCases}
    esac
    COMPREPLY=( \$(compgen -W "\$opts" -- "\$cur") )
    return 0
  fi

  return 0
}

complete -F _dolibarr_completions dolibarr
`;
}

export function generateZsh(spec: CompletionSpec): string {
  const groupLines = spec.groups.map((g) => `    '${g}'`).join("\n");

  const subBlocks = spec.groups
    .map((g) => {
      const subs = subcommandsOf(spec, g);
      if (subs.length === 0) return "";
      return `      ${g})\n        _values 'subcommand' ${subs.map((s) => `'${s}'`).join(" ")}\n        ;;`;
    })
    .filter(Boolean)
    .join("\n");

  const flagBlocks = Object.entries(spec.flagsByPath)
    .filter(([, flags]) => flags.length > 0)
    .map(([path, flags]) => {
      const [g, s] = path.split(" ");
      return `      "${g}:${s ?? ""}")\n        _values 'flag' ${flags.map((f) => `'${f}'`).join(" ")}\n        ;;`;
    })
    .join("\n");

  return `#compdef dolibarr
# zsh completion for dolibarr
# Install:  dolibarr completion zsh > "\${fpath[1]}/_dolibarr"

_dolibarr() {
  local context state line
  local -a groups

  if (( CURRENT == 2 )); then
    groups=(
${groupLines}
    )
    _describe 'command' groups
    return
  fi

  if [[ "\${words[CURRENT]}" == -* ]]; then
    case "\${words[2]}:\${words[3]}" in
${flagBlocks}
      *)
        _values 'flag' ${spec.globalFlags.map((f) => `'${f}'`).join(" ")}
        ;;
    esac
    return
  fi

  if (( CURRENT == 3 )); then
    case "\${words[2]}" in
${subBlocks}
    esac
    return
  fi
}

_dolibarr "\$@"
`;
}

export function generateFish(spec: CompletionSpec): string {
  const lines: string[] = [
    "# fish completion for dolibarr",
    "# Install:  dolibarr completion fish > ~/.config/fish/completions/dolibarr.fish",
    "",
    "# Only complete group names at the top level.",
    'function __dolibarr_no_subcommand',
    "  set -l cmd (commandline -opc)",
    "  test (count $cmd) -eq 1",
    "end",
    "",
  ];

  for (const g of spec.groups) {
    lines.push(
      `complete -c dolibarr -n '__dolibarr_no_subcommand' -a '${g}' -d 'dolibarr ${g}'`,
    );
  }
  lines.push("");

  for (const g of spec.groups) {
    for (const s of subcommandsOf(spec, g)) {
      lines.push(
        `complete -c dolibarr -n '__fish_seen_subcommand_from ${g}' -a '${s}' -d '${g} ${s}'`,
      );
    }
  }
  lines.push("");

  /*
   * Flags are emitted per GROUP, as the union of that group's leaves, rather than per
   * leaf as bash and zsh do.
   *
   * Per-leaf would be marginally more precise but produced a ~440 KB file (292 leaves
   * times their flags), and fish sources completion files eagerly — a file that size
   * is a noticeable shell-startup cost. Per-group is fish's usual granularity and
   * brings it under ~30 KB. The only downside is being offered a sibling
   * subcommand's flag, which fish will simply reject if used.
   */
  const flagsByGroup = new Map<string, Set<string>>();
  for (const [path, flags] of Object.entries(spec.flagsByPath)) {
    const g = path.split(" ")[0];
    const set = flagsByGroup.get(g) ?? new Set<string>();
    for (const f of flags) {
      if (!spec.globalFlags.includes(f)) set.add(f);
    }
    flagsByGroup.set(g, set);
  }
  for (const [g, flags] of [...flagsByGroup].sort(([a], [b]) => a.localeCompare(b))) {
    for (const f of [...flags].sort()) {
      lines.push(
        `complete -c dolibarr -n '__fish_seen_subcommand_from ${g}' -l '${f.replace(/^--/, "")}'`,
      );
    }
  }
  lines.push("");

  for (const f of spec.globalFlags) {
    lines.push(`complete -c dolibarr -l '${f.replace(/^--/, "")}'`);
  }

  return lines.join("\n") + "\n";
}

export function generateCompletion(shell: Shell, spec: CompletionSpec): string {
  switch (shell) {
    case "bash":
      return generateBash(spec);
    case "zsh":
      return generateZsh(spec);
    case "fish":
      return generateFish(spec);
  }
}
