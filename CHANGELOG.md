# Changelog

## 0.5.9 - 2026-07-29

Final patch of the 0.5.x line. **API errors now tell you what to do about them**, and the
README can no longer drift out of sync with the shipped version.

Before:

```text
✗  API error 403: Forbidden
     Hint: Permission denied. Check API user permissions in Dolibarr.
```

After:

```text
✗  API error 403: Forbidden
     Request: GET /api/index.php/products?limit=1
     Server:  api_products.class.php:212 at call stage
     The route exists, but the API user is not permitted to use it.
     Grant rights on "products" in Dolibarr: Home > Users & Groups > (your API user) > Permissions.
     Confirm the module is enabled too: dolibarr setup modules
```

### Fixed

- **README install snippet pointed at v0.2.6** while the package shipped 0.5.x — six
  versions of drift, so anyone following the README installed a badly outdated release.

### Added

- **Actionable API errors** (report item 5.7). Every failure now reports the **exact
  request path and parameters** that were sent, and Dolibarr's own `debug.source`, which
  the CLI previously discarded. `debug.source` names the REST stage that failed, and that
  is what separates two failures which otherwise look identical:
  - **404 at the route stage** → the endpoint does not exist on this instance, which
    almost always means the owning module is disabled. The message names the module and
    points at `dolibarr setup modules`.
  - **404 at the call stage** → the endpoint ran and found no record; verify the id.
  - **403** → the route exists but the API user lacks rights, with the exact Dolibarr
    screen to fix it on.
  - **400 at the validate stage** → parameters were rejected before the call ran.
- **A release guard against version drift.** `scripts/check-version-sync.mjs` asserts that
  every README release-download URL and the newest CHANGELOG entry match `package.json`.
  Wired two ways: `npm run check:version`, and a test in the suite — so `npm test`, already
  the hard gate before release, now fails on drift.
- `explainApiError` and `classifyFailureStage` in `src/core/errors.ts`, exported for
  direct testing.
- `DolibarrParseError` now renders a message that states plainly it is a **CLI-side**
  failure rather than something Dolibarr returned.

### Changed

- `DolibarrApiError` carries a `debugSource` field, and GET errors now report the full
  path **including the query string** rather than the bare path.

### Verification

Exercised live against Dolibarr 20.0.4 across all three shapes: a permission-gated module
(403 at call stage), an absent route (404 at route stage), and a rejected parameter (400 at
validate stage).

### Tests

764 passing (701 pre-existing + 63 added across 0.5.7–0.5.9), build clean.

## 0.5.8 - 2026-07-29

Bug-fix patch. **`--limit` and `--page` now mean something on `bank transactions`** — they
were being silently discarded by the server.

```bash
dolibarr bank transactions 2 --limit 3           # 3 rows, not all of them
dolibarr bank transactions 2 --limit 3 --page 1  # the next 3
dolibarr bank transactions 2 --all               # everything
```

### Fixed

- **`bank transactions` ignored `--limit` / `--page`.** `--limit 1` and `--limit 3` both
  returned every row. Root cause: Dolibarr's `GET /bankaccounts/{id}/lines` is
  `getLines($id, $sqlfilters)` — it takes **no pagination arguments at all** and always
  returns the whole collection. The CLI sent `limit`/`page` anyway and the server discarded
  them. The flags are now applied **client-side** after fetching, so they do what the help
  says.
- **`categories objects` had the identical defect** — `getObjects($id, $type, $onlyids)`
  also ignores `limit`. Fixed the same way.
- **Latent `--all` duplication bug on `bank transactions`.** Because the server ignores
  `page`, auto-pagination would have re-fetched the same full result set for every page and
  appended it repeatedly, stopping only at the `--max-records` cap. An account with more
  than 100 lines would have produced duplicate rows. The CLI no longer sends pagination
  params to this endpoint, so the page walk cannot start.

### Changed

- Help text on both commands now states plainly that the endpoint has no server-side
  pagination and that the CLI applies the flags — it previously implied normal paging.
- A truncated result is reported on **stderr** (`Showing 1-3 of 8 …`), never silently. This
  follows the existing "never cap silently" rule and keeps piped stdout byte-clean.
- `categories objects` deliberately did **not** gain `--page`. Adding it would have wired
  `--all` onto a command whose endpoint cannot page, trading one misleading flag for two.

### Added

- `src/core/client-paginate.ts` — `paginateClientSide`, `parseIntFlag`,
  `reportClientPagination`, exported for direct testing.

### Endpoint audit (report item 5.2)

Every list command was checked for the same mismatch. Only two were affected, and both are
fixed here. The other 26 command files build their query through `buildListQuery` and hit
top-level Dolibarr `index()` routes, which genuinely honour `limit`/`page` — spot-verified
live against Dolibarr 20.0.4. The exhaustive all-endpoint sweep remains scheduled for 0.8.5.

### Verification

Both fixes were exercised live against Dolibarr 20.0.4: `--limit 1` returns 1 row,
`--limit 3` returns 3, `--page 0` and `--page 1` return disjoint records, `--all` returns
all 8, and stdout remains valid JSON with the notice on stderr. `categories objects` could
not be exercised live — the reference instance has no categories — so it ships verified by
its Dolibarr 20.0.4 source signature and by unit tests. ⚠️ **Flagged.**

### Tests

750 passing (701 pre-existing + 49 added across 0.5.7–0.5.8), build clean.

## 0.5.7 - 2026-07-29

Bug-fix patch against the shipped v0.5.6 build. **`accounting ledger` works again** — it
had been unable to produce any export at all.

```bash
dolibarr accounting formats                                   # what this server accepts
dolibarr accounting ledger --period currentyear --format fec > ledger.txt
```

### Fixed

- **`accounting ledger` 404'd on every format.** Root cause: Dolibarr's
  `GET /accountancy/exportdata` expects a **numeric export-model id**, but the CLI sent the
  format *name* (`CSV`, `FEC`, `FEC2`) verbatim. The server rejected it with
  `404 Not Found: Accountancy export format not found` from inside
  `api_accountancy.class.php`. `--format` now resolves names to ids, so `--format fec`
  sends `1000`. **This was a CLI defect, not a server misconfiguration.**
- **`Unexpected end of JSON input` crash.** A 2xx response with an empty or non-JSON body
  escaped as a raw `JSON.parse` error, which told the user nothing about whether the API or
  the CLI had failed. Fixed at the API-client choke point, so it applies to **every**
  command, not just accounting:
  - empty body → `null` (callers decide what "nothing" means)
  - non-JSON body → the raw text, which is the usable payload for CSV/FEC exports
  - `DELETE` keeps answering `undefined` on an empty body — unchanged
- A 404 from `accountancy/exportdata` now carries a hint naming the real cause instead of
  the generic "Resource not found".

### Added

- **`dolibarr accounting formats`** — lists the 20 export models Dolibarr accepts, with
  their numeric ids and descriptions. Supports `--json`.
- `--format` accepts a canonical name (`fec`, `fec2`, `cegid`, `quadratus`, …), an alias
  (`csv` → configurable, `sage50` → `sage50-swiss`), any case, or a **raw numeric id** —
  the passthrough keeps the CLI usable against export models added by future Dolibarr
  versions.
