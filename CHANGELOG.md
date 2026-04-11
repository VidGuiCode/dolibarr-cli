# Changelog

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
- 24 per-resource API reference files in `context/docs/reference/`
- Version roadmap (`docs/ROADMAP.md`)
- CLAUDE.md with full agent briefing
