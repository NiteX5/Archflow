/**
 * The Archflow map: containers reveal their content when the user zooms in on
 * them (semantic zoom) or presses ▸; edges are aggregated between what is
 * visible and carry chips for the functional dependencies involved.
 */
import {
  applyNodeChanges,
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import ElkApi from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aggregateEdges, buildTree, isFunctional, visibleNodes, type MapEdge, type MapTree } from '../../core/hierarchy.js';
import type { Box } from '../../core/layout.js';
import { applyOffsets, layoutMap, type ElkLike, type MapLayout, type Point } from '../../core/mapLayout.js';
import type { Model } from '../../core/model.js';
import { categoryOf, type Element } from '../../core/schema.js';
import { useI18n } from '../i18n.js';
import { iconFor } from './icons.js';
import { provenanceBadge } from './provenance.js';

export type MapSelection =
  | { type: 'element'; id: string }
  | { type: 'relation'; id: string }
  | { type: 'edge'; id: string; from: string; to: string; relations: string[]; via: string[] }
  | null;

/** A container opens when it is at least this wide on screen and mostly in view. */
export const EXPAND_PX = 300;
/** An open container closes when it shrinks below this width on screen. */
export const COLLAPSE_PX = 220;
/** Below this zoom the content of a container is too small to read, so containers opened by zooming close. */
export const UNREADABLE_ZOOM = 0.45;
/** Functional dependencies and functions appear from this zoom on. */
export const DETAIL_ZOOM = 1.15;

const ElkCtor = ((ElkApi as unknown as { default?: unknown }).default ?? ElkApi) as new (opts: { workerUrl: string }) => ElkLike;
let elkInstance: ElkLike | null = null;
const elk = () => (elkInstance ??= new ElkCtor({ workerUrl: elkWorkerUrl }));

type NodeData = {
  element: Element;
  mode: 'collapsed' | 'expanded' | 'leaf' | 'functional';
  childCount: number;
  dim: boolean;
  onToggle: (id: string) => void;
  insideLabel: string;
  toggleLabel: string;
};

