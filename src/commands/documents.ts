import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo, printJson, printTable } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { isDryRunEnabled } from "../core/runtime.js";
import { ask } from "../core/prompt.js";

export function createDocumentsCommand(): Command {
  const cmd = new Command("documents").description("Manage documents and files");

  cmd
    .command("list")
    .description("List documents for a module/object")
    .requiredOption("--module <modulepart>", "Module (facture, commande, societe, product, etc.)")
    .option("--id <id>", "Object ID")
    .option("--ref <ref>", "Object reference")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>("documents", {
          modulepart: opts.module,
          id: opts.id,
          ref: opts.ref,
        });
        if (opts.json) { printJson(items); return; }
        const rows = items.map((i) => [
          String(i.name ?? ""),
          String(i.size ?? ""),
          String(i.type ?? ""),
          i.date ? new Date(Number(i.date) * 1000).toISOString().split("T")[0] : "",
        ]);
        printTable(rows, ["Name", "Size", "Type", "Date"]);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("download")
    .description("Download a document")
    .requiredOption("--module <modulepart>", "Module (facture, commande, societe, etc.)")
    .requiredOption("--file <path>", "Relative file path in Dolibarr")
    .option("--output <file>", "Local output file path")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const client = createClient();
        const result = await client.get<Record<string, unknown>>("documents/download", {
          modulepart: opts.module,
          original_file: opts.file,
        });

        if (opts.json) { printJson(result); return; }

        const content = String(result.content ?? result.filecontent ?? "");
        const filename = opts.output ?? path.basename(opts.file);

        if (content) {
          fs.writeFileSync(filename, Buffer.from(content, "base64"));
          printInfo(`Downloaded to ${filename}`);
        } else {
          printInfo("No file content received.");
        }
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("upload")
    .description("Upload a document")
    .requiredOption("--module <modulepart>", "Module (facture, commande, societe, etc.)")
    .requiredOption("--ref <ref>", "Object reference")
    .requiredOption("--file <file>", "Local file to upload")
    .option("--overwrite", "Overwrite existing file")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const filePath = opts.file;
        const filename = path.basename(filePath);
        const fileContent = fs.readFileSync(filePath).toString("base64");

        const body: Record<string, unknown> = {
          filename,
          modulepart: opts.module,
          ref: opts.ref,
          filecontent: fileContent,
          fileencoding: "base64",
          overwriteifexists: opts.overwrite ? 1 : 0,
          createdirifnotexists: 1,
        };

        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "documents.upload", filename, module: opts.module, ref: opts.ref });
          return;
        }

        const client = createClient();
        const result = await client.post<unknown>("documents/upload", body);
        if (opts.json) { printJson(result); return; }
        printInfo(`Uploaded ${filename}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  cmd
    .command("delete")
    .description("Delete a document")
    .requiredOption("--module <modulepart>", "Module (facture, commande, societe, etc.)")
    .requiredOption("--file <path>", "Relative file path to delete")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        if (!opts.confirm) {
          const answer = await ask(`Delete document ${opts.file}? (yes/no)`);
          if (answer !== "yes") { printInfo("Cancelled."); return; }
        }
        if (isDryRunEnabled()) {
          printJson({ dryRun: true, action: "documents.delete", module: opts.module, file: opts.file });
          return;
        }
        const client = createClient();
        await client.delete(`documents?modulepart=${encodeURIComponent(opts.module)}&original_file=${encodeURIComponent(opts.file)}`);
        if (opts.json) { printJson({ deleted: opts.file }); return; }
        printInfo(`Deleted ${opts.file}`);
      } catch (err) { exitWithError(err, Boolean(opts.json)); }
    });

  return cmd;
}
