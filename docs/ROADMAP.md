# Roadmap

Planned improvements and features for upcoming releases. This is a living document -- items may shift between releases or be dropped based on usage and feedback.

---

## v0.1.0 — Core Release

### Infrastructure

- **API client** (`src/core/api-client.ts`) — fetch wrapper with `DOLAPIKEY` auth header, retries with exponential backoff + jitter, error mapping to typed exceptions
- **Config store** (`src/core/config-store.ts`) — `~/.config/dolibarr-cli/config.json` read/write, env var override (`DOLIBARR_URL`, `DOLIBARR_API_KEY`), `createClient()` factory
- **Output** (`src/core/output.ts`) — `printTable()` with auto-width columns, `printJson()` (respects `--compact`), `printError()`, `printInfo()`
- **Errors** (`src/core/errors.ts`) — `exitWithError()` with status-specific exit codes (1=general, 2=auth, 3=validation, 4=rate limit), status hints for 401/403/404/500
- **Types** (`src/core/types.ts`) — per-resource response types, shared pagination/sort/filter types
- **Runtime** (`src/core/runtime.ts`) — `isDryRunEnabled()`, `isNonInteractiveMode()`, `isCompactMode()` flag detection from `process.argv`
- **Prompt** (`src/core/prompt.ts`) — `ask(question, default?)` and `pickOne(prompt, items[])` readline-based interactive input
- **Help** (`src/core/help.ts`) — custom Commander.js help formatter with ruled sections (`-- Commands --`, `-- Options --`)

### CLI entry point

- **Global options** — `--dry-run`, `--no-interactive`, `--compact`, `--json` on the root program
- **Async parsing** — `program.parseAsync()` for proper async command support
- **Version check** — compare installed version against latest GitHub release (with 1.5s timeout)
- **Custom help** — ruled section formatting matching plane-cli / solidtime-cli style

### Commands

- **`dolibarr config`** — `init` (interactive setup with connection test), `show` (print current config), `set <key> <value>`
- **`dolibarr status`** — server info, Dolibarr version, enabled modules, connection health check
- **`dolibarr raw`** — `GET|POST|PUT|DELETE <path> [--data <json>]` escape hatch for any API endpoint
- **`dolibarr thirdparties`** — `list`, `get`, `create`, `update`, `delete`, `merge`; filter by customer/supplier/prospect
- **`dolibarr invoices`** — `list`, `get`, `create`, `update`, `delete`, `validate`, `pay`, `add-line`, `list-lines`; filter by status, thirdparty
- **`dolibarr supplier-invoices`** — `list`, `get`, `create`, `update`, `delete`, `validate`, `pay`
- **`dolibarr orders`** — `list`, `get`, `create`, `update`, `delete`, `validate`, `close`, `add-line`
- **`dolibarr supplier-orders`** — `list`, `get`, `create`, `update`, `delete`, `validate`, `approve`
- **`dolibarr proposals`** — `list`, `get`, `create`, `update`, `delete`, `validate`, `close`, `add-line`
- **`dolibarr products`** — `list`, `get`, `create`, `update`, `delete`, `stock`; filter by type (product/service)
- **`dolibarr contacts`** — `list`, `get`, `create`, `update`, `delete`
- **`dolibarr bank`** — `list`, `get`, `create`, `transactions`, `transfer`
- **`dolibarr categories`** — `list`, `get`, `create`, `update`, `delete`, `objects`; multi-type support (customer, supplier, product, etc.)
- **`dolibarr documents`** — `list`, `upload`, `download`, `delete`; modulepart-based routing
- **`dolibarr users`** — `list`, `get`, `create`, `update`
- **`dolibarr setup`** — `modules` (list enabled), `dictionaries` (list/get), `company` (get/set)
- **`dolibarr accounting`** — `ledger` (list bookkeeping entries)

### Cross-cutting features

