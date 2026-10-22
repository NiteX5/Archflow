/** draw.io (diagrams.net) export of a diagram view as an uncompressed .drawio file. */
import type { Box } from './layout.js';
import { categoryOf } from './schema.js';
import type { DerivedView } from './views.js';

const COLORS: Record<string, string> = {
  infrastructure: '#8250df',
  system: '#0969da',
  internal: '#1a7f37',
  functional: '#bf3989',
  behavior: '#9a6700',
  data: '#bc4c00',
  business: '#cf222e',
  documentation: '#57606a',
};

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

/** Cell IDs carry the element ID ("n-<id>") so re-importing maps cells back to the same elements. */
export const nodeCellId = (id: string) => `n-${id}`;

export class UnsupportedExportError extends Error {}

export function viewToDrawio(derived: DerivedView, boxes: Record<string, Box>): string {
  if (derived.view.type === 'sequence') {
    throw new UnsupportedExportError('Sequence views cannot be exported to draw.io; use SVG, PNG, PDF or Mermaid.');
  }
  const groups = new Set(derived.nodes.map((n) => n.parentInView).filter(Boolean));
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const byId = new Map(derived.nodes.map((n) => [n.id, n]));
  const depth = (id: string): number => {
    const p = byId.get(id)?.parentInView;
    return p ? 1 + depth(p) : 0;
  };
  for (const n of [...derived.nodes].sort((a, b) => depth(a.id) - depth(b.id))) {
    const b = boxes[n.id]!;
    const parent = n.parentInView ? boxes[n.parentInView]! : undefined;
    const style = derived.view.styles?.[n.id];
    const color = style?.color ?? COLORS[categoryOf(n.element.kind)]!;
    const shape =
      style?.shape === 'ellipse'
        ? 'ellipse;'
        : style?.shape === 'cylinder' || (!style?.shape && (n.element.kind === 'database' || n.element.kind === 'table'))
          ? 'shape=cylinder3;boundedLbl=1;'
          : style?.shape === 'hexagon'
            ? 'shape=hexagon;'
            : style?.shape === 'rectangle'
              ? ''
              : 'rounded=1;';
    const s = groups.has(n.id)
      ? `swimlane;startSize=26;container=1;collapsible=0;strokeColor=${color};`
      : `${shape}whiteSpace=wrap;html=0;strokeColor=${color};${n.element.provenance?.status && n.element.provenance.status !== 'verified' ? 'dashed=1;' : ''}`;
    cells.push(
      `<mxCell id="${attr(nodeCellId(n.id))}" value="${attr(n.element.name)}" tooltip="${attr(`${n.element.kind} · ${n.id}`)}" style="${s}" vertex="1" parent="${parent ? attr(nodeCellId(n.parentInView!)) : '1'}">` +
        `<mxGeometry x="${b.x - (parent?.x ?? 0)}" y="${b.y - (parent?.y ?? 0)}" width="${b.width}" height="${b.height}" as="geometry"/></mxCell>`,
    );
  }
  for (const e of derived.edges) {
    const status = e.relation?.provenance?.status;
    const dashed = !e.relation?.provenance || status === 'inferred' || status === 'pending-review';
    cells.push(
      `<mxCell id="${attr(`e-${e.id}`)}" value="${attr(e.label)}" style="endArrow=block;html=0;${dashed ? 'dashed=1;' : ''}" edge="1" parent="1" source="${attr(nodeCellId(e.from))}" target="${attr(nodeCellId(e.to))}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="Archflow">',
    `  <diagram id="${attr(derived.view.id)}" name="${attr(derived.view.name)}">`,
    '    <mxGraphModel><root>',
    ...cells.map((c) => `      ${c}`),
    '    </root></mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n');
}
