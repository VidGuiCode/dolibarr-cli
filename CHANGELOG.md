# Changelog

## 0.3.6 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 7: **product variants**.

> ⚠️ **Verification note.** On the reference instance (Dolibarr 20.0.4) the Products
> module is enabled but the configured API user lacks product permissions, so every
> `products/*` route answers `403 Forbidden` at the call stage (the route exists — it is
> *not* a `404`). These commands were therefore built against the documented, route-
> confirmed API shape and covered by structural tests, but could **not** be exercised
> against live data. Grant the API user product read/write rights to use them.

### Added

- **`products attributes list|get|create|update|delete`** — variant attribute definitions
  (e.g. Color, Size). `create` takes `--ref --label`.
- **`products attribute-values list|create|delete`** — the possible values of an attribute
  (`create <attribute-id> --ref --value`).
- **`products variants list|create|update|delete`** — concrete variants built from
  attribute values. `create <product-id> --price-impact --weight-impact --price-percent
  --reference --feature <attr-id:value-id>` (repeat `--feature` per attribute; they become
  the `features` map Dolibarr expects).
- **`products subproducts list|add|remove`** — BOM/kit children of a product
  (`add <product-id> <subproduct-id> --qty --incdec`).

### Tests

- Added products variant-surface tests (subgroup registration + `buildVariantBody` features
  map). Test total: 249 → 254.

## 0.3.5 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 6: thirdparty links, category ↔ object
linking, contact categories, and extrafields read.

### Added

- **`thirdparties categories list|add|remove <id>`** — manage a thirdparty's customer (or,
  with `--supplier`, supplier) categories.
- **`thirdparties representatives list|add|remove <id>`** — manage a thirdparty's sales
  representatives (`list --mode 0|1`).
- **`thirdparties contacts <id>`** — list a thirdparty's contacts (empty when the
  thirdparty has none, which Dolibarr signals with a 404 — handled).
- **`categories link|unlink <id> <type> <object-id>`** — link/unlink any object
  (customer, supplier, product, contact, member, project, …) to/from a category.
