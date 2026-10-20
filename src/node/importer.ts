/**
 * Import planning. Nothing is written here: a plan is the complete new file
 * set plus a summary, warnings and validation issues, shown to the user for
 * review before it is applied.
 *
 * - Native JSON/YAML replaces the model; entities missing from the import are
 *   kept and marked as deleted.
 * - Mermaid and draw.io are merged in: new elements go to `imported/<name>.yaml`
 *   with `pending-review` provenance, plus a free view (or a flow).
 */
import { parse as parseYaml, stringify } from 'yaml';
import { DiagramParseError, type DiagramImport } from '../core/diagram.js';
import { BUNDLE_FORMAT, planReplace, type ImportSummary, type ModelBundle } from '../core/interchange.js';
import { hasErrors, type Issue } from '../core/issues.js';
import { isDeleted, type Model } from '../core/model.js';
import { suggestId } from '../core/ops.js';
import { parseMermaid } from '../core/mermaid.js';
import { SCHEMA_VERSION, RELATION_TYPES, type Element, type ElementKind, type Flow, type Relation, type RelationType, type View } from '../core/schema.js';
import { validateModel } from '../core/validate.js';
import { parseDrawio } from './drawio-import.js';

export const IMPORT_FORMATS = ['archflow-json', 'archflow-yaml', 'mermaid', 'drawio'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export interface ImportPreview {
  format: ImportFormat;
  mode: 'replace' | 'merge';
  summary: ImportSummary & { reused: string[] };
  warnings: string[];
  /** Validation issues of the resulting model; the import cannot be applied with errors. */
  issues: Issue[];
  valid: boolean;
  /** Files that would be created, changed or removed. */
  files: { file: string; change: 'created' | 'changed' | 'removed' }[];
  /** Version of the model the plan was computed against. */
  baseVersion: string;
}

export class ImportError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, 40) || 'import';

function parseBundle(content: string, format: 'archflow-json' | 'archflow-yaml'): ModelBundle {
  let data: unknown;
  try {
    data = format === 'archflow-json' ? JSON.parse(content) : parseYaml(content, { schema: 'core' });
  } catch (err) {
    throw new ImportError(`The file is not valid ${format === 'archflow-json' ? 'JSON' : 'YAML'}: ${err instanceof Error ? err.message.split('\n')[0] : ''}`);
  }
  const b = data as Partial<ModelBundle> | null;
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) {
    throw new ImportError(`This is not an Archflow model export (expected "format: ${BUNDLE_FORMAT}").`);
  }
  if (b.schemaVersion !== SCHEMA_VERSION) {
    throw new ImportError(`The export uses schema version ${String(b.schemaVersion)}; this Archflow supports version ${SCHEMA_VERSION}.`);
  }
  const list = <T>(v: unknown, name: string): T[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new ImportError(`"${name}" must be a list.`);
    return v as T[];
  };
  if (!b.manifest || typeof b.manifest !== 'object') throw new ImportError('The export has no manifest.');
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    manifest: b.manifest,
    ...(b.overview ? { overview: b.overview } : {}),
    elements: list(b.elements, 'elements'),
    relations: list(b.relations, 'relations'),
    flows: list(b.flows, 'flows'),
    decisions: list(b.decisions, 'decisions'),
    views: list(b.views, 'views'),
    ...(b.files && typeof b.files === 'object' ? { files: b.files } : {}),
  };
}

