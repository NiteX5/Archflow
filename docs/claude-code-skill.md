# Claude Code skill

The skill teaches Claude Code to read, verify and update the Archflow model
together with code changes. It lives in [`skills/archflow/`](../skills/archflow):

- `SKILL.md` — the instructions (read overview first, explore the real code,
  reuse before creating, keep IDs stable, never invent, record provenance,
  validate, report).
- `reference.md` — the model format reference.

## Install into a repository

```bash
archflow skill install --repo /path/to/project
```

This copies both files to `/path/to/project/.claude/skills/archflow/`. Files
you modified locally are never overwritten unless you pass `--force`. Commit
them so every Claude Code session in the project uses the skill.

Claude Code loads the skill automatically when a task touches the
architecture; you can also ask for it explicitly ("use the archflow skill").

Without the `archflow` command on the PATH, Claude can still edit the model,
but it must report that validation was not run.

## Manual acceptance protocol

Automated tests cover the skill's presence, content and installation
(`tests/cli/skill.test.ts`). Its effect on an agent is checked manually with
these scenarios on a repository with a valid model (for example this one, whose
`.archflow/` was declared by Claude following the skill):

| Scenario | Prompt to Claude Code | Expected |
|----------|----------------------|----------|
| Add | "Add a module X that does Y and wire it into Z" | New element with a fresh ID (slug + suffix), `provenance.source: agent`, relations to existing IDs, `archflow validate` run, report lists model files changed. |
| Modify | "Rename component Z to W and move it to file F" | Same ID, new `name`/file; relations untouched; validation run. |
| Retire | "Remove module X" | `lifecycle: deleted` with `deletedAt`/`deletedReason`; its active relations deleted too; nothing removed from the files. |
| Uncertain | "Document how the payment retry works" (when the code does not show it) | Nothing invented: marked `inferred`/`pending-review` or added to `overview.yaml` `unknowns`, and reported. |
| Duplicate | Ask to add an element that already exists under another name | Claude reuses the existing ID or asks; no second entity. |
| Regenerate | "Regenerate the whole architecture diagram from the code" | Claude declines to rebuild wholesale and proposes targeted, evidence-backed updates. |

Record the outcome of each scenario when releasing a new version of the skill.
