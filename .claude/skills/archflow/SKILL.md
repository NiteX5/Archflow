---
name: archflow
description: Build, read, verify and update the Archflow architecture model in .archflow/ (a didactic, hierarchical map of the app: infrastructure, apps, modules, components, functional dependencies such as guards/RBAC/DTOs/enums/contracts, relevant functions and processes). Use when asked to document or map the architecture, when a task changes components, dependencies, data, infrastructure or flows, or when the user asks how the system is built.
---

# Archflow architecture model

`.archflow/` holds a declared, evidence-backed model of this repository. Archflow
renders it as an explorable map (zoom from infrastructure down to functions),
a documentation panel per element, and separate diagrams (use cases, data,
sequences, processes). **You declare the model from evidence; nothing is
generated wholesale and nothing is invented.** Format: `reference.md` (next to
this file). Read it before writing YAML.

The goal is **didactic documentation**: a developer who has never seen the
code should understand, by browsing the map, what each part is, what it is for,
what it uses, and how it works.

## 0. Before anything

1. Read `.archflow/manifest.yaml` and `.archflow/overview.yaml` (if they exist).
2. Run `archflow validate --repo .`. If it reports `migration-required`, run
   `archflow migrate --repo .` first.
3. Never read `.archflow/history/` (change log, not the model).

## 1. Identify the architecture style

Explore the repository (README, package manifests, top-level folders, entry
points, framework config, Docker/Compose, Terraform, migrations) and decide
which style the code follows. Map it onto Archflow's hierarchy:

| Archflow level | What to look for |
|---|---|
| Infrastructure (only if it exists in code/config) | cloud providers, clusters, containers, databases, queues, CDN (Terraform, Compose, k8s, platform configs) |
| Apps & systems | deployable units: API, web app, mobile app, workers; external systems and actors |
| Modules | feature modules / bounded contexts / packages (`src/<feature>`, Nest `@Module`, Django apps, Maven modules, DDD contexts) |
| Components | controllers, services, use cases, repositories, adapters, listeners **and functional dependencies** |
| Functions & behaviour | only relevant ones: endpoints, handlers, use-case methods, jobs, business rules |

Style hints: **modular / feature folders** → each feature is a `module`.
**MVC** → modules by feature if present, else by layer (controllers, services,
models) under the app. **DDD / Clean / Hexagonal** → bounded contexts are
modules; ports are `contract`s, adapters are `component`s that `implements` them;
domain events are `event`s; value objects are `value-object`s.

Containment is always `parent`. Deployment is a `deploys-to` relation from the
app to the infrastructure element (the map nests it for you).

## 2. Functional dependencies (the important part)

Functional dependencies are code artifacts that give behaviour across modules.
Declare them **only when they are used between modules or at a specific point
that matters**, never as an inventory of every class.

| Kind | Typical evidence |
|---|---|
| `guard` | NestJS `@UseGuards(...)` / `CanActivate`, Angular guards, auth checks wrapping routes |
| `policy` (RBAC / permissions) | `@Roles()`, `RolesGuard`, Spring `@PreAuthorize`, .NET `[Authorize(Roles=...)]`, CASL/permission maps |
| `middleware` | Express/Koa middleware, Next.js `middleware.ts`, ASP.NET middleware, interceptors/pipes |
| `dto` | request/response classes or schemas (`*Dto`, records, zod/yup/Joi schemas, Pydantic models) |
| `enum` | enums or literal unions shared across modules (statuses, roles, types) |
| `contract` | interfaces/ports/abstract classes other modules depend on; OpenAPI/gRPC/GraphQL contracts |
| `event` | domain/integration events, message types published to a bus |
| `value-object` | DDD value objects shared across the domain |

How to link them:
- Put the dependency under the module that **defines** it (`parent`).
- When a component uses it: relation `type: uses` from the component to it.
- When it is part of a call between modules/components, list it in that
  relation's `via: [...]` (e.g. the guard, policy and DTO of an endpoint call).
  The map shows these as chips on the line, and as small nodes when zoomed in.
