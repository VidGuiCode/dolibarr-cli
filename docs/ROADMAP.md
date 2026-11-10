# Roadmap

Where dolibarr-cli is going. A living document — items may shift between releases or be
dropped based on usage and feedback.

**Current release: v0.6.8.** 34 commands — 29 resource groups plus `config`, `status`,
`raw`, `completion` and `upgrade`. 998 tests. `commander` is still the only runtime dependency.

---

## How releases work here

- **Many small, focused releases.** One minor bump owns exactly one theme. Patch releases
  between them are fixes and polish only — never new surface.
- **Every release holds the same bar:** build, typecheck and lint clean; every pre-existing
  test still green; `--json`/`--output` preserved on reads; `--dry-run` preserved on
  mutations; `commander` still the only runtime dependency; `CHANGELOG.md` and
  `package.json` bumped together.
- **1.0.0 means "complete and stable"** — see [the 1.0 criteria](#100--stable-complete).

---

## Shipped

### v0.1.x — Core

API client (`DOLAPIKEY` auth, retries with backoff, typed errors), config store with env
overrides, table/JSON output, status-specific exit codes, custom help formatter. 17 command
groups, `--dry-run`, `--json`, `sqlfilters` filtering, pagination. Internal refactor in
v0.1.2 extracted the shared command boilerplate that everything since has been built on.

### v0.2.x — Cross-cutting flags, then five new groups

Field-validated fixes from real agent usage (Windows path handling in `raw`, payment-type
codes, a slim default `list` view, `YYYY-MM-DD` dates everywhere), then ref-based lookup
(`invoices get FA2501-0001`), CSV output, `--fields` projection, and the `projects`,
`tickets`, `contracts`, `shipments` and `receptions` groups.

### v0.3.x — Deep endpoint coverage

Made `raw` unnecessary for the groups already shipped. Editable `update` covering date,
amount, supplier and line items; payment reversal and bank-line edits; invoice contacts,
discounts and credit notes; order and proposal line editing and create-from-\*; thirdparty
banking, categories and representatives; product variants, pricing and stock.

### v0.4.x — Ten new resource groups

`interventions`, `expensereports`, `members`, `stock`, `supplier-proposals`, `tasks`,
`agenda`, `multicurrencies`, `knowledge` and `mrp`. Every enabled Dolibarr module on a
standard instance now has a command group.

### v0.5.x — Bulk, batch & scripting

Batch by IDs (`invoices validate 1,2,3`), status-scoped bulk (`--all-draft`), server-side
list filters (`--from`/`--to`/`--min-amount`), `--all` auto-pagination, bulk create from a
JSON array or piped NDJSON, pipeline output formats (`ndjson`, `yaml`, `--template`),
and scalar extraction (`--field ref`) for xargs. Exit code **5** was introduced for a
partially-applied batch, so a half-finished run is detectable rather than silent.

### v0.6.x — Safety first, then polish

Safety led the line: mandatory confirmation on 28 financial-write commands, a global
`--read-only` mode enforced at the HTTP layer, output views (`--view summary|accounting|…`)
plus `--redact`, an approval-token mechanism, an NDJSON audit log, and duplicate-payment
detection. Then UX: colour-coded statuses, shell completions for bash/zsh/fish, interactive
fuzzy pickers, progress indicators, and `--explain` — which tells you what a command will do
and which safety gates apply, without running it.

---

## Planned

### v0.7.x — Verification floor & configuration

Nothing here is a headline feature. All of it is what makes the accounting work that follows
it trustworthy, and the project contributable.

- **v0.7.0 — Multi-profile config.** `--profile <name>`, `DOLIBARR_PROFILE`, and
  `config profiles add|list|use|remove` for working against several Dolibarr instances.
  Existing single-instance configs keep working untouched.
- **v0.7.1 — CI & release hardening.** Build/typecheck/lint/test on every push and pull
  request across Node 20/22 on Linux and Windows. A post-pack smoke test that installs the
  packed `.tgz` into a temp directory and runs the binary before anything is released. Issue
  and pull-request templates.
- **v0.7.2 — Reproducible test instance.** A `docker-compose.yml` bringing up Dolibarr 20.x
  with the modules this CLI touches enabled, a seed script, and a record/replay fixture layer
  so integration tests run offline. This is also how a contributor gets a working instance in
  one command.
- **v0.7.3 — Pagination & completeness audit.** Every paginated endpoint audited for whether
  the server actually honours `--limit`/`--page`, with client-side enforcement where it does
  not, and a **completeness marker** on every list result so a truncated set can never be
  mistaken for a full one.
- **v0.7.4 — `setup extrafields`.** List, create, update and delete custom fields, and set
  them on any `create`/`update`.
- **v0.7.5 — `setup dictionaries`.** Payment terms, payment types, units, VAT rates. A wrong
  dictionary value will error with the accepted values listed, instead of a bare 400.
- **v0.7.6 — Secure key storage.** Optional OS keychain or credential-helper indirection
  instead of a plaintext key in `config.json`.

### v0.8.x — Finance intelligence & reconciliation

The line that turns endpoint access into a bookkeeping workflow. Everything here is
read-only reporting except the statement import and the document actions.

- **v0.8.0 — `bank balance`.** A balance calculated from transaction lines, with credits,
  debits, opening and closing figures, date filtering, and a clear separation between
  calculated and server-reported values.
- **v0.8.1 — `reconcile bank` + `bank import <csv>`.** Match a bank statement against
  Dolibarr, flag unmatched lines in both directions, and import a statement.
- **v0.8.2 — Invoice documents.** Build an invoice PDF from a record, fetch it, and
  (where the API supports it) send it — so a validated invoice can reach a client without
  leaving the CLI.
- **v0.8.3 — Receivables & payables ageing.** `unpaid`, `overdue` and aged-bucket reports
  for both customer and supplier invoices.
- **v0.8.4 — Payment matching.** `reconcile invoices` and `reconcile suppliers`: matched,
  unmatched and partial, in a shape an agent can act on.
- **v0.8.5 — Anomaly detection.** Duplicate transactions and missing payment references,
  each explaining why a row was flagged.
- **v0.8.6 — Period close & accounting reports.** `reconcile period`, period-close blockers,
  sales/purchase journals, VAT summaries, accounting-account mapping checks, and export
  validation *before* a file is written.
- **v0.8.7 — `admin health`.** One read-only command answering "is this instance sane?",
  with an overall pass/fail and machine-readable per-check status.
- **v0.8.8 — Instance audits.** Module readiness, API permission audit, user access review,
  company information, document inventory and missing-document checks, backup readiness.

### v0.9.x — Agent & integration surface

Making the CLI a first-class tool for automation, rather than a human CLI that scripts scrape.

- **v0.9.0 — `dolibarr schema`.** The entire command tree as JSON: every group, subcommand,
  flag and argument with types and write classification, generated from the live tree so it
  cannot drift.
- **v0.9.1 — Stable error codes & consistent envelopes.** A machine-readable `code` on every
  error (`MODULE_DISABLED`, `NO_PERMISSION`, `NOT_FOUND`, …) and one consistent JSON envelope
  across every command. Includes flattening `status --output json`, which is a breaking
  change and ships behind a deprecation window.
- **v0.9.2 — MCP server mode.** `dolibarr mcp` exposing the CLI over the Model Context
  Protocol. **Read commands only by default** — writes require an explicit flag, and
  financial writes require another on top. Read-only mode, the audit log and duplicate
  detection all apply.
- **v0.9.3 — Audit readback & recovery.** The audit log is currently written and never read.
  `audit show` reads it back, `audit verify` re-checks each recorded mutation against the live
  record to detect a half-applied run, and bulk mutations can write a pre-run snapshot.

### v0.10.x — Reliability, docs & the 1.0 run-up

- **v0.10.0** — Respect `Retry-After`, smarter rate-limit backoff, and *reported* retries
  rather than silently absorbed ones.
- **v0.10.1** — Optional local response cache with a TTL for read-heavy scripts.
- **v0.10.2** — Connection reuse and bounded concurrency for batch operations.
- **v0.10.3** — `--verbose` / `DOLIBARR_DEBUG` request logging with the API key redacted,
  on stderr so piped output stays byte-exact.
- **v0.10.4** — Per-Dolibarr-version compatibility checks and broader integration coverage.
- **v0.10.5** — `--watch` polling on `list`.
- **v0.10.6** — Consistency pass with [plane-cli](https://github.com/VidGuiCode/plane-cli)
  and [solidtime-cli](https://github.com/VidGuiCode/solidtime-cli) on flag names, config
  layout and exit codes.
- **v0.10.7** — Generated man pages, a runnable example on every subcommand's `--help`, and a
  task-oriented cookbook.
- **v0.10.8** — Surface freeze / release candidate: deprecation warnings for anything
  changing at 1.0, and contract tests locking flag behaviour across every command group.

---

## 1.0.0 — Stable "complete"

Shipped when all of these are true:

- Every practical Dolibarr REST resource has a first-class command group *(done)*
- The flag contract is frozen and documented, and semver guarantees begin
- Power-user surface in: bulk/batch, completions, colour, multi-profile
- **Safe for unattended use** — mandatory confirmation on financial writes, a global
  read-only mode, redaction and safe output views, an audit trail that can be read back and
  verified. Until that readback lands, treat the tool as **supervised-use only**
- **Answers accounting questions, not just endpoint calls** — calculated balances,
  reconciliation, ageing, period close, working exports
- **Produces and delivers documents** — a validated invoice can become a PDF and reach a
  client without leaving the CLI
- **Usable by automation without scraping** — machine-readable schema, stable error codes,
  MCP server mode
- Reliability bar met — rate-limit handling, redacted debug logging, correct and
  *provable* pagination on every endpoint, a post-pack smoke test in CI
- Docs: README, cookbook and man pages, with the install snippet version-checked at release
- `--json` kept as a documented alias for `--output json`

---

## Under consideration

Not committed. Feedback on any of these is genuinely useful — it is how items get promoted.

- **Easier install** — a one-line install script, a Scoop manifest for Windows, a Homebrew
  tap. (The project does not publish to the npm registry; releases are `.tgz` artifacts on
  GitHub.)
- **Per-command defaults in config** — set `--view accounting` once instead of on every call.
- **Relative date windows** — `--from last-month`, `--from -30d`, `--period 2026-Q1`.
- **`dolibarr open <group> <id>`** — open a record in the Dolibarr web UI.
- **Recurring / template invoices** — wrap Dolibarr's template-invoice endpoints.
- **`--since-last-run`** — incremental fetching for scheduled jobs.
- **Payload templates** — named saved payloads for `create`.
- **`dolibarr diff`** — compare two records, or a record against a snapshot.
- **Multicompany `--entity` support.**
- **Full-instance export** for backup or migration.

### Deliberately out of scope

- Publishing to the npm registry — distribution is via GitHub Releases.
- A long-running daemon or webhook receiver — `--watch` covers the polling need.
- Any heavy runtime dependency. `commander` is the only one; YAML output, the progress
  spinner and shell completions are all hand-rolled, and that will not change.
- A full interactive TUI — the fuzzy pickers in v0.6.6 covered the real need.
- `POST /mos/{id}/produceandconsumeall` (MRP production) — irreversible stock consumption
  with no inverse route. Deliberately unwrapped; use `raw` if you need it.

---

Feedback, bug reports and feature requests are welcome via
[GitHub Issues](https://github.com/VidGuiCode/dolibarr-cli/issues).
