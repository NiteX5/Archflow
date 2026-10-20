import { describe, expect, it } from 'vitest';
import { categoryOf, classifyModelFile, validateModel, type Issue } from '../../src/core/index.js';
import { editFile, sampleFiles, withFiles } from '../helpers.js';

const errors = (issues: Issue[]) => issues.filter((i) => i.severity === 'error');
const codes = (issues: Issue[]) => issues.map((i) => i.code);

describe('valid model', () => {
  it('loads the multi-file sample model without issues', () => {
    const { model, issues } = validateModel(sampleFiles());
    expect(issues).toEqual([]);
    expect(model).toBeDefined();
    expect(model!.schemaVersion).toBe(1);
    expect(model!.elements.map((e) => e.id)).toContain('orders-module');
    expect(model!.sources['orders-module']).toEqual({ type: 'element', file: 'components/api.yaml', path: ['elements', 0] });
    expect(model!.sources['flow-checkout']?.file).toBe('flows/checkout.yaml');
  });

  it('resolves references across files', () => {
    const { model } = validateModel(sampleFiles());
    // components/api.yaml → data.yaml
    expect(model!.relations.find((r) => r.id === 'rel-repo-writes-orders')?.to).toBe('orders-table');
    expect(model!.sources['orders-table']?.file).toBe('data.yaml');
  });

  it('accepts files with Windows line endings', () => {
    const crlf = sampleFiles().map((f) => ({ ...f, content: f.content.replace(/\n/g, '\r\n') }));
    const { model, issues } = validateModel(crlf);
    expect(issues).toEqual([]);
    expect(model!.elements).toHaveLength(11);
  });

  it('keeps missing provenance absent instead of filling defaults', () => {
    const { model } = validateModel(sampleFiles());
    expect(model!.elements.find((e) => e.id === 'payment-provider')?.provenance).toBeUndefined();
  });

  it('derives categories from kinds', () => {
    expect(categoryOf('table')).toBe('data');
    expect(categoryOf('container')).toBe('infrastructure');
  });
});

describe('file classification', () => {
  it.each([
    ['manifest.yaml', 'manifest'],
    ['overview.yaml', 'overview'],
    ['decisions.yaml', 'decisions'],
    ['flows/a.yaml', 'flow'],
    ['views/a.yaml', 'view'],
    ['systems.yaml', 'elements'],
    ['components/billing/x.yaml', 'elements'],
    ['history/1.yaml', null],
    ['notes.md', null],
  ])('%s → %s', (p, kind) => {
    expect(classifyModelFile(p)).toBe(kind);
  });

  it('warns about non-YAML files instead of dropping them silently', () => {
    const { model, issues } = validateModel([...sampleFiles(), { path: 'notes.yml', content: 'x: 1' }]);
    expect(model).toBeDefined();
    expect(issues).toMatchObject([{ severity: 'warning', code: 'ignored-file', file: 'notes.yml' }]);
  });
});

describe('manifest and schema version', () => {
  it('requires a manifest', () => {
    const { model, issues } = validateModel(withFiles({ 'manifest.yaml': null }));
    expect(model).toBeUndefined();
    expect(codes(issues)).toContain('missing-manifest');
  });

  it('rejects newer schema versions without touching anything else', () => {
    const { model, issues } = validateModel(withFiles({ 'manifest.yaml': 'schemaVersion: 2\nproject: { name: X }\n' }));
    expect(model).toBeUndefined();
    expect(issues).toMatchObject([{ code: 'unsupported-schema-version', file: 'manifest.yaml', line: 1 }]);
    expect(issues[0]!.hint).toMatch(/Upgrade Archflow/);
  });

  it('reports a missing schemaVersion', () => {
    const { issues } = validateModel(withFiles({ 'manifest.yaml': 'project: { name: X }\n' }));
    expect(issues).toMatchObject([{ code: 'schema', path: 'schemaVersion', message: 'Missing required field "schemaVersion"' }]);
  });
});