- `--format` is now required on `accounting ledger`, with an error listing the accepted
  values. Previously, omitting it crashed.
- An empty export now reports *why* it is empty (no bound bookkeeping entries, or an
  unconfigured export model) instead of printing nothing. The notice goes to **stderr**, so
  redirecting stdout to a file still yields a byte-exact export.
- `src/core/accounting-formats.ts` — `resolveExportFormat`, `exportFormatNames`,
  `findExportFormatById`, and the format table, exported for direct testing.
- `printNotice` in `src/core/output.ts` for pipeline-safe out-of-band messages.

### Verification

The export-model id table was confirmed twice over: against the Dolibarr 20.0.4 source
(`AccountancyExport::$EXPORT_TYPE_*`) and by probing a live 20.0.4 server, which accepts
exactly these 20 ids and rejects every other value. `--format fec` was exercised
end-to-end against that instance and returned FEC content.

⚠️ **Flagged:** the reference instance has no bound bookkeeping entries, so live exports
returned the FEC header with no data rows. The request/response path is verified; the row
content is not, because no instance was available with bindings configured.

### Tests

727 passing (701 pre-existing + 26 new), build clean.

## 0.5.6 - 2026-07-25

Final release of the **0.5.x line — bulk, batch & scripting power**. **Scalar extraction**:
`--field ref` prints one raw value per row.

```bash
dolibarr invoices list --all --field id | xargs -n1 dolibarr invoices validate --confirm
```

### Added

- **`--field <key>`** on every command that renders output (**76 commands**), wired through
  `renderList` / `renderGet`. Prints one bare value per row — no header, no quoting, no
  delimiters — and walks nested paths (`--field a.b`). A missing key renders an empty line
  rather than failing the row.
- `renderField` and `resolveFieldOpt` in `src/core/formats.ts`.

### ⚠️ Decision: `--field` vs `--fields`

The roadmap flagged this as an open UX question, since the two are one letter apart and mean
different things (scalar extraction vs. column projection). **Resolution: ship both as
specced, and make every confusable combination fail loudly** rather than silently doing the
wrong thing:

- `--field id,ref` → rejected, suggesting `--fields id,ref`
- `--field` + `--fields` → rejected
- `--field` + `--template` → rejected

All exit `3`. Folding scalar extraction into `--fields` was rejected because it would change
what `--fields ref` already does, which this line forbids; renaming the new flag was rejected
because `--field` is named in the roadmap's own exit criteria. **This is the one call in the
line the maintainer may want to revisit** — the alternative is renaming `--field` to
something like `--pluck`, which is a one-line change here plus docs.

### Behaviour notes

- `--field` takes precedence over `--output` and `--fields` is untouched — `--fields id,ref`
  still projects columns exactly as before.
- Correcting the roadmap's exit-criterion one-liner: piping ids into `xargs` needs `-n1`
  (one call per id), or the ids joined with `paste -sd,` for a single batch call, because
  these subcommands take one id or one comma-separated list. Both forms are documented.

### Tests

701 tests (up from 685). **All 420 pre-existing tests still pass unchanged.** Added
`resolveFieldOpt` guard tests for every rejected combination, `renderField` tests (nested
paths, missing keys, object values, empty input), renderer tests proving `--field` wins over
`--output` while `--fields` keeps its meaning, and a reach test that `--field` lands on every
output-rendering command with a description distinct from `--fields`.

### Verified live

Exercised against Dolibarr 20.0.4: `--field id` and `--field ref` on a list, `--field` on a
`get`, all three rejection paths exiting 3 with their hints, `--fields` still projecting
columns unchanged, a missing key yielding blank lines rather than an error, and the full
pipeline of extracting ids and feeding them back into a batch mutation.

## 0.5.5 - 2026-07-25

Sixth release of the **0.5.x line**. **Pipeline output formats**: `ndjson`, `yaml`,
`--template`, `--no-header` and `--quiet`.

```bash
dolibarr thirdparties list --all --output ndjson > thirdparties.ndjson
dolibarr invoices list --template '{{.id}} {{.ref}}'
dolibarr invoices list --output csv --no-header
```

### Added

- **`src/core/formats.ts`** — hand-rolled ndjson, YAML and template rendering. Exports
  `renderNdjson`, `toYaml`, `renderYaml`, `renderTemplate`, `renderTemplateLine`,
  `lookupPath`, `validateTemplate`, `headersSuppressed` and `enableOutputFormats`.
  No new runtime dependency; `commander` is still the only one.
- **`--output ndjson`** and **`--output yaml`**, wired through `renderList` / `renderGet`, so
  all 33 groups inherit them from one edit. `OutputFormat` in `src/core/types.ts` was
  extended alongside `resolveOutput`, so the new values resolve rather than silently
  printing a table.
- **`--template <tpl>`** — Go-style `{{.field}}` substitution, one line per row, with
  `{{.a.b}}` walking nested fields. Available on every command that renders output
  (**76 commands**).
- **`--no-header`** on the same set, and **`--quiet`** on **every leaf command** — `--quiet`
  also silences the batch reporter, and those commands render through `--json` rather than
  `--output`.
- **`printLines`** in `src/core/output.ts` for formats that control their own line structure.

### YAML quotes every string, deliberately

Unquoted, `1.0` reads back as a number, `007` as `7`, `yes`/`no`/`on` as booleans, `null` and
`~` as null, and `2024-01-01` as a date. Any of those would silently change the data in the
middle of a pipeline — the exact failure mode this line exists to prevent. Strings are
therefore quoted unconditionally: less pretty, and correct for every value Dolibarr returns.
This was the "cut YAML if hand-rolling looks riskier than it's worth" decision from the
roadmap; always-quoting removes the risk, so YAML ships.

### Behaviour notes

- **`--template` wins over `--output`** — it is the output format. A missing field renders
  empty rather than failing the row, so one odd record never kills a stream. A template with
  no placeholder, or one missing the leading dot, is rejected with exit `3`.
- `--fields` composes with every new format.
- **An unknown `--output` value still falls back to `table`**, exactly as since v0.2.0. The
  pre-existing contract test for that behaviour is untouched — only `ndjson` and `yaml` were
  added to the known set.
- `--quiet` suppresses headers and the batch reporter's selection list, per-item lines and
  summary. It deliberately does **not** suppress a command's own result, so a create still
  prints its new id.
- Empty results print nothing at all in `ndjson` rather than an empty line.

### Tests

685 tests (up from 631). **All 420 pre-existing tests still pass unchanged.** Added the
formats suite (ndjson round-tripping, YAML escaping and the always-quote property asserted
against nine type-coercion-prone values, nested `lines` arrays, empty containers, non-identifier
keys, template nesting/missing fields/validation, header suppression) plus renderer tests
proving `renderList`/`renderGet` honour each format, and reach tests that `--quiet` reaches
every leaf command, the rendering flags reach every output-rendering command and nothing
else, and that no duplicate flag exists anywhere after all five 0.5.x wiring layers.

### Verified live

Exercised against Dolibarr 20.0.4: ndjson output re-parsing to exactly the same data as
`--output json`, YAML for both list and detail views, templates on list and `get`, headerless
CSV and table, template validation rejected with exit 3, `--quiet` silencing batch chatter
while leaving the data, and an unknown `--output` still rendering a table.

## 0.5.4 - 2026-07-25