/** Converts a parsed diagram into new model files merged with the current model. */
function planDiagram(model: Model, files: Map<string, string>, diagram: DiagramImport, fileName: string) {
  const warnings = [...diagram.warnings];
  const taken = new Set(Object.keys(model.sources));
  const newId = (base: string) => {
    const id = suggestId(base, (x) => taken.has(x));
    taken.add(id);
    return id;
  };
  const active = model.elements.filter((e) => !isDeleted(e));
  const byName = new Map(active.map((e) => [e.name.trim().toLowerCase(), e]));
  const byId = new Map(active.map((e) => [e.id, e]));
  const provenance = {
    source: 'tool-inferred' as const,
    status: 'pending-review' as const,
    evidence: [{ description: `Imported from ${fileName}`, ref: fileName }],
  };
  const summary: ImportSummary & { reused: string[] } = { added: [], changed: [], markedDeleted: [], unchanged: 0, reused: [] };
  const elements: Element[] = [];
  const relations: Relation[] = [];
  const map = new Map<string, string>(); // source id → element id
  const defaulted: string[] = [];

  /** Existing element with the same ID (Archflow exports) or the same name: reused, never duplicated. */
  const match = (sourceId: string, label: string): Element | undefined => {
    const fromCell = sourceId.startsWith('n-') ? byId.get(sourceId.slice(2)) : undefined;
    return fromCell ?? byId.get(sourceId) ?? byName.get(label.trim().toLowerCase());
  };
  const addElement = (sourceId: string, label: string, kindHint: ElementKind | undefined, shape: string | undefined) => {
    const existing = match(sourceId, label);
    if (existing) {
      map.set(sourceId, existing.id);
      summary.reused.push(existing.id);
      return;
    }
    const id = newId(label);
    map.set(sourceId, id);
    if (!kindHint) defaulted.push(label);
    elements.push({
      id,
      kind: kindHint ?? 'component',
      name: label,
      provenance,
      metadata: { importedFrom: fileName, sourceId, ...(shape ? { sourceShape: shape } : {}), ...(kindHint ? {} : { kindAssumed: true }) },
    });
    summary.added.push(id);
  };

  const viewName = diagram.title || fileName;
  const base = slug(fileName);
  let elementsFile = `imported/${base}.yaml`;
  for (let i = 2; files.has(elementsFile); i++) elementsFile = `imported/${base}-${i}.yaml`;
  const next = new Map(files);

  if (diagram.kind === 'sequence') {
    const seq = diagram.sequence!;
    for (const p of seq.participants) addElement(p.sourceId, p.label, p.actor ? 'actor' : undefined, undefined);
    const flowId = newId(`flow-${base}`);
    const flow: Flow = {
      id: flowId,
      kind: 'execution',
      name: viewName,
      participants: seq.participants.map((p) => map.get(p.sourceId)!),
      steps: seq.steps.map((s, i) => ({
        id: `step-${i + 1}`,
        from: map.get(s.from)!,
        to: map.get(s.to)!,
        action: s.label,
        ...(s.condition ? { condition: s.condition } : {}),
      })),
      provenance,
      metadata: { importedFrom: fileName, ...(diagram.unconverted.length ? { unconverted: diagram.unconverted } : {}) },
    };
    summary.added.push(flowId);
    let flowFile = `flows/${flowId}.yaml`;
    for (let i = 2; next.has(flowFile); i++) flowFile = `flows/${flowId}-${i}.yaml`;
    next.set(flowFile, stringify({ flow }, { lineWidth: 0 }));
  } else {
    for (const n of diagram.nodes) addElement(n.sourceId, n.label, n.kindHint, n.shape);
    // Parents only for new elements: existing elements keep their declared containment.
    for (const n of diagram.nodes) {
      const el = elements.find((e) => e.id === map.get(n.sourceId));
      if (el && n.parent && map.has(n.parent)) el.parent = map.get(n.parent)!;
    }
    const nonType: string[] = [];
    for (const e of diagram.edges) {
      const from = map.get(e.from);
      const to = map.get(e.to);
      if (!from || !to) continue;
      const labelText = e.label?.trim().toLowerCase().replace(/\s+/g, '-');
      const type = (RELATION_TYPES as readonly string[]).includes(labelText ?? '') ? (labelText as RelationType) : 'depends-on';
      if (type === 'depends-on' && labelText !== 'depends-on') nonType.push(e.label ?? '(no label)');
      const duplicate = model.relations.some((r) => !isDeleted(r) && r.from === from && r.to === to && r.type === type);
      if (duplicate) continue;
      const id = newId(`rel-${from}`);
      relations.push({
        id,
        type,
        from,
        to,
        ...(e.label && type === 'depends-on' && labelText !== 'depends-on' ? { description: e.label } : {}),
        provenance,
        metadata: { importedFrom: fileName, ...(e.label ? { sourceLabel: e.label } : {}) },
      });
      summary.added.push(id);
    }
    if (nonType.length) {
      warnings.push(`${nonType.length} connection(s) had no Archflow relation type as label; they were imported as "depends-on" with the original label kept: ${[...new Set(nonType)].slice(0, 5).join(', ')}${nonType.length > 5 ? '…' : ''}.`);
    }
    const viewId = newId(`view-${base}`);
    const layout: NonNullable<View['layout']> = {};
    for (const n of diagram.nodes) {
      const id = map.get(n.sourceId);
      if (id && n.box) layout[id] = { x: Math.round(n.box.x), y: Math.round(n.box.y), width: Math.round(n.box.width), height: Math.round(n.box.height) };
    }
    const view: View = {
      id: viewId,
      name: viewName,
      type: 'free',
      include: [...new Set(diagram.nodes.map((n) => map.get(n.sourceId)!).filter(Boolean))],
      ...(Object.keys(layout).length ? { layout } : {}),
      metadata: { importedFrom: fileName, ...(diagram.unconverted.length ? { unconverted: diagram.unconverted } : {}) },
    };
    summary.added.push(viewId);
    next.set(`views/${viewId}.yaml`, stringify({ view }, { lineWidth: 0 }));
  }
  if (elements.length || relations.length) {
    next.set(elementsFile, stringify({ ...(elements.length ? { elements } : {}), ...(relations.length ? { relations } : {}) }, { lineWidth: 0 }));
  }
  if (summary.reused.length) {
    warnings.push(`${summary.reused.length} shape(s) matched existing elements by ID or name and were linked instead of duplicated: ${summary.reused.slice(0, 8).join(', ')}${summary.reused.length > 8 ? '…' : ''}. Review the matches.`);
  }
  if (defaulted.length) {
    warnings.push(`The diagram does not say what kind of element ${defaulted.length} shape(s) are; they were created as "component" and marked for review: ${defaulted.slice(0, 5).join(', ')}${defaulted.length > 5 ? '…' : ''}.`);
  }
  warnings.push('All imported elements and relations are marked "pending-review": a diagram is not evidence that they exist in the code.');
  return { next, summary, warnings };
}

