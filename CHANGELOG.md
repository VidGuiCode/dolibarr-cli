# Changelog

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

- Removed hardcoded personal default URL (`https://finance.cylro.com`) from `dolibarr config init` prompt. The prompt now shows a generic placeholder (`https://erp.example.com`) and requires the user to enter their own URL. This value should never have shipped as a default in an open-source tool.
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
