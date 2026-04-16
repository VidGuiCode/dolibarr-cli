import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Command } from "commander";
import {
  compareVersions,
  fetchLatestRelease,
  readCache,
  writeCache,
} from "../core/updater.js";
import { printError, printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { ask } from "../core/prompt.js";
import { isNonInteractiveMode } from "../core/runtime.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

function showStatus(): void {
  const cache = readCache();
  const current = pkg.version;
  printInfo(`Installed: v${current}`);

  if (!cache) {
    printInfo("Latest:    (not checked yet)");
    printInfo("\nRun `dolibarr upgrade check` to fetch the latest release from GitHub.");
    return;
  }

  printInfo(`Latest:    v${cache.latestVersion}  (checked ${cache.lastCheck})`);

  const cmp = compareVersions(cache.latestVersion, current);
  if (cmp > 0) {
    printInfo(`\nA newer version is available. Run \`dolibarr upgrade install\` to upgrade.`);
  } else if (cmp === 0) {
    printInfo("\nYou are on the latest version.");
  } else {
    printInfo("\nYou are ahead of the latest published release.");
  }
}

async function runCheck(): Promise<void> {
  const latest = await fetchLatestRelease();
  writeCache({
    lastCheck: new Date().toISOString(),
    latestVersion: latest.version,
    currentVersion: pkg.version,
    assetUrl: latest.assetUrl,
  });

  if (process.env.DOLIBARR_UPDATE_CHECK_BACKGROUND === "1") {
    // Silent when invoked by the background scheduler.
    return;
  }

  printInfo(`Latest release: v${latest.version}`);
  if (latest.assetUrl) {
    printInfo(`Asset:          ${latest.assetUrl}`);
  } else {
    printInfo(`Asset:          (no .tgz attached to the latest release)`);
  }

  const cmp = compareVersions(latest.version, pkg.version);
  if (cmp > 0) {
    printInfo(`\nYou are on v${pkg.version}. Run \`dolibarr upgrade install\` to upgrade.`);
  } else if (cmp === 0) {
    printInfo(`\nYou are on the latest version.`);
  } else {
    printInfo(`\nYou are on v${pkg.version}, which is ahead of the latest release.`);
  }
}

async function runInstall(): Promise<void> {
  let cache = readCache();
  if (!cache) {
    printInfo("No cached release info. Fetching latest...");
    const latest = await fetchLatestRelease();
    cache = {
      lastCheck: new Date().toISOString(),
      latestVersion: latest.version,
      currentVersion: pkg.version,
      assetUrl: latest.assetUrl,
    };
    writeCache(cache);
  }

  if (!cache.assetUrl) {
    printError(
      "The latest release has no .tgz asset attached. Install manually from the Releases page.",
    );
    process.exit(1);
  }

  const cmp = compareVersions(cache.latestVersion, pkg.version);
  if (cmp === 0) {
    printInfo(`Already on the latest version (v${pkg.version}). Nothing to install.`);
    return;
  }
  if (cmp < 0) {
    printInfo(
      `You are on v${pkg.version}, ahead of the latest release v${cache.latestVersion}. Nothing to install.`,
    );
    return;
  }

  printInfo(`Installing dolibarr-cli v${cache.latestVersion} from:`);
  printInfo(`  ${cache.assetUrl}`);

  if (!isNonInteractiveMode()) {
    const answer = await ask("Proceed? [y/N]", "n");
    if (!/^y(es)?$/i.test(answer.trim())) {
      printInfo("Cancelled.");
      return;
    }
  }

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn("npm", ["install", "-g", cache!.assetUrl!], {
      stdio: "inherit",
    });
    child.on("error", (err) => {
      printError(`Failed to invoke npm: ${err.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    printError(
      `npm install exited with code ${exitCode}. You can retry manually:\n  npm install -g ${cache.assetUrl}`,
    );
    process.exit(exitCode);
  }

  // Silence the update banner on the next invocation by recording that we're now
  // on the installed version.
  writeCache({
    lastCheck: new Date().toISOString(),
    latestVersion: cache.latestVersion,
    currentVersion: cache.latestVersion,
    assetUrl: cache.assetUrl,
  });

  printInfo(`\nInstalled dolibarr-cli v${cache.latestVersion}.`);
}

export function createUpgradeCommand(): Command {
  const cmd = new Command("upgrade")
    .description("Check for and install dolibarr-cli updates from GitHub Releases")
    .action(() => {
      try {
        showStatus();
      } catch (err) {
        exitWithError(err);
      }
    });

  cmd
    .command("check")
    .description("Fetch the latest release info from GitHub and cache it")
    .action(async () => {
      try {
        await runCheck();
      } catch (err) {
        exitWithError(err);
      }
    });

  cmd
    .command("install")
    .description("Download and install the latest release via npm install -g")
    .action(async () => {
      try {
        await runInstall();
      } catch (err) {
        exitWithError(err);
      }
    });

  return cmd;
}
