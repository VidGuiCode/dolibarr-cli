import * as fs from "node:fs";
import { Command } from "commander";
import { createClient } from "../core/config-store.js";
import { printInfo } from "../core/output.js";
import { exitWithError } from "../core/errors.js";
import { toEpochSeconds } from "../core/dates.js";
import {
  addGetOptions,
  addListOptions,
  buildListQuery,
  confirmOrCancel,
  dryRunJson,
  echoState,
  prunePayload,
  renderGet,
  renderList,
  resolveOutput,
  type ColumnSpec,
} from "../core/resource-helpers.js";

/** Member statuses per Dolibarr's Adherent class — note the negative codes. */
const STATUS_MAP: Record<string, string> = {
  "-2": "Excluded",
  "-1": "Resiliated",
  "0": "Draft",
  "1": "Validated",
};

const tsToDate = (v: unknown): string =>
  v ? new Date(Number(v) * 1000).toISOString().split("T")[0] : "";

const statusLabel = (i: Record<string, unknown>): string => {
  const s = i.statut ?? i.status;
  return STATUS_MAP[String(s)] ?? String(s ?? "");
};

const announce = (opts: Record<string, unknown>, msg: string): void => {
  if (resolveOutput(opts) !== "json") printInfo(msg);
};

export const memberListColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  {
    key: "lastname",
    label: "Name",
    format: (i) => [i.firstname, i.lastname].filter(Boolean).join(" "),
  },
  { key: "login", label: "Login" },
  { key: "email", label: "Email" },
  { key: "typeid", label: "Type", format: (i) => String(i.typeid ?? i.fk_adherent_type ?? "") },
  { key: "statut", label: "Status", format: statusLabel },
];

export const memberDetailFields: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "ref", label: "Ref" },
  { key: "firstname", label: "First name" },
  { key: "lastname", label: "Last name" },
  { key: "societe", label: "Company" },
  { key: "login", label: "Login" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "typeid", label: "Type ID", format: (i) => String(i.typeid ?? i.fk_adherent_type ?? "") },
  { key: "socid", label: "Thirdparty ID" },
  { key: "address", label: "Address" },
  { key: "zip", label: "Zip" },
  { key: "town", label: "Town" },
  { key: "country_id", label: "Country ID" },
  { key: "morphy", label: "Nature" },
  { key: "public", label: "Public" },
  { key: "datefin", label: "Subscription end", format: (i) => tsToDate(i.datefin) },
  { key: "note_public", label: "Public note" },
  { key: "note_private", label: "Private note" },
  { key: "statut", label: "Status", format: statusLabel },
];

export const subscriptionColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "fk_adherent", label: "Member", format: (i) => String(i.fk_adherent ?? i.fk_member ?? "") },
  { key: "dateh", label: "From", format: (i) => tsToDate(i.dateh ?? i.date_start) },
  { key: "datef", label: "To", format: (i) => tsToDate(i.datef ?? i.date_end) },
  { key: "amount", label: "Amount" },
  { key: "note", label: "Label", format: (i) => String(i.note ?? i.label ?? "") },
];

export const memberTypeColumns: ColumnSpec[] = [
  { key: "id", label: "ID" },
  { key: "label", label: "Label" },
  { key: "subscription", label: "Subscription" },
  { key: "amount", label: "Amount" },
  { key: "duration", label: "Duration" },
  { key: "vote", label: "Vote" },
];

/** Build the POST/PUT body for a member. Only passed flags become part of the body. */
export function buildMemberBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    lastname: opts.lastname,
    firstname: opts.firstname,
    societe: opts.company,
    typeid: opts.type === undefined ? undefined : Number(opts.type),
    login: opts.login,
    email: opts.email,
    phone: opts.phone,
    morphy: opts.nature,
    socid: opts.socid === undefined ? undefined : Number(opts.socid),
    address: opts.address,
    zip: opts.zip,
    town: opts.town,
    country_id: opts.country === undefined ? undefined : Number(opts.country),
    public: opts.public === undefined ? undefined : Number(opts.public),
    note_public: opts.notePublic,
    note_private: opts.notePrivate,
  });
}

/**
 * Build the POST body for a subscription.
 * Dolibarr requires `start_date`, `end_date` and `amount` (confirmed by the API's own
 * validation messages).
 */