- **`categories of-object <type> <object-id>`** — list the categories an object belongs to.
- **`contacts categories <id>`** — list a contact's categories; `contacts list
  --thirdparty <id>` filters by thirdparty.
- **`setup extrafields [--type <elementtype>]`** — read custom (extra) field definitions,
  optionally scoped to one element type (societe, contact, facture, commande, product, …).

### Notes

- **Accounting stays export-only.** The instance's REST API exposes only
  `accountancy/exportdata` (wrapped by `accounting ledger`); the chart-of-accounts,
  journals, and bookkeeping endpoints return no route on Dolibarr 20.0.4, so no
  `accounting accounts/journals` commands were added. Use `accounting ledger` for export
  and `raw` for anything else.

### Tests

- Added categories, contacts, and thirdparty-links tests. Test total: 243 → 249.

## 0.3.4 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 5: proposals + supplier-side deep, and a
significant fix to the supplier-orders group.

### Fixed

- **The entire `supplier-orders` command group was broken.** It called the API path
  `supplier_orders`, which Dolibarr answers with `501 API not found`. The correct path is
  `supplierorders` (no underscore). Every `supplier-orders` subcommand
  (list/get/create/update/delete/validate/approve) now works. Verified live vs Dolibarr
  20.0.4.

### Added

- **`supplier-orders make-order <id>`** — send an approved order to the supplier
  (`--date --method --comment`).
- **`supplier-orders receive <id>`** — record reception (`--close`, `--comment`,
  `--from-json` with a `[{ id, qty, comment }]` lines array for partial reception).
- **`supplier-orders contacts <id>`** — list linked contacts (`--source
  internal|external`, default external — Dolibarr requires the source).
- **`supplier-invoices add-line / update-line / delete-line / list-lines`** — full
  line editing. Supplier-invoice lines use `pu_ht` for the unit price (Dolibarr silently
  ignores `subprice` here), so `--subprice` is mapped to `pu_ht` and totals recompute.
  Verified live.
- **`proposals update-line / delete-line`** — edit or remove a proposal line
  (`PUT`/`DELETE /proposals/{id}/lines/{lineid}`). See the note below.

### Notes

- **Proposal line *creation* fails on the test instance** with a Dolibarr-side error
  (`api_proposals.class.php:463`, "Bad Request: , Array") for every field combination
  tried, so `proposals add-line` / `update-line` / `delete-line` are wired against the
  verified REST routes but could not be functionally exercised. This is a Dolibarr API
  issue, not a CLI one.
- Supplier orders expose **no** line-edit or contact add/remove routes (only a contacts
  *list*), so those are intentionally not provided.

### Tests

- Added proposals, supplier-orders, and supplier-invoice line-editing tests. Test total:
  235 → 243.

## 0.3.3 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 4: the orders sub-resource surface.

### Added

- **`orders update-line <id> <lineid>` / `orders delete-line <id> <lineid>`** — edit or
  remove a draft order line; order totals recompute server-side and are echoed back.
- **`orders reopen <id>`** — reopen a closed order.
- **`orders create-from-proposal <proposal-id>`** — create an order from a proposal.
- **`orders contacts list|add|remove`** — orders expose a real list-contacts route (unlike
  invoices), so all three are available.
- **`orders shipments <id>`** and **`orders create-shipment <id> <warehouse-id>`** — list
  shipments generated from an order, or create one (requires the Shipments/Expedition
  module on the instance).

### Fixed

- **`orders add-line` now works.** Dolibarr's order-line insert requires an integer
  `product_type`; the command never sent it, so every `add-line` failed with "Incorrect
  integer value: '' for column ... product_type." It now defaults to 0 and accepts
  `--product-type` (0=product, 1=service). Verified live against Dolibarr 20.0.4.

### Tests

- Added orders deep-surface tests (line body builder + product_type, contacts subgroup,
  new subcommand registration). Test total: 231 → 235.

## 0.3.2 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 3: the invoices sub-resource surface, plus
payment-registration bug fixes surfaced while wiring `payments`.

### Added

- **`invoices payments <id>`** — list the payments registered on an invoice (ref, date,
  type, amount, bank line).
- **`invoices create-from-order <order-id>`** — create a customer invoice from an order
  (`POST /invoices/createfromorder/{orderid}`).
- **`invoices template <id>`** — fetch a template (recurring) invoice.
- **`invoices contacts add|remove <id> <contact-id> [type]`** — link/unlink a contact
  (`BILLING` default, `SHIPPING`, `CUSTOMER`). Dolibarr's REST API exposes no
  list-contacts route, so only add/remove are provided (documented in `--help`).
- **`invoices discounts list|apply|apply-credit-note`** — list available discounts and
  apply a fixed discount or a credit note to an invoice.
- **`invoices credit-notes list|create`** — list credit notes (type-2 invoices) or create
  one, optionally against a `--source-invoice`.

### Fixed

- **`invoices pay` / `supplier-invoices pay` now actually register a payment.** Three bugs
  fixed (all verified live against Dolibarr 20.0.4):
  - `--date` was sent verbatim; Dolibarr's `datepaye` requires a Unix timestamp, so every
    `YYYY-MM-DD` payment was rejected. Dates are now normalized via the shared date helper.
  - `supplier-invoices pay` sent `paymentid`; the supplier endpoint requires
    `payment_mode_id`, so supplier payments always failed with "`payment_mode_id` is
    required." Fixed.
  - Both now send `closepaidinvoices` (default `no`; new `--close` flag sets `yes`), which
    the payments endpoint requires.

### Tests

- Added invoices deep-surface tests (payments/contacts/discounts/credit-notes
  registration, contact types, `--close`) and a supplier-invoices `pay` flag test.
  Test total: 226 → 231.

## 0.3.1 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 2. Theme: banking edits (M2, the #2 functional
gap) + thirdparties banking. A recorded payment or bank line was previously immutable,
forcing whole-invoice deletion to fix a mistake.

### Added

- **`invoices unpay <id>` / `invoices set-draft <id>`** — reverse a paid invoice back to
  unpaid, or set a validated invoice back to draft (for corrections). Both echo the
  resulting status. `set-draft` sends the `idwarehouse` (default 0) that Dolibarr's route
  requires.
- **`bank update <id>` / `bank delete <id>`** — bank-account edit and delete (completes the
  account CRUD).
- **`bank add-transaction` / `update-transaction` / `delete-transaction`** — record a manual
  bank line, edit its label, or delete it. `--date` accepts `YYYY-MM-DD`.
- **`thirdparties bank-accounts` (list/create/update/delete)** — a thirdparty's company bank
  accounts including RIB (`--code-banque --code-guichet --number --cle-rib`) and SEPA
  (`--rum --owner`) fields; IBAN/BIC. Listing an account-less thirdparty shows an empty
  table instead of erroring (Dolibarr returns 404 in that case).
- **`thirdparties outstanding <id>`** — outstanding (unpaid) totals, `--type
  invoices|orders|proposals` and `--mode customer|supplier` (supplier reads the purchase
  side).
- **`thirdparties gateways` (list/create/delete)** — external site / payment-gateway
  accounts (societe accounts).

### Changed

- **`thirdparties merge` now confirms before merging** — the source thirdparty is
  permanently deleted, so it prompts (or requires `--confirm` in non-interactive mode) and
  still honors `--dry-run`.

### Notes on Dolibarr API limits (verified live vs 20.0.4)

- **A bank transaction's date is not editable via the REST API** — only its label is. The
  `update-transaction` help says so; it exposes `--label` only rather than a `--date` that
  would silently no-op.
- **There is no REST payment-delete endpoint** (neither invoices nor supplier-invoices).
  `unpay` reverses the paid status; fully removing a recorded payment must be done in the
  Dolibarr web UI. Supplier invoices additionally expose no status-reversal routes.

### Tests

- Added bank (account/transaction body builders, new subcommands), invoices (unpay/
  set-draft), and thirdparties (bank-account body, outstanding path, merge guard) tests.
  Test total: 216 → 226.

## 0.3.0 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 1. Theme: editable `update` (M1, the #1
functional gap from the agent usage report). Re-dating an invoice previously forced a
delete-and-recreate; now it's a single `update`.

### Added

- **`invoices update` / `supplier-invoices update` / `orders update` are now genuinely editable.** In addition to the notes, you can edit the fields that a bookkeeping correction actually needs:
  - `invoices update <id> --date --due-date --socid --cond-reglement --mode-reglement --ref-client --ref-ext --project`
  - `supplier-invoices update <id> --date --due-date --socid --ref-supplier --cond-reglement --mode-reglement --project`
  - `orders update <id> --date --delivery-date --socid --cond-reglement --mode-reglement --ref-client --project`
  - Dates accept `YYYY-MM-DD` (or a raw epoch). **Only fields Dolibarr's header PUT actually persists were exposed** — verified live against Dolibarr 20.0.4. Notably the order date maps to `date_commande` (the `date` key is silently ignored on an order PUT) and the order delivery date maps to `delivery_date` (not `date_livraison`).
- **`invoices update-line <id> <lineid>` / `invoices delete-line <id> <lineid>`.** Edit or remove a draft invoice line (`--desc --subprice --qty --tva-tx --product-id --remise`); the invoice totals recompute server-side and are echoed back. (Order and supplier-invoice line editing land in v0.3.3 / v0.3.4, where their line-endpoint field mapping is verified.)

### Changed

- **Mutations now echo the resulting server state.** After an `update` / `update-line`, the CLI re-fetches the object and prints its post-write state (honoring `--output`/`--json`/`--fields`), so a half-applied write is detectable rather than masked by an optimistic "Updated" message — an agent-safety guard from the usage report.
- **Amount/total is intentionally not editable on the header `update`.** Writing `total_ht` directly desyncs the recomputed totals (verified live), so amounts are changed through line edits (`update-line`) instead. Documented in the command help and the API reference notes.

### Tests

- Added `invoices`, `supplier-invoices`, and `orders` command tests (update body builders, date-field mapping, amount-omission, update-line/delete-line registration). Test total: 201 → 216.

## 0.2.10 - 2026-07-24

### Fixed

- **`dolibarr upgrade install` no longer fails with `spawn npm ENOENT` on Windows.** The installer now spawns `npm` through the platform shell, so Windows resolves the `npm.cmd` launcher (recent Node also refuses to spawn `.cmd` files without a shell). Self-update now works on Windows, macOS, and Linux — previously every Windows user had to fall back to a manual `npm install -g <url>`.
- **`dolibarr upgrade` (bare) now reflects new releases immediately.** It performs a best-effort live check against GitHub (falling back to the cached result when offline) instead of only reading a cache that could be stale right after a release — which made a freshly published version show as "you are ahead of the latest published release."

### Tests

- Added `npmInstallSpawn` tests asserting the global-install args and the `shell: true` option that fixes the Windows ENOENT. Test total: 199 → 201.

### Added

- **`raw --date <keys>` date helper.** Convert `YYYY-MM-DD` values in a `raw` request body to the Unix epoch seconds Dolibarr expects, instead of hand-computing timestamps: `dolibarr raw PUT /supplierinvoices/18 --data '{"date":"2026-03-01"}' --date date`. Accepts one or more comma-separated body keys; date-only values are treated as UTC midnight, and existing epoch values pass through unchanged.

### Changed

- **`list --help` now surfaces the slim-output/`--fields` guidance.** Every `list` command's help footer explains that output is a slim table by default (not full JSON) and shows how to pick columns with `--fields id,ref,date,total_ttc` or switch format with `--output json|csv` — the `--fields` selector shipped in v0.2.0 but was undiscoverable.
- **README** gained a "Dates" section documenting `YYYY-MM-DD` acceptance and the `raw --date` helper.

### Tests

- Added `dates` unit tests (`toEpochSeconds`, `normalizeDateFields`: YYYY-MM-DD → UTC epoch, passthrough, timezone-stability, error cases). Test total: 191 → 199.

### Added

- **`invoices pay` / `supplier-invoices pay` accept payment-type codes.** `--payment-type CB` (or `VIR`, `LIQ`, `CHQ`, …) now works alongside the numeric dictionary id — codes are resolved case-insensitively against `GET /setup/dictionary/payment_types`, so you no longer have to look up the per-instance rowid first. An unknown code fails with a message listing the known codes. Numeric ids are passed through unchanged with no extra API call.

### Fixed

- **`--compact` help text clarified.** It now reads "Minify JSON output (strip whitespace only; does not reduce fields)" so it isn't mistaken for a summary/field-reduction view. (Behavior was already corrected in v0.2.5.)
- **README** `invoices pay` example now includes the required `--payment-type` and shows the new code form.

### Tests

- Added `payment-types` resolver tests (numeric passthrough, code lookup, case-insensitivity, unknown-code error, rowid fallback, dictionary limit). Test total: 185 → 191.

### Fixed

- **`raw` no longer breaks on Windows/Git Bash (MSYS) path mangling.** Under Git Bash, a leading-slash argument like `/supplierinvoices/18/payments` is rewritten by the shell into a Windows path (`C:/Program Files/Git/...`) before the CLI starts, which Dolibarr rejected with a 403 "injection protection". `raw` now detects and un-mangles this automatically — using `EXEPATH` when available and falling back to `.../Git/` and mingw markers — and prints a one-line notice to stderr. Tip: drop the leading slash or set `MSYS_NO_PATHCONV=1` to avoid it entirely.
- **`raw` never silently returns an all-null object.** A failed/rejected request now surfaces the real HTTP status and response body instead of masking it as success. A 2xx response whose fields are all null (Dolibarr's "routed but not served" stub — usually a permission or path issue) prints a stderr warning while keeping stdout as clean JSON for piping.
- **README `raw` examples** now use the real `--data` / `--data-file` flags (they previously showed a nonexistent `--body`) and document the Git Bash path caveat.

### Tests

- Added `api-path` unit tests (path normalization + all-null detection) and `requestRaw` client tests. Test total: 164 → 185.

### Fixed

- **`dolibarr bank list` machine-readable balances** now omits Dolibarr's account-object `balance` / `solde` fields from JSON and CSV output too, because those fields can be stale or zero even when transaction lines exist. This matches the v0.2.5 default table behavior.

## 0.2.5 - 2026-05-17

### Fixed

- **`--compact` output selection** now matches the CLI help again: it only controls JSON indentation and no longer switches default table output to raw JSON. Use `--json --compact` or `--output json --compact` for compact JSON.
- **`dolibarr bank list` balance display** no longer shows Dolibarr's account-object `balance` / `solde` fields in the default table, because those fields can be stale or zero even when transaction lines exist. `bank get` labels the same API value as `Reported Balance` when shown.
- **`dolibarr bank transfer --date`** now converts `YYYY-MM-DD` to a Unix timestamp before calling `/bankaccounts/transfer`, while still accepting an explicit Unix timestamp.
- **Windows install guidance** now documents using `dolibarr.cmd` when PowerShell blocks npm's `.ps1` shim.
- **README examples** now match the shipped command surface for accounting, setup, documents, invoice filters, supplier-invoice filters, and ref lookup.
- **MIT license file** is now included in the repository and release package.

## 0.2.4 - 2026-05-05

### Fixed

- **`dolibarr bank list --compact`** now emits compact JSON when no explicit `--output` is provided. Previously `--compact` only controlled JSON indentation, so the command still rendered the default table output.
- **Bank account field mapping** now uses Dolibarr's current API fields (`account_number`, `iban_prefix`, `balance`) while keeping fallbacks for older aliases (`number`, `iban`, `solde`). `bank create --number/--iban` now sends `account_number` and `iban_prefix`.
- **README bank examples** now use the actual shipped subcommands: `dolibarr bank list` and `dolibarr bank transactions <account-id>`.

### Tests

- Added bank command regression tests and compact JSON output coverage. Test total: 157 -> 164.

## 0.2.3 — 2026-04-17

### Added

- **`dolibarr contracts` command group** — `list`, `get <id>`, `create`, `update`, `delete`, `validate`, `close`, `list-lines <id>`, `activate-line <id> <line-id>`, `deactivate-line <id> <line-id>`. The full lifecycle surface for contracts. `activate-line` requires `--date-start` and accepts `--date-end` + `--comment`; dates accept `YYYY-MM-DD` and are stored as Unix epoch seconds. Contracts do not expose `/ref/{ref}` on the Dolibarr side, so `get` takes a numeric id only.
- **`dolibarr shipments` command group** — `list`, `get <id>`, `create`, `delete`, `validate`, `close`. `create` accepts `--socid`, `--order <id>` (sets `origin=commande`), `--date`, `--tracking`, and `--from-json`. `validate` accepts `--no-trigger` to suppress triggers.
- **`dolibarr receptions` command group** — same surface as shipments: `list`, `get <id>`, `create`, `delete`, `validate`, `close`. `create` sets `origin=supplier_order` when `--order <id>` is given.

### Tests

25 new structural tests (132 → 157) for the three new command trees.

### Docs

- `README.md` — added `contracts`, `shipments`, and `receptions` to the Commands table with one usage example per group.
- `docs/ROADMAP.md` — marked Phase 4b as shipped. The v0.2 program is now complete.
- Heads-up: the `shipments` and `receptions` modules are **not enabled** on the source Dolibarr instance used to generate the reference docs. Endpoints for those two groups were sourced from the public Dolibarr API reference rather than a live swagger dump. `contracts` is verified against a live instance. Please open a GitHub issue if you hit drift on shipments/receptions against a module-enabled instance.

## 0.2.2 — 2026-04-17

### Added

- **`dolibarr projects` command group** — `list`, `get <id-or-ref>`, `create`, `update`, `delete`, `tasks <project-id>`. Projects is the fifth resource group with ref-based lookup support (see 0.2.0). `tasks` calls `GET /projects/{id}/tasks` and accepts `--with-timespent` to include per-task time entries. `list` accepts `--thirdparty <id>` and `--status <n>` (0=draft, 1=validated, 2=closed). `create` requires `--ref` and `--title`; dates accept `YYYY-MM-DD` and are stored as Unix epoch seconds.
- **`dolibarr tickets` command group** — `list`, `get [id-or-ref]`, `create`, `update`, `delete`, `reply <track-id>`. Tickets is the sixth resource group with ref-based lookup. `get` additionally accepts `--track-id <track>` to look up by the public track ID (routes to `GET /tickets/track_id/{track}`). `reply` posts to `POST /tickets/messages` with the required `--message <text>`. `create` requires `--subject` and `--message` and accepts `--category`, `--severity`, `--type`, and `--project` (fk_project).

### Tests

16 new structural tests (116 → 132) covering the command tree shape for both new groups: subcommand registration, positional arguments (including the optional id-or-ref on `tickets get`), required option semantics on `tickets reply --message`, and the filter/flag surface on `list` / `create` / `update` / `delete` / `tasks`.

### Docs

- `README.md` — added `projects` and `tickets` to the Commands table with one usage example per group.
- `docs/ROADMAP.md` — marked Phase 4a as shipped.
- Heads-up: the `tickets` module is **not enabled** on the source Dolibarr instance used to generate the reference docs; endpoints for `tickets` in this release were sourced from the public Dolibarr API reference rather than a live swagger dump. Please open a GitHub issue if you hit drift against a module-enabled instance.

## 0.2.1 — 2026-04-17

### Fixed

- **Cold-start update banner** — on a fresh install with no cache file, the update-check banner previously couldn't appear until the second `dolibarr` invocation because the check was detached and ran asynchronously. It now runs synchronously on the first-ever invocation only, with a 1500ms timeout, so the banner can appear immediately when a newer version is available. If the fetch exceeds the timeout or fails, behavior falls back to the existing detached scheduler (cache lands in the background, banner appears on the next run). Subsequent invocations are unaffected because the cache is non-null for 24h.

### Changed

- `fetchLatestRelease(timeoutMs?)` in `src/core/updater.ts` now takes an optional timeout (defaults to 5000ms) so the cold-start path can use a tighter budget without affecting the detached path.
- New exports in `src/core/update-notifier.ts`: `shouldColdStartCheck`, `ensureFreshCacheOnColdStart`. Same guard rails as the banner (TTY-only, skipped under `--json`, `DOLIBARR_NO_UPDATE_CHECK=1`, or when the `upgrade` subcommand is invoked).

### Tests

11 new unit tests (105 → 116). Coverage: `fetchLatestRelease` timeout parameter (aborts on small timeout, default when unspecified), `shouldColdStartCheck` across all gate combinations, `ensureFreshCacheOnColdStart` happy path, error fall-through, and no-op when cache already exists.

## 0.2.0 — 2026-04-16

### Added

- **Ref-based lookup** — `dolibarr <group> get <id-or-ref>` now accepts a human ref (e.g. `FA2501-0001`) in addition to a numeric id. All-digit input routes to `GET /{resource}/{id}`; anything else routes to `GET /{resource}/ref/{ref}` with proper URL encoding. Enabled on the four resource groups whose Dolibarr API exposes `/ref/{ref}`: `invoices`, `orders`, `proposals`, `categories`. Other groups still require numeric ids.
- **`--output <format>` flag** on all `list` and `get` commands. Formats: `table` (default), `json`, `csv`. `--json` is kept as a back-compat alias for `--output json`; `--output csv` takes precedence when both are set.
- **CSV output** — new `printCsv` helper in `src/core/output.ts` with RFC 4180 escaping (fields containing `,`, `"`, `\r`, `\n` are quoted; internal `"` is doubled; `\r\n` line terminators). CSV headers use the raw Dolibarr field key (not the human label) so downstream tools get a stable schema.
- **`--fields a,b,c` flag** on all `list` and `get` commands. Projects the output to exactly the columns listed, using raw Dolibarr field keys. Works across all three formats. Missing keys render as empty strings. When `--fields` is set, format functions are bypassed so values pass through raw — e.g. `--fields status` on invoices emits `0` / `1` / `2` rather than `Draft` / `Validated` / `Paid`.

### Changed

- `src/core/api-client.ts` — added `getByRefOrId<T>(resource, idOrRef)` used by the four ref-capable `get` actions.
- `src/core/resource-helpers.ts` — `addListOptions` and `addGetOptions` now both register `--output`, `--json`, and `--fields`. New exports: `resolveOutput`, `parseFields`, `renderList`, `renderGet`, `ColumnSpec`. `renderList` / `renderGet` consolidate the format-switching logic that was previously duplicated in every resource file.
- All 14 resource command files were refactored to render lists and single-record views through `renderList` / `renderGet` instead of hand-rolled switches. No user-visible behavior change on the default `table` output beyond the new flags.

### Tests

- 34 new unit tests. Test total: 71 → 105. Coverage: `getByRefOrId` (numeric→id path, ref→encoded path, URL encoding, whitespace trim), `printCsv` (RFC 4180 escaping, CRLF, empty rows, headers-only), `renderList` / `renderGet` (table / json / csv / `--fields` projection / missing keys), `resolveOutput` precedence, `parseFields` edge cases.

## 0.1.2 — 2026-04-16

### Added

- **`dolibarr upgrade` command group** — self-upgrade the CLI from GitHub Releases without leaving the terminal. Three subcommands, no flags:
  - `dolibarr upgrade` — shows installed version + cached latest + next step
  - `dolibarr upgrade check` — fetches the latest release from GitHub and caches it
  - `dolibarr upgrade install` — downloads the `.tgz` asset and runs `npm install -g` on it
- **Update-available notice** — a one-line banner printed to stderr on every `dolibarr` run when a newer version is cached. Cached for 24h; refreshed in a detached background process so it never slows down commands. Suppressed automatically when stdout is piped/redirected, when `--json` is in use, on the `upgrade` command itself, and when the opt-out env var `DOLIBARR_NO_UPDATE_CHECK=1` is set. Goes to stderr, so piped JSON stays clean.
- 32 new unit tests covering updater logic, cache round-trip, staleness boundaries, and banner suppression. Test total: 23 → 71 (16 added in the Phase 2 refactor, 32 added for the upgrade feature).
- 16 earlier tests in this release cover the Phase 2 `resource-helpers.ts` module (option wiring, query building, dry-run envelope, payload pruning, confirm semantics).

### Changed

- **Internal refactor**: extracted shared command boilerplate into `src/core/resource-helpers.ts`. The list-option wiring, dry-run envelope, pagination query shape, undefined-key pruning, and delete-confirmation prompt are now single helpers (`addListOptions`, `buildListQuery`, `dryRunJson`, `prunePayload`, `confirmOrCancel`) reused across 11 command files. No user-visible CLI behavior changes.
- `src/core/config-store.ts` gained generic `readJson` / `writeJson` / `getUpdateCachePath` helpers, now shared by the config store and the update cache.
- Removed unused `CHANGELOG` line from 0.1.0 that referenced gitignored documentation. See README and `docs/ROADMAP.md` for current reference material.

### Docs

- `README.md` — added an "Upgrading" section documenting the `upgrade` subcommands and the `DOLIBARR_NO_UPDATE_CHECK` opt-out.
- `docs/ROADMAP.md` — v0.2 is now documented as a **phased** program (Phase 2 refactor → Phase 3 cross-cutting features → Phase 4a/4b new resource groups → Phase 5 deep endpoint coverage) rather than a single monolithic release.

## 0.1.1 — 2026-04-16

### Fixed

- Removed a hardcoded personal default URL from `dolibarr config init`. The prompt now shows a generic placeholder (`https://erp.example.com`) and requires the user to enter their own URL. This value should never have shipped as a default in an open-source tool.
- `npm run clean` now works cross-platform. It previously only ran on Windows (PowerShell); it now uses a Node one-liner that works on macOS, Linux, and Windows.