const MapNode = memo(function MapNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const { element, mode, childCount, dim, onToggle } = data;
  const Icon = iconFor(element.kind);
  const badge = provenanceBadge(element.provenance);
  const cls = ['map-node', `mode-${mode}`, `cat-${categoryOf(element.kind)}`, `prov-${badge.key}`, dim ? 'dim' : '', selected ? 'selected' : ''].join(' ');
  return (
    <div className={cls} title={element.summary ?? element.name}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {mode === 'functional' ? (
        <div className="map-pill">
          <Icon size={14} aria-hidden="true" />
          <span>{element.name}</span>
        </div>
      ) : (
        <>
          <div className="map-head">
            <Icon size={mode === 'expanded' ? 18 : 20} strokeWidth={1.75} aria-hidden="true" className="map-icon" />
            <div className="map-title">
              <div className="map-name">{element.name}</div>
              <div className="map-kind">{element.kind}</div>
            </div>
            <span className={`badge badge-${badge.key}`} title={badge.title}>
              {badge.short}
            </span>
            {childCount > 0 && (
              <button
                className="map-toggle nodrag"
                aria-label={data.toggleLabel}
                title={data.toggleLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(id);
                }}
              >
                {mode === 'expanded' ? '▾' : '▸'}
              </button>
            )}
          </div>
          {mode === 'collapsed' && (
            <div className="map-body">
              {element.summary && <div className="map-summary">{element.summary}</div>}
              <div className="map-count">{data.insideLabel}</div>
            </div>
          )}
          {mode === 'leaf' && element.summary && <div className="map-summary one-line">{element.summary}</div>}
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

type EdgeData = {
  route?: Point[];
  label: string;
  chips: { id: string; name: string }[];
  more: number;
  uncertain: boolean;
  highlight: boolean;
  dim: boolean;
  showChips: boolean;
  onChip: (id: string) => void;
};

/** Rounded orthogonal path through ELK's route points. */
function roundedPath(points: Point[], r = 8): string {
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1]!;
    const p = points[i]!;
    const p1 = points[i + 1]!;
    const d0 = Math.min(r, Math.hypot(p.x - p0.x, p.y - p0.y) / 2);
    const d1 = Math.min(r, Math.hypot(p1.x - p.x, p1.y - p.y) / 2);
    const a = { x: p.x - (Math.sign(p.x - p0.x) * d0), y: p.y - (Math.sign(p.y - p0.y) * d0) };
    const b = { x: p.x + (Math.sign(p1.x - p.x) * d1), y: p.y + (Math.sign(p1.y - p.y) * d1) };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

/** Midpoint of the longest segment: where labels are least likely to collide. */
function labelPoint(points: Point[]): Point {
  let best = 0;
  let at: Point = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return at;
}

function RouteEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { data, markerEnd } = props;
  let path: string;
  let mid: Point;
  if (data?.route && data.route.length >= 2) {
    path = roundedPath(data.route);
    mid = labelPoint(data.route);
  } else {
    const [p, lx, ly] = getSmoothStepPath(props);
    path = p;
    mid = { x: lx, y: ly };
  }
  const cls = ['map-edge', data?.uncertain ? 'uncertain' : '', data?.highlight ? 'highlight' : '', data?.dim ? 'dim' : ''].join(' ');
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={cls} interactionWidth={14} />
      <EdgeLabelRenderer>
        <div className={`map-edge-label${data?.dim ? ' dim' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}>
          {data?.highlight && <div className="edge-types">{data.label}</div>}
          {data?.showChips && data.chips.length > 0 && (
            <div className="edge-chips">
              {data.chips.map((c) => (
                <button
                  key={c.id}
                  className="chip nodrag nopan"
                  onClick={(e) => {
                    // The chip selects the dependency, not the edge it sits on.
                    e.stopPropagation();
                    data.onChip(c.id);
                  }}
                  title={c.name}
                >
                  {c.name}
                </button>
              ))}
              {data.more > 0 && <span className="chip more">+{data.more}</span>}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes: NodeTypes = { map: MapNode };
const edgeTypes: EdgeTypes = { route: RouteEdge };

export interface MapCanvasProps {
  model: Model;
  expanded: ReadonlySet<string>;
  setExpanded: (next: Set<string>) => void;
  selection: MapSelection;
  onSelect: (s: MapSelection) => void;
  editable: boolean;
  /** Manual offsets on top of the automatic layout (map view file). */
  offsets: Record<string, { x: number; y: number }>;
  onOffset?: (id: string, offset: { x: number; y: number }) => void;
}

export function MapCanvas(props: MapCanvasProps) {
  const { model, expanded, setExpanded, selection, onSelect, editable, offsets, onOffset } = props;
  const { t } = useI18n();
  const flow = useReactFlow();
  const detail = useStore((s) => s.transform[2] >= DETAIL_ZOOM);
  const paneSize = useStore((s) => ({ width: s.width, height: s.height }), (a, b) => a.width === b.width && a.height === b.height);
  const tree: MapTree = useMemo(() => buildTree(model), [model]);
  const visible = useMemo(() => visibleNodes(tree, { expanded, detail }), [tree, expanded, detail]);
  const edges = useMemo(() => aggregateEdges(model, tree, visible), [model, tree, visible]);
  const [layout, setLayout] = useState<MapLayout | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const anchor = useRef<{ id: string; screen: Point; zoom: number } | null>(null);
  const firstLayout = useRef(true);
  /** Zoom at the end of the previous move: only real zooming in/out opens or closes containers. */
  const lastZoom = useRef<number | null>(null);
  /** Containers opened by zooming in; only these close again by zooming out (manual opens stay open). */
  const autoOpened = useRef(new Set<string>());

  // Layout runs off the main thread; the previous layout stays on screen meanwhile.
  useEffect(() => {
    let cancelled = false;
    layoutMap(elk(), tree, visible, edges, expanded).then(
      (l) => {
        if (!cancelled) setLayout(applyOffsets(tree, l, edges, offsets));
      },
      () => {
        /* a failed layout keeps the previous one; nothing is lost */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tree, visible, edges, expanded, offsets]);

  // Keep the container the user zoomed into where it was on screen after it opens.
  useEffect(() => {
    if (!layout) return;
    if (firstLayout.current) {
      firstLayout.current = false;
      requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 0 }));
      return;
    }
    const a = anchor.current;
    anchor.current = null;
    const box = a && layout.boxes[a.id];
    if (a && box) void flow.setViewport({ x: a.screen.x - box.x * a.zoom, y: a.screen.y - box.y * a.zoom, zoom: a.zoom });
  }, [layout, flow]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(expanded);
      autoOpened.current.delete(id);
      if (next.has(id)) {
        next.delete(id);
        for (const d of descendants(tree, id)) next.delete(d);
      } else {
        next.add(id);
        const box = layout?.boxes[id];
        const vp = flow.getViewport();
        if (box) anchor.current = { id, screen: { x: box.x * vp.zoom + vp.x, y: box.y * vp.zoom + vp.y }, zoom: vp.zoom };
      }
      setExpanded(next);
    },
    [expanded, setExpanded, tree, layout, flow],
  );

  /** Semantic zoom: open what the user zoomed into, close what became too small. */
  const onMoveEnd = useCallback(
    (_: unknown, vp: Viewport) => {
      const previous = lastZoom.current;
      lastZoom.current = vp.zoom;
      if (!layout || previous === null || Math.abs(vp.zoom - previous) < 0.01) return;
      const zoomingIn = vp.zoom > previous;
      const next = new Set(expanded);
      let changed = false;
      let best: { id: string; dist: number } | null = null;
      const cx = paneSize.width / 2;
      const cy = paneSize.height / 2;
      for (const id of visible) {
        const n = tree.nodes.get(id)!;
        if (n.children.length === 0) continue;
        const b = layout.boxes[id];
        if (!b) continue;
        const sx = b.x * vp.zoom + vp.x;
        const sy = b.y * vp.zoom + vp.y;
        const sw = b.width * vp.zoom;
        const sh = b.height * vp.zoom;
        if (zoomingIn && !expanded.has(id)) {
          const visW = Math.max(0, Math.min(sx + sw, paneSize.width) - Math.max(sx, 0));
          const visH = Math.max(0, Math.min(sy + sh, paneSize.height) - Math.max(sy, 0));
          if (sw >= EXPAND_PX && visW * visH >= 0.6 * sw * sh) {
            next.add(id);
            autoOpened.current.add(id);
            changed = true;
            const dist = Math.hypot(sx + sw / 2 - cx, sy + sh / 2 - cy);
            if (!best || dist < best.dist) best = { id, dist };
          }
        } else if (!zoomingIn && autoOpened.current.has(id) && (sw < COLLAPSE_PX || vp.zoom < UNREADABLE_ZOOM)) {
          next.delete(id);
          autoOpened.current.delete(id);
          const dist = Math.hypot(sx + sw / 2 - cx, sy + sh / 2 - cy);
          if (!best || dist < best.dist) best = { id, dist };
          for (const d of descendants(tree, id)) {
            next.delete(d);
            autoOpened.current.delete(d);
          }
          changed = true;
        }
      }
      if (!changed) return;
      if (best) {
        const b = layout.boxes[best.id]!;
        anchor.current = { id: best.id, screen: { x: b.x * vp.zoom + vp.x, y: b.y * vp.zoom + vp.y }, zoom: vp.zoom };
      }
      setExpanded(next);
    },
    [layout, expanded, visible, tree, paneSize, setExpanded],
  );

  const focusId = hovered ?? (selection?.type === 'element' ? selection.id : null);
  const nameOf = useCallback((id: string) => tree.nodes.get(id)?.element.name ?? id, [tree]);

  const rfNodesFromLayout = useMemo<Node<NodeData>[]>(() => {
    if (!layout) return [];
    const shown = new Set(visible);
    const related = focusId ? relatedTo(tree, edges, focusId) : null;
    return visible
      .filter((id) => layout.boxes[id])
      .map((id) => {
        const n = tree.nodes.get(id)!;
        const box = layout.boxes[id]!;
        const parentBox = n.parent && shown.has(n.parent) ? layout.boxes[n.parent] : undefined;
        const mode: NodeData['mode'] = isFunctional(n.element)
          ? 'functional'
          : n.children.length === 0
            ? 'leaf'
            : expanded.has(id)
              ? 'expanded'
              : 'collapsed';
        return {
          id,
          type: 'map',
          position: parentBox ? { x: box.x - parentBox.x, y: box.y - parentBox.y } : { x: box.x, y: box.y },
          ...(parentBox ? { parentId: n.parent } : {}),
          width: box.width,
          height: box.height,
          zIndex: n.depth * 2 + (mode === 'expanded' ? 0 : 1),
          selected: selection?.type === 'element' && selection.id === id,
          draggable: editable,
          data: {
            element: n.element,
            mode,
            childCount: n.children.length,
            dim: !!related && !related.has(id) && mode !== 'expanded',
            onToggle: toggle,
            insideLabel: t('{n} inside', { n: n.children.length }),
            toggleLabel: mode === 'expanded' ? t('Collapse') : t('Expand'),
          },
        };
      });
  }, [layout, visible, tree, expanded, selection, editable, toggle, edges, focusId, t]);

  const [rfNodes, setRfNodes] = useState(rfNodesFromLayout);
  useEffect(() => setRfNodes(rfNodesFromLayout), [rfNodesFromLayout]);

  const rfEdges = useMemo<Edge<EdgeData>[]>(() => {
    if (!layout) return [];
    const zoomedOut = flow.getViewport().zoom < 0.55;
    return edges.map((e: MapEdge) => {
      const highlight = !!focusId && (e.from === focusId || e.to === focusId);
      const selectedEdge = selection?.type === 'edge' && selection.id === e.id;
      const chips = e.via.slice(0, 3).map((id) => ({ id, name: nameOf(id) }));
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'route',
        selected: selectedEdge,
        zIndex: 1000,
        markerEnd: 'url(#archflow-arrow)',
        data: {
          route: layout.routes[e.id],
          label: `${e.types.join(', ')}${e.relations.length > 1 ? ` ×${e.relations.length}` : ''}`,
          chips,
          more: Math.max(0, e.via.length - 3),
          uncertain: e.uncertain,
          highlight: highlight || selectedEdge,
          dim: !!focusId && !highlight,
          showChips: !zoomedOut || highlight,
          onChip: (id) => onSelect({ type: 'element', id }),
        },
      };
    });
    // The zoom is read when edges are rebuilt; label visibility does not need to follow every frame.
  }, [layout, edges, focusId, selection, nameOf, onSelect, flow]);

  if (tree.roots.length === 0) {
    return <div className="map-empty">{t('No elements to show yet. Declare them in the UI or with the Archflow skill.')}</div>;
  }

  return (
    <div className="map-wrap">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <marker id="archflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="map-arrowhead" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.05}
        maxZoom={3}
        nodesConnectable={false}
        nodesDraggable={editable}
        onlyRenderVisibleElements
        onNodesChange={(changes: NodeChange<Node<NodeData>>[]) => setRfNodes((ns) => applyNodeChanges(changes, ns))}
        onNodeClick={(_, n) => onSelect({ type: 'element', id: n.id })}
        onEdgeClick={(_, e) => {
          const me = edges.find((x) => x.id === e.id);
          if (me) onSelect({ type: 'edge', id: me.id, from: me.from, to: me.to, relations: me.relations, via: me.via });
        }}
        onPaneClick={() => onSelect(null)}
        onNodeMouseEnter={(_, n) => setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onMoveEnd={onMoveEnd}
        onNodeDragStop={(_, node) => {
          if (!onOffset || !layout) return;
          const auto = layout.boxes[node.id];
          if (!auto) return;
          const parentBox = node.parentId ? layout.boxes[node.parentId] : undefined;
          const absX = node.position.x + (parentBox?.x ?? 0);
          const absY = node.position.y + (parentBox?.y ?? 0);
          const prev = offsets[node.id] ?? { x: 0, y: 0 };
          onOffset(node.id, { x: Math.round(prev.x + absX - auto.x), y: Math.round(prev.y + absY - auto.y) });
        }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

function descendants(tree: MapTree, id: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    for (const c of tree.nodes.get(x)?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** What stays bright while an element is focused: itself, its content, its containers and what it connects to. */
function relatedTo(tree: MapTree, edges: readonly MapEdge[], id: string): Set<string> {
  const out = new Set([id, ...descendants(tree, id)]);
  for (const e of edges) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  for (const x of [...out]) {
    let p = tree.nodes.get(x)?.parent;
    while (p !== undefined) {
      out.add(p);
      p = tree.nodes.get(p)?.parent;
    }
  }
  return out;
}

export type { Box };