export function planImport(
  snapshot: { model: Model; files: Map<string, string>; version: string },
  format: ImportFormat,
  content: string,
  fileName: string,
): { next: Map<string, string>; preview: ImportPreview } {
  let next: Map<string, string>;
  let summary: ImportPreview['summary'];
  let warnings: string[] = [];
  let mode: ImportPreview['mode'];
  try {
    if (format === 'archflow-json' || format === 'archflow-yaml') {
      mode = 'replace';
      const plan = planReplace(snapshot.model, parseBundle(content, format), fileName, today());
      // History files are not part of the model and stay untouched.
      next = plan.files;
      summary = { ...plan.summary, reused: [] };
      if (plan.summary.markedDeleted.length) {
        warnings.push(`${plan.summary.markedDeleted.length} entities are not in the import; they are kept and marked as deleted (restorable).`);
      }
      warnings.push('Model files are rewritten from the import, so YAML comments in them are not preserved (the previous files stay in history).');
    } else {
      mode = 'merge';
      const diagram = format === 'mermaid' ? parseMermaid(content) : parseDrawio(content);
      const plan = planDiagram(snapshot.model, snapshot.files, diagram, fileName);
      next = plan.next;
      summary = plan.summary;
      warnings = plan.warnings;
    }
  } catch (err) {
    if (err instanceof DiagramParseError) throw new ImportError(err.message);
    throw err;
  }
  const result = validateModel([...next].map(([path, c]) => ({ path, content: c })));
  const changes: ImportPreview['files'] = [];
  for (const file of new Set([...snapshot.files.keys(), ...next.keys()])) {
    const before = snapshot.files.get(file);
    const after = next.get(file);
    if (before === after) continue;
    changes.push({ file, change: before === undefined ? 'created' : after === undefined ? 'removed' : 'changed' });
  }
  return {
    next,
    preview: {
      format,
      mode,
      summary,
      warnings,
      issues: result.issues,
      valid: !!result.model && !hasErrors(result.issues),
      files: changes,
      baseVersion: snapshot.version,
    },
  };
}
