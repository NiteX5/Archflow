/**
 * Layout: saved positions from the view file always win; elements without a
 * saved position get a deterministic automatic position. Layout never changes
 * the semantic model.
 */
import type { DerivedView } from './views.js';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;
const GAP_X = 120;
const GAP_Y = 40;
const PAD = 24;
const HEADER = 52;

/** Absolute boxes for every node in the view. */
export function layoutView(derived: DerivedView): Record<string, Box> {
  const saved = derived.view.layout ?? {};
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of derived.nodes) {
    if (n.parentInView) {
      const list = children.get(n.parentInView) ?? [];
      list.push(n.id);
      children.set(n.parentInView, list);
    } else {
      roots.push(n.id);
    }
  }

  // 1. Sizes, bottom-up: groups grow to fit an automatic grid of their children.
  const size = new Map<string, { width: number; height: number }>();
  const measure = (id: string): { width: number; height: number } => {
    const own = saved[id];
    const kids = children.get(id) ?? [];
    let width = own?.width ?? NODE_WIDTH;
    let height = own?.height ?? NODE_HEIGHT;
    if (kids.length > 0) {
      const cols = Math.ceil(Math.sqrt(kids.length));
      const sizes = kids.map(measure);
      const colWidth = Math.max(...sizes.map((s) => s.width));
      const rowHeight = Math.max(...sizes.map((s) => s.height));
      const rows = Math.ceil(kids.length / cols);
      width = Math.max(width, PAD * 2 + cols * colWidth + (cols - 1) * GAP_Y);
      height = Math.max(height, HEADER + PAD + rows * rowHeight + (rows - 1) * GAP_Y);
    }
    const s = { width, height };
    size.set(id, s);
    return s;
  };
  roots.forEach(measure);

  // 2. Top-level ranks from edges (longest path, cycle-safe) for a left-to-right flow.
  const rootOf = new Map<string, string>();
  const byId = new Map(derived.nodes.map((n) => [n.id, n]));
  const findRoot = (id: string): string => {
    const parent = byId.get(id)?.parentInView;
    return parent ? findRoot(parent) : id;
  };
  for (const n of derived.nodes) rootOf.set(n.id, findRoot(n.id));
  const rank = new Map(roots.map((r) => [r, 0]));
  for (let pass = 0; pass < roots.length; pass++) {
    let changed = false;
    for (const e of derived.edges) {
      const a = rootOf.get(e.from);
      const b = rootOf.get(e.to);
      if (!a || !b || a === b) continue;
      const next = (rank.get(a) ?? 0) + 1;
      if (next > (rank.get(b) ?? 0) && next < roots.length) {
        rank.set(b, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Flow-based views keep participants in declaration order on one row.
  if (derived.flow) roots.forEach((r, i) => rank.set(r, i));

  const boxes: Record<string, Box> = {};
  const columns = new Map<number, string[]>();
  for (const r of roots) {
    const k = rank.get(r) ?? 0;
    columns.set(k, [...(columns.get(k) ?? []), r]);
  }
  let x = 0;
  for (const k of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(k)!;
    const colWidth = Math.max(...col.map((id) => size.get(id)!.width));
    let y = 0;
    for (const id of col) {
      const s = size.get(id)!;
      boxes[id] = { x, y, ...s };
      y += s.height + GAP_Y;
    }
    x += colWidth + GAP_X;
  }

  // 3. Children: automatic grid inside the parent, unless saved.
  const place = (parent: string) => {
    const kids = children.get(parent) ?? [];
    const p = boxes[parent]!;
    const cols = Math.ceil(Math.sqrt(kids.length));
    const sizes = kids.map((k) => size.get(k)!);
    const colWidth = Math.max(0, ...sizes.map((s) => s.width));
    const rowHeight = Math.max(0, ...sizes.map((s) => s.height));
    kids.forEach((kid, i) => {
      boxes[kid] = {
        x: p.x + PAD + (i % cols) * (colWidth + GAP_Y),
        y: p.y + HEADER + Math.floor(i / cols) * (rowHeight + GAP_Y),
        ...size.get(kid)!,
      };
    });
  };

  // Apply saved positions top-down so automatic children follow saved parents.
  const apply = (id: string) => {
    const own = saved[id];
    if (own) boxes[id] = { ...boxes[id]!, x: own.x, y: own.y };
    place(id);
    for (const kid of children.get(id) ?? []) apply(kid);
  };
  roots.forEach(apply);

  // 4. Groups must enclose their children, wherever those were saved.
  const enclose = (id: string) => {
    const kids = children.get(id) ?? [];
    kids.forEach(enclose);
    if (kids.length === 0) return;
    const b = boxes[id]!;
    const right = Math.max(...kids.map((k) => boxes[k]!.x + boxes[k]!.width)) + PAD;
    const bottom = Math.max(...kids.map((k) => boxes[k]!.y + boxes[k]!.height)) + PAD;
    const left = Math.min(b.x, ...kids.map((k) => boxes[k]!.x - PAD));
    const top = Math.min(b.y, ...kids.map((k) => boxes[k]!.y - HEADER));
    boxes[id] = { x: left, y: top, width: Math.max(b.x + b.width, right) - left, height: Math.max(b.y + b.height, bottom) - top };
  };
  roots.forEach(enclose);

  return boxes;
}
