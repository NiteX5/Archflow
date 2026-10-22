# Archflow model format — schema version 2

The model is the source of truth that Archflow validates and renders. It is
declared by people or agents; Archflow never generates it from source code.
Schema definition in the Archflow source: `src/core/schema.ts`.

## Layout

```text
.archflow/
  manifest.yaml        required  schemaVersion and project name
  overview.yaml        optional  summary for humans and agents: read this first
  decisions.yaml       optional  architecture decisions
  flows/<any>.yaml     optional  one flow per file
  views/<any>.yaml     optional  one view per file (presentation only)
  history/             reserved  never read as part of the model
  <any other>.yaml     elements and relations, e.g. systems.yaml,
                       infrastructure.yaml, data.yaml, components/<module>.yaml
```

- Only `.yaml` files are read. Other files produce a warning; dotfiles are skipped.
- Symbolic links are never followed.
- Limits: 2000 files, 1 MiB per file, 8 directory levels.
- File names do not carry meaning beyond the classification above: an
  element can move to another file without changing its identity.

## IDs

- Lowercase slugs: `^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$`, max 100 characters
  (`public-api`, `svc.billing`, `orders_db`).
- Unique across **all** elements, relations, flows, decisions and views.
- Never change an ID when renaming or moving something. Change `name` instead.
- Every reference is an ID. A reference to a missing ID is a validation error.

## `manifest.yaml`

```yaml
schemaVersion: 1
project:
  name: My project
  description: Optional.
```

A newer `schemaVersion` is rejected without touching the files. An older one
must be upgraded with `archflow migrate --repo <path>` (or "Migrate" in the
UI); the previous files are kept in the history.

## `overview.yaml`

```yaml
summary: What the system does, in a few lines.   # required
context: Optional extra context.
keyElements: [public-api, orders-db]           # IDs of elements, flows or views
unknowns:                                       # known gaps, stated explicitly
  - Retry policy for payment calls is not documented.
```

## Elements and relations

```yaml
elements:
  - id: orders-module          # required
    kind: module               # required, see kinds below
    name: Orders module        # required
    summary: What it is, in one sentence.       # documentation panel: "what it is"
    description: ...
    responsibility: What it is for.             # "what it is for"
    howItWorks:                                 # "how it works", ordered steps
      - Validates the request
      - Saves the order
    parent: public-api         # containment / grouping (an element ID)
    tags: [backend]
    code:                      # repository-relative, no "..", no absolute paths
      - path: apps/api/src/orders
        symbol: OrdersService
        line: 12
    rules: [An order needs at least one line item.]
    notes:
      - text: Owns the orders table.
        author: alice
        date: 2026-01-10
    provenance: { ... }        # see below
    metadata: { ... }          # free-form, e.g. attributes preserved from an import
    lifecycle: active          # active | deprecated | deleted (default: active)

relations:
  - id: rel-orders-db          # required
    type: writes               # required, see types below
    from: orders-module        # required, element ID
    to: orders-db              # required, element ID
    description: ...
    via: [jwt-guard, create-order-dto]   # functional dependencies involved (guards, DTOs...)
    cardinality: n-1           # only for `references`: 1-1 | 1-n | n-1 | n-n
    notes: [...]
    provenance: { ... }
    metadata: { ... }
    lifecycle: active
```

Unknown fields are errors (they are usually typos). Put free-form data in `metadata`.

### Element kinds

| Category | Kinds |
|----------|-------|
| infrastructure | cloud-provider, environment, server, container, network, load-balancer, storage, message-broker, deployment, infrastructure-resource |
| system | system, application, web-app, api, service, external-system, integration, domain |
| internal | module, package, controller, component, repository, interface, library |
| functional | guard, middleware, policy, dto, enum, contract, event, value-object |
| behavior | function, method, business-rule |
| data | database, table, data-entity, schema |
| business | actor, use-case, process |
| documentation | requirement, constraint |

The category is derived from the kind and drives which views show an element.

**Functional dependencies** (`functional`) are artifacts that provide behaviour
across modules: guards, RBAC/permission policies, middleware, DTOs, enums,
contracts/ports, events and value objects. Put them under the module that
defines them (`parent`), link components that use them with `uses`, and list
them in `via` on the relations where they take part. `via` only accepts
functional elements.

Map levels (derived from the kind): infrastructure → apps & systems →
modules (`module`, `package`) → components (other internal kinds and functional
dependencies) → functions & behaviour.

