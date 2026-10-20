import type { z } from 'zod';
import { formatPath, hasErrors, type Issue } from './issues.js';
import { isDeleted, type EntitySource, type EntityType, type Model } from './model.js';
import { parseModelFile, type ModelFile, type ParsedFile } from './parse.js';
import {
  SCHEMA_VERSION,
  decisionsFileSchema,
  elementsFileSchema,
  flowFileSchema,
  manifestSchema,
  overviewSchema,
  viewFileSchema,
  type Decision,
  type Element,
  type Flow,
  type Manifest,
  type Overview,
  type Relation,
  type View,
} from './schema.js';

export type ModelFileKind = 'manifest' | 'overview' | 'decisions' | 'flow' | 'view' | 'elements';

export interface ValidationResult {
  /** Present only when there are no errors: invalid input never yields a partial model. */
  model?: Model;
  issues: Issue[];
}

/**
 * Classifies a model file by its location (relative to the model directory).
 * Returns `null` for files that are not part of the model.
 */
export function classifyModelFile(path: string): ModelFileKind | null {
  if (!path.endsWith('.yaml')) return null;
  if (path.startsWith('history/')) return null;
  if (path === 'manifest.yaml') return 'manifest';
  if (path === 'overview.yaml') return 'overview';
  if (path === 'decisions.yaml') return 'decisions';
  if (path.startsWith('flows/')) return 'flow';
  if (path.startsWith('views/')) return 'view';
  return 'elements';
}

const FILE_SCHEMAS: Record<ModelFileKind, z.ZodType> = {
  manifest: manifestSchema,
  overview: overviewSchema,
  decisions: decisionsFileSchema,
  flow: flowFileSchema,
  view: viewFileSchema,
  elements: elementsFileSchema,
};

interface IndexedEntity {
  type: EntityType;
  entity: Element | Relation | Flow | Decision | View;
  source: EntitySource;
}

/**
 * Validates a complete set of model files. Validation is atomic: if any error
 * is found no model is returned, so callers keep their last valid version.
 */
export function validateModel(files: readonly ModelFile[]): ValidationResult {
  const issues: Issue[] = [];
  const parsedByPath = new Map<string, ParsedFile>();
  const typed: { kind: ModelFileKind; file: ParsedFile; value: unknown }[] = [];

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    if (file.path.startsWith('history/')) continue;
    const kind = classifyModelFile(file.path);
    if (kind === null) {
      issues.push({
        severity: 'warning',
        code: 'ignored-file',
        file: file.path,
        message: 'File is not part of the model and was ignored',
        hint: 'Model files must use the ".yaml" extension.',
      });
      continue;
    }
    const { parsed, issues: parseIssues } = parseModelFile(file);
    issues.push(...parseIssues);
    if (!parsed) continue;
    parsedByPath.set(file.path, parsed);

    if (parsed.data === null || parsed.data === undefined) {
      if (kind === 'manifest') {
        issues.push({ severity: 'error', code: 'schema', file: file.path, message: 'The manifest is empty' });
      } else {
        issues.push({ severity: 'warning', code: 'empty-file', file: file.path, message: 'File is empty and was ignored' });
      }
      continue;
    }

    if (kind === 'manifest') {
      const versionIssue = checkSchemaVersion(parsed);
      if (versionIssue) return { issues: [...issues, versionIssue] };
    }

    const result = FILE_SCHEMAS[kind].safeParse(parsed.data);
    if (result.success) typed.push({ kind, file: parsed, value: result.data });
    else issues.push(...convertZodIssues(result.error, parsed));
  }

  const manifestEntry = typed.find((t) => t.kind === 'manifest');
  if (!parsedByPath.has('manifest.yaml')) {
    issues.push({
      severity: 'error',
      code: 'missing-manifest',
      file: 'manifest.yaml',
      message: 'The model has no manifest',
      hint: `Create manifest.yaml with "schemaVersion: ${SCHEMA_VERSION}" and "project.name".`,
    });
  }

  // Referential checks on a structurally broken model would report false broken
  // references to entities defined in the files that failed; report those first.
  if (hasErrors(issues) || !manifestEntry) return { issues };

  const model: Model = {
    schemaVersion: SCHEMA_VERSION,
    manifest: manifestEntry.value as Manifest,
    elements: [],
    relations: [],
    flows: [],
    decisions: [],
    views: [],
    sources: {},
  };
  const index = new Map<string, IndexedEntity>();

  const register = (type: EntityType, entity: IndexedEntity['entity'], file: ParsedFile, path: (string | number)[]) => {
    const existing = index.get(entity.id);
    if (existing) {
      issues.push({
        severity: 'error',
        code: 'duplicate-id',
        ...loc(file, [...path, 'id']),
        message: `ID "${entity.id}" is already used by ${withArticle(existing.type)} in ${existing.source.file}`,
        hint: 'IDs are unique across elements, relations, flows, decisions and views. Keep the existing ID and remove or rename the duplicate.',
      });
      return;
    }
    const source: EntitySource = { type, file: file.path, path };
    index.set(entity.id, { type, entity, source });
    model.sources[entity.id] = source;
  };

  for (const { kind, file, value } of typed) {
    switch (kind) {
      case 'overview':
        model.overview = value as Overview;
        break;
      case 'elements': {
        const v = value as z.infer<typeof elementsFileSchema>;
        v.elements?.forEach((e, i) => {
          model.elements.push(e);
          register('element', e, file, ['elements', i]);
        });
        v.relations?.forEach((r, i) => {
          model.relations.push(r);
          register('relation', r, file, ['relations', i]);
        });
        break;
      }
      case 'flow': {
        const flow = (value as z.infer<typeof flowFileSchema>).flow;
        model.flows.push(flow);
        register('flow', flow, file, ['flow']);
        break;
      }
      case 'decisions':
        (value as z.infer<typeof decisionsFileSchema>).decisions.forEach((d, i) => {
          model.decisions.push(d);
          register('decision', d, file, ['decisions', i]);
        });
        break;
      case 'view': {
        const view = (value as z.infer<typeof viewFileSchema>).view;
        model.views.push(view);
        register('view', view, file, ['view']);
        break;
      }
      case 'manifest':
        break;
    }
  }

  const ctx = new RefContext(index, parsedByPath, issues);
  checkLifecycleFields(model, ctx);
  checkElements(model, ctx);
  checkRelations(model, ctx);
  checkFlows(model, ctx);
  checkDecisions(model, ctx);
  checkViews(model, ctx);
  checkOverview(model, ctx);
  checkProvenance(model, ctx);

  return hasErrors(issues) ? { issues } : { model, issues };
}