describe('structural validation', () => {
  it('reports YAML syntax errors with file and line', () => {
    const { model, issues } = validateModel(withFiles({ 'data.yaml': 'elements:\n  - id: a\n    name: [unclosed\n' }));
    expect(model).toBeUndefined();
    expect(issues[0]).toMatchObject({ code: 'yaml-syntax', file: 'data.yaml' });
    expect(issues[0]!.line).toBeGreaterThan(0);
  });

  it('rejects duplicate YAML keys', () => {
    const { issues } = validateModel(withFiles({ 'data.yaml': 'elements: []\nelements: []\n' }));
    expect(codes(issues)).toContain('yaml-syntax');
  });

  it('rejects unsupported element kinds with a hint listing supported ones', () => {
    const files = editFile('data.yaml', (c) => c.replace('kind: database', 'kind: mainframe'));
    const { model, issues } = validateModel(files);
    expect(model).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'schema', file: 'data.yaml', path: 'elements[0].kind', line: 3 });
    expect(issues[0]!.message).toBe('Unsupported value "mainframe"');
    expect(issues[0]!.hint).toContain('database');
  });

  it('rejects unsupported relation types', () => {
    const files = editFile('data.yaml', (c) => c.replace('type: reads', 'type: loves'));
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ code: 'schema', path: 'relations[0].type' }]);
  });

  it('rejects unknown fields (typos) and locates them', () => {
    const files = editFile('data.yaml', (c) => c.replace('description: PostgreSQL.', 'descripton: PostgreSQL.'));
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ message: 'Unknown field "descripton"', path: 'elements[0].descripton', line: 5 }]);
  });

  it('reports missing required fields', () => {
    const files = editFile('data.yaml', (c) => c.replace('    name: Orders database\n', ''));
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ message: 'Missing required field "name"', path: 'elements[0].name' }]);
  });

  it('rejects invalid IDs', () => {
    const files = editFile('data.yaml', (c) => c.replace('id: orders-db', 'id: Orders DB'));
    const { issues } = validateModel(files);
    expect(issues[0]).toMatchObject({ path: 'elements[0].id' });
  });

  it('rejects code references that escape the repository', () => {
    for (const bad of ['../secrets', '/etc/passwd', 'C:/x', 'a\\\\b']) {
      const files = editFile('components/api.yaml', (c) => c.replace('path: apps/api/src/orders\n', `path: "${bad}"\n`));
      const { issues } = validateModel(files);
      expect(errors(issues).length, bad).toBe(1);
      expect(issues[0]!.path).toBe('elements[0].code[0].path');
    }
  });

  it('warns about empty files', () => {
    const { model, issues } = validateModel([...sampleFiles(), { path: 'components/empty.yaml', content: '' }]);
    expect(model).toBeDefined();
    expect(issues).toMatchObject([{ severity: 'warning', code: 'empty-file' }]);
  });

  it('does not run reference checks on structurally broken input', () => {
    // The table definition is broken, so the reference to it must not be reported as broken.
    const files = editFile('data.yaml', (c) => c.replace('kind: table', 'kind: tabel'));
    const { issues } = validateModel(files);
    expect(codes(issues)).toEqual(['schema']);
  });
});