Fifth release of the **0.5.x line**. **Bulk create**: `--from-json` accepts an array, and
`--stdin` reads NDJSON from a pipe.

```bash
dolibarr thirdparties create --from-json batch.json --confirm
cat rows.ndjson | dolibarr thirdparties create --stdin --confirm
```

### Added

- **`src/core/bulk-input.ts`** — record parsing, stdin reading and wiring. Exports
  `parseRecords`, `recordsFromFile`, `readStdin`, `recordLabel`, `acceptsBulkInput` and
  `enableBulkInput`.
- **Array `--from-json`** and **`--stdin`** on every command that takes `--from-json` —
  **34 commands across 27 groups** — wired from one call in `src/cli.ts`.
- **`--confirm`** added to the bulk-capable commands that lacked it, since a multi-record
  run is a bulk mutation.
- **Per-item `output` in the batch envelope** (`src/core/batch.ts`): each result now carries
  what that item printed, parsed as JSON when it is JSON. A bulk create therefore hands back
  the new ids — the reason to run one. This enriches v0.5.0/v0.5.1 batches too.

### How it reaches every group without editing them

All 35 `--from-json` commands read their body the same way
(`JSON.parse(fs.readFileSync(opts.fromJson))`). Bulk input writes each record to its own
scratch file and re-points `--from-json` at it, so every command builds its body through its
existing, already-tested code path — no command file was touched.

### Behaviour notes

- **A single JSON object is untouched.** Bulk mode engages only when the payload is an array
  (or `--stdin` yields more than one record). A one-record payload runs the plain
  single-record path with no confirmation and no batch report.
- `--stdin` accepts NDJSON, a JSON array, or a single object — including pretty-printed
  JSON spanning several lines.
- Malformed input is rejected **before any record is sent**, naming the offending array entry
  or NDJSON line number (exit `3`).
- Multi-record runs follow the line's standard contract: full dry-run listing of every
  record's body, required `--confirm`, per-item outcome, exit `5` on partial success.
- **`supplier-orders receive` is excluded.** Its `--from-json` array already means *the lines
  of one receipt*; splitting it would silently change the command's meaning. Covered by a
  test, and it keeps its old behaviour exactly.

### Tests

631 tests (up from 598). **All 420 pre-existing tests still pass unchanged.** Added the
record-parsing suite (array, NDJSON, CRLF, blank lines, pretty-printed single object, empty
array, bare scalars, non-object entries, per-line error positions) and reach tests that
`--stdin` lands on every `--from-json` command except the exclusion, never on anything else,
and never duplicated.

### Verified live

Exercised against Dolibarr 20.0.4 with `CLIBULK-` fixtures: a two-record array create
returning both new ids in the envelope, a deliberate partial run (one valid record, one
missing a required field) returning **exit 5** with the API's reason per item, and the
non-interactive refusal without `--confirm`. Fixtures were then batch-deleted and the
resource verified back to its pre-test contents. Also confirmed `supplier-orders receive`
still sends its array as `body.lines` rather than splitting it.

## 0.5.3 - 2026-07-25

Fourth release of the **0.5.x line**. **`--all` auto-pagination** on every paginated `list`.

```bash
dolibarr thirdparties list --all --output csv > thirdparties.csv
dolibarr invoices list --all --from 2026-01-01 --to 2026-12-31 --fields id,ref,total_ttc
```

### Added

- **`src/core/paginate.ts`** — the `--all` state, cap parsing, progress reporting and
  wiring. Exports `enableAutoPaginate`, `isPaginatedList`, `isPaginatedQuery`,
  `parseMaxRecords`, `AUTO_PAGE_SIZE` and `DEFAULT_MAX_RECORDS`.
- **`--all`** on every paginated list command — **37 commands across 28 groups** — wired from
  one call in `src/cli.ts`.
- **`--max-records <n>`** safety cap, default **5000**.
- **`src/core/command-tree.ts`** — `walkLeaves` extracted into a dependency-free module so
  the pagination hook cannot create an import cycle back through `batch.ts`. `batch.ts`
  re-exports it, so nothing else changed.

### How it reaches all 33 groups

The page loop lives in `DolibarrApiClient.get`, the one place every list command already
funnels through, and triggers only when `--all` is active **and** the query carries the
`limit` + `page` pair that `buildListQuery` emits. Detail fetches, sub-resource listings and
every non-list call are therefore untouched by construction.

### Behaviour notes

- **`--limit` and `--page` are unchanged** when `--all` is absent — one request, exactly as
  before. `--all` deliberately bypasses `--limit` and walks in pages of 100.
- **The cap is never silent.** Hitting it prints an explicit message naming the cap and how
  to continue, including when the cap lands exactly on a page boundary.
- **Progress and warnings go to stderr**, never stdout, so `list --all --output csv > f`
  stays a clean data stream. Progress is only drawn when stderr is a TTY.
- A short page ends the walk; a `404` on a later page is treated as the end of the list,
  while a `404` on the first page or any permission error propagates rather than silently
  returning a partial list.
- Auto-pagination state is reset after every run, including when the action throws, so it
  can never leak into a later command.
- Commands with `--limit` but no `--page` (`categories objects`) are **excluded** — they
  never emit a `page` param, so `--all` there would be a flag that silently did nothing.

### Tests

598 tests (up from 566). **All 420 pre-existing tests still pass unchanged.** Added the
pagination suite (multi-page concatenation asserting the exact per-request `limit`/`page`,
order and no duplicates/gaps, exact-multiple-of-page-size termination, empty first page, cap
truncation including on a page boundary, no false cap warning when data simply runs out,
404-as-end vs 404-as-error, permission errors propagating, and state reset on throw) plus
reach tests that `--all` lands on every paginated list, on nothing else, and never collides
with v0.5.1's `--all-<status>` selectors.

### Verified live

The real page loop was driven against a real 245-row endpoint on Dolibarr 20.0.4: **245 rows
returned across 3 requests**, identical to a single large request in both contents and order,
with no duplicates; `--max-records` truncating correctly at 120 and at an exact page boundary
of 100, announcing in both cases. Also verified through the installed CLI that `--all`
returns the full set, `--limit` is unaffected without `--all`, and the cap warning goes to
stderr while stdout stays clean CSV.

## 0.5.2 - 2026-07-25

Third release of the **0.5.x line**. **Server-side list filters**: narrow by date and amount
at the source instead of pulling everything and filtering locally.

```bash
dolibarr invoices list --from 2026-01-01 --to 2026-12-31
dolibarr invoices list --min-amount 1000 --max-amount 5000
dolibarr invoices validate --all-draft --from 2026-03-01 --to 2026-03-31 --dry-run
```

### Added

- **`src/core/list-filters.ts`** — compiles `--from` / `--to` / `--min-amount` /
  `--max-amount` into Dolibarr `sqlfilters`. Exports `buildListFilters`, `combineFilters`,
  `parseFilterDate`, `parseFilterAmount`, `nextDay`, `filterSpecForPath`,
  `availableDimensions` and `RESOURCE_FILTERS`.
- **`--from` / `--to`** on every filterable command of a resource with a known date column,
  and **`--min-amount` / `--max-amount`** where there is an amount column — wired from one
  call in `src/cli.ts`, reaching **both** `list` commands and the v0.5.1 status-scoped
  mutations, which is what makes `validate --all-draft --from … --to …` work.
