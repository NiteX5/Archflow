# Archflow

Local tool to represent, explore, edit and maintain the architecture of a
software system. The architecture is a structured, versioned model stored next
to the code in `.archflow/`. People and agents (Claude Code, through the bundled
skill) declare it; Archflow validates it, renders it as navigable views, lets
you edit it, keeps its history and reflects file changes live.

Archflow does **not** generate the architecture by scanning source code. Code
analysis is only used, on request, to report discrepancies.

## Install

Requirements: Node.js 22 or newer (Linux, macOS or Windows).

Download `archflow-<version>.tgz` from the
[releases](https://github.com/NiteX5/Archflow/releases) page (or the CI
artifact) and install it. It contains the compiled application and its
dependencies, so nothing is compiled and no network access is needed:

```bash
npm install --global ./archflow-0.1.0.tgz
archflow --help
```

## Use

```bash
archflow serve --repo /path/to/project
```

- Opens `http://127.0.0.1:4870/` in your browser and prints the address.
- Listens on loopback only. If the port is busy, the next 10 ports are tried,
  then any free port; the change is reported. `--port <n>` chooses the port
  (`0` = any free port); `--strict-port` fails instead of falling back;
  `--no-open` does not open the browser.
- Without `--repo`, you choose the repository in the browser. Archflow only
  accesses that directory.
- A repository without a model shows a button to create an empty one
  (`archflow init --repo <path>` does the same).

In the UI you can switch between views (architecture overview, dependencies,
infrastructure & deployment, data, business flows, sequence of each flow, and
your own free views), find elements, open their details, and create, edit,
delete (logically) and restore elements, relations and notes; move, resize and
style boxes (color, shape and icon; every element shows an icon for its kind); review the history and restore earlier states; export and import;
and run the verification.

Other commands:

| Command | Purpose |
|---------|---------|
| `archflow validate --repo <path> [--json]` | Validate the model. Exit code 0 valid, 1 invalid, 2 usage/path error. |
| `archflow verify --repo <path> [--json]` | Report discrepancies between the model and the code (exit code 1 when there are findings). Never changes the model. |
| `archflow init --repo <path> [--name <n>]` | Create an empty model (never overwrites). |
| `archflow skill install --repo <path> [--force]` | Install the Claude Code skill into `.claude/skills/archflow/`. |

## The model

```text
.archflow/
  manifest.yaml       schema version and project name
  overview.yaml       summary, key elements, known unknowns (read first)
  systems.yaml, infrastructure.yaml, data.yaml, components/*.yaml   elements and relations
  flows/*.yaml        one flow per file
  decisions.yaml      architecture decisions
  views/*.yaml        presentation only: positions, styles, membership
  history/            Archflow's change log (add it to .gitignore if you rely on Git only)
```

Format reference: [`skills/archflow/reference.md`](skills/archflow/reference.md).
Example: [`examples/sample`](examples/sample) (fictional). Archflow's own
architecture is declared in [`.archflow/`](.archflow) and can be opened with
`archflow serve --repo .`.

Key rules: IDs are stable and independent of names, files and positions;
references use IDs and broken references are errors; missing information is
shown as unknown, never filled in; provenance distinguishes verified facts from
inferences; deletion is logical and restorable; an invalid edit on disk never
replaces the last valid model shown.

## Claude Code

```bash
archflow skill install --repo /path/to/project
```

See [`docs/claude-code-skill.md`](docs/claude-code-skill.md). The skill makes
Claude read the overview first, explore and reuse real code, update the model
in the same task as the code, keep IDs stable, record evidence, validate, and
report what changed — without inventing architecture.

## Import and export

- Archflow JSON/YAML (whole model, lossless): export, and import that replaces
  the model (entities missing from the import are kept as deleted).
- Mermaid (`flowchart`/`graph`, `sequenceDiagram`) and draw.io: import adds
  elements marked `pending-review`, reusing existing elements by ID or name;
  export of the current view.
- SVG, PNG and PDF export of the current view.

Every import is previewed (summary, warnings, validation) before it is applied.

## Security and privacy

- Loopback only; requests with a foreign `Host` (DNS rebinding) or `Origin`
  (cross-site) header are rejected; strict Content Security Policy.
- File access is confined to the authorized repository: traversal and symlinks
  are rejected, sizes are limited.
- Nothing is sent to external services. Model content is never executed.
- Verification reports only names and locations, never configuration values.

## Known limitations

- Distributed as an npm package that needs Node.js 22; standalone executables
  are not provided yet.
- CI runs the unit/integration tests and installs and exercises the packaged
  build on Linux, macOS and Windows; browser tests run on Linux (Chromium) only.
- PDF export uses the standard Helvetica font: characters outside Latin-1 are
  replaced by `?` and reported.
- Mermaid import supports flowcharts and sequence diagrams; other diagram types
  are rejected. draw.io import uses the first page; free text and dangling
  connectors are kept as metadata. Sequence views cannot be exported to draw.io.
- Verification is heuristic beyond missing paths: TS/JS relative imports only,
  `CREATE TABLE` in `.sql` files, Compose service names, Terraform resource
  names.
- Concurrent edits are detected per element (and per layout/style entry);
  conflicting edits are shown for review, not merged field by field.
- Only schema version 1 exists, so there are no migrations yet.

## Development

```bash
npm install
npm run typecheck
npm test              # unit and integration tests
npm run build         # server (tsc) + UI (Vite) into dist/
npm run test:e2e      # browser tests against the build (Chromium; set ARCHFLOW_CHROMIUM if needed)
npm run package       # release/archflow-<version>.tgz
npm run smoke:package # install the tarball offline and exercise it
npm run dev -- --repo <path>   # service + Vite dev server with hot reload (UI at http://127.0.0.1:5173)
```

`npm run dev` starts the service on port 4870 (`ARCHFLOW_PORT` changes it) and
Vite on 5173, which forwards `/api/` to the service. To just use Archflow from
a clone, run `npm run build` and then `npm start -- --repo <path>`.

Architecture and decisions: [`docs/technical-plan.md`](docs/technical-plan.md)
and the model in `.archflow/`. Functional specification:
[`docs/architecture_map_mvp_spec.md`](docs/architecture_map_mvp_spec.md).

Branching follows Gitflow (`main`, `develop`, `feature/*`, `release/*`,
`hotfix/*`) and commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## License

MIT
