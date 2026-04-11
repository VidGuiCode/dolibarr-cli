import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printJson } from "../core/output.js";
import { exitWithError, ValidationError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";

export function createRawCommand(): Command {
  const cmd = new Command("raw")
    .description("Execute raw API requests")
    .argument("<method>", "HTTP method (GET, POST, PUT, DELETE)")
    .argument("<path>", "API path (e.g., /thirdparties)")
    .option("--data <json>", "Request body as JSON string")
    .option("--data-file <file>", "Request body from JSON file")
    .action(async (method: string, path: string, opts) => {
      try {
        const upperMethod = method.toUpperCase();
        if (!["GET", "POST", "PUT", "DELETE"].includes(upperMethod)) {
          throw new ValidationError(`Invalid HTTP method: ${method}. Use GET, POST, PUT, or DELETE.`);
        }

        let body: unknown;
        if (opts.data) {
          body = JSON.parse(opts.data);
        } else if (opts.dataFile) {
          const fs = await import("node:fs");
          body = JSON.parse(fs.readFileSync(opts.dataFile, "utf-8"));
        }

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, method: upperMethod, path, body: body ?? null });
          return;
        }

        const client = createClient();
        let result: unknown;

        switch (upperMethod) {
          case "GET":
            result = await client.get(path);
            break;
          case "POST":
            result = await client.post(path, body);
            break;
          case "PUT":
            result = await client.put(path, body);
            break;
          case "DELETE":
            result = await client.delete(path);
            break;
        }

        printJson(result);
      } catch (err) {
        exitWithError(err, true);
      }
    });

  return cmd;
}
