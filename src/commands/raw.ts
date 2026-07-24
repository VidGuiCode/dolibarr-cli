import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printJson, printError } from "../core/output.js";
import { exitWithError, ValidationError, DolibarrApiError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { normalizeApiPath, isAllNullObject } from "../core/api-path.js";
import { normalizeDateFields } from "../core/dates.js";

export function createRawCommand(): Command {
  const cmd = new Command("raw")
    .description("Execute raw API requests")
    .argument("<method>", "HTTP method (GET, POST, PUT, DELETE)")
    .argument("<path>", "API path (e.g., /thirdparties). On Git Bash use no leading slash or set MSYS_NO_PATHCONV=1")
    .option("--data <json>", "Request body as JSON string")
    .option("--data-file <file>", "Request body from JSON file")
    .option(
      "--date <keys>",
      "Comma-separated body keys holding YYYY-MM-DD dates to convert to Unix epoch (e.g. --date date,datef)",
    )
    .action(async (method: string, path: string, opts) => {
      try {
        const upperMethod = method.toUpperCase();
        if (!["GET", "POST", "PUT", "DELETE"].includes(upperMethod)) {
          throw new ValidationError(`Invalid HTTP method: ${method}. Use GET, POST, PUT, or DELETE.`);
        }

        const { path: normalizedPath, warning } = normalizeApiPath(path);
        if (warning) printError(warning);

        let body: unknown;
        if (opts.data) {
          body = JSON.parse(opts.data);
        } else if (opts.dataFile) {
          const fs = await import("node:fs");
          body = JSON.parse(fs.readFileSync(opts.dataFile, "utf-8"));
        }

        // --date lets callers pass YYYY-MM-DD in the body and have it converted to
        // the Unix epoch seconds Dolibarr expects, instead of hand-computing timestamps.
        if (opts.date && body && typeof body === "object" && !Array.isArray(body)) {
          const keys = String(opts.date)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          body = normalizeDateFields(body as Record<string, unknown>, keys);
        }

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, method: upperMethod, path: normalizedPath, body: body ?? null });
          return;
        }

        const client = createClient();
        const { status, ok, data } = await client.requestRaw(upperMethod, normalizedPath, body);

        if (!ok) {
          // Surface the real HTTP status + body instead of masking the failure.
          const message =
            typeof data === "string"
              ? data
              : data && typeof data === "object"
                ? JSON.stringify(data)
                : `HTTP ${status}`;
          throw new DolibarrApiError(status, message, upperMethod, normalizedPath, {
            response: data,
          });
        }

        printJson(data);

        // A 2xx with an all-null object is Dolibarr's "routed but not served" stub —
        // often a permission gap or a still-mangled path. Warn so it isn't mistaken
        // for real data (stdout stays clean JSON for piping).
        if (isAllNullObject(data)) {
          printError(
            `HTTP ${status} but every field in the response is null — this usually means a ` +
              `permission issue or an unrecognized path, not a real record.`,
          );
        }
      } catch (err) {
        exitWithError(err, true);
      }
    });

  return cmd;
}