- The compiled predicate is **ANDed into** the command's own `--filter`, so the two compose.

### Per-resource columns, probed not guessed

Both the date column and the amount column vary. Each candidate was probed with a real
`sqlfilters` query against Dolibarr 20.0.4 and kept only if it did not 503 — **12 resources
verified**: `datef` (invoices, supplier-invoices), `date_commande` (orders, supplier-orders),
`datep` (proposals), `dateo` (projects, tasks), `date_contrat` (contracts), `date_debut`
(expensereports), `datec` (thirdparties, contacts, users); amounts on `total_ttc`, plus
`opp_amount` for projects.

Resources with no date or amount column simply do not get the flag — `contacts list` has
`--from`/`--to` but no `--min-amount`.

### `--to` is inclusive of the whole day

`--to 2026-03-31` compiles to `< 2026-04-01`, not `<= 2026-03-31`. On a DATETIME column the
latter would mean midnight and silently drop that day's records. It also keeps a `:` out of
the sqlfilters value, which is delimiter-sensitive.

### Behaviour notes

- **No flag is shadowed.** `bank transfer` already owns `--from`/`--to` (source/destination
  account). Where a command already uses one of these names, that filter dimension is
  dropped for it rather than redefined — and its value is never read as a date. Covered by a
  test.
- Dates must be exact `YYYY-MM-DD` calendar dates; `2024-02-30` is rejected. Inverted ranges
  (`--to` before `--from`, `--max-amount` below `--min-amount`) are rejected **before any
  request is sent**, exit `3`.
- **Fixed a pre-existing silent override:** `stock movements`, `products stock-movements` and
  `tasks list` discarded `--filter` entirely when `--product` / `--warehouse` / `--project`
  was also given. They now compose via `combineFilters`. This makes `--filter` work where it
  previously did nothing; no test depended on the old behaviour.

### Tests

566 tests (up from 516). **All 420 pre-existing tests still pass unchanged.** Added the
filter-compiler suite (calendar validation including leap years, next-day rollover across
month/year boundaries, range inversion, missing-column refusal) and reach tests asserting the
flags land exactly where the column exists, never on sub-resource listings, never duplicated,
and never shadowing `bank transfer`.

### Verified live

Exercised read-only against Dolibarr 20.0.4: an in-range query returning rows, a single-day
`--from`/`--to` proving whole-day inclusivity, an out-of-range query returning none,
composition with an explicit `--filter`, rejection of a malformed and an inverted range, and
the roadmap's exit-criterion one-liner
`invoices validate --all-draft --from … --to … --dry-run` resolving its selection correctly.

> ⚠️ Columns for the 8 permission-gated resources (`tickets`, `interventions`, `members`,
> `products`, `shipments`, `receptions`, `agenda`, `supplier-proposals`) follow Dolibarr's
> table conventions and are **not** live-verified. A wrong column fails loudly with a 503.

## 0.5.1 - 2026-07-25

Second release of the **0.5.x line**. **Status-scoped bulk**: select records by status, then
act on them — no ids required.

```bash
dolibarr invoices validate --all-draft --dry-run
dolibarr invoices validate --all-draft --confirm
dolibarr orders close --all-validated --filter "(t.datec:>=:'20260101')" --max 20 --confirm
```

### Added

- **`src/core/statuses.ts`** — the per-resource status vocabulary: list path, SQL status
  column, and status-name → code map for **18 resources**. Exports `RESOURCE_STATUSES`,
  `specForPath`, `buildStatusFilter`, `readStatus` and `statusFlag`.
- **`--all-<status>` selectors** on every status-transition subcommand of a resource with a
  known status vocabulary — **36 subcommands across 16 groups**, generated from the status
  map rather than hand-written, so each resource gets exactly the statuses it really has.
- **`--filter <expr>`** on those commands, ANDed with the status predicate, so a bulk run can
  always be scoped to a subset.
- **`--max <n>`** cap on selected records, default **100**. Exceeding it is reported
  explicitly — the run states that it acted on the first N only and how to continue.
- **`resolveStatusSelection`** and **`runStatusScoped`** in `src/core/batch.ts`, plus
  `STATUS_SCOPED_VERBS`, `DEFAULT_SELECTION_CAP` and `camelize`.

### Why selection filters on the status column, not `list --status`

Verified on Dolibarr 20.0.4: the list endpoints' `status` query param expects **string
tokens** (`draft`, `unpaid`, `paid`) and **silently ignores a numeric value** —
`invoices list --status 0`, `--status 1` and `--status 2` all return the same rows. A bulk
mutation driven by a silently-ignored filter is the worst failure mode this line could ship,
so selection instead uses `sqlfilters` on the resource's own status column, where a wrong
column fails loudly with a 503.

The column is **not** uniform and was probed per resource: `fk_statut` for the
invoice/order/proposal family, `statut` for contracts and members, `status` for the newer
MRP and knowledge tables.

### Behaviour notes

- **The resolved selection is always printed before acting**, and `--dry-run` shows every
  target id plus the request each would send.
- **Caps are never silent.** Selection asks for `cap + 1` rows, so "more matched than the cap
  allowed" is detected and announced rather than inferred.
- **Zero matches exits `0`** and does nothing.
- An id and a selector are mutually exclusive (exit `3`), as are two selectors.
- `<id>` became optional **only** on status-scoped subcommands. Omitting it with no selector
  still produces commander's own missing-argument error and **exit code 1**, exactly as
  before — this is asserted by a test.
- Non-status verbs that happen to take an id (`add-line`, `add`, `create`, `set-rate`) get
  **no** selector: "add a line to every draft" is not a status transition, and keeping them
  id-only keeps one flag's blast radius comprehensible.
- **A failed selection degrades gracefully.** Resolving `--all-<status>` is an API call made
  outside any command's own error handling, so a `403` from a permission-gated module is
  routed through the standard hinted-error path (exit `2`) rather than surfacing as an
  unhandled rejection. Caught during release verification against a gated module and covered
  by a regression test.

### Tests

