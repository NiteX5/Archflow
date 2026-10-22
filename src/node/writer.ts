/**
 * Applies changes to the canonical model files.
 *
 * Every write follows the same path: start from the current files on disk
 * (re-read and valid), compute the complete new file set, validate it as a
 * whole, and only then write. Invalid results are rejected without touching
 * any file; each write is recorded in the history.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Document, isMap, isSeq, parseDocument, type Node as YamlNode } from 'yaml';
import { hashValue } from '../core/hash.js';
import { hasErrors, type Issue } from '../core/issues.js';
import { isDeleted, type EntityType, type Model } from '../core/model.js';
import type { Conflict, Op } from '../core/ops.js';
import { categoryOf, MODEL_DIR, type Element, type ElementCategory, type View, type ViewType } from '../core/schema.js';
import { classifyModelFile, validateModel } from '../core/validate.js';
import { BUILTIN_PREFIX } from '../core/views.js';
import type { FileChange, History, HistoryOrigin } from './history.js';
import { resolveInside } from './repo.js';
import { versionOf, type Workspace } from './workspace.js';

export class WriteError extends Error {
  constructor(
    readonly code: 'conflict' | 'invalid-result' | 'model-invalid' | 'invalid-operation' | 'no-repo',
    message: string,
    readonly conflicts: Conflict[] = [],
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = 'WriteError';
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Validates a model-relative file path chosen by a client. */
export function checkModelPath(file: string): string {
  const segments = file.split('/');
  if (!file.endsWith('.yaml') || segments.some((s) => !SAFE_SEGMENT.test(s)) || segments[0] === 'history' || segments.length > 6) {
    throw new WriteError('invalid-operation', `"${file}" is not a valid model file path`);
  }
  return file;
}

const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FILES: Record<ElementCategory, string> = {
  infrastructure: 'infrastructure.yaml',
  system: 'systems.yaml',
  internal: 'components.yaml',
  functional: 'components.yaml',
  behavior: 'components.yaml',
  data: 'data.yaml',
  business: 'business.yaml',
  documentation: 'documentation.yaml',
};

const cascadeReason = (id: string) => `Deleted together with element "${id}"`;

interface Located {
  type: EntityType;
  file: string;
  path: (string | number)[];
  value: Record<string, unknown>;
}

/** Mutable working copy of the model files for one request. */
class Draft {
  readonly docs = new Map<string, Document>();
  readonly removed = new Set<string>();
  readonly located = new Map<string, Located>();
  readonly createdViews: Record<string, string> = {};
  readonly conflicts: Conflict[] = [];
  readonly summary: string[] = [];

  constructor(
    readonly files: Map<string, string>,
    readonly model: Model,
  ) {
    const all: [EntityType, { id: string }[]][] = [
      ['element', model.elements],
      ['relation', model.relations],
      ['flow', model.flows],
      ['decision', model.decisions],
      ['view', model.views],
    ];
    for (const [type, list] of all) {
      for (const entity of list) {
        const src = model.sources[entity.id]!;
        this.located.set(entity.id, { type, file: src.file, path: src.path, value: structuredClone(entity) as Record<string, unknown> });
      }
    }
  }

  doc(file: string): Document {
    let doc = this.docs.get(file);
    if (!doc) {
      const content = this.removed.has(file) ? undefined : this.files.get(file);
      doc = content !== undefined ? parseDocument(content) : new Document({});
      if (doc.contents === null) doc.contents = doc.createNode({}) as never;
      this.docs.set(file, doc);
      this.removed.delete(file);
    }
    return doc;
  }

  exists(file: string): boolean {
    return (this.files.has(file) && !this.removed.has(file)) || this.docs.has(file);
  }

  get(id: string): Located {
    const found = this.located.get(id);
    if (!found) throw new WriteError('invalid-operation', `"${id}" does not exist`);
    return found;
  }

  /** Returns false (and records a conflict) when the entity is not as the client last saw it. */
  check(id: string, expected: string | undefined): boolean {
    if (expected === undefined) return true;
    const current = this.located.get(id);
    if (current && hashValue(current.value) === expected) return true;
    this.conflicts.push({
      id,
      message: current ? `"${id}" was changed by someone else since you loaded it` : `"${id}" no longer exists`,
      current: current ? structuredClone(current.value) : undefined,
    });
    return false;
  }

  set(id: string, key: string, value: unknown) {
    const loc = this.get(id);
    const doc = this.doc(loc.file);
    if (value === null || value === undefined) {
      doc.deleteIn([...loc.path, key]);
      delete loc.value[key];
    } else {
      doc.setIn([...loc.path, key], doc.createNode(value));
      loc.value[key] = structuredClone(value);
    }
  }