describe('identity and references', () => {
  it('rejects duplicate IDs across files and entity types', () => {
    const files = withFiles({ 'extra.yaml': 'elements:\n  - id: rel-web-calls-api\n    kind: service\n    name: Clash\n' });
    const { model, issues } = validateModel(files);
    expect(model).toBeUndefined();
    expect(errors(issues)).toMatchObject([{ code: 'duplicate-id', file: 'systems.yaml' }]);
    expect(issues[0]!.message).toContain('extra.yaml');
  });

  it('reports broken references with file, field and line', () => {
    const files = editFile('components/api.yaml', (c) => c.replace('to: orders-table', 'to: orders-tabel'));
    const { model, issues } = validateModel(files);
    expect(model).toBeUndefined();
    expect(issues).toMatchObject([
      { code: 'broken-reference', file: 'components/api.yaml', path: 'relations[1].to', line: 36 },
    ]);
  });

  it('reports references to the wrong entity type', () => {
    const files = editFile('data.yaml', (c) => c.replace('to: orders-db', 'to: flow-checkout'));
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ code: 'invalid-reference-target' }]);
  });

  it('validates parents, flows, decisions, views and overview references', () => {
    const cases: [string, (c: string) => string, string][] = [
      ['infrastructure.yaml', (c) => c.replace('parent: env-production', 'parent: env-prod'), 'elements[1].parent'],
      ['flows/checkout.yaml', (c) => c.replace('payment-provider]', 'payments]'), 'flow.participants[3]'],
      ['decisions.yaml', (c) => c.replace('orders-module]', 'orders]'), 'decisions[0].relatedTo[1]'],
      ['views/overview.yaml', (c) => c.replace('customer: { x: 0', 'client: { x: 0'), 'view.layout.client'],
      ['views/checkout.yaml', (c) => c.replace('flow: flow-checkout', 'flow: flow-refund'), 'view.flow'],
      ['overview.yaml', (c) => c.replace('- orders-db', '- orders-dbx'), 'keyElements[2]'],
    ];
    for (const [file, edit, path] of cases) {
      const { model, issues } = validateModel(editFile(file, edit));
      expect(model, file).toBeUndefined();
      expect(issues[0], file).toMatchObject({ code: 'broken-reference', file, path });
    }
  });

  it('requires flow steps to use declared participants', () => {
    const files = editFile('flows/checkout.yaml', (c) => c.replace('to: payment-provider', 'to: orders-db'));
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ code: 'broken-reference', path: 'flow.steps[2].to' }]);
    expect(issues[0]!.hint).toContain('participants');
  });

  it('detects containment cycles', () => {
    const files = withFiles({
      'cycle.yaml': [
        'elements:',
        '  - { id: c-a, kind: module, name: A, parent: c-b }',
        '  - { id: c-b, kind: module, name: B, parent: c-a }',
        '  - { id: c-self, kind: module, name: S, parent: c-self }',
      ].join('\n'),
    });
    const { issues } = validateModel(files);
    expect(codes(issues)).toEqual(['parent-cycle', 'parent-cycle']);
  });

  it('flags possible duplicate elements and relations for review without failing', () => {
    const files = withFiles({
      'dup.yaml': [
        'elements:',
        '  - { id: api-2, kind: api, name: "public  API" }',
        'relations:',
        '  - { id: rel-dup, type: calls, from: web-storefront, to: public-api }',
      ].join('\n'),
    });
    const { model, issues } = validateModel(files);
    expect(model).toBeDefined();
    expect(issues.map((i) => [i.severity, i.code])).toEqual([
      ['warning', 'possible-duplicate'],
      ['warning', 'possible-duplicate'],
    ]);
  });

  it('keeps the ID and relations when an element is renamed', () => {
    const files = editFile('systems.yaml', (c) => c.replace('name: Public API', 'name: Storefront Gateway'));
    const { model, issues } = validateModel(files);
    expect(issues).toEqual([]);
    const el = model!.elements.find((e) => e.id === 'public-api');
    expect(el?.name).toBe('Storefront Gateway');
    expect(model!.relations.filter((r) => r.to === 'public-api' || r.from === 'public-api')).toHaveLength(4);
  });

  it('keeps identity when a definition moves to another file', () => {
    const before = validateModel(sampleFiles()).model!;
    const block = '  - id: orders-db\n    kind: database\n    name: Orders database\n    description: PostgreSQL.\n\n';
    const files = sampleFiles().map((f) => {
      if (f.path === 'data.yaml') return { ...f, content: f.content.replace(block, '') };
      if (f.path === 'infrastructure.yaml') return { ...f, content: f.content.replace('elements:\n', `elements:\n${block}`) };
      return f;
    });
    const after = validateModel(files);
    expect(after.issues).toEqual([]);
    expect(after.model!.sources['orders-db']?.file).toBe('infrastructure.yaml');
    const strip = (m: typeof before) => [...m.elements].sort((a, b) => a.id.localeCompare(b.id));
    expect(strip(after.model!)).toEqual(strip(before));
    expect(after.model!.relations).toEqual(expect.arrayContaining(before.relations));
  });
});