- External APIs are `external-system` elements, reached with `integrates-with`.

## 3. Didactic fields (fill from evidence, never guess)

For every element you declare, when the code shows it:
- `summary`: what it is, one sentence.
- `responsibility`: what it is for.
- `howItWorks`: ordered steps of what it does (read the code to write them).
- `rules`: business rules it enforces.
- `code`: path (and `symbol`) where it lives.

Write these in the language the project uses for its docs, or the user's
language. Leave a field out when the code does not show it: the UI shows it as
"not documented". Never paraphrase a guess as a fact.

## 4. Processes and diagrams

- **Use cases**: `use-case` elements under the module that implements them;
  actors connect with `participates-in`.
- **Data**: `table`/`data-entity` elements; foreign keys as `references` with
  `cardinality` (`1-1`, `1-n`, `n-1`, `n-n`); components that read/write them.
- **Flows**: one file per important flow in `flows/`. Steps can be `start`,
  `task`, `decision` (with `branches: [{condition, next}]`), `wait`, `end`.
  Participants are the elements that perform the steps (apps, modules or
  components). Declare 1–3 key flows per app, not every path.

## 5. Workflow (incremental, validated)

Work top-down and **validate after each step** with `archflow validate --repo .`:
1. `overview.yaml`: summary, `keyElements`, `unknowns`.
2. Infrastructure (if any) and apps/systems, actors, external systems.
3. One module at a time: the module, its main components, its functional
   dependencies, its relevant functions, its use cases and tables. Then the
   relations of that module (with `via`).
4. Key flows.
5. `archflow verify --repo .`: fix real discrepancies (add the missing
   relations with evidence), explain the ones that are not real.

For a large repository, model the top levels first, report, and continue
module by module in later steps instead of reading everything at once.

## 6. Rules that never change

- **Do not invent**: no modules, dependencies, rules or explanations without
  evidence. Unknown information stays out of the model (or in `unknowns`).
- **Never regenerate the whole model** from the code, and never ask Archflow or
  another tool to build the architecture automatically: extend and correct the
  existing model, preserving what people declared.
- **Keep IDs stable**: lowercase slug plus a short random suffix
  (`appointments-service-k3f9`). Never change an ID; rename with `name`.
- **Search before declaring**: by name, kind and code path. Never create a
  second entity for the same thing.
- **Provenance** on what you declare: `source: agent`; `status: verified` only
  if you checked it in the code now (with `evidence` or `verifiedRevision`);
  otherwise `inferred` or `pending-review`.
- **Delete logically**: `lifecycle: deleted` + `deletedAt` + `deletedReason`,
  and delete its active relations too.
- **Do not touch `views/`** unless asked: the map lays itself out.
- Do not model: private helpers, getters/setters, framework boilerplate, every
  DTO field, generated code, tests, or anything without a role in the
  architecture.
- Never copy secrets or environment values into the model.

## 7. When the task is to change code

1. Read the overview and only the model files relevant to the task (follow
   `parent`, relations and `via` as far as needed; read the whole model for
   cross-cutting changes).
2. **Explore the real code before implementing**: the model can be outdated;
   check the code paths of the relevant elements.
3. **Search for existing modules, components and functional dependencies to
   reuse** before creating new ones, and say what you reused.
4. Implement, then keep the model in sync (next section).

## 8. Keeping it in sync

When a task changes code, update the model in the same task: new/renamed/moved
modules and components, new or removed functional dependencies, changed calls
(`via`), data access, flows and rules. Then validate.

## 9. Report at the end

1. Code files changed (if any).
2. Model files changed, and the elements/relations/flows added, changed,
   deleted or restored (by ID).
3. Result of `archflow validate` and `archflow verify` (or that they could not
   be run — then say the model is **not validated**).
4. What is `inferred`, `pending-review` or in `unknowns` and needs review, and
   which parts of the repository were not modelled yet.
