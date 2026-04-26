# dolibarr-cli

Unofficial CLI for [Dolibarr ERP](https://www.dolibarr.org) — full REST API coverage from your terminal.

## Install

Requires Node.js 20+ and npm.

```bash
npm install -g https://github.com/VidGuiCode/dolibarr-cli/releases/download/v0.2.3/dolibarr-cli-0.2.3.tgz
dolibarr --version
dolibarr config init
```

This installs the `dolibarr` command as a normal npm global CLI. It does not require `sudo`, does not install a system service, and does not modify system configuration.

On Linux and macOS, avoid `sudo npm install -g` for this CLI. If npm global installs fail with permission errors, use a user-level Node.js setup such as [`nvm`](https://github.com/nvm-sh/nvm) or [`fnm`](https://github.com/Schniz/fnm), or configure npm's global prefix to a user-owned directory.

Or for development:

```bash
git clone https://github.com/VidGuiCode/dolibarr-cli.git
cd dolibarr-cli
npm install
npm run build
npm link
```

## Upgrading

Once installed, the CLI can upgrade itself from GitHub Releases:

```bash
dolibarr upgrade           # show installed + latest version
dolibarr upgrade check     # fetch the latest release info from GitHub
dolibarr upgrade install   # download + install the latest .tgz via npm install -g
```

Every `dolibarr` command also prints a one-line reminder to **stderr** when a newer version is available (cache refreshed at most once every 24h). The reminder is suppressed automatically for piped / `--json` / non-TTY output, and can be turned off entirely:

```bash
export DOLIBARR_NO_UPDATE_CHECK=1
```

## Setup

```bash
dolibarr config init
```

Enter your Dolibarr instance URL and API key. The CLI tests the connection before saving.

Your API key is stored at `~/.config/dolibarr-cli/config.json`. Treat this file as a secret and do not share or commit it.

For CI, containers, or scripts where you do not want a saved config file, set both environment variables instead:

```bash
export DOLIBARR_URL="https://your-dolibarr-instance"
export DOLIBARR_API_KEY="your-api-key"
```

Environment variables are supplied by your shell, CI system, or container runtime. The CLI reads them but does not create an `.env` file.

> **Getting an API key:** In Dolibarr, go to *Users & Groups > [your user] > API* tab > Generate key. Or ask your admin to create a dedicated API user.

## Usage

```bash
# Check connection
dolibarr status

# Thirdparties (customers & suppliers)
dolibarr thirdparties list
dolibarr thirdparties list --supplier
dolibarr thirdparties get 5
dolibarr thirdparties create --name "Acme Corp" --supplier --dry-run

# Customer invoices
dolibarr invoices list --year 2025
dolibarr invoices list --status paid --output json
dolibarr invoices get 12
dolibarr invoices get FA2501-0001            # look up by ref (invoices, orders, proposals, categories)
dolibarr invoices validate 12
dolibarr invoices pay 12 --amount 500.00 --date 2025-12-01

# Supplier invoices
dolibarr supplier-invoices list --supplier 3
dolibarr supplier-invoices get 7

# Bank
dolibarr bank accounts list
dolibarr bank transactions list --account 1 --from 2025-01-01

# Accounting
dolibarr accounting ledger list --account 6132
dolibarr accounting balance
dolibarr accounting transfer --source supplier_invoices

# Products
dolibarr products list --type service
dolibarr products create --label "Consulting" --price 150.00 --type service

# Documents
dolibarr documents list --module invoice --id 5
dolibarr documents upload --module invoice --id 5 ./scan.pdf
dolibarr documents download --module invoice --id 5 --file scan.pdf

# Setup
dolibarr setup modules list
dolibarr setup modules enable accounting
dolibarr setup company show

# Projects
dolibarr projects list --status 1
dolibarr projects get PJ2501-001             # ref-lookup
dolibarr projects tasks 12 --with-timespent

# Tickets
dolibarr tickets list --thirdparty 5
dolibarr tickets get --track-id abc123def456
dolibarr tickets reply abc123def456 --message "Looking into this now."

# Contracts
dolibarr contracts list --thirdparty 5
dolibarr contracts validate 12
dolibarr contracts activate-line 12 42 --date-start 2026-01-01

# Shipments & receptions
dolibarr shipments create --socid 5 --order 123 --date 2026-01-15
dolibarr shipments validate 7 --no-trigger
dolibarr receptions close 3

# Raw API (escape hatch)
dolibarr raw GET /thirdparties
dolibarr raw POST /invoices --body '{"socid": 1}'
dolibarr raw PUT /thirdparties/5 --body '{"fournisseur": 1}'
```

## Output Formats

All `list` and `get` commands support `--output <format>` where format is `table` (default), `json`, or `csv`. `--json` is kept as a back-compat alias for `--output json`.

```bash
dolibarr invoices list                     # table (default)
dolibarr invoices list --output json       # JSON
dolibarr invoices list --json              # JSON (shorthand)
dolibarr invoices list --output csv        # CSV (RFC 4180, raw field keys as headers)
```

### Column projection with `--fields`

Pick exactly the columns you want, using the raw Dolibarr field keys. Works across all three output formats.

```bash
dolibarr invoices list --fields id,ref,total_ttc
dolibarr invoices list --fields id,ref,status --output csv > invoices.csv
dolibarr thirdparties get 5 --fields id,name,email,town --output json
```

With `--fields`, values pass through raw — e.g. `--fields status` emits the numeric code (`0` / `1` / `2`) rather than the mapped label (`Draft` / `Validated` / `Paid`). Missing keys render as empty strings.

### Ref-based lookup

`get` accepts a human ref in place of a numeric id for resources whose Dolibarr API exposes `/ref/{ref}` — **invoices, orders, proposals, categories**. All-digit input is still treated as an id.

```bash
dolibarr invoices get FA2501-0001
dolibarr orders get CO2501-0042
dolibarr proposals get PR2501-0007
```

## Dry Run

All mutating commands support `--dry-run` to preview what would happen:

```bash
dolibarr thirdparties create --name "Test" --supplier --dry-run
# Would create thirdparty: { name: "Test", fournisseur: 1 }
# No changes made.
```

## Commands

| Command | Description |
|---|---|
| `config` | Manage CLI configuration (init, show, set) |
| `status` | Check connection and show server info |
| `raw` | Execute raw API requests |
| `thirdparties` | Customers, suppliers, prospects |
| `invoices` | Customer invoices |
| `supplier-invoices` | Purchase invoices |
| `orders` | Customer orders |
| `supplier-orders` | Purchase orders |
| `proposals` | Quotes / commercial proposals |
| `bank` | Bank accounts and transactions |
| `accounting` | Ledger, journal entries, trial balance |
| `products` | Products and services |
| `contacts` | Contact persons |
| `categories` | Tags and categories |
| `documents` | File upload, download, listing |
| `users` | User management |
| `setup` | Modules, dictionaries, company config |
| `projects` | Projects and tasks |
| `tickets` | Support / help desk tickets |
| `contracts` | Service contracts + line activation |
| `shipments` | Customer shipments (expeditions) |
| `receptions` | Supplier receptions |

## Development

```bash
# Run in dev mode (requires bun)
bun src/cli.ts status

# Build
npm run build

# Type check
npm run typecheck

# Test
npm test

# Lint & format
npm run lint
npm run format
```

## Architecture

```
src/
  cli.ts              Entry point — registers all command groups
  core/
    api-client.ts     HTTP client (native fetch, DOLAPIKEY auth, retries)
    config-store.ts   Config file management (~/.config/dolibarr-cli/)
    errors.ts         Error classes (ApiError, AuthError, ConfigError)
    output.ts         Table / JSON / CSV formatting
    types.ts          Shared TypeScript types
  commands/
    config.ts         dolibarr config init|show|set
    status.ts         dolibarr status
    raw.ts            dolibarr raw <METHOD> <path>
    thirdparties.ts   dolibarr thirdparties ...
    invoices.ts       dolibarr invoices ...
    ...               (one file per resource)
```

**Conventions:**
- Commands stay thin — business logic goes in `src/core/`
- Native `fetch` only — no axios, no node-fetch
- `commander` is the only runtime dependency
- Same patterns as [plane-cli](https://github.com/VidGuiCode/plane-cli) and [solidtime-cli](https://github.com/VidGuiCode/solidtime-cli)

## Compatibility

Tested with Dolibarr 20.x. Should work with any version that has the REST API enabled (16+).

## License

MIT
