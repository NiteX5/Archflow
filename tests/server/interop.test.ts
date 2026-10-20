import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main.js';
import type { AppState } from '../../src/core/api.js';
import { loadModel } from '../../src/node/repo.js';
import { verifyModel } from '../../src/node/verify.js';
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

const state = async (): Promise<AppState> => (await call(s, 'GET', '/api/state')).body;

describe('export', () => {
  it('exports the model as JSON and YAML bundles', async () => {
    const json = await call(s, 'GET', '/api/export/model?format=json');
    expect(json.status).toBe(200);
    expect(json.headers['content-disposition']).toMatch(/attachment; filename="bookstore-example-.archflow.json"/);
    expect(json.body).toMatchObject({ format: 'archflow-model', schemaVersion: 1 });
    expect(json.body.elements).toHaveLength(11);
    expect(json.body.elements.find((e: { id: string }) => e.id === 'public-api').provenance.evidence).toHaveLength(1);
    const yaml = await call(s, 'GET', '/api/export/model?format=yaml');
    expect(yaml.text).toMatch(/^format: archflow-model\nschemaVersion: 1\n/);
    expect((await call(s, 'GET', '/api/export/model?format=xml')).status).toBe(400);
  });

  it('exports views as SVG, PDF, Mermaid and draw.io, including built-in views', async () => {
    const svg = await call(s, 'GET', '/api/export/view?view=view-overview&format=svg');
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svg.text).toContain('Payment provider');
    const pdf = await call(s, 'GET', '/api/export/view?view=builtin:data&format=pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.text.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.headers['x-archflow-warning']).toBeUndefined();
    expect((await call(s, 'GET', '/api/export/view?view=view-checkout&format=mermaid')).text).toMatch(/^sequenceDiagram/);
    expect((await call(s, 'GET', '/api/export/view?view=view-dependencies&format=drawio')).text).toContain('<mxfile');
    const unsupported = await call(s, 'GET', '/api/export/view?view=view-checkout&format=drawio');
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.message).toMatch(/Sequence views/);
    expect((await call(s, 'GET', '/api/export/view?view=nope&format=svg')).status).toBe(404);
  });
});