export function buildSubscriptionBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    start_date: toEpochSeconds(opts.start as string),
    end_date: toEpochSeconds(opts.end as string),
    amount: Number(opts.amount),
  };
  if (opts.label !== undefined) body.label = opts.label;
  return body;
}

/** Build the POST/PUT body for a member type. */
export function buildMemberTypeBody(opts: Record<string, unknown>): Record<string, unknown> {
  return prunePayload({
    label: opts.label,
    subscription: opts.subscription === undefined ? undefined : Number(opts.subscription),
    amount: opts.amount === undefined ? undefined : Number(opts.amount),
    duration: opts.duration,
    vote: opts.vote === undefined ? undefined : Number(opts.vote),
    note: opts.note,
  });
}

export function createMembersCommand(): Command {
  const cmd = new Command("members").description(
    "Manage members, their subscriptions and member types",
  );

  addListOptions(cmd.command("list").description("List members"))
    .option("--type <id>", "Filter by member type ID")
    .option("--category <id>", "Filter by category ID")
    .action(async (opts) => {
      try {
        const client = createClient();
        const items = await client.get<Record<string, unknown>[]>(
          "members",
          buildListQuery(opts, { typeid: opts.type, category: opts.category }),
        );
        renderList(items, { opts, columns: memberListColumns });
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    cmd.command("get").description("Get member details").argument("<id>", "Member ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`members/${id}`);
      renderGet(item, { opts, fields: memberDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    cmd
      .command("by-thirdparty")
      .description("Get the member linked to a thirdparty")
      .argument("<thirdparty-id>", "Thirdparty ID"),
  ).action(async (socid, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`members/thirdparty/${socid}`);
      renderGet(item, { opts, fields: memberDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    cmd
      .command("by-email")
      .description("Get a member by the linked thirdparty's email")
      .argument("<email>", "Email address"),
  ).action(async (email, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(
        `members/thirdparty/email/${encodeURIComponent(email)}`,
      );
      renderGet(item, { opts, fields: memberDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    cmd
      .command("by-barcode")
      .description("Get a member by the linked thirdparty's barcode")
      .argument("<barcode>", "Barcode"),
  ).action(async (barcode, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(
        `members/thirdparty/barcode/${encodeURIComponent(barcode)}`,
      );
      renderGet(item, { opts, fields: memberDetailFields });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  const memberFieldOptions = (c: Command): Command =>
    c
      .option("--firstname <name>", "First name")
      .option("--company <name>", "Company name (societe)")
      .option("--login <login>", "Login")
      .option("--email <email>", "Email address")
      .option("--phone <phone>", "Phone number")
      .option("--nature <mor|phy>", "Nature: `mor` (organisation) or `phy` (person)")
      .option("--socid <id>", "Linked thirdparty ID")
      .option("--address <text>", "Address")
      .option("--zip <zip>", "Postal code")
      .option("--town <town>", "Town")
      .option("--country <id>", "Country ID")
      .option("--public <0|1>", "Publish on the public member list")
      .option("--note-public <text>", "Public note")
      .option("--note-private <text>", "Private note");

  memberFieldOptions(
    addGetOptions(cmd.command("create").description("Create a member"))
      .option("--from-json <file>", "Create from a JSON file")
      .option("--lastname <name>", "Last name (required)")
      .option("--type <id>", "Member type ID (required)"),
  ).action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.fromJson) {
        body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
      } else {
        if (!opts.lastname || !opts.type) {
          printInfo("Error: --lastname and --type are required (or use --from-json)");
          process.exit(1);
        }
        body = buildMemberBody(opts);
      }
      if (dryRunJson("members.create", { body })) return;
      const client = createClient();
      const id = await client.post<number>("members", body);
      announce(opts, `Created member with ID: ${id}`);
      await echoState(client, `members/${id}`, opts, memberDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  memberFieldOptions(
    addGetOptions(
      cmd
        .command("update")
        .description("Update a member (only the flags you pass are sent)")
        .argument("<id>", "Member ID"),
    )
      .option("--lastname <name>", "Last name")
      .option("--type <id>", "Member type ID"),
  ).action(async (id, opts) => {
    try {
      const body = buildMemberBody(opts);
      if (Object.keys(body).length === 0) {
        printInfo("Nothing to update — pass at least one field flag.");
        return;
      }
      if (dryRunJson("members.update", { id, body })) return;
      const client = createClient();
      await client.put<unknown>(`members/${id}`, body);
      announce(opts, `Updated member ${id}`);
      await echoState(client, `members/${id}`, opts, memberDetailFields);
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  cmd
    .command("delete")
    .description("Delete a member")
    .argument("<id>", "Member ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("members.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete member ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`members/${id}`);
        announce(opts, `Deleted member ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  addGetOptions(
    cmd
      .command("categories")
      .description("List the categories a member belongs to")
      .argument("<id>", "Member ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(`members/${id}/categories`);
      renderList(Array.isArray(items) ? items : [], {
        opts,
        columns: [
          { key: "id", label: "ID" },
          { key: "ref", label: "Ref" },
          { key: "label", label: "Label" },
          { key: "description", label: "Description" },
        ],
      });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  cmd.addCommand(createSubscriptionsCommand());
  cmd.addCommand(createMemberTypesCommand());

  cmd.addHelpText(
    "after",
    "\nNotes (Dolibarr 20.0.4, verified by probing the router):" +
      "\n  • No /members/ref/{ref} route — `get` takes a numeric ID. Use `by-thirdparty`," +
      "\n    `by-email` or `by-barcode` to look a member up by its thirdparty." +
      "\n  • Member types live at /memberstypes (their own API class). /members/types also" +
      "\n    resolves, but `types` here uses the dedicated resource." +
      "\n  • Statuses are -2 excluded, -1 resiliated, 0 draft, 1 validated.",
  );

  return cmd;
}

/** `members subscriptions` — membership subscriptions (fee periods). */
function createSubscriptionsCommand(): Command {
  const grp = new Command("subscriptions").description("Manage membership subscriptions");

  addListOptions(
    grp
      .command("list")
      .description("List a member's subscriptions")
      .argument("<member-id>", "Member ID"),
  ).action(async (memberId, opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        `members/${memberId}/subscriptions`,
      );
      renderList(Array.isArray(items) ? items : [], { opts, columns: subscriptionColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addListOptions(
    grp.command("list-all").description("List every subscription across all members"),
  ).action(async (opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        "subscriptions",
        buildListQuery(opts),
      );
      renderList(items, { opts, columns: subscriptionColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp
      .command("get")
      .description("Get one subscription")
      .argument("<subscription-id>", "Subscription ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`subscriptions/${id}`);
      renderGet(item, { opts, fields: subscriptionColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp
      .command("add")
      .description("Record a subscription for a member (books a membership fee)")
      .argument("<member-id>", "Member ID"),
  )
    .requiredOption("--start <date>", "Period start (YYYY-MM-DD or epoch)")
    .requiredOption("--end <date>", "Period end (YYYY-MM-DD or epoch)")
    .requiredOption("--amount <n>", "Subscription amount")
    .option("--label <text>", "Label / note")
    .option("--confirm", "Skip confirmation prompt")
    .addHelpText(
      "after",
      "\n⚠️  This books a membership fee against the member. It is guarded: preview with" +
        "\n--dry-run, and a confirmation (or --confirm) is required. The route and its" +
        "\nrequired fields (start_date, end_date, amount) were confirmed against the live" +
        "\nAPI's own validation, but the write could not be exercised — the reference" +
        "\ninstance's API user lacks member permissions.",
    )
    .action(async (memberId, opts) => {
      try {
        const body = buildSubscriptionBody(opts);
        if (dryRunJson("members.subscriptions.add", { memberId, body })) return;
        if (
          !(await confirmOrCancel(
            `Record a subscription of ${opts.amount} for member ${memberId}?`,
            opts,
          ))
        )
          return;
        const client = createClient();
        const id = await client.post<number>(`members/${memberId}/subscriptions`, body);
        announce(opts, `Recorded subscription ${id} for member ${memberId}`);
        await echoState(client, `members/${memberId}`, opts, memberDetailFields);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    grp
      .command("update")
      .description("Update a subscription")
      .argument("<subscription-id>", "Subscription ID"),
  )
    .option("--start <date>", "Period start (YYYY-MM-DD or epoch)")
    .option("--end <date>", "Period end (YYYY-MM-DD or epoch)")
    .option("--amount <n>", "Subscription amount")
    .option("--label <text>", "Label / note")
    .option("--from-json <file>", "Send a raw JSON body instead of building one")
    .action(async (id, opts) => {
      try {
        const body: Record<string, unknown> = opts.fromJson
          ? (JSON.parse(fs.readFileSync(opts.fromJson, "utf-8")) as Record<string, unknown>)
          : prunePayload({
              start_date: opts.start === undefined ? undefined : toEpochSeconds(opts.start),
              end_date: opts.end === undefined ? undefined : toEpochSeconds(opts.end),
              amount: opts.amount === undefined ? undefined : Number(opts.amount),
              label: opts.label,
            });
        if (Object.keys(body).length === 0) {
          printInfo("Nothing to update — pass at least one field flag.");
          return;
        }
        if (dryRunJson("members.subscriptions.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`subscriptions/${id}`, body);
        announce(opts, `Updated subscription ${id}`);
        await echoState(client, `subscriptions/${id}`, opts, subscriptionColumns);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  return grp;
}

/** `members types` — member type dictionary (`/memberstypes`). */
function createMemberTypesCommand(): Command {
  const grp = new Command("types").description("Manage member types");

  addListOptions(grp.command("list").description("List member types")).action(async (opts) => {
    try {
      const client = createClient();
      const items = await client.get<Record<string, unknown>[]>(
        "memberstypes",
        buildListQuery(opts),
      );
      renderList(items, { opts, columns: memberTypeColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(
    grp.command("get").description("Get a member type").argument("<id>", "Member type ID"),
  ).action(async (id, opts) => {
    try {
      const client = createClient();
      const item = await client.get<Record<string, unknown>>(`memberstypes/${id}`);
      renderGet(item, { opts, fields: memberTypeColumns });
    } catch (err) {
      exitWithError(err, Boolean(opts.json || opts.output === "json"));
    }
  });

  addGetOptions(grp.command("create").description("Create a member type"))
    .option("--from-json <file>", "Create from a JSON file")
    .option("--label <text>", "Label (required)")
    .option("--subscription <0|1>", "Whether the type requires a subscription")
    .option("--amount <n>", "Default subscription amount")
    .option("--duration <spec>", "Subscription duration (e.g. 1y, 6m)")
    .option("--vote <0|1>", "Whether members of this type can vote")
    .option("--note <text>", "Note")
    .action(async (opts) => {
      try {
        let body: Record<string, unknown>;
        if (opts.fromJson) {
          body = JSON.parse(fs.readFileSync(opts.fromJson, "utf-8"));
        } else {
          if (!opts.label) {
            printInfo("Error: --label is required (or use --from-json)");
            process.exit(1);
          }
          body = buildMemberTypeBody(opts);
        }
        if (dryRunJson("members.types.create", { body })) return;
        const client = createClient();
        const id = await client.post<number>("memberstypes", body);
        announce(opts, `Created member type with ID: ${id}`);
        await echoState(client, `memberstypes/${id}`, opts, memberTypeColumns);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  addGetOptions(
    grp
      .command("update")
      .description("Update a member type (only the flags you pass are sent)")
      .argument("<id>", "Member type ID"),
  )
    .option("--label <text>", "Label")
    .option("--subscription <0|1>", "Whether the type requires a subscription")
    .option("--amount <n>", "Default subscription amount")
    .option("--duration <spec>", "Subscription duration (e.g. 1y, 6m)")
    .option("--vote <0|1>", "Whether members of this type can vote")
    .option("--note <text>", "Note")
    .action(async (id, opts) => {
      try {
        const body = buildMemberTypeBody(opts);
        if (Object.keys(body).length === 0) {
          printInfo("Nothing to update — pass at least one field flag.");
          return;
        }
        if (dryRunJson("members.types.update", { id, body })) return;
        const client = createClient();
        await client.put<unknown>(`memberstypes/${id}`, body);
        announce(opts, `Updated member type ${id}`);
        await echoState(client, `memberstypes/${id}`, opts, memberTypeColumns);
      } catch (err) {
        exitWithError(err, Boolean(opts.json || opts.output === "json"));
      }
    });

  grp
    .command("delete")
    .description("Delete a member type")
    .argument("<id>", "Member type ID")
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        if (dryRunJson("members.types.delete", { id })) return;
        if (!(await confirmOrCancel(`Delete member type ${id}?`, opts))) return;
        const client = createClient();
        await client.delete(`memberstypes/${id}`);
        announce(opts, `Deleted member type ${id}`);
      } catch (err) {
        exitWithError(err, Boolean(opts.json));
      }
    });

  return grp;
}
