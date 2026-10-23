/**
 * Native interchange format: the whole model in one JSON or YAML document,
 * preserving IDs, semantics, documentation, provenance, presentation and the
 * file each entity was defined in.
 */
import { stringify } from 'yaml';
import { isDeleted, type Model } from './model.js';
import { categoryOf, SCHEMA_VERSION, type Decision, type Element, type Flow, type Manifest, type Overview, type Relation, type View } from './schema.js';

export const BUNDLE_FORMAT = 'archflow-model';

export interface ModelBundle {
  format: typeof BUNDLE_FORMAT;
  schemaVersion: number;
  manifest: Manifest;
  overview?: Overview;
  elements: Element[];
  relations: Relation[];
  flows: Flow[];
  decisions: Decision[];
  views: View[];
  /** Entity ID → model-relative file it is stored in. */
  files?: Record<string, string>;
}

export function toBundle(model: Model): ModelBundle {
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: model.schemaVersion,
    manifest: model.manifest,
    ...(model.overview ? { overview: model.overview } : {}),
    elements: model.elements,
    relations: model.relations,
    flows: model.flows,
    decisions: model.decisions,
    views: model.views,
    files: Object.fromEntries(Object.entries(model.sources).map(([id, s]) => [id, s.file])),
  };
}

export function bundleToJson(bundle: ModelBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function bundleToYaml(bundle: ModelBundle): string {
  return stringify(bundle, { lineWidth: 0 });
}

const CATEGORY_FILES: Record<string, string> = {
  infrastructure: 'infrastructure.yaml',
  system: 'systems.yaml',
  internal: 'components.yaml',
  functional: 'components.yaml',
  behavior: 'components.yaml',
  data: 'data.yaml',
  business: 'business.yaml',
  documentation: 'documentation.yaml',
};

const SAFE_FILE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,5}[A-Za-z0-9][A-Za-z0-9._-]*\.yaml$/;

/** A requested file is used only if it is a safe path of the right kind; otherwise a default is chosen. */
function fileFor(requested: string | undefined, fallback: string, accept: (f: string) => boolean): string {
  return requested && SAFE_FILE.test(requested) && !requested.startsWith('history/') && accept(requested) ? requested : fallback;
}

const isElementsFile = (f: string) =>
  !['manifest.yaml', 'overview.yaml', 'decisions.yaml'].includes(f) && !f.startsWith('flows/') && !f.startsWith('views/');

/**
 * Serializes entities into the multi-file layout. Each entity goes to its
 * recorded file when valid, else to the default file for its type/category.
 */
export function entitiesToFiles(
  content: Omit<ModelBundle, 'format' | 'files'>,
  files: Record<string, string> = {},
): Map<string, string> {
  const out = new Map<string, string>();
  const yaml = (v: unknown) => stringify(v, { lineWidth: 0 });
  out.set('manifest.yaml', yaml({ schemaVersion: content.schemaVersion, project: content.manifest.project }));
  if (content.overview) out.set('overview.yaml', yaml(content.overview));

  const groups = new Map<string, { elements: Element[]; relations: Relation[] }>();
  const group = (file: string) => {
    let g = groups.get(file);
    if (!g) groups.set(file, (g = { elements: [], relations: [] }));
    return g;
  };
  const elementFile = new Map<string, string>();
  for (const e of content.elements) {
    let category = 'system';
    try {
      category = categoryOf(e.kind);
    } catch {
      /* unsupported kinds are reported by validation */
    }
    const file = fileFor(files[e.id], CATEGORY_FILES[category]!, isElementsFile);
    elementFile.set(e.id, file);
    group(file).elements.push(e);
  }
  for (const r of content.relations) {
    group(fileFor(files[r.id], elementFile.get(r.from) ?? 'systems.yaml', isElementsFile)).relations.push(r);
  }
  for (const [file, g] of groups) {
    out.set(file, yaml({ ...(g.elements.length ? { elements: g.elements } : {}), ...(g.relations.length ? { relations: g.relations } : {}) }));
  }

  const decisions = new Map<string, Decision[]>();
  for (const d of content.decisions) {
    const file = fileFor(files[d.id], 'decisions.yaml', (f) => f === 'decisions.yaml');
    decisions.set(file, [...(decisions.get(file) ?? []), d]);
  }
  for (const [file, list] of decisions) out.set(file, yaml({ decisions: list }));

  const single = (kind: 'flow' | 'view', list: { id: string }[], dir: string) => {
    for (const item of list) {
      let file = fileFor(files[item.id], `${dir}/${item.id}.yaml`, (f) => f.startsWith(`${dir}/`));
      for (let i = 2; out.has(file); i++) file = `${dir}/${item.id}-${i}.yaml`;
      out.set(file, yaml({ [kind]: item }));
    }
  };
  single('flow', content.flows, 'flows');
  single('view', content.views, 'views');
  return out;
}

export interface ImportSummary {
  added: string[];
  changed: string[];
  /** Entities that exist now but not in the import: kept, marked as deleted. */
  markedDeleted: string[];
  unchanged: number;
}

/**
 * Plans the replacement of the model by an imported bundle. Entities missing
 * from the import are not destroyed: they are kept and marked as deleted so
 * the change stays traceable and restorable.
 */
export function planReplace(current: Model, bundle: ModelBundle, sourceName: string, today: string): { files: Map<string, string>; summary: ImportSummary } {
  const summary: ImportSummary = { added: [], changed: [], markedDeleted: [], unchanged: 0 };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const merge = <T extends { id: string; lifecycle?: string; deletedAt?: string; deletedReason?: string }>(incoming: T[], existing: T[], deletable: boolean): T[] => {
    const ids = new Set(incoming.map((x) => x.id));
    const before = new Map(existing.map((x) => [x.id, x]));
    for (const x of incoming) {
      const old = before.get(x.id);
      if (!old) summary.added.push(x.id);
      else if (same(old, x)) summary.unchanged++;
      else summary.changed.push(x.id);
    }
    const kept: T[] = [];
    if (deletable) {
      for (const old of existing) {
        if (ids.has(old.id)) continue;
        if (isDeleted(old)) {
          kept.push(old);
          continue;
        }
        summary.markedDeleted.push(old.id);
        kept.push({ ...old, lifecycle: 'deleted', deletedAt: today, deletedReason: `Not present in import "${sourceName}"` });
      }
    }
    return [...incoming, ...kept];
  };
  const content = {
    schemaVersion: SCHEMA_VERSION,
    manifest: bundle.manifest,
    ...(bundle.overview ? { overview: bundle.overview } : {}),
    elements: merge(bundle.elements, current.elements, true),
    relations: merge(bundle.relations, current.relations, true),
    flows: merge(bundle.flows, current.flows, true),
    decisions: merge(bundle.decisions, current.decisions, true),
    // Views are presentation: the imported set replaces them (the old files stay in history).
    views: merge(bundle.views, current.views, false),
  };
  const files = { ...Object.fromEntries(Object.entries(current.sources).map(([id, s]) => [id, s.file])), ...(bundle.files ?? {}) };
  return { files: entitiesToFiles(content, files), summary };
}
