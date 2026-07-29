import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// @ts-expect-error -- plain .mjs guard script, shared with `npm run check:version`
import { checkVersionSync } from "../scripts/check-version-sync.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The README install snippet sat at v0.2.6 while the package shipped v0.5.6, so
 * anyone following the README installed a six-version-old release. Nothing in the
 * release flow compared the two. Running the guard here makes `npm test` — already
 * the hard gate before any release — fail on drift.
 */
describe("documented version stays in sync with package.json", () => {
  it("reports no drift", () => {
    expect(checkVersionSync(root)).toEqual([]);
  });
});
