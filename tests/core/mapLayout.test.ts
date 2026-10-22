import path from 'node:path';
import ElkModule from 'elkjs/lib/elk.bundled.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { aggregateEdges, buildTree, visibleNodes, type MapTree } from '../../src/core/hierarchy.js';
import { applyOffsets, layoutMap, SIZES, type ElkLike } from '../../src/core/mapLayout.js';
import type { Model } from '../../src/core/index.js';
import { loadModel } from '../../src/node/repo.js';
import { SAMPLE_REPO } from '../helpers.js';

let model: Model;
let tree: MapTree;
// CommonJS default export: the constructor is either the module itself or its `default`.
const ELK = ((ElkModule as unknown as { default?: unknown }).default ?? ElkModule) as new () => ElkLike;
const elk = new ELK();
beforeAll(async () => {
  model = (await loadModel(path.resolve(SAMPLE_REPO, '../modular-app'))).model!;
  tree = buildTree(model);
});

async function layout(expandedIds: string[], detail = false) {
  const expanded = new Set(expandedIds);
  const visible = visibleNodes(tree, { expanded, detail });
  const edges = aggregateEdges(model, tree, visible);
  return { visible, edges, ...(await layoutMap(elk, tree, visible, edges, expanded)) };
}

const inside = (c: { x: number; y: number; width: number; height: number }, p: { x: number; y: number; width: number; height: number }) =>
  c.x >= p.x && c.y >= p.y && c.x + c.width <= p.x + p.width && c.y + c.height <= p.y + p.height;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('map layout', () => {
  it('lays out collapsed roots without overlaps and routes every edge', async () => {
    const r = await layout([]);
    expect(Object.keys(r.boxes).sort()).toEqual([...r.visible].sort());
    expect(r.boxes['aws-cloud']).toMatchObject(SIZES.collapsed);
    for (const a of r.visible) for (const b of r.visible) if (a < b) expect(overlap(r.boxes[a]!, r.boxes[b]!), `${a}/${b}`).toBe(false);
    for (const e of r.edges) expect(r.routes[e.id]?.length, e.id).toBeGreaterThanOrEqual(2);
  });

  it('keeps children inside expanded containers and siblings apart', async () => {
    const r = await layout(['aws-cloud', 'ecs-cluster', 'clinic-api', 'auth-module'], true);
    expect(inside(r.boxes['clinic-api']!, r.boxes['ecs-cluster']!)).toBe(true);
    expect(inside(r.boxes['jwt-guard']!, r.boxes['auth-module']!)).toBe(true);
    const mods = ['auth-module', 'appointments-module', 'billing-module', 'notifications-module'];
    for (const a of mods) for (const b of mods) if (a < b) expect(overlap(r.boxes[a]!, r.boxes[b]!)).toBe(false);
  });

  it('routes are orthogonal', async () => {
    const r = await layout(['aws-cloud', 'ecs-cluster', 'clinic-api']);
    for (const pts of Object.values(r.routes)) {
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y).toBe(true);
    }
  });

  it('applies manual offsets to a node and its content, dropping stale routes', async () => {
    const r = await layout(['aws-cloud', 'ecs-cluster']);
    const moved = applyOffsets(tree, r, r.edges, { 'ecs-cluster': { x: 100, y: 50 } });
    expect(moved.boxes['ecs-cluster']!.x).toBe(r.boxes['ecs-cluster']!.x + 100);
    expect(moved.boxes['clinic-api']!.y).toBe(r.boxes['clinic-api']!.y + 50);
    const touching = r.edges.filter((e) => ['ecs-cluster', 'clinic-api'].includes(e.from) || ['ecs-cluster', 'clinic-api'].includes(e.to));
    for (const e of touching) expect(moved.routes[e.id]).toBeUndefined();
  });
});
