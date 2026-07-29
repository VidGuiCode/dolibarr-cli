#!/usr/bin/env node
/**
 * Guard against documented-version drift.
 *
 * The README install snippet sat at v0.2.6 while the package shipped v0.5.6 — six
 * minor versions of drift, so anyone following the README installed a badly
 * outdated release. Nothing in the release flow could catch that, because nothing
 * compared the two. This does.
 *
 * Run standalone (`npm run check:version`) or via the test suite, which is already
 * the hard gate before any release.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {string} root repository root
 * @returns {string[]} human-readable problems; empty means in sync
 */
export function checkVersionSync(root) {
  const problems = [];

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = pkg.version;

  // 1. Every release-download URL in the README must name the current version.
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const urlPattern = /releases\/download\/v(\d+\.\d+\.\d+)\/dolibarr-cli-(\d+\.\d+\.\d+)\.tgz/g;
  let found = 0;
  for (const m of readme.matchAll(urlPattern)) {
    found += 1;
    const [, tag, file] = m;
    if (tag !== version || file !== version) {
      problems.push(
        `README install URL points at v${tag}/dolibarr-cli-${file}.tgz but package.json is ${version}`,
      );
    }
  }
  if (found === 0) {
    problems.push("README has no release-download URL to check — the install snippet is missing");
  }

  // 2. The CHANGELOG must lead with an entry for the current version.
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const firstEntry = changelog.match(/^##\s+(\d+\.\d+\.\d+)/m);
  if (!firstEntry) {
    problems.push("CHANGELOG.md has no version entries");
  } else if (firstEntry[1] !== version) {
    problems.push(
      `CHANGELOG.md's newest entry is ${firstEntry[1]} but package.json is ${version}`,
    );
  }

  return problems;
}

// Only act as a CLI when executed directly, so importing it from a test is side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkVersionSync(process.cwd());
  if (problems.length > 0) {
    console.error("Version sync check failed:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("Version references are in sync.");
}
