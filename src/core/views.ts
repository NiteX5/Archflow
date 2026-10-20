/**
 * Views are presentations of the declared model. Their content is derived from
 * the model here; nothing is inferred from source code and nothing is invented:
 * when the model lacks information, the view reports it as incomplete.
 */
import { isDeleted, type Model } from './model.js';
import {
  categoryOf,
  type Element,
  type ElementCategory,
  type Flow,
  type Relation,
  type RelationType,
  type View,
  type ViewType,
} from './schema.js';

export interface DerivedNode {
  id: string;
  element: Element;
  /** Nearest ancestor that is also in the view (for grouping). */
  parentInView?: string;
}

export interface DerivedEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  relation?: Relation;
  /** For flow-based views: the step this edge represents and its order (1-based). */
  step?: { id: string; order: number };
}

export interface DerivedView {
  view: View;
  /** True for views Archflow offers by default that have no file yet. */
  builtin: boolean;
  nodes: DerivedNode[];
  edges: DerivedEdge[];
  flow?: Flow;
  /** Human-readable reasons why the view is empty or incomplete. */
  incomplete: string[];
}

interface ViewRule {
  categories: ElementCategory[];
  /** Relation types shown; `undefined` means all. */
  relationTypes?: RelationType[];
  /** Also include elements connected through these relation types to included ones. */
  pullInVia?: RelationType[];
  describe: string;
}

const RULES: Record<Exclude<ViewType, 'sequence' | 'free'>, ViewRule> = {
  overview: {
    categories: ['system', 'business'],
    describe: 'systems, applications, APIs, services, external systems or actors',
  },
  dependencies: {
    categories: ['system', 'internal'],
    relationTypes: ['depends-on', 'calls', 'implements', 'integrates-with', 'contains'],
    describe: 'systems, modules or components',
  },
  deployment: {
    categories: ['infrastructure'],
    relationTypes: ['deploys-to', 'contains', 'depends-on', 'sends-data-to', 'receives-data-from', 'integrates-with'],
    pullInVia: ['deploys-to'],
    describe: 'infrastructure elements (environments, servers, containers, networks...)',
  },
  data: {
    categories: ['data'],
    relationTypes: ['reads', 'writes', 'sends-data-to', 'receives-data-from', 'contains', 'depends-on'],
    pullInVia: ['reads', 'writes', 'sends-data-to', 'receives-data-from'],
    describe: 'data elements (databases, tables, data entities)',
  },
  business: {
    categories: ['business'],
    relationTypes: ['participates-in', 'depends-on', 'implements', 'contains'],
    describe: 'actors, use cases or processes',
  },
};

export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  overview: 'Architecture overview',
  dependencies: 'Dependencies',
  sequence: 'Execution & sequence',
  deployment: 'Infrastructure & deployment',
  data: 'Data & databases',
  business: 'Business flows',
  free: 'Free view',
};

export const BUILTIN_PREFIX = 'builtin:';

/**
 * Views shown in the UI: declared views plus one built-in view per type that
 * has no declared view yet (and one sequence view per flow without one).
 */
export function listViews(model: Model): { view: View; builtin: boolean }[] {
  const order: Record<ViewType, number> = { overview: 0, dependencies: 1, deployment: 2, data: 3, business: 4, sequence: 5, free: 6 };
  const out = [...model.views].sort((a, b) => order[a.type] - order[b.type]).map((view) => ({ view, builtin: false }));
  const declaredTypes = new Set(model.views.map((v) => v.type));
  for (const type of ['overview', 'dependencies', 'deployment', 'data', 'business'] as const) {
    if (!declaredTypes.has(type)) {
      out.push({ view: { id: `${BUILTIN_PREFIX}${type}`, name: VIEW_TYPE_LABELS[type], type }, builtin: true });
    }
  }
  const flowsWithView = new Set(model.views.filter((v) => v.flow).map((v) => v.flow));
  for (const flow of model.flows) {
    if (isDeleted(flow) || flowsWithView.has(flow.id)) continue;
    out.push({
      view: { id: `${BUILTIN_PREFIX}sequence:${flow.id}`, name: `${flow.name} (sequence)`, type: 'sequence', flow: flow.id },
      builtin: true,
    });
  }
  return out.sort((a, b) => order[a.view.type] - order[b.view.type]);
}

export interface DeriveOptions {
  showDeleted?: boolean;
}

