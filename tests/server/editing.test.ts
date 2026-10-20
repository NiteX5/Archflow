import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppState } from '../../src/core/api.js';
import { hashValue } from '../../src/core/hash.js';
import { entityHash, suggestId } from '../../src/core/ops.js';
import type { RunningServer } from '../../src/server/serve.js';
import { call, copySample, start } from './helpers.js';

let repo: string;
let cleanup: () => Promise<void>;
let s: RunningServer;

beforeEach(async () => {
  ({ dir: repo, cleanup } = await copySample());
  s = await start(repo);
});
afterEach(async () => {
  await s.stop();
  await cleanup();
});

const file = (rel: string) => readFile(path.join(repo, '.archflow', rel), 'utf8');
const put = (rel: string, content: string) => writeFile(path.join(repo, '.archflow', rel), content, 'utf8');
const ops = (...list: unknown[]) => call(s, 'POST', '/api/ops', { ops: list });
const state = async (): Promise<AppState> => (await call(s, 'GET', '/api/state')).body;
const hashOf = async (id: string) => entityHash((await state()).model!, id);
const until = async (check: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition not met in time');
};

describe('editing elements and relations', () => {
  it('renames an element in place, keeping its ID, comments and relations', async () => {
    const r = await ops({ op: 'update', id: 'payment-provider', set: { name: 'Stripe' }, expected: await hashOf('payment-provider') });
    expect(r.status).toBe(200);
    const text = await file('systems.yaml');
    expect(text).toContain('name: Stripe');
    expect(text).toContain('# Provenance intentionally missing: it is shown as unknown.');
    const m = r.body.state.model;
    expect(m.elements.find((e: { id: string }) => e.id === 'payment-provider').name).toBe('Stripe');
    expect(m.relations.filter((x: { to: string }) => x.to === 'payment-provider')).toHaveLength(2);
  });

  it('removes fields set to null and refuses to change IDs', async () => {
    expect((await ops({ op: 'update', id: 'orders-db', set: { description: null } })).status).toBe(200);
    expect(await file('data.yaml')).not.toContain('PostgreSQL');
    const r = await ops({ op: 'update', id: 'orders-db', set: { id: 'other' } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/IDs are stable/);
  });

  it('creates elements in the file of their category, or of their parent', async () => {
    const r = await ops(
      { op: 'create', entity: 'element', value: { id: 'cache-1', kind: 'database', name: 'Cache' } },
      { op: 'create', entity: 'element', value: { id: 'billing-1', kind: 'module', name: 'Billing', parent: 'public-api' } },
      { op: 'create', entity: 'element', value: { id: 'rule-1', kind: 'business-rule', name: 'Max 10 items' } },
      { op: 'create', entity: 'relation', value: { id: 'rel-billing-cache', type: 'reads', from: 'billing-1', to: 'cache-1' } },
    );
    expect(r.status).toBe(200);
    expect(await file('data.yaml')).toContain('id: cache-1');
    expect(await file('systems.yaml')).toContain('id: billing-1');
    expect(await file('systems.yaml')).toContain('id: rel-billing-cache');
    expect(await file('components.yaml')).toContain('id: rule-1');
  });

  it('rejects changes that would make the model invalid, without writing anything', async () => {
    const before = await file('systems.yaml');
    const r = await ops(
      { op: 'update', id: 'customer', set: { name: 'Buyer' } },
      { op: 'create', entity: 'relation', value: { id: 'rel-bad', type: 'calls', from: 'customer', to: 'ghost' } },
    );
    expect(r.status).toBe(422);
    expect(r.body.issues[0]).toMatchObject({ code: 'broken-reference' });
    expect(await file('systems.yaml')).toBe(before);
    expect((await state()).model!.elements.find((e) => e.id === 'customer')!.name).toBe('Customer');
  });

  it('rejects duplicate IDs and unsafe file paths', async () => {
    const dup = await ops({ op: 'create', entity: 'element', value: { id: 'customer', kind: 'actor', name: 'Again' } });
    expect(dup.status).toBe(409);
    for (const bad of ['../x.yaml', 'history/x.yaml', 'manifest.yaml', 'a/../../b.yaml', 'x.yml']) {
      const r = await ops({ op: 'create', entity: 'element', value: { id: 'x-1', kind: 'actor', name: 'X' }, file: bad });
      expect(r.status, bad).toBe(400);
    }
  });

  it('validates the request shape', async () => {
    expect((await call(s, 'POST', '/api/ops', { ops: [] })).status).toBe(400);
    expect((await call(s, 'POST', '/api/ops', { ops: [{ op: 'explode' }] })).status).toBe(400);
  });
});

describe('logical deletion and restoration', () => {
  it('deletes an element with its active relations and restores both with the same IDs', async () => {
    const del = await ops({ op: 'delete', id: 'payment-provider', reason: 'Replaced' });
    expect(del.status).toBe(200);
    let m = del.body.state.model;
    const pp = m.elements.find((e: { id: string }) => e.id === 'payment-provider');
    expect(pp).toMatchObject({ lifecycle: 'deleted', deletedReason: 'Replaced' });
    expect(m.relations.filter((r: { to: string; lifecycle?: string }) => r.to === 'payment-provider').every((r: { lifecycle?: string }) => r.lifecycle === 'deleted')).toBe(true);

    const res = await ops({ op: 'restore', id: 'payment-provider' });
    expect(res.status).toBe(200);
    m = res.body.state.model;
    expect(m.elements.find((e: { id: string }) => e.id === 'payment-provider').lifecycle).toBeUndefined();
    expect(m.relations.filter((r: { to: string }) => r.to === 'payment-provider').every((r: { lifecycle?: string }) => r.lifecycle === undefined)).toBe(true);
    expect(await file('systems.yaml')).not.toContain('deletedAt');
  });

  it('refuses to delete an element that still contains active elements', async () => {
    const r = await ops({ op: 'delete', id: 'public-api' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/contains active elements/);
  });

  it('does not restore relations that were deleted on their own', async () => {
    await ops({ op: 'delete', id: 'rel-api-pays', reason: 'Not used' });
    await ops({ op: 'delete', id: 'payment-provider' });
    const r = await ops({ op: 'restore', id: 'payment-provider' });
    const rel = r.body.state.model.relations.find((x: { id: string }) => x.id === 'rel-api-pays');
    expect(rel.lifecycle).toBe('deleted');
  });
});

describe('conflicts', () => {
  it('rejects an edit when the same element changed on disk, and keeps the other change', async () => {
    const expected = await hashOf('customer');
    await put('systems.yaml', (await file('systems.yaml')).replace('name: Customer', 'name: Client (by Claude)'));
    const r = await ops({ op: 'update', id: 'customer', set: { name: 'Buyer' }, expected });
    expect(r.status).toBe(409);
    expect(r.body.conflicts[0]).toMatchObject({ id: 'customer', current: { name: 'Client (by Claude)' } });
    expect(await file('systems.yaml')).toContain('Client (by Claude)');
  });

  it('merges independent changes to different elements', async () => {
    const expected = await hashOf('orders-db');
    await put('systems.yaml', (await file('systems.yaml')).replace('name: Customer', 'name: Client (by Claude)'));
    const r = await ops({ op: 'update', id: 'orders-db', set: { name: 'Orders DB' }, expected });
    expect(r.status).toBe(200);
    const m = r.body.state.model;
    expect(m.elements.find((e: { id: string }) => e.id === 'customer').name).toBe('Client (by Claude)');
    expect(m.elements.find((e: { id: string }) => e.id === 'orders-db').name).toBe('Orders DB');
  });

  it('refuses to edit while the files on disk are invalid', async () => {
    await put('data.yaml', 'elements: [oops');
    const r = await ops({ op: 'update', id: 'customer', set: { name: 'Buyer' } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('model-invalid');
    expect(r.body.issues[0].code).toBe('yaml-syntax');
  });
});

describe('layout and styles', () => {
  it('stores positions in a view file, creating it for a built-in view', async () => {
    const r = await ops({ op: 'layout', view: 'builtin:data', entries: { 'orders-db': { x: 10, y: 20 } } });
    expect(r.status).toBe(200);
    expect(r.body.createdViews).toEqual({ 'builtin:data': 'view-data' });
    const text = await file('views/view-data.yaml');
    expect(text).toContain('orders-db: { x: 10, y: 20 }');
    // Layout changes never touch the semantic files.
    expect(await file('data.yaml')).not.toContain('x: 10');
  });

  it('detects concurrent position changes of the same element', async () => {
    const view = (await state()).model!.views.find((v) => v.id === 'view-overview')!;
    const expected = { customer: hashValue(view.layout?.['customer'] ?? null) };
    await put('views/overview.yaml', (await file('views/overview.yaml')).replace('customer: { x: 0, y: 0 }', 'customer: { x: 5, y: 5 }'));
    const r = await ops({ op: 'layout', view: 'view-overview', entries: { customer: { x: 99, y: 99 } }, expected });
    expect(r.status).toBe(409);
    expect(await file('views/overview.yaml')).toContain('customer: { x: 5, y: 5 }');
  });

  it('sets and clears styles', async () => {
    let r = await ops({ op: 'style', view: 'view-overview', element: 'customer', style: { color: '#ff0000', shape: 'ellipse' } });
    expect(r.status).toBe(200);
    expect(await file('views/overview.yaml')).toContain('customer: { color: "#ff0000", shape: ellipse }');
    r = await ops({ op: 'style', view: 'view-overview', element: 'customer', style: { color: 'red' } });
    expect(r.status).toBe(422);
    r = await ops({ op: 'style', view: 'view-overview', element: 'customer', style: null });
    expect(r.status).toBe(200);
    expect(await file('views/overview.yaml')).not.toContain('#ff0000');
  });

  it('creates free views and deletes views', async () => {
    let r = await ops({ op: 'create', entity: 'view', value: { id: 'v-mine', name: 'Mine', type: 'free', include: ['customer'] } });
    expect(r.status).toBe(200);
    expect(await file('views/v-mine.yaml')).toContain('type: free');
    r = await ops({ op: 'delete', id: 'v-mine' });
    expect(r.status).toBe(200);
    expect(await readdir(path.join(repo, '.archflow', 'views'))).not.toContain('v-mine.yaml');
  });
});

describe('history', () => {
  it('records each change and restores an earlier state, itself recorded', async () => {
    const original = await file('systems.yaml');
    await ops({ op: 'update', id: 'customer', set: { name: 'Buyer' } });
    await ops({ op: 'update', id: 'customer', set: { description: 'Changed' } });
    const list = (await call(s, 'GET', '/api/history')).body;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ origin: 'ui', files: ['systems.yaml'] });
    const entry = (await call(s, 'GET', `/api/history/${list[1].id}`)).body;
    expect(entry.changes[0].before).toBe(original);

    const r = await call(s, 'POST', `/api/history/${list[1].id}/restore`, {});
    expect(r.status).toBe(200);
    expect(await file('systems.yaml')).toBe(original);
    const after = (await call(s, 'GET', '/api/history')).body;
    expect(after[0].origin).toBe('restore');
    expect(after).toHaveLength(3);
  });

  it('refuses to restore when files changed in ways the history does not cover', async () => {
    await ops({ op: 'update', id: 'customer', set: { name: 'Buyer' } });
    const [entry] = (await call(s, 'GET', '/api/history')).body;
    // Simulate an untracked change: edit the file and the in-memory snapshot without history.
    await s.stop();
    await put('systems.yaml', (await file('systems.yaml')).replace('name: Buyer', 'name: Edited offline'));
    s = await start(repo);
    const r = await call(s, 'POST', `/api/history/${entry.id}/restore`, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('history-diverged');
  });

  it('returns 404 for unknown entries', async () => {
    expect((await call(s, 'GET', '/api/history/123')).status).toBe(404);
    expect((await call(s, 'POST', '/api/history/1234567890123-000001/restore', {})).status).toBe(404);
  });
});

describe('external changes (watcher)', () => {
  it('applies valid external edits, keeps the last valid model on errors, and recovers', async () => {
    await put('systems.yaml', (await file('systems.yaml')).replace('name: Customer', 'name: Shopper'));
    await until(async () => (await state()).model!.elements.some((e) => e.name === 'Shopper'));
    const history = (await call(s, 'GET', '/api/history')).body;
    expect(history[0]).toMatchObject({ origin: 'external', files: ['systems.yaml'] });

    const valid = await state();
    await put('data.yaml', 'elements:\n  - id: Bad Id\n');
    await until(async () => (await state()).status === 'invalid');
    const invalid = await state();
    expect(invalid.version).toBe(valid.version);
    expect(invalid.model!.elements.some((e) => e.name === 'Shopper')).toBe(true);
    expect(invalid.issues.some((i) => i.file === 'data.yaml' && i.severity === 'error')).toBe(true);

    await put('data.yaml', 'elements:\n  - id: orders-db\n    kind: database\n    name: Orders database\n  - id: orders-table\n    kind: table\n    name: orders\n    parent: orders-db\nrelations:\n  - id: rel-api-reads-db\n    type: reads\n    from: public-api\n    to: orders-db\n');
    await until(async () => (await state()).status === 'valid');
    expect((await state()).issues).toEqual([]);
  });

  it('does not record its own writes twice', async () => {
    await ops({ op: 'update', id: 'customer', set: { name: 'Buyer' } });
    await new Promise((r) => setTimeout(r, 400));
    const history = (await call(s, 'GET', '/api/history')).body;
    expect(history.map((h: { origin: string }) => h.origin)).toEqual(['ui']);
  });
});

describe('suggestId', () => {
  it('builds a slug with a random suffix and avoids taken IDs', () => {
    let n = 0;
    const seq = [0, 0, 0.5];
    const id = suggestId('Órdenes API!', (x) => x === 'ordenes-api-0000', () => seq[n++]!);
    expect(id).toMatch(/^ordenes-api-[a-z0-9]{4}$/);
    expect(id).not.toBe('ordenes-api-0000');
    expect(suggestId('123', () => false)).toMatch(/^item-[a-z0-9]{4}$/);
  });
});
