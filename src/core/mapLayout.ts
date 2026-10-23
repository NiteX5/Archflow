/**
 * Automatic layout of the map with ELK (layered, orthogonal edges, nested
 * containers). The ELK instance is injected so the browser can run it in a web
 * worker and tests can use the bundled build.
 */
import type { MapEdge, MapTree } from './hierarchy.js';
import { isFunctional } from './hierarchy.js';
import type { Box } from './layout.js';

export interface Point {
  x: number;
  y: number;
}

export interface MapLayout {
  /** Absolute boxes of visible nodes. */
  boxes: Record<string, Box>;
  /** Absolute orthogonal route of each edge (start, bends, end). */
  routes: Record<string, Point[]>;
}

/** Minimal surface of elkjs used here. */
export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}
export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
}
interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
}

export const SIZES = {
  leaf: { width: 210, height: 64 },
  collapsed: { width: 230, height: 96 },
  functional: { width: 180, height: 34 },
  actor: { width: 170, height: 60 },
};
/** Space for the header of an expanded container. */
export const CONTAINER_HEADER = 52;

export function nodeSize(tree: MapTree, id: string, expanded: ReadonlySet<string>): { width: number; height: number } {
  const n = tree.nodes.get(id)!;
  if (isFunctional(n.element)) return SIZES.functional;
  if (n.element.kind === 'actor') return SIZES.actor;
  if (n.children.length > 0 && !expanded.has(id)) return SIZES.collapsed;
  return SIZES.leaf;
}

const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.json.edgeCoords': 'ROOT',
  'elk.json.shapeCoords': 'ROOT',
  'elk.spacing.nodeNode': '36',
  // Wide gaps between columns leave room for the dependency chips on edges.
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
  'elk.padding': '[top=24,left=24,bottom=24,right=24]',
};
const CONTAINER_OPTIONS: Record<string, string> = {
  'elk.padding': `[top=${CONTAINER_HEADER},left=24,bottom=24,right=24]`,
  'elk.spacing.nodeNode': '28',
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
};

export function buildElkGraph(tree: MapTree, visible: readonly string[], edges: readonly MapEdge[], expanded: ReadonlySet<string>): ElkNode {
  const shown = new Set(visible);
  const toElk = (id: string): ElkNode => {
    const n = tree.nodes.get(id)!;
    const kids = expanded.has(id) ? n.children.filter((c) => shown.has(c)) : [];
    if (kids.length === 0) return { id, ...nodeSize(tree, id, expanded) };
    return { id, layoutOptions: CONTAINER_OPTIONS, children: kids.map(toElk) };
  };
  return {
    id: '__root',
    layoutOptions: ROOT_OPTIONS,
    children: tree.roots.filter((r) => shown.has(r)).map(toElk),
    edges: edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
}

export async function layoutMap(
  elk: ElkLike,
  tree: MapTree,
  visible: readonly string[],
  edges: readonly MapEdge[],
  expanded: ReadonlySet<string>,
): Promise<MapLayout> {
  const result = await elk.layout(buildElkGraph(tree, visible, edges, expanded));
  const boxes: Record<string, Box> = {};
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      boxes[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0), width: Math.round(c.width ?? 0), height: Math.round(c.height ?? 0) };
      walk(c);
    }
  };
  walk(result);
  const routes: Record<string, Point[]> = {};
  const collect = (n: ElkNode) => {
    for (const e of n.edges ?? []) {
      const s = e.sections?.[0];
      if (s) routes[e.id] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    }
    (n.children ?? []).forEach(collect);
  };
  collect(result);
  return { boxes, routes };
}

/**
 * Applies manual offsets (from the map view file) on top of the automatic
 * layout: a moved node takes its visible descendants with it, and routes that
 * touch a moved node are dropped so the UI draws them directly.
 */
export function applyOffsets(tree: MapTree, layout: MapLayout, edges: readonly MapEdge[], offsets: Record<string, { x: number; y: number }>): MapLayout {
  const boxes = { ...layout.boxes };
  const moved = new Set<string>();
  const shift = (id: string, dx: number, dy: number) => {
    const b = boxes[id];
    if (!b) return;
    boxes[id] = { ...b, x: b.x + dx, y: b.y + dy };
    moved.add(id);
    for (const c of tree.nodes.get(id)?.children ?? []) shift(c, dx, dy);
  };
  for (const [id, o] of Object.entries(offsets)) if (boxes[id] && (o.x || o.y)) shift(id, o.x, o.y);
  const routes = { ...layout.routes };
  for (const e of edges) if (moved.has(e.from) || moved.has(e.to)) delete routes[e.id];
  return { boxes, routes };
}
