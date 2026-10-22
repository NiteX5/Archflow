/**
 * The Archflow map: a containment tree derived from the model, explored by
 * expanding containers (semantic zoom) instead of drawing everything at once.
 *
 * Nothing here invents structure: levels come from element kinds, containment
 * from `parent` (and `deploys-to` when infrastructure is declared), and every
 * drawn edge stands for declared relations.
 */
import { isDeleted, type Model } from './model.js';
import { categoryOf, type Element, type ElementKind, type Relation, type RelationType } from './schema.js';

export const MAP_LEVELS = ['infrastructure', 'systems', 'modules', 'components', 'functions'] as const;
export type MapLevel = (typeof MAP_LEVELS)[number];

/** Kinds documented in separate diagrams, not drawn on the architecture map. */
const DIAGRAM_ONLY: ElementKind[] = ['use-case', 'process', 'requirement', 'constraint'];

/** Map level of a kind, or null when the kind is not drawn on the map. */
export function levelOf(kind: ElementKind): MapLevel | null {
  if (DIAGRAM_ONLY.includes(kind)) return null;
  switch (categoryOf(kind)) {
    case 'infrastructure':
      return 'infrastructure';
    case 'system':
    case 'business':
      return 'systems';
    case 'internal':
      return kind === 'module' || kind === 'package' ? 'modules' : 'components';
    case 'functional':
      return 'components';
    case 'behavior':
      return 'functions';
    case 'data':
      return kind === 'database' ? 'infrastructure' : 'components';
    case 'documentation':
      return null;
  }
}

export function isFunctional(el: Element): boolean {
  return categoryOf(el.kind) === 'functional';
}

export interface MapNode {
  id: string;
  element: Element;
  level: MapLevel;
  parent?: string;
  children: string[];
  depth: number;
}

export interface MapTree {
  nodes: Map<string, MapNode>;
  roots: string[];
  /** True when infrastructure is declared (it becomes the top of the map). */
  hasInfrastructure: boolean;
  /** Relations represented by containment instead of an edge (deploys-to used for nesting). */
  nestingRelations: Set<string>;
}

/**
 * Builds the containment tree. Declared `parent` is used; an element deployed
 * (`deploys-to`) on declared infrastructure is nested in it, so infrastructure is
 * the top level of the map whenever it exists.
 */
export function buildTree(model: Model): MapTree {
  const nodes = new Map<string, MapNode>();
  for (const el of model.elements) {
    if (isDeleted(el)) continue;
    const level = levelOf(el.kind);
    if (level) nodes.set(el.id, { id: el.id, element: el, level, children: [], depth: 0 });
  }
  const hasInfrastructure = [...nodes.values()].some((n) => n.level === 'infrastructure');
  const deployedOn = new Map<string, Relation>();
  if (hasInfrastructure) {
    for (const r of model.relations) {
      if (isDeleted(r) || r.type !== 'deploys-to') continue;
      const target = nodes.get(r.to);
      if (nodes.has(r.from) && target?.level === 'infrastructure' && !deployedOn.has(r.from)) deployedOn.set(r.from, r);
    }
  }
  const nestingRelations = new Set<string>();
  const parentOf = (n: MapNode): string | undefined => {
    const deployment = deployedOn.get(n.id);
    if (deployment) return deployment.to;
    const p = n.element.parent;
    return p !== undefined && nodes.has(p) ? p : undefined;
  };
  for (const n of nodes.values()) {
    const p = parentOf(n);
    if (p !== undefined && !createsCycle(n.id, p, nodes, parentOf)) {
      n.parent = p;
      const d = deployedOn.get(n.id);
      if (d) nestingRelations.add(d.id);
    }
  }
  for (const n of nodes.values()) if (n.parent) nodes.get(n.parent)!.children.push(n.id);
  const roots: string[] = [];
  const order = (ids: string[]) => ids.sort((a, b) => rank(nodes.get(a)!) - rank(nodes.get(b)!));
  for (const n of nodes.values()) if (!n.parent) roots.push(n.id);
  order(roots);
  const setDepth = (id: string, depth: number) => {
    const n = nodes.get(id)!;
    n.depth = depth;
    order(n.children);
    for (const c of n.children) setDepth(c, depth + 1);
  };
  roots.forEach((r) => setDepth(r, 0));
  return { nodes, roots, hasInfrastructure, nestingRelations };
}

