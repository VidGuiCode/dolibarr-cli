# Contributing

## Setup

```bash
git clone https://github.com/VidGuiCode/dolibarr-cli.git
cd dolibarr-cli
npm install
```

## Development

```bash
bun src/cli.ts              # run without building
npm run build               # compile TypeScript
npm run typecheck           # type check only
npm test                    # run tests
npm run lint                # lint
npm run format              # format
```

## Adding a Command

1. Create `src/commands/{resource}.ts`
2. Export a `Command` instance
3. Register it in `src/cli.ts` via `program.addCommand()`
4. Follow the existing patterns (list/get/create/update/delete + resource-specific actions)
5. Support `--output table|json|csv` on read commands and `--dry-run` on mutations

## Conventions

- Commands are thin — put logic in `src/core/`
- Use native `fetch` — no HTTP libraries
- `commander` is the only runtime dependency
- Match the style of plane-cli and solidtime-cli

## No personal hardcoded values

This is an open-source tool. It is built for every Dolibarr user, not for any one maintainer or contributor. Do not hardcode personal values anywhere in the codebase — including source, tests, docs, examples, CHANGELOG, or prompt defaults:

- No personal URLs, instance hostnames, or IP addresses
- No personal email addresses, account IDs, API keys, or usernames
- No company names, project refs, or customer data from any real Dolibarr instance

Use placeholders like `https://erp.example.com`, leave defaults blank so the user is prompted, or read values from environment variables / config. If you find a hardcoded personal value while working on something else, remove it as part of your change.
