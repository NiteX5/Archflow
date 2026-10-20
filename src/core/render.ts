/**
 * Static rendering of a view for export. A view is turned into a neutral
 * scene (boxes, lines, texts) that is written as SVG or PDF, so both formats
 * show exactly the same content.
 */
import type { Box } from './layout.js';
import { categoryOf, type ElementCategory } from './schema.js';
import type { DerivedView } from './views.js';

export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string;
  dashed?: boolean;
  radius?: number;
}
export interface SceneLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  dashed?: boolean;
  arrow?: boolean;
}
export interface SceneText {
  x: number;
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  anchor?: 'start' | 'middle';
  color: string;
}
export interface Scene {
  width: number;
  height: number;
  title: string;
  rects: SceneRect[];
  lines: SceneLine[];
  texts: SceneText[];
}

const COLORS: Record<ElementCategory, string> = {
  infrastructure: '#8250df',
  system: '#0969da',
  internal: '#1a7f37',
  behavior: '#9a6700',
  data: '#bc4c00',
  business: '#cf222e',
  documentation: '#57606a',
};
const TEXT = '#1f2328';
const MUTED = '#656d76';
const MARGIN = 24;

/** Fits text into a width (approximate average glyph width), adding an ellipsis. */
function fit(text: string, width: number, size: number): string {
  const max = Math.max(3, Math.floor(width / (size * 0.55)));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Point on the border of box `b` towards point (tx, ty). */
function border(b: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : b.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : b.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function buildScene(derived: DerivedView, boxes: Record<string, Box>): Scene {
  return derived.view.type === 'sequence' ? sequenceScene(derived) : diagramScene(derived, boxes);
}

function diagramScene(derived: DerivedView, boxes: Record<string, Box>): Scene {
  const ids = derived.nodes.map((n) => n.id);
  const minX = Math.min(0, ...ids.map((id) => boxes[id]!.x));
  const minY = Math.min(0, ...ids.map((id) => boxes[id]!.y));
  const ox = MARGIN - minX;
  const oy = MARGIN + 28 - minY;
  const scene: Scene = { width: 0, height: 0, title: derived.view.name, rects: [], lines: [], texts: [] };
  scene.texts.push({ x: MARGIN, y: MARGIN + 6, text: derived.view.name, size: 14, bold: true, color: TEXT });

  const depth = (id: string): number => {
    const p = derived.nodes.find((n) => n.id === id)?.parentInView;
    return p ? 1 + depth(p) : 0;
  };
  // Groups first so children are drawn on top.
  for (const n of [...derived.nodes].sort((a, b) => depth(a.id) - depth(b.id))) {
    const b = boxes[n.id]!;
    const color = derived.view.styles?.[n.id]?.color ?? COLORS[categoryOf(n.element.kind)];
    const isGroup = derived.nodes.some((c) => c.parentInView === n.id);
    const status = n.element.provenance?.status;
    scene.rects.push({
      x: b.x + ox,
      y: b.y + oy,
      w: b.width,
      h: b.height,
      stroke: color,
      fill: isGroup ? '#f6f8fa' : '#ffffff',
      dashed: status === 'inferred' || status === 'pending-review' || n.element.lifecycle === 'deleted',
      radius: 6,
    });
    scene.texts.push({ x: b.x + ox + 8, y: b.y + oy + 14, text: fit(n.element.kind, b.width - 16, 9), size: 9, color: MUTED });
    scene.texts.push({ x: b.x + ox + 8, y: b.y + oy + 30, text: fit(n.element.name, b.width - 16, 12), size: 12, bold: true, color: TEXT });
    if (n.element.lifecycle && n.element.lifecycle !== 'active') {
      scene.texts.push({ x: b.x + ox + 8, y: b.y + oy + 44, text: n.element.lifecycle, size: 9, color: '#cf222e' });
    }
  }
  for (const e of derived.edges) {
    const a = boxes[e.from];
    const b = boxes[e.to];
    if (!a || !b) continue;
    const p1 = border(a, b.x + b.width / 2, b.y + b.height / 2);
    const p2 = border(b, a.x + a.width / 2, a.y + a.height / 2);
    const status = e.relation?.provenance?.status;
    scene.lines.push({
      x1: p1.x + ox,
      y1: p1.y + oy,
      x2: p2.x + ox,
      y2: p2.y + oy,
      stroke: MUTED,
      dashed: !e.relation?.provenance || status === 'inferred' || status === 'pending-review',
      arrow: true,
    });
    scene.texts.push({ x: (p1.x + p2.x) / 2 + ox, y: (p1.y + p2.y) / 2 + oy - 4, text: e.label, size: 9, anchor: 'middle', color: MUTED });
  }
  const right = Math.max(200, ...ids.map((id) => boxes[id]!.x + boxes[id]!.width)) + ox + MARGIN;
  const bottom = Math.max(40, ...ids.map((id) => boxes[id]!.y + boxes[id]!.height)) + oy + MARGIN;
  scene.width = Math.ceil(right);
  scene.height = Math.ceil(bottom);
  if (derived.incomplete.length) {
    derived.incomplete.forEach((r, i) => scene.texts.push({ x: MARGIN, y: scene.height + 14 * i, text: `Incomplete: ${r}`, size: 10, color: '#9a6700' }));
    scene.height += 14 * derived.incomplete.length + MARGIN;
  }
  return scene;
}

function sequenceScene(derived: DerivedView): Scene {
  const COL = 200;
  const TOP = 70 + 28;
  const ROW = 56;
  const steps = derived.flow?.steps ?? [];
  const idx = new Map(derived.nodes.map((n, i) => [n.id, i]));
  const cx = (id: string) => MARGIN + (idx.get(id) ?? 0) * COL + COL / 2;
  const height = TOP + (steps.length + 1) * ROW + MARGIN;
  const scene: Scene = {
    width: MARGIN * 2 + Math.max(1, derived.nodes.length) * COL,
    height,
    title: derived.view.name,
    rects: [],
    lines: [],
    texts: [{ x: MARGIN, y: MARGIN + 6, text: derived.view.name, size: 14, bold: true, color: TEXT }],
  };
  for (const n of derived.nodes) {
    const x = cx(n.id);
    scene.rects.push({ x: x - 80, y: 38, w: 160, h: 40, stroke: COLORS[categoryOf(n.element.kind)], fill: '#f6f8fa', radius: 6 });
    scene.texts.push({ x, y: 62, text: fit(n.element.name, 150, 12), size: 12, bold: true, anchor: 'middle', color: TEXT });
    scene.lines.push({ x1: x, y1: 78, x2: x, y2: height - MARGIN, stroke: '#d0d7de', dashed: true });
  }
  steps.forEach((s, i) => {
    const y = TOP + (i + 1) * ROW - ROW / 2;
    const from = cx(s.from);
    const to = s.to !== undefined ? cx(s.to) : from + 40;
    scene.lines.push({ x1: from, y1: y, x2: to === from ? from + 40 : to, y2: y, stroke: TEXT, arrow: true });
    const label = `${i + 1}. ${s.action}${s.condition ? ` [${s.condition}]` : ''}`;
    scene.texts.push({ x: to === from ? from + 46 : (from + to) / 2, y: y - 6, text: label, size: 10, anchor: to === from ? 'start' : 'middle', color: TEXT });
  });
  derived.incomplete.forEach((r, i) => scene.texts.push({ x: MARGIN, y: height + 14 * i, text: `Incomplete: ${r}`, size: 10, color: '#9a6700' }));
  scene.height += derived.incomplete.length ? 14 * derived.incomplete.length + MARGIN : 0;
  return scene;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sceneToSvg(scene: Scene): string {
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="Helvetica, Arial, sans-serif">`,
    `<title>${esc(scene.title)}</title>`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#656d76"/></marker></defs>',
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ];
  for (const r of scene.rects) {
    out.push(
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.radius ?? 0}" fill="${r.fill}" stroke="${r.stroke}" stroke-width="2"${r.dashed ? ' stroke-dasharray="6 4"' : ''}/>`,
    );
  }
  for (const l of scene.lines) {
    out.push(
      `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.stroke}" stroke-width="1.5"${l.dashed ? ' stroke-dasharray="5 4"' : ''}${l.arrow ? ' marker-end="url(#arrow)"' : ''}/>`,
    );
  }
  for (const t of scene.texts) {
    out.push(
      `<text x="${t.x}" y="${t.y}" font-size="${t.size}"${t.bold ? ' font-weight="bold"' : ''}${t.anchor === 'middle' ? ' text-anchor="middle"' : ''} fill="${t.color}">${esc(t.text)}</text>`,
    );
  }
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

/** Characters outside Latin-1 cannot be drawn with the standard PDF fonts used here. */
export interface PdfResult {
  bytes: Uint8Array;
  replacedCharacters: string[];
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`;
};

/** Minimal single-page vector PDF (PDF 1.4, Helvetica, WinAnsi). */
export function sceneToPdf(scene: Scene): PdfResult {
  const replaced = new Set<string>();
  const pdfText = (s: string) => {
    let out = '';
    for (const ch of s.replace('…', '...')) {
      const code = ch.codePointAt(0)!;
      if (code > 255 || (code < 32 && code !== 9)) {
        replaced.add(ch);
        out += '?';
      } else out += ch;
    }
    return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  };
  const H = scene.height;
  const ops: string[] = ['1 1 1 rg', `0 0 ${scene.width} ${H} re f`];
  for (const r of scene.rects) {
    ops.push(`${rgb(r.fill)} rg ${rgb(r.stroke)} RG 2 w ${r.dashed ? '[6 4] 0 d' : '[] 0 d'}`);
    ops.push(`${r.x} ${H - r.y - r.h} ${r.w} ${r.h} re B`);
  }
  for (const l of scene.lines) {
    ops.push(`${rgb(l.stroke)} RG 1.5 w ${l.dashed ? '[5 4] 0 d' : '[] 0 d'}`);
    ops.push(`${l.x1} ${H - l.y1} m ${l.x2} ${H - l.y2} l S`);
    if (l.arrow) {
      const a = Math.atan2(-(l.y2 - l.y1), l.x2 - l.x1);
      const x = l.x2;
      const y = H - l.y2;
      const p = (da: number) => `${(x - 8 * Math.cos(a + da)).toFixed(2)} ${(y - 8 * Math.sin(a + da)).toFixed(2)}`;
      ops.push(`[] 0 d ${rgb(l.stroke)} rg ${x.toFixed(2)} ${y.toFixed(2)} m ${p(0.45)} l ${p(-0.45)} l f`);
    }
  }
  for (const t of scene.texts) {
    const text = pdfText(t.text);
    // Approximate centering; Helvetica averages ~0.5em per glyph.
    const x = t.anchor === 'middle' ? t.x - (text.length * t.size * 0.5) / 2 : t.x;
    ops.push(`BT ${rgb(t.color)} rg /${t.bold ? 'F2' : 'F1'} ${t.size} Tf ${x.toFixed(2)} ${(H - t.y).toFixed(2)} Td (${text}) Tj ET`);
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${scene.width} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title (${pdfText(scene.title)}) /Producer (Archflow) >>`,
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is <= 0xFF at this point, so string length equals byte length.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return { bytes, replacedCharacters: [...replaced] };
}