- **`--output table|json|csv`** on all read commands for machine-readable output
- **`--dry-run`** on all mutating commands — prints what would happen without executing
- **`--limit`, `--page`, `--filter`, `--sort`** on all list commands — maps to Dolibarr's pagination, `sqlfilters`, and `sortfield`/`sortorder`
- **`--from-json <file>`** on create commands — bulk-friendly alternative to individual flags
- **`--confirm`** on delete commands — required in non-interactive mode, prompted interactively otherwise

### Tests

- **Vitest setup** — `vitest.config.ts`, test scripts in `package.json`
- **Core unit tests** — api-client (retry logic, error mapping), config-store (load/save/env override), output (table formatting)
- **Command integration tests** — mocked fetch responses for key CRUD flows

---

## v0.2.0 — Extended Resources & Deep Endpoint Coverage

### New command groups

- **`dolibarr projects`** — `list`, `get`, `create`, `update`, `delete`, `tasks`
- **`dolibarr tickets`** — `list`, `get`, `create`, `update`, `delete`
- **`dolibarr contracts`** — `list`, `get`, `create`, `update`, `delete`, `activate-line`, `deactivate-line`
- **`dolibarr shipments`** — `list`, `get`, `create`, `delete`, `validate`
- **`dolibarr receptions`** — `list`, `get`, `create`, `delete`, `validate`

### Enhanced existing commands

- **`thirdparties`** — categories, representatives, bank accounts, outstanding invoices, notifications, merge (remaining 27 endpoints)
- **`invoices`** — contacts, discounts, create-from-order, credit notes (remaining endpoints)
- **`orders`** — create-from-proposal, create-shipment (remaining endpoints)
- **`products`** — attributes, attribute values, variants, purchase prices, multiprices, subproducts (remaining 30+ endpoints)

### Features

- **Ref-based lookup** — `dolibarr invoices get FA2501-0001` resolves ref to ID transparently
- **`--fields` flag** — select which columns to display in table output
- **CSV export** — full `--output csv` support with proper escaping

---

## v0.3.0 — Automation & Bulk Operations

### New command groups

- **`dolibarr interventions`** — field service interventions with lines
- **`dolibarr expensereports`** — expense reports with payment tracking
- **`dolibarr members`** — association members, subscriptions, member types
- **`dolibarr stock`** — stock movements (in/out), warehouse management
- **`dolibarr supplier-proposals`** — supplier price requests

### Bulk operations

- **Batch by IDs** — `dolibarr invoices validate 1,2,3` operates on multiple resources
- **`--all-draft`** — `dolibarr invoices validate --all-draft` validates all draft invoices in one go
- **Export lists** — `dolibarr thirdparties list --all` bypasses pagination for full export

### Workflow shortcuts

- **`invoices create-from-order`** — one-step order-to-invoice conversion
- **`supplier-orders receive`** — mark goods as received with optional quantity

---

## v0.4.0 — Polish & Advanced Features

### Output & UX

- **Shell completions** — bash, zsh, fish auto-complete for commands and options
- **Color-coded statuses** — draft/validated/paid/abandoned shown in distinct colors
- **Progress indicators** — progress bars for bulk operations and large exports
- **Interactive selection** — fuzzy search when picking thirdparties, products, etc.

### Advanced

- **`setup extrafields`** — list, create, update custom fields on any resource
- **`setup modules enable|disable`** — toggle Dolibarr modules from the CLI
- **Multi-profile config** — manage connections to multiple Dolibarr instances, switch with `--profile`
- **Webhook monitoring** — `dolibarr events watch` for real-time event streaming (if supported)

### Reliability

- **Post-pack smoke tests** — install `.tgz` into temp directory and verify binary works before publishing
- **Rate limit handling** — respect `Retry-After` headers, automatic backoff
- **Connection pooling** — reuse connections for batch operations

---

Items beyond v0.4.0 will be added as the project evolves. Feedback and suggestions welcome via [GitHub Issues](https://github.com/VidGuiCode/dolibarr-cli/issues).