### Docs

- `CONTRIBUTING.md` — added a rule forbidding hardcoded personal values (URLs, emails, instance names, etc.) in source, tests, docs, or examples.
- `docs/ROADMAP.md` — reconciled the `setup` command description with what actually ships (`modules`, `company`, `conf`).
- `README.md` — install snippet bumped to v0.1.1.

## 0.1.0 — 2026-04-11

### Added

#### Infrastructure
- API client (`src/core/api-client.ts`) — native fetch with DOLAPIKEY auth, retries with exponential backoff + jitter, typed error handling
- Config store (`src/core/config-store.ts`) — `~/.config/dolibarr-cli/config.json`, env var override (`DOLIBARR_URL`, `DOLIBARR_API_KEY`)
- Output formatting (`src/core/output.ts`) — `printTable` (auto-width), `printJson` (compact/pretty), `printError`, `printErrorJson`
- Error handling (`src/core/errors.ts`) — `DolibarrApiError`, `DolibarrAuthError`, `DolibarrConfigError`, `exitWithError` with status-specific exit codes
- Runtime flags (`src/core/runtime.ts`) — `isDryRunEnabled`, `isNonInteractiveMode`, `isCompactMode`
- Interactive prompts (`src/core/prompt.ts`) — `ask`, `pickOne` with non-interactive mode support
- Custom help formatter (`src/core/help.ts`) — ruled sections matching plane-cli/solidtime-cli style
- Global CLI options: `--dry-run`, `--no-interactive`, `--compact`

