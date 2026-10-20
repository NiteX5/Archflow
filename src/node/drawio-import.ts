/**
 * draw.io (diagrams.net) import: vertices become nodes, edges become relations,
 * containers become groups. Compressed diagrams are inflated with bounded size.
 */
import { inflateRawSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { DiagramParseError, type DiagramImport, type ImportedNode } from '../core/diagram.js';
import type { ElementKind } from '../core/schema.js';

const MAX_INFLATED = 16 * 1024 * 1024;

type Attrs = Record<string, string | undefined>;
interface Cell extends Attrs {
  _label?: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

/** Attribute values are XML-escaped and labels are often HTML: unescape, drop tags, unescape HTML entities. */
export const labelText = (value: string | undefined) =>
  decodeEntities(decodeEntities(value ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function parseStyle(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) out.set(part, '1');
    else out.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return out;
}

function inflate(text: string): string {
  try {
    const raw = inflateRawSync(Buffer.from(text.trim(), 'base64'), { maxOutputLength: MAX_INFLATED });
    return decodeURIComponent(raw.toString('latin1'));
  } catch {
    throw new DiagramParseError('The compressed draw.io diagram could not be decoded.');
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  processEntities: false,
  isArray: (name) => ['diagram', 'mxCell', 'object', 'UserObject'].includes(name),
});

function collectCells(root: Record<string, unknown>): Cell[] {
  const cells: Cell[] = [];
  for (const c of (root.mxCell as Record<string, unknown>[] | undefined) ?? []) cells.push(c as Cell);
  // <object>/<UserObject> wrap a cell and hold its id and label.
  for (const key of ['object', 'UserObject']) {
    for (const o of (root[key] as Record<string, unknown>[] | undefined) ?? []) {
      const inner = ((o.mxCell as Record<string, unknown>[] | undefined) ?? [])[0] as Cell | undefined;
      if (!inner) continue;
      cells.push({ ...inner, id: o.id as string, value: (o.label as string | undefined) ?? inner.value, _label: o.label as string | undefined });
    }
  }
  return cells;
}

export function parseDrawio(xml: string): DiagramImport {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new DiagramParseError('The file is not valid XML.');
  }
  const result: DiagramImport = { kind: 'graph', nodes: [], edges: [], warnings: [], unconverted: [] };
  let model = doc.mxGraphModel as Record<string, unknown> | undefined;
  const file = doc.mxfile as Record<string, unknown> | undefined;
  if (!model && file) {
    const diagrams = (file.diagram as Record<string, unknown>[] | undefined) ?? [];
    if (diagrams.length === 0) throw new DiagramParseError('The draw.io file contains no diagram.');
    // A <diagram> without attributes is parsed as its text content.
    const first = (typeof diagrams[0] === 'string' ? { '#text': diagrams[0] } : diagrams[0]!) as Record<string, unknown>;
    result.title = first.name as string | undefined;
    if (diagrams.length > 1) {
      result.warnings.push(`Only the first page ("${result.title ?? 'page 1'}") was imported; ${diagrams.length - 1} other page(s) were ignored.`);
    }
    model = first.mxGraphModel as Record<string, unknown> | undefined;
    if (!model && typeof first['#text'] === 'string') {
      model = (parser.parse(inflate(first['#text'])) as Record<string, unknown>).mxGraphModel as Record<string, unknown> | undefined;
    }
  }
  const root = model?.root as Record<string, unknown> | undefined;
  if (!root) throw new DiagramParseError('No draw.io diagram (mxGraphModel) was found in the file.');

  const cells = collectCells(root);
  const byId = new Map(cells.map((c) => [c.id!, c]));
  const vertices = new Map<string, ImportedNode>();
  const absolute = (cell: Cell): { x: number; y: number } => {
    const g = (cell as unknown as { mxGeometry?: Attrs }).mxGeometry;
    const own = { x: Number(g?.x ?? 0), y: Number(g?.y ?? 0) };
    const parent = cell.parent ? byId.get(cell.parent) : undefined;
    if (parent && parent.vertex === '1') {
      const p = absolute(parent);
      return { x: p.x + own.x, y: p.y + own.y };
    }
    return own;
  };

  for (const cell of cells) {
    if (cell.vertex !== '1' || !cell.id) continue;
    const style = parseStyle(cell.style);
    const text = labelText(cell.value);
    if (style.has('text') || style.has('edgeLabel')) {
      if (style.has('edgeLabel') && cell.parent && byId.get(cell.parent)?.edge === '1') continue; // handled with its edge
      result.unconverted.push(`text "${text}"`);
      result.warnings.push(`Free text "${text || '(empty)'}" is an annotation, not an element; it was kept as metadata.`);
      continue;
    }
    const g = (cell as unknown as { mxGeometry?: Attrs }).mxGeometry;
    const pos = absolute(cell);
    let kindHint: ElementKind | undefined;
    let shape = style.get('shape') ?? (style.has('ellipse') ? 'ellipse' : style.has('swimlane') ? 'swimlane' : style.has('rhombus') ? 'rhombus' : 'rectangle');
    if (/^(cylinder|datastore)/.test(shape)) kindHint = 'database';
    else if (shape === 'umlActor') kindHint = 'actor';
    else if (style.has('swimlane') || style.get('container') === '1' || style.has('group')) {
      kindHint = 'domain';
      shape = 'container';
    }
    vertices.set(cell.id, {
      sourceId: cell.id,
      label: text || cell.id,
      ...(kindHint ? { kindHint } : {}),
      shape,
      ...(g ? { box: { x: pos.x, y: pos.y, width: Number(g.width ?? 120), height: Number(g.height ?? 60) } } : {}),
    });
  }
  for (const node of vertices.values()) {
    const parent = byId.get(node.sourceId)?.parent;
    if (parent && vertices.has(parent)) node.parent = parent;
  }
  for (const cell of cells) {
    if (cell.edge !== '1') continue;
    const labelCell = cells.find((c) => c.parent === cell.id && parseStyle(c.style).has('edgeLabel'));
    const text = labelText(cell.value) || labelText(labelCell?.value);
    if (!cell.source || !cell.target || !vertices.has(cell.source) || !vertices.has(cell.target)) {
      result.unconverted.push(`edge ${cell.id}${text ? ` "${text}"` : ''}`);
      result.warnings.push(`Connection ${cell.id}${text ? ` ("${text}")` : ''} is not attached to two shapes and was kept as metadata.`);
      continue;
    }
    result.edges.push({ from: cell.source, to: cell.target, ...(text ? { label: text } : {}), ...(parseStyle(cell.style).get('dashed') === '1' ? { dashed: true } : {}) });
  }
  result.nodes = [...vertices.values()];
  return result;
}