### Relation types

`depends-on`, `calls`, `contains`, `implements`, `deploys-to`, `reads`, `writes`,
`sends-data-to`, `receives-data-from`, `participates-in`, `integrates-with`,
`uses` (a component uses a functional dependency), `references` (foreign key
between tables/entities, optionally with `cardinality`).

Adding a kind or relation type requires a schema change in Archflow; unknown
values are rejected with the list of supported ones.

## Provenance

Optional on elements, relations, flows and decisions. **When absent, the
information is shown as unknown — it is never filled in automatically.**

```yaml
provenance:
  source: agent            # manual | agent | code-observed | tool-inferred
  status: pending-review   # verified | inferred | pending-review
  evidence:
    - description: Express app bootstrapped here
      ref: apps/api/src/server.ts     # path or URL
  verifiedAt: 2026-01-15
  verifiedRevision: 3f2c1ab
```

- Inferences must use `status: inferred` or `pending-review`, never `verified`.
- `status: verified` without `evidence`, `verifiedAt` or `verifiedRevision` produces a warning.

## Flows (`flows/<file>.yaml`)

```yaml
flow:
  id: flow-checkout
  kind: business            # execution | business | data | event
  name: Checkout
  participants: [customer, web-storefront, public-api]   # element IDs, at least one
  steps:
    - id: submit            # unique within the flow
      from: customer        # must be a participant
      to: web-storefront    # optional, must be a participant
      action: Submits the cart
      condition: ...
      result: ...
    - id: free
      type: decision        # start | task (default) | decision | wait | end
      from: web-storefront
      action: Is the item in stock?
      branches:             # only for decisions
        - { condition: "yes", next: pay }
        - { condition: "no", next: sorry }
    - { id: pay, from: web-storefront, action: Pays, next: done }   # next: default is the following step
    - { id: sorry, type: end, from: web-storefront, action: Shows "out of stock" }
    - { id: done, type: end, from: customer, action: Receives confirmation }
  metadata: { ... }         # optional, free-form
```

`next` and `branches[].next` must name steps of the same flow. A chain of
`next` that loops back without a decision is an error. Process diagrams draw one
lane per module of the participants.

## Decisions (`decisions.yaml`)

```yaml
decisions:
  - id: adr-postgres
    title: Use PostgreSQL for orders
    status: accepted        # proposed | accepted | superseded | deprecated
    date: 2026-01-10
    context: ...
    decision: ...
    consequences: ...
    relatedTo: [orders-db]  # element, relation, flow or decision IDs
    supersededBy: adr-other # decision ID
```

## Views (`views/<file>.yaml`)

Views hold presentation only, so moving a box never looks like an
architecture change. Membership of typed views is derived from the model;
`include`/`exclude` adjust it, and a `free` view shows only `include`.

```yaml
view:
  id: view-overview
  name: System overview
  type: overview      # overview | dependencies | sequence | deployment | data | business | free
  flow: flow-checkout # only for sequence and business views
  include: [orders-db]
  exclude: [customer]
  layout:
    public-api: { x: 440, y: 0, width: 160, height: 60 }
  styles:
    public-api: { color: "#1f6feb", shape: rounded, icon: server }
  metadata: { ... }   # optional, e.g. source information kept by an import
```

Shapes: rectangle, rounded, ellipse, cylinder, hexagon, document.
Icons: server, database, user, users, cloud, queue, lock, key, shield, globe,
mobile, gear, document, cache, mail, api, webhook, network, container, storage,
code, package, workflow, table, chart, cpu, layers, rocket.
Without `icon`, the UI shows the icon of the element's kind. Icons come from
Lucide (ISC license) and are shown in the UI; exports (SVG, PDF, Mermaid,
draw.io) do not include them.

## Logical deletion

Do not remove entries; mark them:

```yaml
lifecycle: deleted
deletedAt: 2026-02-01
deletedReason: Merged into billing-service.
```

Active relations and children may not point to a deleted element: delete them
too or restore the element. To restore, set `lifecycle: active` and remove the
deletion fields — the ID stays the same.

## Validation

```bash
archflow validate --repo <path> [--json]
```

Exit codes: `0` valid (warnings allowed), `1` invalid model, `2` usage or
repository access error. Validation is atomic: one error means no model is
produced, so a running Archflow keeps showing the last valid version.
Structural errors are reported first; reference checks run once every file is
structurally valid.