  /** Appends `value` to the sequence `key` of `file`, creating it when needed. */
  append(type: EntityType, file: string, key: string, value: Record<string, unknown>) {
    const doc = this.doc(file);
    const seq = doc.get(key, true) as YamlNode | undefined;
    let index = 0;
    if (seq && isSeq(seq)) {
      index = seq.items.length;
      seq.items.push(doc.createNode(value) as never);
    } else if (seq === undefined || seq === null) {
      doc.set(key, doc.createNode([value]));
    } else {
      throw new WriteError('invalid-operation', `"${key}" in ${file} is not a list`);
    }
    this.located.set(value.id as string, { type, file, path: [key, index], value: structuredClone(value) });
  }

  putSingle(type: 'flow' | 'view', file: string, value: Record<string, unknown>) {
    if (this.exists(file)) throw new WriteError('invalid-operation', `${file} already exists`);
    const doc = new Document({ [type]: value });
    this.docs.set(file, doc);
    this.located.set(value.id as string, { type, file, path: [type], value: structuredClone(value) });
  }

  remove(file: string) {
    this.docs.delete(file);
    this.removed.add(file);
  }

  /** The complete new file set. */
  result(): Map<string, string> {
    const out = new Map(this.files);
    for (const f of this.removed) out.delete(f);
    for (const [file, doc] of this.docs) out.set(file, doc.toString({ lineWidth: 0 }));
    return out;
  }
}

function entityValue(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.id !== 'string') throw new WriteError('invalid-operation', 'New entities need an "id"');
  return value;
}

