/**
 * Mermaid interchange. Supported: `flowchart`/`graph` (nodes, edges, labels,
 * subgraphs) and `sequenceDiagram` (participants, messages, alt/opt/loop
 * conditions). Anything else is reported, never silently dropped.
 */
import type { Box } from './layout.js';
import { DiagramParseError, type DiagramImport, type ImportedNode } from './diagram.js';
import { categoryOf, type ElementKind } from './schema.js';
import type { DerivedView } from './views.js';

// ---------- export ----------

const label = (s: string) => `"${s.replace(/"/g, '#quot;').replace(/\n/g, ' ')}"`;

function mermaidIds(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const id of ids) {
    let m = id.replace(/[^A-Za-z0-9_]/g, '_');
    if (/^(end|graph|subgraph|flowchart)$/i.test(m)) m = `n_${m}`;
    let candidate = m;
    for (let i = 2; used.has(candidate); i++) candidate = `${m}_${i}`;
    used.add(candidate);
    out.set(id, candidate);
  }
  return out;
}

function nodeShape(kind: ElementKind, shape: string | undefined, text: string): string {
  switch (shape) {
    case 'ellipse':
      return `((${text}))`;
    case 'rounded':
      return `(${text})`;
    case 'hexagon':
      return `{{${text}}}`;
    case 'cylinder':
      return `[(${text})]`;
    case 'rectangle':
    case 'document':
      return `[${text}]`;
  }
  if (kind === 'database' || kind === 'table' || kind === 'storage') return `[(${text})]`;
  if (kind === 'actor') return `((${text}))`;
  return `[${text}]`;
}

export function viewToMermaid(derived: DerivedView, _boxes?: Record<string, Box>): string {
  const ids = mermaidIds(derived.nodes.map((n) => n.id));
  if (derived.view.type === 'sequence') {
    const lines = ['sequenceDiagram', `  %% ${derived.view.name} (exported from Archflow)`];
    for (const n of derived.nodes) {
      lines.push(`  ${n.element.kind === 'actor' ? 'actor' : 'participant'} ${ids.get(n.id)} as ${n.element.name.replace(/[\n;]/g, ' ')}`);
    }
    for (const s of derived.flow?.steps ?? []) {
      const msg = `  ${ids.get(s.from) ?? s.from}->>${ids.get(s.to ?? s.from) ?? s.to}: ${s.action.replace(/[\n;]/g, ' ')}`;
      if (s.condition) lines.push(`  opt ${s.condition.replace(/\n/g, ' ')}`, `  ${msg}`, '  end');
      else lines.push(msg);
    }
    return `${lines.join('\n')}\n`;
  }

  const lines = ['flowchart LR', `  %% ${derived.view.name} (exported from Archflow)`];
  const children = new Map<string | undefined, string[]>();
  for (const n of derived.nodes) children.set(n.parentInView, [...(children.get(n.parentInView) ?? []), n.id]);
  const byId = new Map(derived.nodes.map((n) => [n.id, n]));
  const emit = (id: string, indent: string) => {
    const n = byId.get(id)!;
    const kids = children.get(id);
    if (kids?.length) {
      lines.push(`${indent}subgraph ${ids.get(id)}[${label(n.element.name)}]`);
      for (const k of kids) emit(k, `${indent}  `);
      lines.push(`${indent}end`);
    } else {
      lines.push(`${indent}${ids.get(id)}${nodeShape(n.element.kind, derived.view.styles?.[id]?.shape, label(n.element.name))}`);
    }
  };
  for (const id of children.get(undefined) ?? []) emit(id, '  ');
  for (const e of derived.edges) {
    const status = e.relation?.provenance?.status;
    const arrow = !e.relation?.provenance || status === 'inferred' || status === 'pending-review' ? '-.->' : '-->';
    lines.push(`  ${ids.get(e.from)} ${arrow}|${label(e.label)}| ${ids.get(e.to)}`);
  }
  for (const n of derived.nodes) {
    const color = derived.view.styles?.[n.id]?.color;
    if (color) lines.push(`  style ${ids.get(n.id)} stroke:${color}`);
  }
  // Category is kept as a class so a re-import can suggest kinds.
  for (const n of derived.nodes) if (!children.get(n.id)?.length) lines.push(`  class ${ids.get(n.id)} ${categoryOf(n.element.kind)}`);
  return `${lines.join('\n')}\n`;
}

// ---------- import ----------