describe('import', () => {
  const mermaid = 'flowchart LR\n  web[Web storefront] --> search[Search service]\n  search -->|reads| idx[(Search index)]\n  style web fill:#fff\n';

  it('previews a Mermaid import without writing, then applies it', async () => {
    const before = await readdir(path.join(repo, '.archflow'));
    const preview = await call(s, 'POST', '/api/import/preview', { format: 'mermaid', content: mermaid, fileName: 'search.mmd' });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ mode: 'merge', valid: true, issues: [] });
    expect(preview.body.summary.reused).toEqual(['web-storefront']);
    expect(preview.body.summary.added).toHaveLength(5); // 2 elements, 2 relations, 1 view
    expect(preview.body.warnings.join('\n')).toMatch(/matched existing elements/);
    expect(preview.body.warnings.join('\n')).toMatch(/created as "component"/);
    expect(preview.body.warnings.join('\n')).toMatch(/Styling statements/);
    expect(await readdir(path.join(repo, '.archflow'))).toEqual(before);

    const applied = await call(s, 'POST', '/api/import/apply', { format: 'mermaid', content: mermaid, fileName: 'search.mmd', baseVersion: preview.body.baseVersion });
    expect(applied.status).toBe(200);
    const m = applied.body.model;
    const idx = m.elements.find((e: { name: string }) => e.name === 'Search index');
    expect(idx).toMatchObject({ kind: 'database', provenance: { source: 'tool-inferred', status: 'pending-review' } });
    expect(m.elements.filter((e: { name: string }) => e.name === 'Web storefront')).toHaveLength(1);
    const rel = m.relations.find((r: { to: string }) => r.to === idx.id);
    expect(rel.type).toBe('reads');
    const view = m.views.find((v: { type: string }) => v.type === 'free');
    expect(view.include).toContain('web-storefront');
    expect(view.metadata.unconverted).toEqual(['line 4: style web fill:#fff']);
    expect(await readFile(path.join(repo, '.archflow', 'imported', 'search.yaml'), 'utf8')).toContain('Search index');
    const history = (await call(s, 'GET', '/api/history')).body;
    expect(history[0].origin).toBe('import');
  });

  it('refuses to apply when the model changed after the preview', async () => {
    const preview = await call(s, 'POST', '/api/import/preview', { format: 'mermaid', content: mermaid, fileName: 'a.mmd' });
    await call(s, 'POST', '/api/ops', { ops: [{ op: 'update', id: 'customer', set: { name: 'Buyer' } }] });
    const r = await call(s, 'POST', '/api/import/apply', { format: 'mermaid', content: mermaid, fileName: 'a.mmd', baseVersion: preview.body.baseVersion });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('changed-since-preview');
  });

  it('imports a sequence diagram as a flow', async () => {
    const seq = 'sequenceDiagram\n  actor C as Customer\n  participant A as Public API\n  C->>A: GET /books\n';
    const p = await call(s, 'POST', '/api/import/preview', { format: 'mermaid', content: seq, fileName: 'browse.mmd' });
    expect(p.body.summary.reused.sort()).toEqual(['customer', 'public-api']);
    const r = await call(s, 'POST', '/api/import/apply', { format: 'mermaid', content: seq, fileName: 'browse.mmd', baseVersion: p.body.baseVersion });
    const flow = r.body.model.flows.find((f: { name: string }) => f.name === 'browse.mmd');
    expect(flow.steps).toEqual([{ id: 'step-1', from: 'customer', to: 'public-api', action: 'GET /books' }]);
  });

  it('round-trips a native export, marking removed entities as deleted', async () => {
    const exported = (await call(s, 'GET', '/api/export/model?format=json')).body;
    exported.elements = exported.elements.map((e: { id: string; name: string }) => (e.id === 'customer' ? { ...e, name: 'Shopper' } : e));
    exported.elements = exported.elements.filter((e: { id: string }) => e.id !== 'orders-table');
    exported.relations = exported.relations.filter((r: { to: string }) => r.to !== 'orders-table');
    const content = JSON.stringify(exported);
    const p = await call(s, 'POST', '/api/import/preview', { format: 'archflow-json', content, fileName: 'backup.json' });
    expect(p.body).toMatchObject({ mode: 'replace', valid: true });
    expect(p.body.summary.changed).toEqual(['customer']);
    expect(p.body.summary.markedDeleted.sort()).toEqual(['orders-table', 'rel-repo-writes-orders']);
    const r = await call(s, 'POST', '/api/import/apply', { format: 'archflow-json', content, fileName: 'backup.json', baseVersion: p.body.baseVersion });
    expect(r.status).toBe(200);
    expect(r.body.model.elements.find((e: { id: string }) => e.id === 'orders-table').lifecycle).toBe('deleted');
  });

  it('shows validation errors before anything is replaced', async () => {
    const exported = (await call(s, 'GET', '/api/export/model?format=json')).body;
    exported.relations.push({ id: 'rel-x', type: 'calls', from: 'customer', to: 'ghost' });
    const content = JSON.stringify(exported);
    const p = await call(s, 'POST', '/api/import/preview', { format: 'archflow-json', content, fileName: 'bad.json' });
    expect(p.body.valid).toBe(false);
    expect(p.body.issues[0].code).toBe('broken-reference');
    const r = await call(s, 'POST', '/api/import/apply', { format: 'archflow-json', content, fileName: 'bad.json', baseVersion: p.body.baseVersion });
    expect(r.status).toBe(422);
    expect((await state()).model!.relations.some((x) => x.id === 'rel-x')).toBe(false);
  });

  it('rejects unreadable or foreign files with a clear message', async () => {
    const cases: [string, string, RegExp][] = [
      ['archflow-json', '{nope', /not valid JSON/],
      ['archflow-yaml', 'format: other\n', /not an Archflow model export/],
      ['archflow-json', JSON.stringify({ format: 'archflow-model', schemaVersion: 9, manifest: {} }), /schema version 9/],
      ['mermaid', 'gantt\n  title x', /Unsupported Mermaid diagram type "gantt"/],
      ['drawio', '<svg/>', /No draw.io diagram/],
    ];
    for (const [format, content, msg] of cases) {
      const r = await call(s, 'POST', '/api/import/preview', { format, content, fileName: 'x' });
      expect(r.status, content).toBe(422);
      expect(r.body.message).toMatch(msg);
    }
    expect((await call(s, 'POST', '/api/import/preview', { format: 'pdf', content: 'x' })).status).toBe(400);
    expect((await call(s, 'POST', '/api/import/preview', { format: 'mermaid', content: '  ' })).status).toBe(400);
  });
});