function checkSchemaVersion(parsed: ParsedFile): Issue | undefined {
  const data = parsed.data as { schemaVersion?: unknown };
  const version = typeof data === 'object' ? data.schemaVersion : undefined;
  if (typeof version !== 'number' || version === SCHEMA_VERSION) return undefined;
  return {
    severity: 'error',
    code: 'unsupported-schema-version',
    ...loc(parsed, ['schemaVersion']),
    path: 'schemaVersion',
    message:
      version > SCHEMA_VERSION
        ? `Schema version ${version} is newer than the supported version ${SCHEMA_VERSION}`
        : `Schema version ${version} is not supported and no migration to version ${SCHEMA_VERSION} exists`,
    hint:
      version > SCHEMA_VERSION
        ? 'Upgrade Archflow to open this model. The files were not modified.'
        : `Set "schemaVersion: ${SCHEMA_VERSION}" after reviewing docs/model-format.md.`,
  };
}

function loc(file: ParsedFile, path: readonly (string | number)[]): Pick<Issue, 'file' | 'path' | 'line' | 'column'> {
  const pos = file.locate(path);
  return { file: file.path, path: formatPath(path) || undefined, line: pos?.line, column: pos?.column };
}

function getAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = data;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function withArticle(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

function describeValue(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function convertZodIssues(error: z.ZodError, file: ParsedFile): Issue[] {
  const out: Issue[] = [];
  for (const issue of error.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          severity: 'error',
          code: 'schema',
          ...loc(file, [...path, key]),
          message: `Unknown field "${key}"`,
          hint: 'Check the spelling against docs/model-format.md. Free-form data belongs in "metadata" (elements and relations).',
        });
      }
      continue;
    }
    const last = path[path.length - 1];
    if (issue.code === 'invalid_type' && getAt(file.data, path) === undefined && last !== undefined) {
      out.push({
        severity: 'error',
        code: 'schema',
        ...loc(file, path),
        message: `Missing required field "${String(last)}"`,
        hint: `Expected ${issue.expected}.`,
      });
      continue;
    }
    if (issue.code === 'invalid_value') {
      out.push({
        severity: 'error',
        code: 'schema',
        ...loc(file, path),
        message: `Unsupported value ${describeValue(getAt(file.data, path))}`,
        hint: `Supported values: ${issue.values.map(String).join(', ')}.`,
      });
      continue;
    }
    if (issue.code === 'invalid_key') {
      out.push({
        severity: 'error',
        code: 'schema',
        ...loc(file, path),
        message: `Invalid key: ${issue.issues[0]?.message ?? issue.message}`,
      });
      continue;
    }
    out.push({ severity: 'error', code: 'schema', ...loc(file, path), message: issue.message });
  }
  return out;
}

class RefContext {
  constructor(
    readonly index: Map<string, IndexedEntity>,
    private readonly files: Map<string, ParsedFile>,
    readonly issues: Issue[],
  ) {}

