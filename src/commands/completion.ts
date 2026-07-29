import { Command } from "commander";
import { printInfo, printNotice } from "../core/output.js";
import { exitWithError, ValidationError } from "../core/errors.js";
import {
  SUPPORTED_SHELLS,
  buildCompletionSpec,
  generateCompletion,
  isSupportedShell,
} from "../core/completion.js";

const INSTALL_HINTS: Record<string, string> = {
  bash: 'eval "$(dolibarr completion bash)"   # or > /etc/bash_completion.d/dolibarr',
  zsh: 'dolibarr completion zsh > "${fpath[1]}/_dolibarr"',
  fish: "dolibarr completion fish > ~/.config/fish/completions/dolibarr.fish",
};

/**
 * `dolibarr completion <shell>`.
 *
 * Takes the root program so the script is generated from the tree as actually
 * registered — including the flags the 0.5.x/0.6.x wiring layers add — rather than
 * from a hand-maintained list that would drift.
 */
export function createCompletionCommand(getProgram: () => Command): Command {
  const cmd = new Command("completion")
    .description("Print a shell completion script (bash, zsh, fish)")
    .argument("<shell>", `Shell to generate for: ${SUPPORTED_SHELLS.join(", ")}`)
    .action((shell: string) => {
      try {
        const name = shell.trim().toLowerCase();
        if (!isSupportedShell(name)) {
          throw new ValidationError(
            `Unsupported shell "${shell}". Supported: ${SUPPORTED_SHELLS.join(", ")}.`,
          );
        }
        const spec = buildCompletionSpec(getProgram());
        // Script to stdout so it can be redirected; the hint to stderr so it doesn't
        // end up inside the file the user just wrote.
        printInfo(generateCompletion(name, spec).trimEnd());
        printNotice(`\n# Install with:\n#   ${INSTALL_HINTS[name]}`);
      } catch (err) {
        exitWithError(err);
      }
    });

  cmd.addHelpText(
    "after",
    "\nThe script is generated from the live command tree, so it stays in step with" +
      "\nthe commands and flags this build actually has.",
  );

  return cmd;
}