describe('verification', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'archflow-verify-'));
    const w = async (rel: string, content: string) => {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), content);
    };
    await w('.archflow/manifest.yaml', 'schemaVersion: 1\nproject: { name: V }\n');
    await w(
      '.archflow/systems.yaml',
      `elements:
  - { id: orders, kind: module, name: Orders, code: [{ path: src/orders }] }
  - { id: payments, kind: module, name: Payments, code: [{ path: src/payments, symbol: chargeCard }] }
  - { id: billing, kind: module, name: Billing, code: [{ path: src/billing/index.ts, symbol: Missing }] }
  - { id: gone, kind: module, name: Gone, code: [{ path: src/removed }] }
  - { id: users-table, kind: table, name: users }
  - { id: ghost-table, kind: table, name: ghosts }
  - { id: api, kind: service, name: api }
  - { id: assets-bucket, kind: storage, name: Assets, code: [{ path: infra/main.tf, symbol: aws_s3_bucket.assets }] }
relations:
  - { id: r1, type: depends-on, from: orders, to: billing }
`,
    );
    await w('src/orders/service.ts', "import { charge } from '../payments/client.js';\nimport { bill } from '../billing/index';\nexport const x = 1;\n");
    await w('src/payments/client.ts', 'export function chargeCard() {}\n');
    await w('src/billing/index.ts', 'export const bill = 1;\n');
    await w('db/schema.sql', 'CREATE TABLE users (id int);\ncreate table if not exists "public"."orders" (id int);\n');
    await w('docker-compose.yml', 'services:\n  api:\n    image: x\n    environment:\n      SECRET: hunter2\n  worker:\n    image: y\n');
    await w('infra/main.tf', 'resource "aws_s3_bucket" "assets" {}\nresource "aws_sqs_queue" "jobs" {}\n');
    await w('node_modules/pkg/index.ts', "import '../../src/orders/service';\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports discrepancies with evidence and never modifies the model', async () => {
    const before = await readFile(path.join(dir, '.archflow/systems.yaml'), 'utf8');
    const { model } = await loadModel(dir);
    const report = await verifyModel(dir, model!);
    const got = report.findings.map((f) => [f.adapter, f.code, f.status, f.elementId ?? '', f.evidence.map((e) => `${e.file}:${e.line ?? ''}`).join(',')]);
    expect(got).toEqual(
      expect.arrayContaining([
        ['code-refs', 'missing-code-path', 'verified', 'gone', 'src/removed:'],
        ['code-refs', 'symbol-not-found', 'inferred', 'billing', 'src/billing/index.ts:'],
        ['typescript', 'undeclared-dependency', 'inferred', 'orders', 'src/orders/service.ts:1'],
        ['sql', 'undocumented-table', 'inferred', '', 'db/schema.sql:2'],
        ['sql', 'table-not-found', 'inferred', 'ghost-table', 'db/schema.sql:'],
        ['compose', 'undocumented-service', 'inferred', '', 'docker-compose.yml:6'],
        ['terraform', 'undocumented-resource', 'inferred', '', 'infra/main.tf:2'],
      ]),
    );
    expect(report.findings).toHaveLength(7);
    // Declared dependency orders → billing is not reported; node_modules is not scanned.
    expect(JSON.stringify(report)).not.toContain('Billing", but');
    expect(JSON.stringify(report)).not.toContain('node_modules');
    // Configuration values are never echoed.
    expect(JSON.stringify(report)).not.toContain('hunter2');
    expect(await readFile(path.join(dir, '.archflow/systems.yaml'), 'utf8')).toBe(before);
  });

  it('is available from the CLI and the API', async () => {
    const out: string[] = [];
    const code = await runCli(['verify', '--repo', dir], { out: (l) => out.push(l), err: () => {} });
    expect(code).toBe(1);
    expect(out.join('\n')).toMatch(/INFERRED \[sql\/undocumented-table\] Table "orders"/);
    expect(out.join('\n')).toMatch(/7 discrepancy\(ies\)/);
    const srv = await start(dir);
    try {
      const r = await call(srv, 'POST', '/api/verify', {});
      expect(r.status).toBe(200);
      expect(r.body.findings).toHaveLength(7);
      expect(r.body.adapters.map((a: { adapter: string; applied: boolean }) => [a.adapter, a.applied])).toEqual([
        ['code-refs', true],
        ['typescript', true],
        ['sql', true],
        ['compose', true],
        ['terraform', true],
      ]);
    } finally {
      await srv.stop();
    }
  });

  it('explains when there is nothing to check', async () => {
    const { model } = await loadModel(repo);
    const report = await verifyModel(repo, model!);
    expect(report.adapters.find((a) => a.adapter === 'sql')).toMatchObject({ applied: false, note: 'No .sql files found' });
  });
});