const SHAPES: [RegExp, string, ElementKind | undefined][] = [
  [/^\[\((.*)\)\]$/s, 'cylinder', 'database'],
  [/^\(\((.*)\)\)$/s, 'circle', undefined],
  [/^\(\[(.*)\]\)$/s, 'stadium', undefined],
  [/^\[\[(.*)\]\]$/s, 'subroutine', undefined],
  [/^\{\{(.*)\}\}$/s, 'hexagon', undefined],
  [/^\[\/(.*)\/\]$/s, 'parallelogram', undefined],
  [/^\[\\(.*)\\\]$/s, 'parallelogram', undefined],
  [/^\{(.*)\}$/s, 'rhombus', undefined],
  [/^>(.*)\]$/s, 'flag', undefined],
  [/^\((.*)\)$/s, 'rounded', undefined],
  [/^\[(.*)\]$/s, 'rectangle', undefined],
];

const cleanLabel = (s: string) =>
  s
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^`(.*)`$/s, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/#quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const NODE = /^\s*([A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)*)(\s*(?:\[\(.*?\)\]|\(\(.*?\)\)|\(\[.*?\]\)|\[\[.*?\]\]|\{\{.*?\}\}|\[\/.*?\/\]|\[\\.*?\\\]|\{.*?\}|>.*?\]|\(.*?\)|\[.*?\]))?(?::::[A-Za-z0-9_-]+)?/;
const EDGES: RegExp[] = [
  /^\s*(<?)(-->|---|==>|===|-\.->|-\.-|--[ox]|<-->)\s*(?:\|([^|]*)\|)?\s*/,
  /^\s*(<?)--\s+(.+?)\s+(-->|---)\s*/,
  /^\s*(<?)==\s+(.+?)\s+(==>|===)\s*/,
  /^\s*(<?)-\.\s+(.+?)\s+\.->\s*/,
];

export function parseMermaid(text: string): DiagramImport {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i]!.trim() || lines[i]!.trim().startsWith('%%') || lines[i]!.trim() === '---')) {
    // Skip blank lines, comments and a front-matter block.
    if (lines[i]!.trim() === '---') {
      i++;
      while (i < lines.length && lines[i]!.trim() !== '---') i++;
    }
    i++;
  }
  const header = (lines[i] ?? '').trim();
  if (/^sequenceDiagram\b/.test(header)) return parseSequence(lines, i + 1);
  if (/^(flowchart|graph)\b/.test(header)) return parseFlowchart(lines, i + 1);
  throw new DiagramParseError(
    header ? `Unsupported Mermaid diagram type "${header.split(/\s/)[0]}". Supported: flowchart/graph and sequenceDiagram.` : 'The Mermaid file is empty.',
  );
}

