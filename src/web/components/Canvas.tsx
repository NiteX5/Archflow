import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { memo, useEffect, useMemo, useState } from 'react';
import type { Box } from '../../core/layout.js';
import { categoryOf, type Element, type View } from '../../core/schema.js';
import type { DerivedView } from '../../core/views.js';
import { provenanceBadge } from './provenance.js';
import { ICON_GLYPHS } from './icons.js';

export type LayoutEntry = { x: number; y: number; width?: number; height?: number };

export type Selection = { type: 'element' | 'relation'; id: string } | null;

export interface CanvasProps {
  derived: DerivedView;
  boxes: Record<string, Box>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  editable: boolean;
  /** Absolute layout entries of moved or resized nodes. */
  onLayout?: (entries: Record<string, LayoutEntry>) => void;
  onConnect?: (from: string, to: string) => void;
}

type ElementNodeData = {
  element: Element;
  style?: NonNullable<View['styles']>[string];
  isGroup: boolean;
  editable: boolean;
  origin: { x: number; y: number };
  onResized?: (id: string, box: Box) => void;
};

const ElementNode = memo(function ElementNode({ id, data, selected }: NodeProps<Node<ElementNodeData>>) {
  const { element, style, isGroup, editable, origin, onResized } = data;
  const badge = provenanceBadge(element.provenance);
  const classes = [
    'node',
    `cat-${categoryOf(element.kind)}`,
    `shape-${style?.shape ?? 'rounded'}`,
    isGroup ? 'group' : '',
    element.lifecycle === 'deleted' ? 'deleted' : '',
    element.lifecycle === 'deprecated' ? 'deprecated' : '',
    `prov-${badge.key}`,
  ].join(' ');
  return (
    <div className={classes} style={style?.color ? { borderColor: style.color, ['--accent' as string]: style.color } : undefined}>
      {editable && (
        <NodeResizer
          isVisible={selected}
          minWidth={120}
          minHeight={48}
          onResizeEnd={(_, p) =>
            onResized?.(id, {
              x: Math.round(origin.x + p.x),
              y: Math.round(origin.y + p.y),
              width: Math.round(p.width),
              height: Math.round(p.height),
            })
          }
        />
      )}
      <Handle type="target" position={Position.Left} isConnectable={editable} />
      <div className="node-head">
        <span className="node-kind">{element.kind}</span>
        <span className={`badge badge-${badge.key}`} title={badge.title}>
          {badge.short}
        </span>
      </div>
      <div className="node-name">
        {style?.icon && <span className="node-icon" aria-label={style.icon}>{ICON_GLYPHS[style.icon]}</span>}
        {element.name}
      </div>
      {element.lifecycle && element.lifecycle !== 'active' && <div className="node-lifecycle">{element.lifecycle}</div>}
      <Handle type="source" position={Position.Right} isConnectable={editable} />
    </div>
  );
});

const nodeTypes: NodeTypes = { element: ElementNode };

export function Canvas({ derived, boxes, selection, onSelect, editable, onLayout, onConnect }: CanvasProps) {
  const parentOf = useMemo(() => new Map(derived.nodes.map((n) => [n.id, n.parentInView])), [derived]);

  const nodes = useMemo<Node<ElementNodeData>[]>(() => {
    const groups = new Set(derived.nodes.map((n) => n.parentInView).filter(Boolean));
    const depth = (id: string): number => {
      const p = parentOf.get(id);
      return p ? 1 + depth(p) : 0;
    };
    // Parents must precede children for React Flow sub-flows.
    return [...derived.nodes]
      .sort((a, b) => depth(a.id) - depth(b.id))
      .map((n) => {
        const box = boxes[n.id]!;
        const parent = n.parentInView ? boxes[n.parentInView]! : undefined;
        const origin = parent ? { x: parent.x, y: parent.y } : { x: 0, y: 0 };
        return {
          id: n.id,
          type: 'element',
          position: { x: box.x - origin.x, y: box.y - origin.y },
          ...(n.parentInView ? { parentId: n.parentInView } : {}),
          width: box.width,
          height: box.height,
          selected: selection?.type === 'element' && selection.id === n.id,
          draggable: editable,
          zIndex: depth(n.id),
          data: {
            element: n.element,
            style: derived.view.styles?.[n.id],
            isGroup: groups.has(n.id),
            editable,
            origin,
            onResized: (id: string, b: Box) => onLayout?.({ [id]: b }),
          },
        };
      });
  }, [derived, boxes, selection, editable, parentOf, onLayout]);

  // Local copy so drags render; it is reset whenever the model or layout changes.
  const [rfNodes, setRfNodes] = useState(nodes);
  useEffect(() => setRfNodes(nodes), [nodes]);

  const edges = useMemo<Edge[]>(
    () =>
      derived.edges.map((e) => {
        const status = e.relation?.provenance?.status;
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          label: e.label,
          className: [
            e.relation?.lifecycle === 'deleted' ? 'edge-deleted' : '',
            status && status !== 'verified' ? 'edge-uncertain' : '',
            e.relation && !e.relation.provenance ? 'edge-unknown' : '',
          ].join(' '),
          markerEnd: { type: MarkerType.ArrowClosed },
          selected: selection?.type === 'relation' && selection.id === e.id,
          zIndex: 1000,
        };
      }),
    [derived, selection],
  );

  /** Absolute position of a node from the local (relative) React Flow state. */
  const absoluteOf = (id: string, all: Node[]): { x: number; y: number } => {
    const n = all.find((x) => x.id === id)!;
    const parent = parentOf.get(id);
    const base = parent ? absoluteOf(parent, all) : { x: 0, y: 0 };
    return { x: Math.round(base.x + n.position.x), y: Math.round(base.y + n.position.y) };
  };

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      maxZoom={2.5}
      nodesConnectable={editable}
      nodesDraggable={editable}
      elementsSelectable
      onNodesChange={(changes: NodeChange<Node<ElementNodeData>>[]) => setRfNodes((ns) => applyNodeChanges(changes, ns))}
      onNodeClick={(_, n) => onSelect({ type: 'element', id: n.id })}
      onEdgeClick={(_, e) => onSelect(derived.flow ? null : { type: 'relation', id: e.id })}
      onPaneClick={() => onSelect(null)}
      onNodeDragStop={(_, node, dragged) => {
        if (!onLayout) return;
        const moved = new Set((dragged.length ? dragged : [node]).map((n) => n.id));
        // Saved descendants are stored as absolute positions, so they move with their group.
        const savedLayout = derived.view.layout ?? {};
        for (const n of derived.nodes) {
          let p = n.parentInView;
          while (p) {
            if (moved.has(p) && savedLayout[n.id]) moved.add(n.id);
            p = parentOf.get(p);
          }
        }
        const all = rfNodes.map((n) => dragged.find((d) => d.id === n.id) ?? (n.id === node.id ? node : n));
        const out: Record<string, LayoutEntry> = {};
        for (const id of moved) {
          // Keep sizes automatic unless the user resized the node before.
          const saved = savedLayout[id];
          out[id] = { ...absoluteOf(id, all), ...(saved?.width ? { width: saved.width } : {}), ...(saved?.height ? { height: saved.height } : {}) };
        }
        onLayout(out);
      }}
      onConnect={(c: Connection) => {
        if (c.source && c.target) onConnect?.(c.source, c.target);
      }}
    >
      <Background />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
