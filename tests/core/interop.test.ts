import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DiagramParseError } from '../../src/core/diagram.js';
import { viewToDrawio, UnsupportedExportError } from '../../src/core/drawio.js';
import { entitiesToFiles, planReplace, toBundle } from '../../src/core/interchange.js';
import { layoutView } from '../../src/core/layout.js';
import { parseMermaid, viewToMermaid } from '../../src/core/mermaid.js';
import { buildScene, sceneToPdf, sceneToSvg } from '../../src/core/render.js';
import { validateModel, type Model } from '../../src/core/index.js';
import { deriveView, listViews } from '../../src/core/views.js';
import { parseDrawio } from '../../src/node/drawio-import.js';
import { sampleFiles } from '../helpers.js';

const sample = (): Model => validateModel(sampleFiles()).model!;
const derived = (m: Model, id: string) => {
  const v = listViews(m).find((x) => x.view.id === id)!;
  return deriveView(m, v.view, v.builtin);
};

describe('Mermaid', () => {
  it('parses flowchart nodes, shapes, labels, subgraphs and edges', () => {
    const d = parseMermaid(`%% comment
flowchart LR
  subgraph backend[Backend services]
    api(Orders API) -->|calls| db[(Orders DB)]
  end
  web["Web <br> app"] --> api
  web -- uses --> cdn((CDN))
  a & b -.-> c
  classDef x fill:#f00
  this is not mermaid
`);
    expect(d.kind).toBe('graph');
    const byId = Object.fromEntries(d.nodes.map((n) => [n.sourceId, n]));
    expect(byId['backend']).toMatchObject({ label: 'Backend services', kindHint: 'domain' });
    expect(byId['api']).toMatchObject({ label: 'Orders API', parent: 'backend', shape: 'rounded' });
    expect(byId['db']).toMatchObject({ label: 'Orders DB', kindHint: 'database', parent: 'backend' });
    expect(byId['web']!.label).toBe('Web app');
    expect(byId['cdn']).toMatchObject({ label: 'CDN', shape: 'circle' });
    expect(d.edges).toEqual([
      { from: 'api', to: 'db', label: 'calls' },
      { from: 'web', to: 'api' },
      { from: 'web', to: 'cdn', label: 'uses' },
      { from: 'a', to: 'c', dashed: true },
      { from: 'b', to: 'c', dashed: true },
    ]);
    expect(d.unconverted).toEqual(['line 9: classDef x fill:#f00', 'line 10: this is not mermaid']);
    expect(d.warnings.join('\n')).toMatch(/Line 10 could not be converted/);
  });

  it('does not confuse dashes in IDs with arrows', () => {
    const d = parseMermaid('graph TD\n  A-->B\n  svc-a --> svc-b\n');
    expect(d.edges).toEqual([
      { from: 'A', to: 'B' },
      { from: 'svc-a', to: 'svc-b' },
    ]);
  });

  it('parses sequence diagrams with conditions', () => {
    const d = parseMermaid(`sequenceDiagram
  actor U as User
  participant W as Web app
  U->>W: Opens page
  alt logged in
    W-->>U: Dashboard
  else
    W-->>U: Login form
  end
  Note over U: unsupported
`);
    expect(d.kind).toBe('sequence');
    expect(d.sequence!.participants).toEqual([
      { sourceId: 'U', label: 'User', actor: true },
      { sourceId: 'W', label: 'Web app', actor: false },
    ]);
    expect(d.sequence!.steps).toEqual([
      { from: 'U', to: 'W', label: 'Opens page' },
      { from: 'W', to: 'U', label: 'Dashboard', condition: 'logged in' },
      { from: 'W', to: 'U', label: 'Login form', condition: 'else' },
    ]);
    expect(d.unconverted).toEqual(['line 10: Note over U: unsupported']);
  });

  it('rejects unsupported diagram types', () => {
    expect(() => parseMermaid('pie title Pets\n "Dogs" : 386')).toThrow(DiagramParseError);
    expect(() => parseMermaid('   \n')).toThrow(/empty/);
  });

  it('exports a view and re-imports the same structure', () => {
    const m = sample();
    const d = derived(m, 'view-dependencies');
    const text = viewToMermaid(d);
    expect(text).toMatch(/^flowchart LR/);
    expect(text).toContain('subgraph public_api["Public API"]');
    const back = parseMermaid(text);
    expect(back.nodes.map((n) => n.label).sort()).toEqual(d.nodes.map((n) => n.element.name).sort());
    expect(back.edges).toHaveLength(d.edges.length);
    expect(back.nodes.find((n) => n.label === 'Orders module')?.parent).toBe('public_api');
  });

  it('exports sequence views as sequence diagrams', () => {
    const text = viewToMermaid(derived(sample(), 'view-checkout'));
    expect(text).toContain('actor customer as Customer');
    expect(text).toContain('opt Order total > 0');
    const back = parseMermaid(text);
    expect(back.sequence!.steps.map((s) => s.label)).toEqual(['Submits the cart', 'POST /orders', 'Charges the card']);
    expect(back.sequence!.steps[2]!.condition).toBe('Order total > 0');
  });
});