function parseFlowchart(lines: string[], start: number): DiagramImport {
  const result: DiagramImport = { kind: 'graph', nodes: [], edges: [], warnings: [], unconverted: [] };
  const nodes = new Map<string, ImportedNode>();
  const stack: string[] = [];
  const skippedStyles: number[] = [];
  const classes = new Map<string, string>();

  const touch = (id: string, raw?: string) => {
    let node = nodes.get(id);
    if (!node) {
      node = { sourceId: id, label: id };
      if (stack.length) node.parent = stack[stack.length - 1];
      nodes.set(id, node);
    }
    if (raw) {
      const shapeText = raw.trim();
      for (const [re, shape, kind] of SHAPES) {
        const m = re.exec(shapeText);
        if (m) {
          node.label = cleanLabel(m[1]!) || id;
          node.shape = shape;
          if (kind) node.kindHint = kind;
          break;
        }
      }
    }
    return node;
  };

  for (let n = start; n < lines.length; n++) {
    const lineNo = n + 1;
    const line = lines[n]!.trim().replace(/;$/, '');
    if (!line || line.startsWith('%%')) continue;
    let m: RegExpExecArray | null;
    if ((m = /^subgraph\s+([A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)*)?\s*(\[.*\])?\s*(.*)$/.exec(line))) {
      const id = m[1] ?? `subgraph_${lineNo}`;
      const node = touch(id);
      node.label = m[2] ? cleanLabel(m[2].slice(1, -1)) : m[3] ? cleanLabel(m[3]) : id;
      node.shape = 'subgraph';
      node.kindHint = 'domain';
      stack.push(id);
      continue;
    }
    if (line === 'end') {
      if (!stack.pop()) result.unconverted.push(`line ${lineNo}: ${line}`);
      continue;
    }
    if (/^direction\s/.test(line)) continue; // layout direction only
    if ((m = /^class\s+([^\s]+)\s+([A-Za-z0-9_-]+)$/.exec(line))) {
      for (const id of m[1]!.split(',')) classes.set(id, m[2]!);
      continue;
    }
    if (/^(classDef|style|linkStyle|click)\b/.test(line)) {
      skippedStyles.push(lineNo);
      result.unconverted.push(`line ${lineNo}: ${line}`);
      continue;
    }
    // Statement: node (edge node)*, with "&" groups.
    let rest = line;
    let prev: string[] | null = null;
    let pendingEdge: { label?: string; dashed?: boolean } | null = null;
    let ok = true;
    for (;;) {
      const group: string[] = [];
      for (;;) {
        const nm = NODE.exec(rest);
        if (!nm) {
          ok = false;
          break;
        }
        touch(nm[1]!, nm[2]);
        group.push(nm[1]!);
        rest = rest.slice(nm[0].length);
        const amp = /^\s*&\s*/.exec(rest);
        if (!amp) break;
        rest = rest.slice(amp[0].length);
      }
      if (!ok) break;
      if (prev && pendingEdge) {
        for (const a of prev) for (const b of group) result.edges.push({ from: a, to: b, ...pendingEdge });
      }
      prev = group;
      if (!rest.trim()) break;
      let edge: { label?: string; dashed?: boolean } | null = null;
      for (const re of EDGES) {
        const em = re.exec(rest);
        if (!em) continue;
        const op = (re === EDGES[0] ? em[2] : em[3]) ?? '';
        const text = re === EDGES[0] ? em[3] : em[2];
        edge = { ...(text && cleanLabel(text) ? { label: cleanLabel(text) } : {}), ...(op.includes('.') || re === EDGES[3] ? { dashed: true } : {}) };
        rest = rest.slice(em[0].length);
        break;
      }
      if (!edge) {
        ok = false;
        break;
      }
      pendingEdge = edge;
    }
    if (!ok) {
      result.unconverted.push(`line ${lineNo}: ${line}`);
      result.warnings.push(`Line ${lineNo} could not be converted and was kept as metadata: ${line}`);
    }
  }
  if (stack.length) result.warnings.push(`${stack.length} subgraph(s) were not closed with "end".`);
  if (skippedStyles.length) result.warnings.push(`Styling statements (lines ${skippedStyles.join(', ')}) are not converted; they are kept as metadata.`);
  const categoryKinds: Record<string, ElementKind> = { data: 'data-entity', infrastructure: 'infrastructure-resource' };
  for (const [id, cls] of classes) {
    const node = nodes.get(id);
    if (node && !node.kindHint && categoryKinds[cls]) node.kindHint = categoryKinds[cls];
  }
  result.nodes = [...nodes.values()];
  return result;
}
function parseSequence(lines: string[], start: number): DiagramImport {
  const result: DiagramImport = { kind: 'sequence', nodes: [], edges: [], warnings: [], unconverted: [], sequence: { participants: [], steps: [] } };
  const seq = result.sequence!;
  const participants = new Map<string, { sourceId: string; label: string; actor: boolean }>();
  const conditions: string[] = [];
  const touch = (id: string, labelText?: string, actor = false) => {
    let p = participants.get(id);
    if (!p) {
      p = { sourceId: id, label: id, actor };
      participants.set(id, p);
      seq.participants.push(p);
    }
    if (labelText) p.label = cleanLabel(labelText);
    if (actor) p.actor = true;
    return p;
  };
  for (let n = start; n < lines.length; n++) {
    const lineNo = n + 1;
    const line = lines[n]!.trim();
    if (!line || line.startsWith('%%') || line === 'autonumber') continue;
    let m: RegExpExecArray | null;
    if ((m = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(line))) {
      touch(m[2]!.trim(), m[3], m[1] === 'actor');
      continue;
    }
    if ((m = /^(alt|opt|loop|par|critical|break|rect)\b\s*(.*)$/.exec(line))) {
      conditions.push(m[1] === 'rect' ? '' : `${m[1] === 'alt' || m[1] === 'opt' ? '' : `${m[1]}: `}${m[2]!.trim()}`);
      continue;
    }
    if ((m = /^(else|and|option)\b\s*(.*)$/.exec(line))) {
      if (conditions.length) conditions[conditions.length - 1] = m[2]!.trim() || 'else';
      continue;
    }
    if (line === 'end') {
      if (conditions.pop() === undefined) result.unconverted.push(`line ${lineNo}: ${line}`);
      continue;
    }
    if ((m = /^([^\s:<>-][^:<>]*?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*([^:]+?)\s*:\s*(.*)$/.exec(line))) {
      const from = touch(m[1]!.trim()).sourceId;
      const to = touch(m[3]!.trim()).sourceId;
      const condition = conditions.filter(Boolean).join(' / ');
      seq.steps.push({ from, to, label: cleanLabel(m[4]!) || '(no label)', ...(condition ? { condition } : {}) });
      continue;
    }
    result.unconverted.push(`line ${lineNo}: ${line}`);
    result.warnings.push(`Line ${lineNo} could not be converted and was kept as metadata: ${line}`);
  }
  return result;
}