  at(id: string, subpath: (string | number)[]): Pick<Issue, 'file' | 'path' | 'line' | 'column'> {
    const source = this.index.get(id)!.source;
    return loc(this.files.get(source.file)!, [...source.path, ...subpath]);
  }

  atFile(file: string, path: (string | number)[]) {
    return loc(this.files.get(file)!, path);
  }

  /**
   * Checks that `target` exists and is one of `allowed`. Returns the entity when
   * it is valid so callers can apply further checks.
   */
  ref(
    target: string,
    allowed: EntityType[],
    where: Pick<Issue, 'file' | 'path' | 'line' | 'column'>,
    what: string,
  ): IndexedEntity | undefined {
    const found = this.index.get(target);
    if (!found) {
      this.issues.push({
        severity: 'error',
        code: 'broken-reference',
        ...where,
        message: `${what} references "${target}", which does not exist`,
        hint: `Declare ${allowed.map(withArticle).join(' or ')} with ID "${target}" or fix the reference. References use IDs, not names.`,
      });
      return undefined;
    }
    if (!allowed.includes(found.type)) {
      this.issues.push({
        severity: 'error',
        code: 'invalid-reference-target',
        ...where,
        message: `${what} references "${target}", which is ${withArticle(found.type)} (expected ${allowed.map(withArticle).join(' or ')})`,
      });
      return undefined;
    }
    return found;
  }

  error(issue: Omit<Issue, 'severity'>) {
    this.issues.push({ severity: 'error', ...issue });
  }

  warn(issue: Omit<Issue, 'severity'>) {
    this.issues.push({ severity: 'warning', ...issue });
  }
}

type WithLifecycle = { id: string; lifecycle?: string | undefined; deletedAt?: string | undefined; deletedReason?: string | undefined };

function checkLifecycleFields(model: Model, ctx: RefContext) {
  const all: WithLifecycle[] = [...model.elements, ...model.relations, ...model.flows, ...model.decisions];
  for (const e of all) {
    if (!isDeleted(e) && (e.deletedAt || e.deletedReason)) {
      ctx.error({
        code: 'lifecycle',
        ...ctx.at(e.id, [e.deletedAt ? 'deletedAt' : 'deletedReason']),
        message: '"deletedAt" and "deletedReason" are only allowed when "lifecycle: deleted"',
        hint: 'Set "lifecycle: deleted", or remove the deletion fields if the entity was restored.',
      });
    }
  }
}