describe('draw.io', () => {
  it('exports a view with containers and imports it back with positions', () => {
    const m = sample();
    const d = derived(m, 'view-dependencies');
    const boxes = layoutView(d);
    const xml = viewToDrawio(d, boxes);
    expect(xml).toContain('<mxfile host="Archflow">');
    const back = parseDrawio(xml);
    expect(back.nodes).toHaveLength(d.nodes.length);
    const repo = back.nodes.find((n) => n.sourceId === 'n-orders-repository')!;
    expect(repo.parent).toBe('n-orders-module');
    // Positions are absolute again after import.
    expect(repo.box).toMatchObject({ x: boxes['orders-repository']!.x, y: boxes['orders-repository']!.y });
    expect(back.edges).toHaveLength(d.edges.length);
  });

  it('refuses to export sequence views', () => {
    const d = derived(sample(), 'view-checkout');
    expect(() => viewToDrawio(d, layoutView(d))).toThrow(UnsupportedExportError);
  });

  it('reads compressed diagrams, HTML labels, wrappers and reports what it skips', () => {
    const inner = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <object id="u1" label="&lt;b&gt;User&lt;/b&gt;"><mxCell style="shape=umlActor;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="30" height="60" as="geometry"/></mxCell></object>
      <mxCell id="db" value="Main DB" style="shape=cylinder3;" vertex="1" parent="1"><mxGeometry x="200" y="20" width="60" height="80" as="geometry"/></mxCell>
      <mxCell id="t" value="just a note" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="20" as="geometry"/></mxCell>
      <mxCell id="e1" value="reads" edge="1" parent="1" source="u1" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="e2" value="" edge="1" parent="1" source="u1"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(inner), 'latin1')).toString('base64');
    const xml = `<mxfile><diagram name="Page A">${compressed}</diagram><diagram name="Page B"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>`;
    const d = parseDrawio(xml);
    expect(d.title).toBe('Page A');
    expect(d.nodes.map((n) => [n.sourceId, n.label, n.kindHint])).toEqual([
      ['db', 'Main DB', 'database'],
      ['u1', 'User', 'actor'],
    ]);
    expect(d.edges).toEqual([{ from: 'u1', to: 'db', label: 'reads' }]);
    expect(d.unconverted).toEqual(['text "just a note"', 'edge e2']);
    expect(d.warnings.join('\n')).toMatch(/Only the first page/);
  });

  it('rejects files that are not draw.io diagrams', () => {
    expect(() => parseDrawio('<html></html>')).toThrow(DiagramParseError);
    expect(() => parseDrawio('<mxfile><diagram>not base64 deflate</diagram></mxfile>')).toThrow(/could not be decoded/);
  });
});

describe('SVG and PDF rendering', () => {
  it('renders every node name and relation label to SVG, escaping text', () => {
    const m = sample();
    const d = derived(m, 'view-overview');
    d.nodes[0]!.element = { ...d.nodes[0]!.element, name: 'A <b>&</b>' };
    const svg = sceneToSvg(buildScene(d, layoutView(d)));
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('A &lt;b&gt;&amp;&lt;/b&gt;');
    for (const e of d.edges) expect(svg).toContain(`>${e.label}</text>`);
    expect(svg.match(/<line /g)).toHaveLength(d.edges.length);
  });

  it('renders sequence views with lifelines and numbered steps', () => {
    const svg = sceneToSvg(buildScene(derived(sample(), 'view-checkout'), {}));
    expect(svg).toContain('1. Submits the cart');
    expect(svg).toContain('3. Charges the card [Order total &gt; 0]');
  });

  it('produces a structurally valid PDF and reports unsupported characters', () => {
    const d = derived(sample(), 'view-overview');
    d.nodes[0]!.element = { ...d.nodes[0]!.element, name: 'Café 日本' };
    const { bytes, replacedCharacters } = sceneToPdf(buildScene(d, layoutView(d)));
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(Caf\xe9 ??) Tj');
    expect(replacedCharacters).toEqual(['日', '本']);
    // The xref table points at the real object offsets.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});

describe('native interchange', () => {
  it('round-trips the model through the bundle and the file layout', () => {
    const m = sample();
    const bundle = toBundle(m);
    const files = entitiesToFiles(bundle, bundle.files);
    const again = validateModel([...files].map(([path, content]) => ({ path, content })));
    expect(again.issues).toEqual([]);
    const strip = (x: Model) => ({ ...toBundle(x), files: undefined });
    expect(strip(again.model!)).toEqual(strip(m));
    expect(again.model!.sources['orders-module']!.file).toBe('components/api.yaml');
  });

  it('ignores unsafe file names in a bundle', () => {
    const m = sample();
    const bundle = toBundle(m);
    const files = entitiesToFiles(bundle, { ...bundle.files, customer: '../../etc/evil.yaml', 'flow-checkout': 'history/x.yaml' });
    expect([...files.keys()].every((f) => !f.includes('..') && !f.startsWith('history/'))).toBe(true);
    expect(files.has('business.yaml')).toBe(true);
  });

  it('keeps entities missing from a replacement as deleted', () => {
    const m = sample();
    const bundle = toBundle(m);
    bundle.elements = bundle.elements.filter((e) => e.id !== 'payment-provider');
    bundle.relations = bundle.relations.filter((r) => r.to !== 'payment-provider');
    bundle.flows = [];
    bundle.views = bundle.views.filter((v) => v.id !== 'view-checkout');
    const plan = planReplace(m, bundle, 'x.json', '2026-10-20');
    expect(plan.summary.markedDeleted.sort()).toEqual(['flow-checkout', 'payment-provider', 'rel-api-pays', 'rel-payments-client-calls-provider'].sort());
    const result = validateModel([...plan.files].map(([path, content]) => ({ path, content })));
    expect(result.issues).toEqual([]);
    expect(result.model!.elements.find((e) => e.id === 'payment-provider')).toMatchObject({ lifecycle: 'deleted', deletedReason: 'Not present in import "x.json"' });
  });
});
