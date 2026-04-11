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
