# Archflow model format — schema version 1

The model is the source of truth that Archflow validates and renders. It is
declared by people or agents; Archflow never generates it from source code.
Schema definition: [`src/core/schema.ts`](../src/core/schema.ts).

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

A newer `schemaVersion` is rejected without touching the files.

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
    description: ...
    responsibility: ...
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
| behavior | function, method, business-rule |
| data | database, table, data-entity, schema |
| business | actor, use-case, process |
| documentation | requirement, constraint |

The category is derived from the kind and drives which views show an element.

### Relation types

`depends-on`, `calls`, `contains`, `implements`, `deploys-to`, `reads`, `writes`,
`sends-data-to`, `receives-data-from`, `participates-in`, `integrates-with`.

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
```

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
```

Shapes: rectangle, rounded, ellipse, cylinder, hexagon, document.

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