export function deriveView(model: Model, view: View, builtin = false, options: DeriveOptions = {}): DerivedView {
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const visible = (e: Element | undefined): e is Element => !!e && (options.showDeleted || !isDeleted(e));
  const visibleRel = (r: Relation) => options.showDeleted || !isDeleted(r);
  const incomplete: string[] = [];
  const ids = new Set<string>();
  let flow: Flow | undefined;
  const edges: DerivedEdge[] = [];

  if (view.type === 'sequence' || (view.type === 'business' && view.flow)) {
    flow = view.flow ? model.flows.find((f) => f.id === view.flow) : undefined;
    if (!flow) {
      incomplete.push(
        view.flow
          ? `Flow "${view.flow}" is not available.`
          : 'No flow selected. Set "flow" on the view to the ID of a declared flow.',
      );
    } else {
      for (const p of flow.participants) if (visible(elements.get(p))) ids.add(p);
      if (!flow.steps?.length) incomplete.push(`Flow "${flow.name}" has no steps declared.`);
      flow.steps?.forEach((step, i) => {
        if (step.to === undefined) return;
        edges.push({
          id: `${flow!.id}/${step.id}`,
          from: step.from,
          to: step.to,
          label: `${i + 1}. ${step.action}`,
          step: { id: step.id, order: i + 1 },
        });
      });
    }
  } else if (view.type !== 'free') {
    const rule = RULES[view.type];
    for (const e of model.elements) if (visible(e) && rule.categories.includes(categoryOf(e.kind))) ids.add(e.id);
    if (rule.pullInVia) {
      for (const r of model.relations) {
        if (!visibleRel(r) || !rule.pullInVia.includes(r.type)) continue;
        if (ids.has(r.to) && visible(elements.get(r.from))) ids.add(r.from);
        else if (ids.has(r.from) && visible(elements.get(r.to))) ids.add(r.to);
      }
    }
    if (ids.size === 0) incomplete.push(`The model declares no ${rule.describe}.`);
  }

  for (const id of view.include ?? []) if (visible(elements.get(id))) ids.add(id);
  for (const id of view.exclude ?? []) ids.delete(id);

  if (view.type === 'free' && ids.size === 0) incomplete.push('This free view has no elements yet. Add elements to "include".');

  if (!flow) {
    const allowed = view.type === 'free' || view.type === 'overview' ? undefined : RULES[view.type as keyof typeof RULES]?.relationTypes;
    for (const r of model.relations) {
      if (!visibleRel(r) || !ids.has(r.from) || !ids.has(r.to)) continue;
      if (allowed && !allowed.includes(r.type)) continue;
      edges.push({ id: r.id, from: r.from, to: r.to, label: r.type, relation: r });
    }
  } else {
    // Steps between participants that are hidden (e.g. deleted) cannot be drawn.
    for (let i = edges.length - 1; i >= 0; i--) {
      if (!ids.has(edges[i]!.from) || !ids.has(edges[i]!.to)) edges.splice(i, 1);
    }
  }

  const nodes: DerivedNode[] = [];
  for (const e of model.elements) {
    if (!ids.has(e.id)) continue;
    let parent = e.parent;
    const seen = new Set<string>();
    while (parent !== undefined && !ids.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = elements.get(parent)?.parent;
    }
    // Flow-based views draw participants side by side, never nested.
    const node: DerivedNode = { id: e.id, element: e };
    if (parent !== undefined && ids.has(parent) && !flow) node.parentInView = parent;
    nodes.push(node);
  }
  if (flow) {
    // Participants appear in the order the flow declares them; extra included elements follow.
    const order = new Map(flow.participants.map((p, i) => [p, i]));
    nodes.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }

  return { view, builtin, nodes, edges, ...(flow ? { flow } : {}), incomplete };
}

/** IDs of the views (declared or built-in) where an element appears. */
export function viewsContaining(model: Model, elementId: string): View[] {
  return listViews(model)
    .filter(({ view, builtin }) => deriveView(model, view, builtin).nodes.some((n) => n.id === elementId))
    .map(({ view }) => view);
}

export interface SearchHit {
  id: string;
  name: string;
  kind: string;
  /** What matched: name, id, code path/symbol or tag. */
  matched: 'name' | 'id' | 'code' | 'tag';
}

/** Finds elements by name, ID, code reference or tag (case-insensitive substring). */
export function searchElements(model: Model, query: string, limit = 50): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const e of model.elements) {
    let matched: SearchHit['matched'] | undefined;
    if (e.name.toLowerCase().includes(q)) matched = 'name';
    else if (e.id.includes(q)) matched = 'id';
    else if (e.code?.some((c) => c.path.toLowerCase().includes(q) || c.symbol?.toLowerCase().includes(q))) matched = 'code';
    else if (e.tags?.some((t) => t.toLowerCase().includes(q))) matched = 'tag';
    if (matched) hits.push({ id: e.id, name: e.name, kind: e.kind, matched });
    if (hits.length >= limit) break;
  }
  return hits;
}