/** Actors first, then by level; stable within a level (declaration order). */
function rank(n: MapNode): number {
  if (n.element.kind === 'actor') return -1;
  return MAP_LEVELS.indexOf(n.level) + (isFunctional(n.element) ? 0.5 : 0);
}

function createsCycle(id: string, parent: string, nodes: Map<string, MapNode>, parentOf: (n: MapNode) => string | undefined): boolean {
  const seen = new Set([id]);
  let cur: string | undefined = parent;
  while (cur !== undefined) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    const n = nodes.get(cur);
    cur = n ? parentOf(n) : undefined;
  }
  return false;
}

export interface VisibilityOptions {
  /** Containers whose content is revealed. */
  expanded: ReadonlySet<string>;
  /** Show functional dependencies and functions inside expanded containers (close zoom). */
  detail: boolean;
}

/** Nodes drawn for the current expansion: roots plus the children of expanded, visible containers. */
export function visibleNodes(tree: MapTree, opts: VisibilityOptions): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    const n = tree.nodes.get(id)!;
    if (!opts.expanded.has(id)) return;
    for (const c of n.children) {
      const child = tree.nodes.get(c)!;
      if (!opts.detail && (isFunctional(child.element) || child.level === 'functions')) continue;
      visit(c);
    }
  };
  tree.roots.forEach(visit);
  return out;
}

/** Visible children of an expanded container (what it reveals). */
export function hasHiddenContent(tree: MapTree, id: string): boolean {
  return (tree.nodes.get(id)?.children.length ?? 0) > 0;
}

export interface MapEdge {
  /** Stable key "from>to". */
  id: string;
  from: string;
  to: string;
  /** Declared relations this edge stands for. */
  relations: string[];
  types: RelationType[];
  /** Functional dependencies involved (from `via`, and from `uses` endpoints that are hidden). */
  via: string[];
  /** True when any of the relations is inferred or pending review (drawn dashed). */
  uncertain: boolean;
}

/**
 * Edges between visible nodes. Each relation is lifted to the nearest visible
 * ancestor of both ends; relations inside one visible node disappear, and the
 * rest are merged per (from, to) pair with a count, their types and `via`.
 */
export function aggregateEdges(model: Model, tree: MapTree, visible: readonly string[]): MapEdge[] {
  const shown = new Set(visible);
  const lift = (id: string): string | undefined => {
    let cur: string | undefined = id;
    while (cur !== undefined && !shown.has(cur)) cur = tree.nodes.get(cur)?.parent;
    return cur;
  };
  const edges = new Map<string, MapEdge>();
  for (const r of model.relations) {
    if (isDeleted(r) || r.type === 'contains' || tree.nestingRelations.has(r.id)) continue;
    if (!tree.nodes.has(r.from) || !tree.nodes.has(r.to)) continue; // diagram-only or deleted ends
    const from = lift(r.from);
    const to = lift(r.to);
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    let e = edges.get(key);
    if (!e) edges.set(key, (e = { id: key, from, to, relations: [], types: [], via: [], uncertain: false }));
    e.relations.push(r.id);
    if (!e.types.includes(r.type)) e.types.push(r.type);
    const deps = [...(r.via ?? [])];
    // A hidden functional dependency at the end of `uses` becomes a chip on the lifted edge.
    if (r.type === 'uses' && to !== r.to && isFunctional(tree.nodes.get(r.to)!.element)) deps.push(r.to);
    for (const d of deps) if (!e.via.includes(d)) e.via.push(d);
    const status = r.provenance?.status;
    if (status === 'inferred' || status === 'pending-review') e.uncertain = true;
  }
  return [...edges.values()];
}

/** Ancestors of a node, outermost first (for breadcrumbs and focusing). */
export function ancestorsOf(tree: MapTree, id: string): string[] {
  const out: string[] = [];
  let cur = tree.nodes.get(id)?.parent;
  while (cur !== undefined) {
    out.unshift(cur);
    cur = tree.nodes.get(cur)?.parent;
  }
  return out;
}

/** Where a functional dependency is used: relations listing it in `via` and `uses` relations to it. */
export function usagesOf(model: Model, id: string): Relation[] {
  return model.relations.filter((r) => !isDeleted(r) && (r.via?.includes(id) || (r.type === 'uses' && r.to === id)));
}
