---
name: archflow
description: Read, verify and update the Archflow architecture model in .archflow/ together with code changes. Use when a task touches architecture, components, dependencies, data, infrastructure, flows or architecture decisions, when the user asks about the system's architecture, or when asked to document or update the architecture map.
---

# Archflow architecture model

The repository's architecture is declared in `.archflow/` as YAML files
(schema documented in `reference.md` next to this file). Archflow, a local
tool, validates the model and renders it as diagrams. **You declare the model;
Archflow never generates it from code, and neither should you rebuild it
wholesale.** Your job is to keep it truthful and in sync with the code you
change.

## 1. Read before acting (cheap first, expand when needed)

1. Read `.archflow/manifest.yaml` and `.archflow/overview.yaml` first.
2. Identify the elements, relations and flows relevant to the task. Find them
   by ID, name or code path, e.g. `grep -rn "<id or path>" .archflow --include=*.yaml`.
3. Read only the files that define them (`systems.yaml`, `components/*.yaml`,
   `data.yaml`, `infrastructure.yaml`, `flows/*.yaml`, `decisions.yaml`), and
   follow their references (`parent`, `from`/`to`, `participants`,
   `relatedTo`) as far as the task requires.
4. Read the whole model when the change is cross-cutting (new system,
   restructuring, infrastructure moves). Never skip a critical dependency just
   to save tokens.
5. Never read `.archflow/history/`; it is Archflow's change log, not the model.

## 2. Explore the real code before implementing

- The model can be outdated. Check the code paths referenced by the relevant
  elements (`code:`) before trusting them.
- Search for existing modules, components and functionality to reuse before
  creating new ones. Prefer extending what exists, and say what you reused.
- When the task touches architecture, dependencies, routes, persistence,
  infrastructure or business rules, compare the model with the code and note
  every discrepancy you find.

## 3. Update the model in the same task as the code

Update `.archflow/` whenever you add, remove, rename or move components,
change dependencies or data access, change infrastructure, change a flow or
business rule, or make an architecture decision. Rules:

- **Keep IDs stable.** Renaming or moving an element changes `name` or its
  file, never its `id`. Relations, flows and views refer to IDs.
- **Check for an existing entity before declaring one.** Search by name, kind
  and code path. Never declare a second entity for the same thing; if you are
  unsure whether two entities are the same, ask or report it.
- **New IDs:** lowercase slug plus a short random suffix, e.g.
  `billing-service-k3f9`. Never derive an ID only from a name or path.
- **Do not invent.** Only declare elements, relations, rules and
  explanations you can support with evidence (code, configuration, docs, or an
  explicit statement from the user). Leave unknown fields out; never fill them
  with plausible guesses. Add known gaps to `overview.yaml` `unknowns`.
- **Record provenance** on what you declare or change:
  ```yaml
  provenance:
    source: agent                 # you declared it
    status: verified              # only if you checked it in the code now
    evidence:
      - description: Imports OrdersRepository
        ref: src/orders/service.ts
    verifiedRevision: <git short sha, if known>
  ```
  Use `status: inferred` or `status: pending-review` for anything you could
  not confirm (e.g. derived from naming, partial reading, or dynamic code).
  An inference must never be marked `verified`.
- **Delete logically.** Set `lifecycle: deleted`, `deletedAt` and
  `deletedReason` instead of removing entries, and mark the element's active
  relations as deleted too. Restore by removing those fields; keep the ID.
- **Presentation is separate.** Do not touch `views/*.yaml` layout or styles
  unless asked; new elements appear in the derived views automatically.
- Keep YAML readable and diff-friendly: one entity per list item, block style,
  no reformatting of unrelated entries.

## 4. Validate

Run the validator after editing the model:

```bash
archflow validate --repo .
```

Fix every error. Exit code `0` = valid, `1` = invalid model, `2` = usage or
path problem. If the `archflow` command is not available, say so explicitly
in your report: the model is **not validated** in that case. Do not claim it
is valid.

A running Archflow UI reloads automatically after you save valid files and
keeps showing the last valid version while files are invalid.

## 5. Never

- Never regenerate the whole model or all diagrams from the code.
- Never ask Archflow (or another tool) to build the architecture automatically.
- Never change IDs, delete history, or remove entries to make validation pass.
- Never present inferred relations as verified.
- Never copy secrets, credentials or environment values into the model.

## 6. Report at the end of the task

Always include:

1. Code files changed.
2. Model files changed, and which elements/relations/flows were added,
   changed, deleted or restored (by ID).
3. Validation run and its result (or that it could not be run).
4. Discrepancies found between model and code, and anything left as
   `inferred`, `pending-review` or unknown that a person should review.
