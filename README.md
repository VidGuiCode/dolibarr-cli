# dolibarr-cli

Unofficial CLI for [Dolibarr ERP](https://www.dolibarr.org) — full REST API coverage from your terminal.

## Install

Requires Node.js 20+ and npm.

```bash
npm install -g https://github.com/VidGuiCode/dolibarr-cli/releases/download/v0.6.4/dolibarr-cli-0.6.4.tgz
dolibarr --version
dolibarr config init
```

This installs the `dolibarr` command as a normal npm global CLI. It does not require `sudo`, does not install a system service, and does not modify system configuration.

On Windows PowerShell, `dolibarr` may resolve to npm's `.ps1` shim and be blocked by the execution policy. Use `dolibarr.cmd` from PowerShell, or run `dolibarr` from `cmd.exe` / a shell that resolves the `.cmd` shim.

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
dolibarr upgrade           # show installed + latest version (checks GitHub live)
dolibarr upgrade check     # fetch + cache the latest release info from GitHub
dolibarr upgrade install   # download + install the latest .tgz via npm install -g
```

`dolibarr upgrade` performs a best-effort live check against GitHub and falls back to the last cached result when offline, so "Latest" reflects new releases immediately. Self-update works on Windows, macOS, and Linux (the installer runs through the platform shell so `npm.cmd` resolves correctly on Windows).

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
export DOLIBARR_URL="https://your-dolibarr.example.com"
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
dolibarr invoices list --status 2 --output json
dolibarr invoices get 12
dolibarr invoices get FA2501-0001            # look up by ref
dolibarr invoices update 12 --date 2025-06-15 --socid 4 --due-date 2025-07-15   # re-date / re-assign
dolibarr invoices update-line 12 34 --subprice 40 --qty 2   # edit a draft line; totals recompute
dolibarr invoices validate 12
dolibarr invoices pay 12 --amount 500.00 --date 2025-12-01 --payment-type CB   # or a numeric id
dolibarr invoices unpay 12         # reverse a paid invoice back to unpaid
dolibarr invoices set-draft 12     # send a validated invoice back to draft
dolibarr invoices payments 12      # list payments on an invoice
dolibarr invoices create-from-order 45
dolibarr invoices credit-notes list
dolibarr invoices contacts add 12 7 BILLING

# Supplier invoices
dolibarr supplier-invoices list --thirdparty 3
dolibarr supplier-invoices get 7
dolibarr supplier-invoices update 7 --date 2025-03-01 --ref-supplier INV-2025-03   # re-date a purchase invoice

# Bank
dolibarr bank list
dolibarr bank transactions 1
dolibarr bank add-transaction 1 --date 2026-05-05 --type VIR --label "Bank fee" --amount -3.50
dolibarr bank update-transaction 1 240 --label "Corrected label"   # only the label is API-editable
dolibarr bank transfer --from 1 --to 2 --amount 100.00 --date 2026-05-05 --description "Internal transfer"

# Customer orders
dolibarr orders create-from-proposal 9
dolibarr orders update-line 42 310 --qty 3        # edit a draft order line; totals recompute
dolibarr orders contacts list 42
dolibarr orders reopen 42

# Product variants (needs the Products module + API-user product rights)
dolibarr products attributes create --ref COL --label Color
dolibarr products variants create 42 --price-impact 5 --feature 1:3 --feature 2:7
dolibarr products subproducts add 42 88 --qty 2
dolibarr products purchase-prices set 42 --supplier 3 --buyprice 12.50   # upserts by supplier
dolibarr products multiprices show 42 --by segment
dolibarr products stock-movements --product 42
dolibarr products correct-stock 42 --warehouse 1 --qty -3 --dry-run   # preview; mutates inventory when run

# Categories & links
dolibarr categories link 12 customer 3        # link thirdparty 3 to category 12
dolibarr categories of-object customer 3      # categories a thirdparty belongs to
dolibarr thirdparties categories list 3
dolibarr thirdparties representatives add 3 8
dolibarr setup extrafields --type societe

# Supplier orders (path fixed in v0.3.4)
dolibarr supplier-orders list
dolibarr supplier-orders make-order 8 --date 2025-06-15
dolibarr supplier-orders receive 8 --close

# Proposals / supplier-invoice line editing
dolibarr proposals update-line 15 220 --qty 4
dolibarr supplier-invoices update-line 7 88 --subprice 42   # maps to pu_ht; totals recompute

# Thirdparty banking (RIB / SEPA / gateways)
dolibarr thirdparties bank-accounts list 3
dolibarr thirdparties bank-accounts create 3 --label Main --iban LU28... --bic BCEELULL --rum RUM-0001
dolibarr thirdparties outstanding 3 --mode supplier   # unpaid purchase invoices for a supplier

# Accounting
dolibarr accounting formats                                  # export models this Dolibarr accepts
dolibarr accounting ledger --period currentyear --format fec > ledger.txt
dolibarr accounting ledger --period lastmonth --format 1000  # numeric model ids also work

# Products
dolibarr products list --type service
dolibarr products create --label "Consulting" --price 150.00 --type service

# Documents
dolibarr documents list --module facture --ref FA2501-0001
dolibarr documents upload --module facture --ref FA2501-0001 --file ./scan.pdf
dolibarr documents download --module facture --file invoices/FA2501-0001/scan.pdf --output scan.pdf

# Setup
dolibarr setup modules
dolibarr setup company
dolibarr setup conf MAIN_INFO_SOCIETE_NOM

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

# Interventions (fichinter)
dolibarr interventions list --thirdparty 5
dolibarr interventions create --socid 5 --description "On-site repair" --date 2026-03-01
dolibarr interventions add-line 12 --description "Diagnostics" --hours 1.5
dolibarr interventions validate 12

# Expense reports
dolibarr expensereports list --user 2
dolibarr expensereports create --user 2 --date-start 2026-03-01 --date-end 2026-03-31
dolibarr expensereports set-status 4 --status approved --confirm
dolibarr expensereports payments list

# Members
dolibarr members list --type 1
dolibarr members by-email member@example.com
dolibarr members subscriptions add 7 --start 2026-01-01 --end 2026-12-31 --amount 50
dolibarr members types list

# Stock & warehouses
dolibarr stock warehouses list
dolibarr stock warehouses create --label "Main depot" --location "Aisle 1"
dolibarr stock movements list --product 12
# Same endpoint as `products correct-stock`, warehouse-first — guarded, so preview first:
dolibarr stock movements create --product 12 --warehouse 1 --qty -3 --dry-run

# Supplier proposals (price requests)
dolibarr supplier-proposals list --thirdparty 8
dolibarr supplier-proposals create --socid 8 --date 2026-02-01 --ref-supplier SUP-77
dolibarr supplier-proposals lines 4

# Tasks & time spent
dolibarr tasks list --project 3 --with-timespent
dolibarr tasks create --ref T1 --label "Design" --project 3 --workload-hours 3
# Time spent wants a datetime; pass a plain date and the CLI converts it:
dolibarr tasks timespent add 9 --date 2026-03-01 --hours 1.5

# Agenda (calendar events)
dolibarr agenda list --user 2
dolibarr agenda create --label "Client call" --start 2026-04-01 --type AC_RDV

# Multi-currency & knowledge base
dolibarr multicurrencies list
dolibarr multicurrencies set-rate 2 --rate 1.08 --dry-run
dolibarr knowledge list
dolibarr knowledge create --question "How do I reset?" --answer "Click reset."

# MRP — bills of materials & manufacturing orders
dolibarr mrp boms list
dolibarr mrp boms add-line 3 --product 7 --qty 2
dolibarr mrp mos create --product 5 --qty 100 --bom 3 --date-start 2026-05-01
dolibarr mrp workstations list          # read-only
# MO production is intentionally not wrapped (it irreversibly consumes stock):
dolibarr raw POST mos/12/produceandconsumeall --data '{}'

# Raw API (escape hatch)
dolibarr raw GET /thirdparties
dolibarr raw POST /invoices --data '{"socid": 1}'
dolibarr raw PUT /thirdparties/5 --data '{"fournisseur": 1}'
dolibarr raw POST /invoices --data-file body.json
# Convert YYYY-MM-DD body fields to the Unix epoch Dolibarr wants — no hand-computing:
dolibarr raw PUT /supplierinvoices/18 --data '{"date":"2026-03-01"}' --date date
```

> **Windows / Git Bash (MSYS) note:** Git Bash rewrites a leading-slash argument
> like `/thirdparties` into a Windows path (`C:/Program Files/Git/thirdparties`)
> before the CLI ever sees it, which Dolibarr rejects. The CLI now detects and
> un-mangles this automatically (printing a one-line notice). To avoid it entirely,
> either drop the leading slash (`dolibarr raw GET thirdparties`) or set
> `MSYS_NO_PATHCONV=1` for the session.

## Output Formats

All `list` and `get` commands support `--output <format>` where format is `table` (default), `json`, or `csv`. `--json` is kept as a back-compat alias for `--output json`.

```bash
dolibarr invoices list                     # table (default)
dolibarr invoices list --output json       # JSON
dolibarr invoices list --json              # JSON (shorthand)
dolibarr invoices list --output csv        # CSV (RFC 4180, raw field keys as headers)
```

`--compact` only changes JSON indentation. It does not select JSON output by itself; use `--json --compact` or `--output json --compact`.

### Bank balances

`dolibarr bank list` shows bank account metadata. Dolibarr's account-object `balance` / `solde` fields may be stale or zero on some server versions, so they are omitted from bank list table, JSON, and CSV output. For reconciliation, use `dolibarr bank transactions <account-id>` or raw `/bankaccounts/{id}/lines` output and sum transaction lines independently.

### Column projection with `--fields`

Pick exactly the columns you want, using the raw Dolibarr field keys. Works across all three output formats.

```bash
dolibarr invoices list --fields id,ref,total_ttc
dolibarr invoices list --fields id,ref,status --output csv > invoices.csv
dolibarr thirdparties get 5 --fields id,name,email,town --output json
```

With `--fields`, values pass through raw — e.g. `--fields status` emits the numeric code (`0` / `1` / `2`) rather than the mapped label (`Draft` / `Validated` / `Paid`). Missing keys render as empty strings.

### Dates

Command flags such as `create --date` and `pay --date` accept `YYYY-MM-DD` and convert it to the Unix epoch (seconds) Dolibarr stores. When you need a date inside a `raw` request body, pass `--date <keys>` to convert the named body fields for you, so you never have to hand-compute a timestamp:

```bash
dolibarr raw PUT /supplierinvoices/18 --data '{"date":"2026-03-01"}' --date date
```

Date-only values are interpreted as UTC midnight. `get` views already render stored epoch dates back as `YYYY-MM-DD`.

### Ref-based lookup

`get` accepts a human ref in place of a numeric id for resources whose Dolibarr API exposes `/ref/{ref}` — **invoices, orders, proposals, categories, projects, and tickets**. All-digit input is still treated as an id. Tickets also support public track ID lookup via `--track-id`.

```bash
dolibarr invoices get FA2501-0001
dolibarr orders get CO2501-0042
dolibarr proposals get PR2501-0007
dolibarr projects get PJ2501-001
dolibarr tickets get TICKET-001
dolibarr tickets get --track-id abc123def456
```

## Dry Run

All mutating commands support `--dry-run` to preview what would happen:

```bash
dolibarr thirdparties create --name "Test" --supplier --dry-run
# Would create thirdparty: { name: "Test", fournisseur: 1 }
# No changes made.
```

## Colour

Table output colours record statuses by meaning — yellow for not-yet-committed
(draft, open), blue for committed (validated, approved, signed), green for
successfully finished (paid, closed, delivered), red for ended badly (abandoned,
cancelled, refused).

Colour is automatically off when stdout is piped, under any machine-readable
`--output`, on `TERM=dumb`, when `NO_COLOR` is set, and with `--no-color`.

## Output views and redaction

Dolibarr returns very large objects — a single invoice carries ~130 fields, most of them
null, plus notes, internal ids and contact data. `--view` picks a named preset instead of
naming every key by hand:

```bash
dolibarr invoices list --view summary
dolibarr invoices list --view accounting
dolibarr bank transactions 2 --view reconciliation
dolibarr thirdparties get 3 --view contact
```

| View | Shows |
|---|---|
| `summary` | id, ref, date, thirdparty, totals, status |
| `accounting` | totals, VAT, due date, accountancy codes, remaining to pay |
| `reconciliation` | dates, label, amount, statement number, bank account |
| `contact` | name, email, phone, address |
| `admin` | entity, status, creation/modification metadata |
| `full` | everything (no projection) |

A view is a *candidate* key list resolved against what each record actually carries — keys
that are absent, or null on every row, are dropped rather than rendered as empty columns.
So one view works across every resource and never invents a column.

`--redact` masks sensitive values (IBAN/BIC/RUM, account numbers, notes, credentials,
email/phone), keeping the key visible so a consumer can tell *withheld* from *absent*:

```bash
dolibarr thirdparties get 3 --redact --output json
# "email": "[redacted]"
```

Redaction is applied before any projection or formatting, so it holds on every output
path — including `--field` and `--template`.

`--fields` and `--view` are mutually exclusive: passing both is rejected rather than
silently resolved, the same rule `--field` vs `--fields` follows.

## Read-only mode

Blocks **every** write for the whole run — `POST`, `PUT`, `DELETE`, including `raw`:

```bash
dolibarr invoices list --read-only          # fine
dolibarr invoices validate 12 --read-only   # refused, exits 6
dolibarr raw POST invoices --data '{}' --read-only   # also refused

export DOLIBARR_READ_ONLY=1                 # for a whole cron job or agent session
```

This is enforced at the single function every API request passes through, not per
command. That is what makes it a **guarantee rather than a promise**: it cannot be
bypassed with `raw POST`, and any command added in future inherits it without anyone
remembering to opt in. A blocked write exits **`6`**, which is distinct from a permission
failure (`2`), so a script can tell "I wasn't allowed" from "I wasn't permitted".

It is deliberately different from `--dry-run`. Dry run is per-command and previews what one
mutation *would* do; read-only is a property of the entire process, and it is the thing to
hand to a cron job or an AI agent.

## Confirmation on financial writes

> **Breaking change in v0.6.0.** Commands that move money or change a document's official
> state no longer execute straight after argument parsing. They now require approval.

Affected: every `pay` / `unpay` / `transfer` / `add-transaction` / `update-transaction` /
`delete-transaction` / `apply-credit-note`, every `validate` / `close` / `reopen` /
`set-draft` / `approve`, `documents upload --overwrite`, and `raw` with `POST`/`PUT`/`DELETE`.
Reads are untouched, and `raw GET` is untouched.

The rule is the one `delete` has always used, so there is a single rule across the CLI:

| Situation | Behavior |
|---|---|
| Interactive terminal | You are shown the pending write and prompted to type `yes` |
| Non-interactive (cron, CI, piped) | **`--confirm` is required**, otherwise the command refuses with exit `3` |
| `DOLIBARR_ASSUME_YES=1` set | Approved automatically, with a notice on stderr |
| `--dry-run` | Previews without approving — a dry run is not an approval |

```bash
# Interactive: prompts before moving anything
dolibarr bank transfer --from 1 --to 2 --amount 500 --date 2026-07-29 --description "Rent"

# Automation: approve the specific call
dolibarr invoices pay 42 --amount 100 --confirm

# Trusted automation: approve every such call for this process
DOLIBARR_ASSUME_YES=1 dolibarr invoices validate 42
```

**Migrating an existing script:** add `--confirm` to the affected calls, or export
`DOLIBARR_ASSUME_YES=1` once for the whole run.

Batch runs compose with this rather than double-prompting: a batch confirms once for the
whole selection, and each item inherits that approval.

### Approval tokens

For unattended runs where `--confirm` is too easy to supply by accident, `--approve` checks
a secret the caller must have been given out of band:

```bash
export DOLIBARR_APPROVAL_TOKEN="a-secret-you-generated"
dolibarr invoices pay 42 --amount 100 --approve "a-secret-you-generated"
```

A missing or mismatched token is refused — `--confirm` cannot rescue a wrong token, and the
token is never echoed in the confirmation display or the audit log.

### Duplicate-payment protection

The hazard: a payment appears to fail — timeout, dropped connection, ambiguous error — but
actually applied server-side. Re-running it moves the money twice, and Dolibarr accepts the
second one because from its side nothing is wrong.

The CLI keeps a local ledger of money movements it performed, fingerprinted by what makes
two payments *the same payment*: command, account, amount, date and reference. An identical
repeat within 30 days is refused:

```bash
dolibarr invoices pay 42 --amount 100 --date 2026-07-29 --confirm
# ✗ Refusing a duplicate money movement: an identical `invoices pay` was already
#   performed by this CLI at 2026-07-29T11:00:00Z.

dolibarr invoices pay 42 --amount 100 --date 2026-07-29 --confirm --allow-duplicate
```

A movement is recorded only *after* the command succeeds, so a payment that genuinely
failed can still be retried. This is a local guard: it cannot see payments made through the
web UI or from another machine, and it says so rather than implying otherwise.

### Audit log

```bash
dolibarr invoices pay 42 --amount 100 --confirm --audit-log ./writes.ndjson
export DOLIBARR_AUDIT_LOG=~/dolibarr-writes.ndjson
```

One JSON object per line, recording every **mutating** call — method, endpoint, body,
outcome, status. Reads are not logged; the trail exists to answer "what did this run
change?". Sensitive body fields are redacted unconditionally, whether or not `--redact` was
passed, and the API key is never written. Off by default.

## Batch operations

Every mutating subcommand that takes a record id as its only positional argument also
accepts a **comma-separated id list**, so one call can act on many records:

```bash
dolibarr invoices validate 12,13,14 --confirm
dolibarr thirdparties update 20,21 --town "Berlin" --confirm
dolibarr orders delete 5,6,7 --confirm
```

A single id behaves exactly as it always has — the batch path is only taken when the
argument contains a comma.

> **PowerShell users: quote every comma-separated value.** PowerShell parses a bare
> `12,13,14` as an array literal and rewrites it before the CLI ever sees it, so
> `--fields id,ref` silently becomes a single field named `id ref` and a batch id list
> collapses into one argument. Always quote:
>
> ```powershell
> dolibarr invoices validate "12,13,14" --confirm
> dolibarr invoices list --fields "id,ref"
> ```
>
> Bash, zsh and fish need no quoting.

Batch runs are deliberately loud:

- **`--dry-run` prints every resolved target** and the request each one would send — not a
  count, not a sample.
- **Confirmation is required.** Non-interactively, a batch refuses to run without
  `--confirm` and exits `3`.
- **Failures do not stop the batch.** Each item is attempted in turn and reported
  individually, so a half-applied batch is always detectable.
- **Partial success exits `5`** (see the exit-code table below).

Under `--output json` the whole run collapses to a single machine-readable envelope:

```bash
dolibarr invoices validate 12,13,14 --confirm --output json
```

```json
{
  "batch": true,
  "action": "invoices validate",
  "dryRun": false,
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "exitCode": 5,
  "results": [
    { "id": "12", "ok": true },
    { "id": "13", "ok": true },
    {
      "id": "14",
      "ok": false,
      "exitCode": 1,
      "error": "API error 404: Not Found: Invoice not found",
      "detail": { "httpStatus": 404, "method": "POST", "path": "invoices/14/validate" }
    }
  ]
}
```

Re-running a batch with the failed ids converges rather than double-applying, so the usual
recovery is to fix the cause and re-run just the ids that reported `"ok": false`.

Ids must be positive integers in a list; a malformed list is rejected before **any** record
is touched. Read commands (`get`, `list`, …) are not batched — their output shape is
unchanged.

### Status-scoped bulk

Status transitions can select their own targets instead of taking ids. Each resource
exposes one `--all-<status>` flag per status it actually has:

```bash
# validate every draft invoice
dolibarr invoices validate --all-draft --confirm

# preview first — always do this
dolibarr invoices validate --all-draft --dry-run

# close every validated order
dolibarr orders close --all-validated --confirm
```

The status vocabulary is per-resource and is **not** a uniform `0..n` sequence — expense
reports run `0/2/4/5/6/99`, members `-2/-1/0/1`, BOMs `0/1/9`. `--help` on any status-scoped
command lists that resource's real statuses.

Scope and cap the selection:

| Flag | Purpose |
|---|---|
| `--filter <expr>` | Narrow the selection with an SQL filter, ANDed with the status |
| `--max <n>` | Cap on records selected (default `100`) |

```bash
# only this month's drafts, at most 20 of them
dolibarr invoices validate --all-draft \
  --filter "(t.datef:>=:'20260701')" --max 20 --confirm
```

Selection rules:

- **The resolved selection is printed before anything happens** — with `--dry-run` you get
  every target id and the request each would send.
- **A cap is never silent.** If more records matched than `--max` allowed, the run says so
  explicitly and tells you how to continue.
- An id and a selector are mutually exclusive, as are two selectors.
- Zero matches is a success (exit `0`), not an error.

> Selection filters server-side on the resource's own status column, so nothing that matched
> can be silently skipped. Note that Dolibarr's own `list --status` query param expects
> string tokens (`draft`, `paid`) and **silently ignores** a numeric value — the status-scoped
> flags avoid that trap entirely.

## Server-side list filters

`list` commands can narrow by date and amount **at the server**, so scripts and agents stop
pulling everything and filtering locally:

```bash
dolibarr invoices list --from 2026-01-01 --to 2026-12-31
dolibarr invoices list --min-amount 1000 --max-amount 5000
dolibarr orders list --from 2026-03-01 --to 2026-03-31 --fields id,ref,total_ttc
```

| Flag | Meaning |
|---|---|
| `--from <YYYY-MM-DD>` | Records on or after this date |
| `--to <YYYY-MM-DD>` | Records on or before this date (**the whole day is included**) |
| `--min-amount <n>` | Amount at or above `n` |
| `--max-amount <n>` | Amount at or below `n` |

These compile to Dolibarr `sqlfilters` and are **ANDed with** any `--filter` you pass, so the
two compose rather than one overriding the other. They also apply to v0.5.1's status-scoped
selection, which is what makes this work:

```bash
# validate just this month's drafts — preview first
dolibarr invoices validate --all-draft --from 2026-03-01 --to 2026-03-31 --dry-run
dolibarr invoices validate --all-draft --from 2026-03-01 --to 2026-03-31 --confirm
```

The flags appear **only on resources that actually have the column** — `contacts list` has
`--from`/`--to` but no `--min-amount`, because contacts have no amount. Dates must be exact
`YYYY-MM-DD` calendar dates, and an inverted range is rejected before any request is sent
(exit `3`).

> `bank transfer` keeps its own pre-existing `--from`/`--to` (source and destination account).
> Where a command already owns one of these flag names, the filter of that kind is not added
> rather than shadowing it.

### Fetching every page with `--all`

Dolibarr pages its list endpoints. `--all` walks every page for you:

```bash
# full export, no manual pagination
dolibarr thirdparties list --all --output csv > thirdparties.csv

# combine with server-side filters
dolibarr invoices list --all --from 2026-01-01 --to 2026-12-31 --fields id,ref,total_ttc
```

| Flag | Meaning |
|---|---|
| `--all` | Fetch every page, **ignoring `--limit`** |
| `--max-records <n>` | Safety cap on records fetched (default `5000`) |

- `--limit` and `--page` keep working exactly as before when `--all` is absent.
- **Hitting the cap is never silent** — the run says so explicitly and tells you how to
  continue. Raise `--max-records`, or narrow with `--filter` / `--from` / `--to`.
- **Progress and warnings go to stderr**, so `--all` output stays a clean data stream:
  `dolibarr thirdparties list --all --output csv > out.csv` writes only CSV to the file.

### Bulk create from a file or a pipe

`--from-json` accepts a **JSON array**, and `--stdin` reads records from a pipe as NDJSON:

```bash
# one call per array entry
dolibarr thirdparties create --from-json batch.json --confirm

# stream NDJSON in
cat rows.ndjson | dolibarr thirdparties create --stdin --confirm

# preview first — prints the body of every record
dolibarr thirdparties create --from-json batch.json --dry-run
```

`--stdin` accepts NDJSON (one JSON object per line), a JSON array, or a single object.

A **single JSON object** in `--from-json` behaves exactly as it always has — no
confirmation, no batch report. Bulk behaviour only kicks in for more than one record, and
then it follows the same rules as every other bulk operation here: full dry-run listing,
required `--confirm`, per-item outcome, exit `5` on partial success.

Under `--output json` each result carries the command's own output, so a bulk create hands
back the new ids:

```json
{
  "batch": true, "action": "thirdparties create",
  "total": 2, "succeeded": 2, "failed": 0, "exitCode": 0,
  "results": [
    { "id": "#1 Acme Ltd", "ok": true, "output": 41 },
    { "id": "#2 Globex",   "ok": true, "output": 42 }
  ]
}
```

> `supplier-orders receive --from-json` is excluded: there an array already means *the lines
> of one receipt*, and splitting it would change what the command does.

## Pipeline output

Beyond `table`, `json` and `csv`, read commands support formats built for pipelines:

```bash
# one JSON object per line — feed jq, or a while-read loop
dolibarr thirdparties list --all --output ndjson > thirdparties.ndjson

# YAML
dolibarr invoices get 42 --output yaml

# a Go-style template, one line per row
dolibarr invoices list --template '{{.id}} {{.ref}}'

# headerless CSV for a downstream importer
dolibarr invoices list --output csv --no-header
```

| Flag | Meaning |
|---|---|
| `--output ndjson` | One compact JSON object per line |
| `--output yaml` | YAML |
| `--field ref` | **One raw value per row** — no header, no quoting (xargs-friendly) |
| `--template '{{.ref}}'` | Render each row from a template; `{{.a.b}}` walks nested fields |
| `--no-header` | Omit the header row from `table` / `csv` |
| `--quiet` | Suppress headers and batch progress chatter; print data only |

### `--field` vs `--fields`

These are one letter apart and do different things:

| | Does |
|---|---|
| `--field ref` | **singular** — prints one bare value per row, nothing else |
| `--fields id,ref` | **plural** — projects those columns into the chosen `--output` |

```bash
dolibarr invoices list --field id        # 16⏎17⏎18
dolibarr invoices list --fields id,ref   # a two-column table
```

Because a mix-up would otherwise be silent, every confusable combination is rejected with
exit `3`: a comma in `--field` (it suggests `--fields`), and pairing `--field` with either
`--fields` or `--template`.

### Piping ids between commands

```bash
# one call per id
dolibarr invoices list --all --field id | xargs -n1 dolibarr invoices validate --confirm

# or collapse to a single batch call (see Batch operations)
dolibarr invoices list --all --field id | paste -sd, - \
  | xargs dolibarr invoices validate --confirm
```

Note the `-n1`: a bare `xargs` would hand every id to one invocation, and these subcommands
take a single id (or one comma-separated list).

Notes:

- `--template` takes precedence over `--output` — it *is* the output format. A missing field
  renders empty rather than failing the row, so one odd record never kills a stream.
- `--fields` composes with all of these, so `--fields id,ref --output ndjson` emits only
  those keys.
- **In YAML, every string is quoted.** Unquoted, values like `1.0`, `007`, `yes` or
  `2024-01-01` would be read back as a number, boolean or date — silently changing your data
  mid-pipeline. Quoting always is less pretty and always correct.
- `--quiet` silences the batch reporter and table headers. It never suppresses a command's
  actual result, so a create still prints its new id.
- An unrecognised `--output` value still falls back to `table`, as it always has.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Generic error (including a batch where every item failed for an unclassified reason) |
| `2` | Authentication or permission failure (HTTP 401 / 403) |
| `3` | Validation error, or a prompt was required in non-interactive mode (including a financial write refused for want of `--confirm`) |
| `4` | Rate limited (HTTP 429) |
| `5` | **Partial batch failure** — some items applied, some failed |
| `6` | **Blocked by read-only mode** — a write was attempted while `--read-only` / `DOLIBARR_READ_ONLY` was active |

Code `5` only ever comes from a batch run. When every item of a batch fails, the batch exits
with that shared underlying code (e.g. `2` for a permission-gated module) rather than `5`.

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
| `accounting` | Accounting export data |
| `products` | Products and services |
| `contacts` | Contact persons |
| `categories` | Tags and categories |
| `documents` | File upload, download, listing |
| `users` | User management |
| `setup` | Modules, company info, config constants |
| `projects` | Projects and tasks |
| `tickets` | Support / help desk tickets |
| `contracts` | Service contracts + line activation |
| `shipments` | Customer shipments (expeditions) |
| `receptions` | Supplier receptions |
| `interventions` | Interventions (fichinter) + time lines |
| `expensereports` | Expense reports + payment tracking |
| `members` | Members, subscriptions, member types |
| `stock` | Warehouses + stock movement ledger |
| `supplier-proposals` | Supplier price requests |
| `tasks` | Project tasks + time spent |
| `agenda` | Calendar / agenda events |
| `multicurrencies` | Currencies + FX rates |
| `knowledge` | Knowledge-base articles |
| `mrp` | BOMs, manufacturing orders, workstations |

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
