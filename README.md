# Archflow

Local tool to represent, explore, edit and maintain the architecture of a
software system. The architecture is a structured, versioned model stored
next to the code in `.archflow/`; Archflow validates it and renders views
from it. It does **not** generate the architecture by scanning source code.

> Status: early MVP development. Implemented so far: model schema v1, loader,
> validator and the `archflow validate` command. The local web UI, editing,
> file watching, history, Claude Code skill and import/export are not built yet.
> See [`docs/technical-plan.md`](docs/technical-plan.md).

## Requirements

- Node.js 22 or newer.

## Development

```bash
npm install
npm test            # unit and integration tests
npm run typecheck
npm run build
node dist/cli/index.js validate --repo examples/sample
```

## Documentation

- [MVP specification](docs/architecture_map_mvp_spec.md) — functional source of truth.
- [Technical plan](docs/technical-plan.md) — technical decisions and progress.
- [Model format](docs/model-format.md) — how to write `.archflow/` files.
- [Sample model](examples/sample) — fictional example used by docs and tests.

## Contributing

- Branching follows Gitflow (`main`, `develop`, `feature/*`, `release/*`, `hotfix/*`).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

MIT