describe('logical deletion', () => {
  const deleteDb = (c: string) =>
    c.replace('    description: PostgreSQL.\n', '    description: PostgreSQL.\n    lifecycle: deleted\n    deletedAt: 2026-02-01\n');

  it('rejects active relations and children pointing to a deleted element', () => {
    const { model, issues } = validateModel(editFile('data.yaml', deleteDb));
    expect(model).toBeUndefined();
    expect(issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ['deleted-reference', 'elements[1].parent'],
        ['deleted-reference', 'relations[0].to'],
      ]),
    );
  });

  it('accepts a deletion when dependent entities are deleted consistently', () => {
    const consistent = (c: string) =>
      deleteDb(c)
        .replace('    parent: orders-db\n', '    parent: orders-db\n    lifecycle: deleted\n')
        .replace('    to: orders-db\n', '    to: orders-db\n    lifecycle: deleted\n');
    const files = sampleFiles().map((f) => {
      if (f.path === 'data.yaml') return { ...f, content: consistent(f.content) };
      if (f.path === 'components/api.yaml') return { ...f, content: f.content.replace('    to: orders-table\n', '    to: orders-table\n    lifecycle: deleted\n') };
      return f;
    });
    const { model, issues } = validateModel(files);
    expect(issues).toEqual([]);
    // The deleted entity is still in the model for traceability and restoration.
    expect(model!.elements.find((e) => e.id === 'orders-db')?.lifecycle).toBe('deleted');
  });

  it('rejects deletion fields on active entities', () => {
    const files = editFile('data.yaml', (c) => c.replace('    description: PostgreSQL.\n', '    description: PostgreSQL.\n    deletedAt: 2026-02-01\n'));
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ code: 'lifecycle', path: 'elements[0].deletedAt' }]);
  });
});

describe('provenance', () => {
  it('warns when something is verified without any evidence', () => {
    const files = editFile('systems.yaml', (c) => c.replace('      verifiedAt: 2026-01-15\n', ''));
    const { model, issues } = validateModel(files);
    expect(model).toBeDefined();
    expect(issues).toMatchObject([{ severity: 'warning', code: 'missing-evidence', path: 'elements[1].provenance.status' }]);
  });

  it('rejects unsupported provenance values', () => {
    const files = editFile('systems.yaml', (c) => c.replace('status: pending-review', 'status: probably'));
    const { issues } = validateModel(files);
    expect(issues[0]).toMatchObject({ code: 'schema', path: 'elements[2].provenance.status' });
  });
});

describe('views', () => {
  it('rejects a flow on a view type that does not use flows', () => {
    const files = editFile('views/deployment.yaml', (c) => `${c}  flow: flow-checkout\n`);
    const { issues } = validateModel(files);
    expect(issues).toMatchObject([{ code: 'view-config', path: 'view.flow' }]);
  });

  it('accepts known icons and rejects unknown ones', () => {
    const ok = editFile('views/overview.yaml', (c) => c.replace('shape: rounded }', 'shape: rounded, icon: cloud }'));
    expect(validateModel(ok).issues).toEqual([]);
    const bad = editFile('views/overview.yaml', (c) => c.replace('shape: rounded }', 'shape: rounded, icon: unicorn }'));
    expect(validateModel(bad).issues[0]).toMatchObject({ path: 'view.styles.payment-provider.icon', message: 'Unsupported value "unicorn"' });
  });

  it('rejects invalid style values', () => {
    const files = editFile('views/overview.yaml', (c) => c.replace('#8250df', 'purple'));
    const { issues } = validateModel(files);
    expect(issues[0]).toMatchObject({ code: 'schema', path: 'view.styles.payment-provider.color' });
  });
});

describe('safety', () => {
  it('treats YAML tags as data and never executes them', () => {
    const files = withFiles({ 'evil.yaml': 'elements: !!js/function "function(){ return 1 }"\n' });
    const { model } = validateModel(files);
    expect(model).toBeUndefined();
  });

  it('bounds alias expansion', () => {
    const bomb = ['a: &a [x, x, x, x, x, x, x, x, x, x]'];
    for (let i = 1; i < 12; i++) bomb.push(`${'b'.repeat(i)}: &${'b'.repeat(i)} [${Array(10).fill(i === 1 ? '*a' : `*${'b'.repeat(i - 1)}`).join(', ')}]`);
    const { model, issues } = validateModel(withFiles({ 'bomb.yaml': bomb.join('\n') }));
    expect(model).toBeUndefined();
    expect(errors(issues).length).toBeGreaterThan(0);
  });
});