516 tests (up from 459). **All 420 pre-existing tests still pass unchanged.** Added the
status vocabulary suite (including a **drift test** that parses each command file's own
`STATUS_MAP` and fails if core's codes diverge — currently agreeing across 17 resources),
selection-engine tests (truncation detection, 404-as-empty, filter composition, `--max`
validation), and reach tests asserting every status-scoped command carries one flag per
status, that `<id>` is optional exactly where a selector can replace it, and that no
duplicate flag was registered anywhere.

### Verified live

Exercised against Dolibarr 20.0.4 on self-created invoice fixtures, every call scoped by
`--filter` so it could only ever match those fixtures: dry-run target listing, cap
truncation, zero-match, and a **real partial run returning exit 5** (one fixture validated,
one rejected by Dolibarr for having no lines). Fixtures were then set back to draft and
deleted, and the resource confirmed byte-identical to its pre-test contents.

> ⚠️ **Status columns verified live for 9 resources** (invoices, supplier-invoices, orders,
> proposals, projects, contracts, supplier-orders, expensereports, tasks). The columns for
> `tickets`, `shipments`, `receptions`, `interventions`, `supplier-proposals`, `members`,
> `knowledge` and `mrp` are **docs-sourced** — those modules are permission-gated on the
> reference instance, so their selectors could not be exercised. A wrong column fails loudly
> with a 503 rather than selecting the wrong records.

## 0.5.0 - 2026-07-25

First release of the **0.5.x line — bulk, batch & scripting power**. Unlike 0.3.x and 0.4.x,
this line adds no command group: it adds cross-cutting capability implemented once in
`src/core/` and inherited by all **33 existing groups**.

**Batch by ids.** Every mutating subcommand whose sole required positional is a record id now
accepts a comma-separated list — **90 subcommands across 26 groups**, wired from a single
call in `src/cli.ts`.

```bash
dolibarr invoices validate 12,13,14 --confirm
dolibarr thirdparties update 20,21 --town "Berlin" --confirm
dolibarr orders delete 5,6,7 --confirm --output json
```

### Added

- **`src/core/batch.ts`** — id-list parsing, per-item execution, and result aggregation.
  Exports `parseIdList`, `batchExitCode`, `unpackItemError`, `isBatchable`, `walkLeaves` and
  `enableBatchIds` as pure, directly-testable functions.
- **Comma-separated id lists** on every batchable mutating subcommand (`delete`, `update`,
  `validate`, `close`, `pay`, `add-line`, `add`, `create`, `set-status`, `set-draft`,
  `set-rate`, `unpay`, `reopen`, `approve`, `make-order`, `receive`).
- **`--confirm`** added to the batchable subcommands that lacked it. A batch refuses to run
  non-interactively without it, and states how many records will be affected when prompting.
- **Exit code `5` = partial batch failure** — some items applied, some failed. Documented in
  the new README exit-code table. A batch where *every* item failed keeps the shared
  underlying code (2/3/4/1) instead.
- **Machine-readable batch envelope** under `--output json` / `--json`: `total`, `succeeded`,
  `failed`, `exitCode` and a per-item `results` array carrying `error` plus a structured
  `detail` object. A half-applied batch is now detectable by an agent — the motivating gap
  for this whole line.
- **`--dry-run` on a batch prints every resolved target id** and the request each would send,
  never a count or a sample.
- README: new **Batch operations** and **Exit Codes** sections.

### Behaviour notes

- **A single id is untouched.** The batch path is entered only when the positional contains a
  comma; `invoices validate 12` takes the original code path and produces byte-identical
  output and exit codes. A one-element list (`12,`) also collapses to the single-id path.
- **Failures never abort the run.** Items execute sequentially — no concurrent writes against
  a live ERP — and each is reported ok/failed with a reason.
- **Malformed lists are rejected before anything is touched** (non-numeric, negative or
  decimal ids), exiting `3`.
- **Read commands are not batched.** `get`, `list`, `lines`, `payments` and friends keep their
  exact output shape. `src/core/batch.ts` carries explicit `BATCH_VERBS` /
  `READ_ONLY_ID_VERBS` tables, and a test fails if any id-taking subcommand is unclassified.
- Multi-positional mutations (`thirdparties merge <id> <id-to-delete>`,
  `categories link <id> <type> <object-id>`) are deliberately **not** batched — the semantics
  of a list in the first slot are ambiguous there.

### Tests

459 tests (up from 420). **All 420 pre-existing tests pass unchanged** — they are the
compatibility contract for this line. Added unit tests for the batch engine (empty list,
duplicates, non-numeric, one-item-equals-single-id, partial failure → exit 5, dry-run target
listing, an item calling `process.exit` itself) plus **reach tests** that rebuild the whole
command tree from `src/cli.ts` and assert the capability landed on every group rather than
spot-checking one.

### Verified live

Exercised end-to-end against Dolibarr 20.0.4 using throwaway `CLIBULK-` thirdparty fixtures:
batch `update` across 3 records (persisted and confirmed), a deliberate partial failure
returning **exit 5** with per-item detail, and batch `delete` for cleanup. All fixtures were
removed and the resource verified back to its prior contents.

## 0.4.7 - 2026-07-25

New resource groups — line 0.4.x, part 8 (final): **`mrp`** (BOMs + manufacturing orders +
workstations).

> ⚠️ **Module-gated / docs-sourced.** `/boms`, `/mos` and `/workstations` all return `403` on
> the reference instance (the routes exist — `api_boms.class.php`, `api_mos.class.php`,
> `api_workstations.class.php` — but the API user lacks MRP permissions). Every path and
> method below was confirmed by probing the live router; the writes were **not exercised**.

### Added

- **`mrp boms`** — bills of materials (`/boms`): `list`, `get <id>`,
  `create --label --product [--ref --qty --type --warehouse --duration --efficiency
  --description --note-public --note-private]`, `update <id>`, `delete <id> --confirm`,
  `lines <id>`, and `add-line <id> --product --qty [--qty-frozen --disable-stock-change
  --efficiency --position --child-bom --unit]`.
- **`mrp mos`** — manufacturing orders (`/mos`): `list`, `get <id>`,
  `create --product --qty [--bom --warehouse --type --date-start --date-end --project
  --socid …]`, `update <id>`, `delete <id> --confirm`. Creating or editing an MO does not
  move stock.
- **`mrp workstations`** — `list` and `get <id>`, **read-only by design** (see below).

### Deliberately NOT wrapped: MO production

`POST /mos/{id}/produceandconsumeall` produces the finished product **and consumes every
component's stock in one irreversible call** — the API exposes no inverse operation. The
route exists on Dolibarr 20.0.4 but is permission-gated here (`403 "Not enough
permission"`), so its request shape could not be verified.

Rather than guess at a command that consumes real inventory, it is left to the escape hatch,
which both `mrp --help` and `mrp mos --help` name explicitly:

```
dolibarr raw POST mos/{id}/produceandconsumeall --data '{...}'
```

It will be wrapped once it can be exercised against a module-enabled instance. This was an
explicit, recorded decision rather than an oversight — a test asserts the `produce`
subcommand is *not* registered and that the help text carries the escape hatch.

### Route findings (Dolibarr 20.0.4)

- **Workstations are read-only.** `POST /workstations` answers `405 Method Not Allowed` and
  `PUT`/`DELETE /workstations/{id}` answer `404`, so no write subcommands exist.
- **`/mos` has no `validate`, `produce`, `consume`, `cancel` or `lines` sub-resource** — all
  route-stage 404s. `produceandconsumeall` is the only action route on the resource.
- **BOM lines can be listed and added, but not edited or removed** — no `PUT`/`DELETE` on
  `/boms/{id}/lines/{lineid}`.

### Tests

- Added MRP command-tree, body-builder and column tests, including assertions that the
  production subcommand is absent and that workstations expose no writes.
  Test total: 402 → 420.

### 0.4.x line complete

This is the last release of the 0.4.x "new resource groups" line — eight versions
(0.4.0 → 0.4.7) delivering **ten** new command groups: `interventions`, `expensereports`,
`members`, `stock`, `supplier-proposals`, `tasks`, `agenda`, `multicurrencies`, `knowledge`
and `mrp`. That brings the CLI from 23 to **33 command groups**, covering every practical
Dolibarr REST module on a standard instance. Test suite grew 260 → 420.

Next up: 0.5.x — bulk, batch and scripting power (batch-by-ids, `--all-draft`, server-side
list filters, auto-paginate, bulk create, pipeline output formats).

## 0.4.6 - 2026-07-25

New resource groups — line 0.4.x, part 7: **`multicurrencies`** + **`knowledge`**.

> ⚠️ **Module-gated / docs-sourced.** Both surfaces are permission-gated on the reference
> instance (`403 "Insufficient rights to read currency"`;
> `403` on `api_knowledgemanagement.class.php`). Every path and method below was confirmed by
> probing the live router, and the mandatory create fields for a currency came from the
> API's own validator — but the writes were **not exercised**.

### Added

- **`multicurrencies`** command group (`/multicurrencies`) — FX definitions and rates:
  - `list`, `get <id>`, `rates <id>` (the currency's recorded rate history).
  - `create --code --name [--rate]` — both `code` and `name` are mandatory per the API's
    validator; `--from-json` also accepted. Echoes the created object.
  - `update <id>` — `--code` / `--name`; only what you pass is sent.
  - `set-rate <id> --rate <n>` — **⚠️ the rate drives every multi-currency conversion**, so
    it is guarded: `--dry-run` previews the body and a confirmation (or `--confirm`) is
    required.
  - `delete <id>` — confirmation prompt or `--confirm`.
- **`knowledge`** command group (`/knowledgemanagement/knowledgerecords`) — KB articles with
  full CRUD (`list`, `get`, `create --question …`, `update`, `delete --confirm`) plus
  `--answer --ref --lang --url --category --status --note-public --note-private`.

### Path and route findings (Dolibarr 20.0.4)

- **Knowledge records live at the nested `knowledgemanagement/knowledgerecords`.** A bare
  `knowledgemanagement` returns a route-stage 404 and `knowledgerecords` returns a `501` —
  the module prefix cannot be dropped. This was the one path in the 0.4.x line that needed
  more than a spelling change to find.
- **The FX rate is updated with `PUT /multicurrencies/{id}/rates`.** `POST /{id}/rates` and
  `DELETE /multicurrencies/rates/{id}` are both route-stage 404s, so there is no rate-create
  or rate-delete subcommand.
- **No `/multicurrencies/code/{code}`** lookup route (route-stage 404), so no `by-code`
  subcommand — `get` takes a numeric ID. Same for knowledge: no `/ref/{ref}`.
- **`code` and `name` are both mandatory** on a currency create.
- No currency was created during verification on purpose: `POST` reaches the validator but
  `DELETE` returns `403`, so a probe record would have been unremovable.

### Tests

- Added multicurrency + knowledge command-tree, body-builder and column tests.
  Test total: 385 → 402.

## 0.4.5 - 2026-07-25

New resource groups — line 0.4.x, part 6: **`tasks`** + **`agenda`**.

> ✅ **`tasks` is live-verified** — the Project module is enabled and the API user has task
> rights, so every route, field name and the time-spent date format below were exercised
> against a real Dolibarr 20.0.4 (throwaway project + task + time entry, all deleted).
> ⚠️ **`agenda` is module-gated** — `/agendaevents` returns `403 "Insufficient rights to read
> an event"`. Its routes are confirmed; the bodies are docs-sourced and not exercised.

### Added

- **`tasks`** command group (`/tasks`) — tasks as a top-level resource:
  - `list` — `--project` filter, `--with-timespent`, plus the shared list flags. Workload
    and time spent render as `3h` / `1h 30m`.
  - `get <id>` — detail view, `--with-timespent` supported.
  - `create --ref --label --project` (all three mandatory) plus `--description --parent
    --date-start --date-end --workload-hours|--workload --progress --priority
    --note-public --note-private`, or `--from-json`. Echoes the created object.
  - `update <id>` — same field flags; only what you pass is sent. Echoes the result.
  - `delete <id>` — confirmation prompt or `--confirm`.
  - `roles <id>` — user roles assigned on a task (`--user` to narrow).
  - `timespent add <id> --date [--hours|--duration --user --note]`,
    `timespent update <id> <line-id> …`, `timespent delete <id> <line-id> --confirm`.
- **`agenda`** command group (`/agendaevents`) — calendar events with full CRUD
  (`list --user --thirdparty`, `get`, `create --label --start …`, `update`, `delete`).

### Field/route quirks found live (tasks)

- **Time spent takes a `YYYY-MM-DD HH:MM:SS` *string*, not an epoch.** Passing an epoch is
  rejected outright ("Expecting date and time in `YYYY-MM-DD HH:MM:SS` format") — the only
  date field in the API that behaves this way. A new `toDateTimeString()` helper in
  `src/core/dates.ts` converts whatever you pass, so `--date 2026-03-01` just works.
- **`ref`, `label` and `fk_project` are all mandatory** on a task create — a task cannot
  exist outside a project.
- **`fk_statut` is silently ignored on `PUT /tasks/{id}`** (verified: the stored status did
  not change), so no status flag is exposed. Everything else persisted: `label`, `ref`,
  `description`, `date_start`, `date_end`, `planned_workload`, `progress`, `priority`,
  `fk_task_parent`, `note_public`, `note_private`.
- **Time spent is added at `/tasks/{id}/addtimespent`.** `GET` and `POST` on
  `/tasks/{id}/timespent` are route-stage 404s — only `PUT`/`DELETE` on
  `/timespent/{lineid}` exist — so there is no `timespent list`; read totals via
  `get --with-timespent`.
- **A task with time-spent lines cannot be deleted** (`ErrorRecordHasChildren`). The
  `delete --help` says so and points at `timespent delete`.
- **No `/tasks/ref/{ref}`** route, so `get` takes a numeric ID.

### Relationship to `projects`

`projects tasks <project-id>` (shipped earlier) stays the project-scoped listing. The new
group is the task resource itself — get/create/update/delete/roles/timespent — and the two
cross-link in their help text.

### Tests

- Added tasks + agenda command-tree, body-builder and column tests, plus `toDateTimeString`
  unit tests. Test total: 352 → 385.

## 0.4.4 - 2026-07-25

New resource groups — line 0.4.x, part 5: **`supplier-proposals`**.

> ⚠️ **Module-gated / docs-sourced.** `/supplierproposals` returns `403` on the reference
> instance (the route exists — `api_supplier_proposals.class.php` — but the API user lacks
> supplier-proposal permissions). Every path and method below was confirmed by probing the
> live router; the writes were **not exercised**.

### Added

- **`supplier-proposals`** command group (`/supplierproposals`) — supplier price requests:
  - `list` — `--thirdparty <ids>` filter plus the shared list flags; statuses as labels.
  - `get <id>` — two-column detail view.
  - `create --socid …` — plus `--date --delivery-date --ref-supplier --project
    --cond-reglement --mode-reglement --note-public --note-private`, or `--from-json`.
    Echoes the created object.
  - `update <id>` — same field flags; only what you pass is sent. Echoes the result.
  - `delete <id>` — confirmation prompt or `--confirm`.
  - `lines <id>` — read-only line view, from the `lines` array embedded in the object.

### Path quirk

The API path is **`supplierproposals`** — one word. `supplier_proposals` (as the older
reference notes had it) returns a `501`, exactly the same quirk as `supplierorders`. The
reference doc has been corrected.

### Not added (verified absent on Dolibarr 20.0.4 — all route-stage 404s)

- **ref-lookup** — no `/supplierproposals/ref/{ref}`, so `get` takes a numeric ID. Ref
  lookup is only enabled where the route is confirmed, and here it is not.
- **line add / edit / delete** — no `/{id}/lines` routes in any method, so `lines` is a
  read-only view rather than a CRUD subgroup.
- **`validate` / `close` / `contacts`** — no dedicated routes; Dolibarr's REST surface for
  this resource is plain CRUD. The help text points at the web UI or `raw PUT` for a status
  change rather than guessing a field the API may ignore.

### Tests

- Added supplier-proposal command-tree, body-builder and column tests, including one that
  asserts the absent-route subcommands are *not* registered. Test total: 339 → 352.

## 0.4.3 - 2026-07-25

New resource groups — line 0.4.x, part 4: **`stock`** (warehouses + movements).

> ⚠️ **Module-gated / docs-sourced.** `/warehouses` and `/stockmovements` return `403` on
> the reference instance (routes exist — `api_warehouses.class.php`,
> `api_stockmovements.class.php` — but the API user lacks stock permissions). Every path,
> method and mandatory field below was confirmed by probing the live router and validator;
> the writes were **not exercised**.

### Added

- **`stock warehouses`** — full CRUD over `/warehouses`:
  - `list` — `--category` filter plus the shared list flags; open/closed status as a label.
  - `get <id>` — detail view including `stock_reel` / `stock_theorique`.
  - `create --label …` — plus `--location --description --address --zip --town --country
    --phone --parent --status`, or `--from-json`. Echoes the created object.
  - `update <id>` — same field flags; only what you pass is sent. Echoes the result.
  - `delete <id>` — confirmation prompt or `--confirm`.
- **`stock movements`** — the stock movement ledger:
  - `list` — `--product` / `--warehouse` filters (mapped to `sqlfilters`).
  - `create --product --warehouse --qty [--type --lot --label --code --price --date
    --origin-type --origin-id]` — **⚠️ mutates real inventory.** Guarded exactly like
    v0.3.8's `products correct-stock`: `--dry-run` previews the body and a confirmation
    (or `--confirm`) is required, so a non-interactive shell without `--confirm` refuses to
    proceed. `--from-json` is available for a raw body.

### Shared with the `products` group — not duplicated

v0.3.8 already shipped `products stock-movements` and `products correct-stock`, which hit
the same endpoints product-first. Rather than reimplement them, the movement body builder,
the `sqlfilters` builder and the movement column spec moved into a new **`src/core/stock.ts`**
that both command groups import. `products.ts` re-exports `buildStockMovementBody` from
there, and a test asserts the two surfaces really share one function. Both groups' help text
cross-links to the other:

| warehouse-first (0.4.3) | product-first (0.3.8) |
|---|---|
| `stock movements list` | `products stock-movements` |
| `stock movements create` | `products correct-stock <product-id>` |

### Route findings (Dolibarr 20.0.4)

- **The movement ledger is append-only.** `GET`, `PUT` and `DELETE` on
  `/stockmovements/{id}` all return a route-stage 404 — only list and create exist — so
  there is deliberately no `movements get/update/delete`.
- **`product_id`, `warehouse_id` and `qty` are all mandatory** on a movement create,
  confirmed by the API's own validation messages.
- **No `/warehouses/ref/{ref}`** route, so `get` takes a numeric ID.

### Tests

- Added stock command-tree, warehouse body-builder and shared-helper tests (including one
  asserting `products` and `stock` share a single movement body builder).
  Test total: 322 → 339.

## 0.4.2 - 2026-07-25

New resource groups — line 0.4.x, part 3: **`members`** (+ subscriptions + member types).

> ⚠️ **Module-gated / docs-sourced.** `/members` and `/subscriptions` return `403` and
> `/memberstypes` returns `401` on the reference instance — the routes exist
> (`api_members.class.php`, `api_subscriptions.class.php`, `api_memberstypes.class.php`) but
> the API user lacks member permissions. Every path, method and required field below was
> confirmed by probing the live router and its validator; the writes were **not exercised**.

### Added

- **`members`** command group (`/members`):
  - `list` — `--type <id>` (member type) and `--category <id>` filters, plus the shared
    list flags.
  - `get <id>` — two-column detail view with named statuses.
  - `by-thirdparty <id>` / `by-email <email>` / `by-barcode <barcode>` — the three
    thirdparty-based lookups Dolibarr exposes (`/members/thirdparty/…`).
  - `create` — `--lastname` and `--type` required, plus `--firstname --company --login
    --email --phone --nature --socid --address --zip --town --country --public
    --note-public --note-private`, or `--from-json`. Echoes the created object.
  - `update <id>` — same field flags; only what you pass is sent. Echoes the result.
  - `delete <id>` — confirmation prompt or `--confirm`.
  - `categories <id>` — the categories a member belongs to.
- **`members subscriptions`** — `list <member-id>`, `list-all` (across all members),
  `get <subscription-id>`, `update <subscription-id>`, and
  `add <member-id> --start --end --amount [--label]`.
  - `add` **books a membership fee**, so it is guarded: `--dry-run` previews the body and a
    confirmation (or `--confirm`) is required. The API's own validator confirmed all three
    fields are mandatory (`start_date`, `end_date`, `amount`).
- **`members types`** — full CRUD over `/memberstypes` (`list`, `get`, `create --label …`,
  `update`, `delete --confirm`) with `--subscription --amount --duration --vote --note`.

### Route findings (Dolibarr 20.0.4)

- **Member types live at `/memberstypes`**, their own API class — not `/members/types` as
  the older reference notes claimed. `/members/types` does still resolve (to a method inside
  `api_members`), but `members types` uses the dedicated resource.
- **No `/members/ref/{ref}`** route, so `get` takes a numeric ID; the `by-*` lookups cover
  identifier-based access.
- **Statuses are not a 0..n sequence**: `-2` excluded, `-1` resiliated, `0` draft,
  `1` validated. Rendered as labels.

### Tests

- Added members command-tree, body-builder and column tests. Test total: 303 → 322.

## 0.4.1 - 2026-07-25

New resource groups — line 0.4.x, part 2: **`expensereports`**.

> ✅ **Live-verified.** The Expense Report module is enabled on the reference instance, so
> every route, field name and status code below was exercised against a real Dolibarr
> 20.0.4 API (throwaway record, created and deleted). The one exception is flagged inline:
> `payments add`.

### Added

- **`expensereports`** command group (`/expensereports`):
  - `list` — `--user <ids>` (author filter) plus the shared list flags.
  - `get <id>` — two-column detail view with named statuses.
  - `create` — `--user` (required) `--date-start --date-end --validator --note-public
    --note-private`, or `--from-json`. Echoes the created object.
  - `update <id>` — only the flags you pass are sent; echoes the resulting state.
  - `delete <id>` — confirmation prompt or `--confirm`.
  - `set-status <id> --status draft|validated|approved|paid|refused|cancelled` (or a numeric
    code) — confirmation-guarded; echoes the resulting state.
  - `payments list` / `payments get <payment-id>` — read recorded payments.
  - `payments add <id> --amount --date --payment-type [--account --num --note-public]` —
    **⚠️ moves money.** Guarded: `--dry-run` previews the body and a confirmation (or
    `--confirm`) is required. `--payment-type` accepts a code (`CB`, `VIR`, `LIQ`, …) or the
    numeric dictionary id. The route and its required fields (`fk_typepayment`, `datepaid`,
    `amounts`) were confirmed live, but a **completed payment could not be exercised
    end-to-end** — Dolibarr only accepts one against an approved report. `--from-json` is
    available if your instance expects a different `amounts` shape.
  - `payments update <id>` — update the payment on a report.

### Field/route quirks found live (worth knowing)

- **Status is written through `fk_statut`, not `status`.** A `PUT` with `{"status": 2}` is
  silently ignored; `{"fk_statut": 2}` works. `set-status` uses the field that works.
- **`ref_ext` does not persist.** The `PUT` response echoes it back, but a re-`GET` still
  reports `null` — so no `--ref-ext` flag is exposed on `update`.
- **`create` needs a period.** `fk_user_author` alone returns a 500; pass `--date-start` and
  `--date-end`.
- **`set-status` is not Dolibarr's approval workflow.** No `/validate`, `/approve` or
  `/setstatus` route exists on this resource, so the status is written directly: the draft
  ref is *not* replaced (it stays `(PROVn)`), `date_valid`/`date_approve` are not stamped,
  and no triggers fire. This is spelled out in `set-status --help`.

### Not added (verified absent on Dolibarr 20.0.4)

- **expense-report lines** — no `/expensereports/{id}/lines` route in any method
  (route-stage 404), despite the roadmap listing them. Lines must be entered in the web UI.
- **`validate` / `approve` subcommands** — no dedicated routes; `set-status` is the honest
  equivalent and says so.
- **ref-lookup** — no `/expensereports/ref/{ref}` route.

### Changed

- State-echoing mutations in both 0.4.x groups (`create`, `update`, `set-status`,
  `validate`, `close`, `add-line`) now accept `--output`/`--json`/`--fields`, matching the
  0.3.x groups, so the echoed post-write state can be projected or parsed. The human
  confirmation line is suppressed in JSON mode to keep output parseable.

### Tests

- Added expense-report command-tree, body-builder, status-resolver and column tests.
  Test total: 277 → 303.

## 0.4.0 - 2026-07-25

New resource groups — line 0.4.x, part 1: **`interventions`**.

> ⚠️ **Module-gated / docs-sourced.** `/interventions` returns `403` on the reference
> instance (the route exists — `api_interventions.class.php` — but the API user lacks
> intervention permissions). Every path and HTTP method below was confirmed by probing the
> live router (route-stage 404 vs. call-stage 403), and the request shapes come from the
> documented API; the endpoints were **not exercised live**.

### Added

- **`interventions`** command group (`/interventions`, Dolibarr's *fichinter*):
  - `list` — `--thirdparty` filter plus the shared `--limit/--page/--sort/--order/--filter`
    and `--output/--json/--fields`.
  - `get <id>` — two-column detail view; durations render as `1h 30m`.
  - `create` — `--socid` (required) `--ref --ref-client --description --date --project
    --contract --note-public --note-private`, or `--from-json`. Echoes the created object.
  - `delete <id>` — confirmation prompt or `--confirm`.
  - `validate <id>` — `--no-trigger`; always sends `notrigger` because Dolibarr rejects an
    empty body on this route. Echoes the resulting state.
  - `close <id>` — echoes the resulting state.
  - `lines <id>` — the intervention's time lines (read from the embedded `lines` array;
    there is no standalone lines route).
  - `add-line <id>` — `--description --date --hours` (converted to seconds) or
    `--duration <secs>`, or `--from-json`.

### Not added (verified absent on Dolibarr 20.0.4)

- **`update`** — no `PUT /interventions/{id}`; the router returns a route-stage 404.
- **line edit / line delete** — no `PUT`/`DELETE` on `/interventions/{id}/lines/{lineid}`.
- **ref-lookup** — no `/interventions/ref/{ref}` route, so `get` takes a numeric ID only.

### Tests

- Added intervention command-tree, body-builder and column-formatter tests.
  Test total: 260 → 277.

## 0.3.8 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 9 (final): **product stock & movements**.

> ⚠️ **Module-gated / docs-sourced.** The Stock/Warehouse and Product routes return `403`
> on the reference instance (routes exist — `api_stockmovements.class.php`,
> `api_warehouses.class.php`, `api_products.class.php` — but the API user lacks stock
> permissions). Built against the route-confirmed shape with structural tests; not
> exercised live.

### Added

- **`products stock-movements`** — list warehouse stock movements (`--product`,
  `--warehouse` filters map to `sqlfilters`).
- **`products correct-stock <product-id> --warehouse --qty [...]`** — record a stock
  movement to correct inventory via `POST /stockmovements` (`--type --lot --label --code
  --price --date`).
  - **⚠️ This mutates real inventory.** It is guarded: `--dry-run` previews the request
    body, and a confirmation prompt (or `--confirm`) is required before the write — in a
    non-interactive shell without `--confirm` it refuses to proceed. It was authored from
    the documented `POST /stockmovements` shape and **could not be exercised live** because
    the reference instance's API user lacks stock permissions.

### Not added

- **`productlot` (batch/serial) list/get/update** — no standalone product-lot REST route
  exists on Dolibarr 20.0.4 (every candidate path returns 404/501). Lot/batch data flows
  through the stock endpoints (`lot` on a stock movement, `includestockdata=2` on a product
  read) instead.

### Tests

- Added products stock-surface tests (registration, `correct-stock` guard flags,
  `buildStockMovementBody`). Test total: 257 → 260.

### 0.3.x line complete

This is the last release of the 0.3.x "deep endpoint coverage" line (0.3.0 → 0.3.8). The
22 existing command groups now expose their practical sub-resource endpoints; `raw` is only
needed for truly exotic paths. Next up: 0.4.x — new resource groups (interventions,
expensereports, members, stock/warehouses, supplier-proposals, tasks/agenda, …).

## 0.3.7 - 2026-07-24

Deep endpoint coverage — line 0.3.x, part 8: **product pricing**.

> ⚠️ **Module-gated (same as v0.3.6).** All `products/*` routes are `403` on the reference
> instance (route exists, API user lacks product rights), so these were built against the
> documented, route-confirmed shape and covered by structural tests, not exercised live.

### Added

- **`products purchase-prices list [product-id]`** — list a product's supplier prices, or
  all supplier products (`--supplier` filter).
- **`products purchase-prices set <product-id>`** — add/update a supplier price
  (`--supplier --buyprice --qty --price-base --ref-fourn --tva-tx --delivery-days`).
  Dolibarr **upserts** by supplier — there is no separate update route (verified: `PUT
  .../purchase_prices/{id}` is a 404), so `set` covers both create and update.
- **`products purchase-prices delete <product-id> <price-id>`**.
- **`products multiprices show <product-id> --by segment|customer|quantity`** — read the
  selling multiprices. Read-only: Dolibarr exposes no REST setter for multiprices (set
  them in the web UI or via a product update).
- **`products price-by-qty <product-id>`** — read the per-quantity selling price grid.

### Tests

- Added products pricing-surface tests (subgroup registration, `buildPurchasePriceBody`,
  the no-update assertion). Test total: 254 → 257.

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
