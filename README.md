# dolibarr-cli

Unofficial CLI for [Dolibarr ERP](https://www.dolibarr.org) — full REST API coverage from your terminal.

## Install

```bash
npm install -g https://github.com/VidGuiCode/dolibarr-cli/releases/download/v0.1.1/dolibarr-cli-0.1.1.tgz
```

Or for development:

```bash
git clone https://github.com/VidGuiCode/dolibarr-cli.git
cd dolibarr-cli
npm install
npm run build
npm link
```

## Setup

```bash
dolibarr config init
```

Enter your Dolibarr instance URL and API key. The CLI tests the connection before saving.

Your API key is stored at `~/.config/dolibarr-cli/config.json`.

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

# Raw API (escape hatch)
dolibarr raw GET /thirdparties
dolibarr raw POST /invoices --body '{"socid": 1}'
dolibarr raw PUT /thirdparties/5 --body '{"fournisseur": 1}'
```

## Output Formats

All read commands support `--output` (or `--json` shorthand):

```bash
dolibarr invoices list                     # table (default)
dolibarr invoices list --output json       # JSON
dolibarr invoices list --json              # JSON (shorthand)
dolibarr invoices list --output csv        # CSV
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