#### Commands
- `dolibarr config` — `init`, `show`, `set`, `path`
- `dolibarr status` — server info and connection check
- `dolibarr raw` — escape hatch for any API endpoint (`GET`, `POST`, `PUT`, `DELETE`)
- `dolibarr thirdparties` — `list`, `get`, `create`, `update`, `delete`, `merge`
- `dolibarr invoices` — `list`, `get`, `create`, `update`, `delete`, `validate`, `pay`, `add-line`, `list-lines`
- `dolibarr supplier-invoices` — `list`, `get`, `create`, `update`, `delete`, `validate`, `pay`
- `dolibarr orders` — `list`, `get`, `create`, `update`, `delete`, `validate`, `close`, `add-line`
- `dolibarr supplier-orders` — `list`, `get`, `create`, `update`, `delete`, `validate`, `approve`
- `dolibarr proposals` — `list`, `get`, `create`, `update`, `delete`, `validate`, `close`, `add-line`
- `dolibarr products` — `list`, `get`, `create`, `update`, `delete`, `stock`
- `dolibarr contacts` — `list`, `get`, `create`, `update`, `delete`
- `dolibarr bank` — `list`, `get`, `create`, `transactions`, `transfer`
- `dolibarr categories` — `list`, `get`, `create`, `update`, `delete`, `objects`
- `dolibarr documents` — `list`, `download`, `upload`, `delete`
- `dolibarr users` — `list`, `get`, `me`, `create`, `update`
- `dolibarr setup` — `modules`, `company`, `conf`
- `dolibarr accounting` — `ledger`

#### Cross-cutting Features
- `--json` flag on all read commands for machine-readable output
- `--dry-run` on all mutating commands
- `--limit`, `--page`, `--sort`, `--order`, `--filter` on all list commands
- `--from-json <file>` on create commands
- `--confirm` on delete commands
- SQL filter support via `--filter` (maps to Dolibarr's `sqlfilters` syntax)

#### Tests
- Vitest setup with 23 tests across 2 test suites
- API client tests: URL construction, query params, auth header, error handling, retry logic
- Output tests: table formatting, JSON output, info/error printing

#### Documentation
- Version roadmap (`docs/ROADMAP.md`)
- CLAUDE.md with full agent briefing