function uniqueViewId(draft: Draft, base: string): string {
  let id = base;
  for (let i = 2; draft.located.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Resolves a view for presentation edits, creating a file for a built-in view on first edit. */
function resolveView(draft: Draft, viewId: string): string {
  if (!viewId.startsWith(BUILTIN_PREFIX)) {
    const loc = draft.get(viewId);
    if (loc.type !== 'view') throw new WriteError('invalid-operation', `"${viewId}" is not a view`);
    return viewId;
  }
  if (draft.createdViews[viewId]) return draft.createdViews[viewId]!;
  const rest = viewId.slice(BUILTIN_PREFIX.length);
  const [type, flow] = rest.split(':') as [ViewType, string | undefined];
  const names: Record<string, string> = {
    overview: 'Architecture overview',
    dependencies: 'Dependencies',
    deployment: 'Infrastructure & deployment',
    data: 'Data & databases',
    business: 'Business flows',
  };
  if (!(type in names) && !(type === 'sequence' && flow)) throw new WriteError('invalid-operation', `Unknown built-in view "${viewId}"`);
  const flowName = flow ? (draft.located.get(flow)?.value.name as string | undefined) : undefined;
  const id = uniqueViewId(draft, flow ? `view-${flow}-sequence` : `view-${type}`);
  const view: View = flow
    ? { id, name: `${flowName ?? flow} (sequence)`, type: 'sequence', flow }
    : { id, name: names[type]!, type };
  let file = `views/${id}.yaml`;
  for (let i = 2; draft.exists(file); i++) file = `views/${id}-${i}.yaml`;
  draft.putSingle('view', file, view as unknown as Record<string, unknown>);
  draft.createdViews[viewId] = id;
  draft.summary.push(`created view "${id}"`);
  return id;
}

function applyOp(draft: Draft, op: Op): void {
  switch (op.op) {
    case 'create': {
      const value = entityValue(op.value);
      const id = value.id as string;
      if (draft.located.has(id)) {
        draft.conflicts.push({ id, message: `ID "${id}" is already in use`, current: structuredClone(draft.located.get(id)!.value) });
        return;
      }
      if (op.file !== undefined) {
        checkModelPath(op.file);
        const expectedKind = { element: 'elements', relation: 'elements', decision: 'decisions', flow: 'flow', view: 'view' }[op.entity];
        if (classifyModelFile(op.file) !== expectedKind) {
          throw new WriteError('invalid-operation', `A ${op.entity} cannot be stored in ${op.file}`);
        }
      }
      switch (op.entity) {
        case 'element': {
          const parent = typeof value.parent === 'string' ? draft.located.get(value.parent) : undefined;
          let file = op.file ?? parent?.file;
          if (!file) {
            const category = (() => {
              try {
                return categoryOf(value.kind as Element['kind']);
              } catch {
                return 'system' as const; // invalid kinds are reported by validation below
              }
            })();
            file = DEFAULT_FILES[category];
          }
          draft.append('element', file, 'elements', value);
          break;
        }
        case 'relation': {
          const from = typeof value.from === 'string' ? draft.located.get(value.from) : undefined;
          draft.append('relation', op.file ?? (from?.type === 'element' ? from.file : 'systems.yaml'), 'relations', value);
          break;
        }
        case 'decision':
          draft.append('decision', op.file ?? 'decisions.yaml', 'decisions', value);
          break;
        case 'flow':
          draft.putSingle('flow', op.file ?? `flows/${id}.yaml`, value);
          break;
        case 'view':
          draft.putSingle('view', op.file ?? `views/${id}.yaml`, value);
          break;
      }
      draft.summary.push(`created ${op.entity} "${id}"`);
      return;
    }
    case 'update': {
      const id = op.id.startsWith(BUILTIN_PREFIX) ? resolveView(draft, op.id) : op.id;
      if (!draft.check(id, op.expected)) return;
      if ('id' in op.set) throw new WriteError('invalid-operation', 'IDs are stable and cannot be changed');
      for (const [key, value] of Object.entries(op.set)) draft.set(id, key, value);
      draft.summary.push(`updated "${id}"`);
      return;
    }
    case 'delete': {
      if (!draft.check(op.id, op.expected)) return;
      const loc = draft.get(op.id);
      if (loc.type === 'view') {
        draft.remove(loc.file);
        draft.located.delete(op.id);
        draft.summary.push(`removed view "${op.id}"`);
        return;
      }
      if (isDeleted(loc.value)) return;
      if (loc.type === 'element') {
        const activeChildren = [...draft.located.values()].filter(
          (l) => l.type === 'element' && l.value.parent === op.id && !isDeleted(l.value),
        );
        if (activeChildren.length > 0) {
          throw new WriteError(
            'invalid-operation',
            `"${op.id}" contains active elements (${activeChildren.map((c) => c.value.id).join(', ')}). Move or delete them first.`,
          );
        }
        // Active relations are deleted with the element so the model stays consistent; restoring brings them back.
        for (const l of [...draft.located.values()]) {
          if (l.type === 'relation' && !isDeleted(l.value) && (l.value.from === op.id || l.value.to === op.id)) {
            const rid = l.value.id as string;
            draft.set(rid, 'lifecycle', 'deleted');
            draft.set(rid, 'deletedAt', today());
            draft.set(rid, 'deletedReason', cascadeReason(op.id));
          }
        }
      }
      draft.set(op.id, 'lifecycle', 'deleted');
      draft.set(op.id, 'deletedAt', today());
      if (op.reason) draft.set(op.id, 'deletedReason', op.reason);
      draft.summary.push(`deleted ${loc.type} "${op.id}"`);
      return;
    }
    case 'restore': {
      if (!draft.check(op.id, op.expected)) return;
      const loc = draft.get(op.id);
      if (!isDeleted(loc.value)) return;
      for (const key of ['lifecycle', 'deletedAt', 'deletedReason']) draft.set(op.id, key, null);
      if (loc.type === 'element') {
        const active = (id: unknown) => {
          const l = draft.located.get(id as string);
          return !!l && !isDeleted(l.value);
        };
        for (const l of [...draft.located.values()]) {
          if (l.type === 'relation' && l.value.deletedReason === cascadeReason(op.id) && active(l.value.from) && active(l.value.to)) {
            for (const key of ['lifecycle', 'deletedAt', 'deletedReason']) draft.set(l.value.id as string, key, null);
          }
        }
      }
      draft.summary.push(`restored ${loc.type} "${op.id}"`);
      return;
    }
    case 'layout': {
      const viewId = resolveView(draft, op.view);
      const loc = draft.get(viewId);
      const doc = draft.doc(loc.file);
      const layout = (loc.value.layout ?? {}) as Record<string, unknown>;
      for (const [el, entry] of Object.entries(op.entries)) {
        const exp = op.expected?.[el];
        if (exp !== undefined && hashValue(layout[el] ?? null) !== exp) {
          draft.conflicts.push({ id: `${viewId}/${el}`, message: `The position of "${el}" in "${viewId}" was changed by someone else`, current: structuredClone(layout[el]) });
          continue;
        }
        if (entry === null) {
          doc.deleteIn([...loc.path, 'layout', el]);
          delete layout[el];
        } else {
          const node = doc.createNode(entry, { flow: true });
          if (!isMap(doc.getIn([...loc.path, 'layout'], true))) doc.setIn([...loc.path, 'layout'], doc.createNode({}));
          doc.setIn([...loc.path, 'layout', el], node);
          layout[el] = entry;
        }
      }
      loc.value.layout = layout;
      draft.summary.push(`moved ${Object.keys(op.entries).length} element(s) in "${viewId}"`);
      return;
    }
    case 'style': {
      const viewId = resolveView(draft, op.view);
      const loc = draft.get(viewId);
      const doc = draft.doc(loc.file);
      const styles = (loc.value.styles ?? {}) as Record<string, unknown>;
      if (op.expected !== undefined && hashValue(styles[op.element] ?? null) !== op.expected) {
        draft.conflicts.push({ id: `${viewId}/${op.element}`, message: `The style of "${op.element}" in "${viewId}" was changed by someone else`, current: structuredClone(styles[op.element]) });
        return;
      }
      if (op.style === null || Object.keys(op.style).length === 0) {
        doc.deleteIn([...loc.path, 'styles', op.element]);
        delete styles[op.element];
      } else {
        if (!isMap(doc.getIn([...loc.path, 'styles'], true))) doc.setIn([...loc.path, 'styles'], doc.createNode({}));
        doc.setIn([...loc.path, 'styles', op.element], doc.createNode(op.style, { flow: true }));
        styles[op.element] = op.style;
      }
      loc.value.styles = styles;
      draft.summary.push(`styled "${op.element}" in "${viewId}"`);
      return;
    }
  }
}

/** Writes a file atomically: temporary dotfile in the same directory (ignored by the reader), then rename. */
async function atomicWrite(full: string, content: string): Promise<void> {
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, full);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Writes the difference between two complete file sets atomically per file and
 * records it in the history. Callers validate `next` before calling this.
 */
export async function writeFileSet(
  root: string,
  history: History,
  before: Map<string, string>,
  next: Map<string, string>,
  origin: HistoryOrigin,
  summary: string,
): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  for (const file of new Set([...before.keys(), ...next.keys()])) {
    const b = before.get(file) ?? null;
    const a = next.get(file) ?? null;
    if (b !== a) changes.push({ file, before: b, after: a });
  }
  for (const c of changes) {
    const full = resolveInside(root, `${MODEL_DIR}/${checkModelPath(c.file)}`);
    if (c.after === null) await rm(full, { force: true });
    else await atomicWrite(full, c.after);
  }
  await history.record(origin, summary, changes);
  return changes;
}

/**
 * Validates and writes a complete new file set. Must run inside `workspace.exclusive`
 * after the workspace was reloaded from disk.
 */
export async function commitFiles(
  workspace: Workspace,
  history: History,
  next: Map<string, string>,
  origin: HistoryOrigin,
  summary: string,
): Promise<void> {
  const root = workspace.root;
  const snapshot = workspace.snapshot;
  if (!root || !snapshot) throw new WriteError('no-repo', 'No valid model is loaded');
  const result = validateModel([...next].map(([p, content]) => ({ path: p, content })));
  if (!result.model || hasErrors(result.issues)) {
    throw new WriteError('invalid-result', 'The change would make the model invalid; nothing was written.', [], result.issues);
  }
  const changes = await writeFileSet(root, history, snapshot.files, next, origin, summary);
  if (changes.length === 0) return;
  workspace.commitSnapshot({ files: next, model: result.model, version: versionOf(next), at: new Date().toISOString() }, result.issues);
}

/** Re-reads the model and requires it to be valid before any write. Must run inside `exclusive`. */
export async function freshValidSnapshot(workspace: Workspace) {
  if (!workspace.root) throw new WriteError('no-repo', 'No repository is open');
  const state = await workspace.reloadUnlocked();
  if (state.status !== 'valid' || !workspace.snapshot) {
    throw new WriteError(
      'model-invalid',
      state.status === 'no-model'
        ? 'The repository has no model yet'
        : 'The model files on disk are invalid. Fix them (see the listed errors) before editing, so no change is lost.',
      [],
      state.issues,
    );
  }
  return workspace.snapshot;
}

export async function applyOps(workspace: Workspace, history: History, ops: Op[]): Promise<Record<string, string>> {
  return workspace.exclusive(async () => {
    const snapshot = await freshValidSnapshot(workspace);
    const draft = new Draft(snapshot.files, snapshot.model);
    for (const op of ops) applyOp(draft, op);
    if (draft.conflicts.length > 0) {
      throw new WriteError('conflict', 'Some elements changed since you loaded them; nothing was written.', draft.conflicts);
    }
    await commitFiles(workspace, history, draft.result(), 'ui', draft.summary.join('; '));
    return draft.createdViews;
  });
}