function checkElements(model: Model, ctx: RefContext) {
  const byId = new Map(model.elements.map((e) => [e.id, e]));

  for (const el of model.elements) {
    if (el.parent === undefined) continue;
    if (el.parent === el.id) {
      ctx.error({ code: 'parent-cycle', ...ctx.at(el.id, ['parent']), message: 'An element cannot contain itself' });
      continue;
    }
    const parent = ctx.ref(el.parent, ['element'], ctx.at(el.id, ['parent']), `Element "${el.id}" parent`);
    if (parent && isDeleted(parent.entity as Element) && !isDeleted(el)) {
      ctx.error({
        code: 'deleted-reference',
        ...ctx.at(el.id, ['parent']),
        message: `Active element "${el.id}" is contained in deleted element "${el.parent}"`,
        hint: 'Move the element to another parent, delete it too, or restore the parent.',
      });
    }
  }

  // Containment cycles (A → B → A). Each cycle is reported once.
  const reported = new Set<string>();
  for (const start of model.elements) {
    const chain: string[] = [];
    let cur: Element | undefined = start;
    while (cur?.parent !== undefined && cur.parent !== cur.id) {
      if (chain.includes(cur.id)) {
        const cycle = chain.slice(chain.indexOf(cur.id));
        const key = [...cycle].sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          ctx.error({
            code: 'parent-cycle',
            ...ctx.at(cur.id, ['parent']),
            message: `Containment cycle: ${[...cycle, cur.id].join(' → ')}`,
            hint: 'An element cannot be inside one of its own descendants.',
          });
        }
        break;
      }
      chain.push(cur.id);
      cur = byId.get(cur.parent);
    }
  }

  // Possible duplicates are flagged for review, never merged automatically.
  const seen = new Map<string, Element>();
  for (const el of model.elements) {
    if (isDeleted(el)) continue;
    const key = `${el.kind}:${el.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const first = seen.get(key);
    if (first) {
      ctx.warn({
        code: 'possible-duplicate',
        ...ctx.at(el.id, ['name']),
        message: `Element "${el.id}" has the same kind and name as "${first.id}"`,
        hint: 'If they are the same entity, keep one ID and update references; otherwise give them distinct names.',
      });
    } else {
      seen.set(key, el);
    }
  }
}

function checkRelations(model: Model, ctx: RefContext) {
  const seen = new Map<string, Relation>();
  for (const rel of model.relations) {
    for (const end of ['from', 'to'] as const) {
      const target = ctx.ref(rel[end], ['element'], ctx.at(rel.id, [end]), `Relation "${rel.id}" "${end}"`);
      if (target && isDeleted(target.entity as Element) && !isDeleted(rel)) {
        ctx.error({
          code: 'deleted-reference',
          ...ctx.at(rel.id, [end]),
          message: `Active relation "${rel.id}" points to deleted element "${rel[end]}"`,
          hint: 'Mark the relation as "lifecycle: deleted" too, or restore the element.',
        });
      }
    }
    if (isDeleted(rel)) continue;
    const key = `${rel.type}:${rel.from}:${rel.to}`;
    const first = seen.get(key);
    if (first) {
      ctx.warn({
        code: 'possible-duplicate',
        ...ctx.at(rel.id, ['type']),
        message: `Relation "${rel.id}" duplicates "${first.id}" (${rel.type} ${rel.from} → ${rel.to})`,
        hint: 'Keep a single relation unless they describe different facts.',
      });
    } else {
      seen.set(key, rel);
    }
  }
}

function checkFlows(model: Model, ctx: RefContext) {
  for (const flow of model.flows) {
    flow.participants.forEach((p, i) => {
      ctx.ref(p, ['element'], ctx.at(flow.id, ['participants', i]), `Flow "${flow.id}" participant`);
    });
    const participants = new Set(flow.participants);
    const stepIds = new Set<string>();
    flow.steps?.forEach((step, i) => {
      if (stepIds.has(step.id)) {
        ctx.error({
          code: 'duplicate-id',
          ...ctx.at(flow.id, ['steps', i, 'id']),
          message: `Step ID "${step.id}" is repeated in flow "${flow.id}"`,
        });
      }
      stepIds.add(step.id);
      for (const end of ['from', 'to'] as const) {
        const target = step[end];
        if (target !== undefined && !participants.has(target)) {
          ctx.error({
            code: 'broken-reference',
            ...ctx.at(flow.id, ['steps', i, end]),
            message: `Step "${step.id}" "${end}" references "${target}", which is not a participant of the flow`,
            hint: `Add "${target}" to "participants" or fix the step.`,
          });
        }
      }
    });
  }
}

function checkDecisions(model: Model, ctx: RefContext) {
  for (const d of model.decisions) {
    d.relatedTo?.forEach((id, i) => {
      ctx.ref(id, ['element', 'relation', 'flow', 'decision'], ctx.at(d.id, ['relatedTo', i]), `Decision "${d.id}"`);
    });
    if (d.supersededBy !== undefined) {
      ctx.ref(d.supersededBy, ['decision'], ctx.at(d.id, ['supersededBy']), `Decision "${d.id}" supersededBy`);
    }
  }
}

function checkViews(model: Model, ctx: RefContext) {
  for (const view of model.views) {
    if (view.flow !== undefined) {
      if (view.type !== 'sequence' && view.type !== 'business') {
        ctx.error({
          code: 'view-config',
          ...ctx.at(view.id, ['flow']),
          message: `"flow" only applies to sequence and business views, not "${view.type}"`,
        });
      } else {
        ctx.ref(view.flow, ['flow'], ctx.at(view.id, ['flow']), `View "${view.id}" flow`);
      }
    }
    for (const list of ['include', 'exclude'] as const) {
      view[list]?.forEach((id, i) => {
        ctx.ref(id, ['element'], ctx.at(view.id, [list, i]), `View "${view.id}" ${list}`);
      });
    }
    for (const map of ['layout', 'styles'] as const) {
      for (const id of Object.keys(view[map] ?? {})) {
        ctx.ref(id, ['element'], ctx.at(view.id, [map, id]), `View "${view.id}" ${map}`);
      }
    }
  }
}

function checkOverview(model: Model, ctx: RefContext) {
  model.overview?.keyElements?.forEach((id, i) => {
    ctx.ref(id, ['element', 'flow', 'view'], ctx.atFile('overview.yaml', ['keyElements', i]), 'Overview keyElements');
  });
}

function checkProvenance(model: Model, ctx: RefContext) {
  const all = [...model.elements, ...model.relations, ...model.flows, ...model.decisions];
  for (const e of all) {
    const p = e.provenance;
    if (p?.status === 'verified' && !p.evidence?.length && !p.verifiedAt && !p.verifiedRevision) {
      ctx.warn({
        code: 'missing-evidence',
        ...ctx.at(e.id, ['provenance', 'status']),
        message: `"${e.id}" is marked verified without evidence, date or revision`,
        hint: 'Add "evidence", "verifiedAt" or "verifiedRevision", or use "pending-review".',
      });
    }
  }
}
