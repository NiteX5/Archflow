import { describe, expect, it } from 'vitest';
import { layoutView, NODE_HEIGHT, NODE_WIDTH } from '../../src/core/layout.js';
import { validateModel, type Model } from '../../src/core/index.js';
import { BUILTIN_PREFIX, deriveView, listViews, searchElements, viewsContaining } from '../../src/core/views.js';
import { editFile, sampleFiles, withFiles } from '../helpers.js';

const sample = (): Model => validateModel(sampleFiles()).model!;
const view = (m: Model, id: string) => {
  const entry = listViews(m).find((v) => v.view.id === id)!;
  return deriveView(m, entry.view, entry.builtin);
};
const ids = (d: ReturnType<typeof deriveView>) => d.nodes.map((n) => n.id).sort();

describe('listViews', () => {
  it('lists declared views first by type and adds built-in views for missing types', () => {
    const m = sample();
    const list = listViews(m);
    expect(list.map((v) => v.view.id)).toEqual([
      'view-overview',
      'view-dependencies',
      'view-deployment',
      `${BUILTIN_PREFIX}data`,
      `${BUILTIN_PREFIX}business`,
      'view-checkout',
    ]);
    expect(list.find((v) => v.view.id === `${BUILTIN_PREFIX}data`)?.builtin).toBe(true);
  });

  it('offers a sequence view for each flow without one', () => {
    const m = validateModel(withFiles({ 'views/checkout.yaml': null })).model!;
    expect(listViews(m).map((v) => v.view.id)).toContain(`${BUILTIN_PREFIX}sequence:flow-checkout`);
  });
});

describe('deriveView', () => {
  it('overview shows systems and actors with their relations', () => {
    const d = view(sample(), 'view-overview');
    expect(ids(d)).toEqual(['customer', 'payment-provider', 'public-api', 'web-storefront']);
    expect(d.edges.map((e) => e.id).sort()).toEqual(['rel-api-pays', 'rel-customer-uses-web', 'rel-web-calls-api']);
    expect(d.incomplete).toEqual([]);
  });

  it('dependencies nests internal components inside their parents', () => {
    const d = view(sample(), 'view-dependencies');
    expect(d.nodes.find((n) => n.id === 'orders-repository')?.parentInView).toBe('orders-module');
    expect(d.nodes.find((n) => n.id === 'orders-module')?.parentInView).toBe('public-api');
    expect(d.edges.every((e) => ['depends-on', 'calls', 'implements', 'integrates-with', 'contains'].includes(e.label))).toBe(true);
  });

  it('deployment pulls in what is deployed to infrastructure', () => {
    const d = view(sample(), 'view-deployment');
    expect(ids(d)).toEqual(['api-container', 'env-production', 'public-api']);
    expect(d.edges.map((e) => e.id)).toEqual(['rel-api-deploys']);
  });

  it('data view shows data elements and who reads or writes them', () => {
    const d = view(sample(), `${BUILTIN_PREFIX}data`);
    expect(ids(d)).toEqual(['orders-db', 'orders-repository', 'orders-table', 'public-api']);
  });

  it('sequence view follows the flow steps in order', () => {
    const d = view(sample(), 'view-checkout');
    expect(ids(d)).toEqual(['customer', 'payment-provider', 'public-api', 'web-storefront']);
    expect(d.edges.map((e) => e.label)).toEqual(['1. Submits the cart', '2. POST /orders', '3. Charges the card']);
    // Participants keep the order declared in the flow, not the order of the element files.
    expect(d.nodes.map((n) => n.id)).toEqual(['customer', 'web-storefront', 'public-api', 'payment-provider']);
    expect(d.nodes.every((n) => n.parentInView === undefined)).toBe(true);
  });

  it('reports incomplete views instead of inventing content', () => {
    const d = view(sample(), `${BUILTIN_PREFIX}business`);
    expect(ids(d)).toEqual(['customer']);
    const empty = validateModel(withFiles({ 'infrastructure.yaml': null, 'views/deployment.yaml': null })).model!;
    const dep = view(empty, `${BUILTIN_PREFIX}deployment`);
    expect(dep.nodes).toEqual([]);
    expect(dep.incomplete[0]).toMatch(/declares no infrastructure/);
  });

  it('a free view only shows explicitly included elements', () => {
    const m = validateModel(withFiles({ 'views/free.yaml': 'view:\n  id: v-free\n  name: Mine\n  type: free\n  include: [public-api, orders-db]\n' })).model!;
    const d = view(m, 'v-free');
    expect(ids(d)).toEqual(['orders-db', 'public-api']);
    expect(d.edges.map((e) => e.id)).toEqual(['rel-api-reads-db']);
    const blank = validateModel(withFiles({ 'views/free.yaml': 'view:\n  id: v-free\n  name: Mine\n  type: free\n' })).model!;
    expect(view(blank, 'v-free').incomplete).toHaveLength(1);
  });

  it('include and exclude adjust derived membership', () => {
    const m = validateModel(editFile('views/overview.yaml', (c) => `${c}  exclude: [customer]\n  include: [orders-db]\n`)).model!;
    expect(ids(view(m, 'view-overview'))).toEqual(['orders-db', 'payment-provider', 'public-api', 'web-storefront']);
  });

  it('hides deleted elements and their relations unless asked', () => {
    const files = sampleFiles().map((f) =>
      f.path === 'systems.yaml'
        ? {
            ...f,
            content: f.content
              .replace('    description: Third-party card processor.\n', '    description: Third-party card processor.\n    lifecycle: deleted\n')
              .replace('    to: payment-provider\n', '    to: payment-provider\n    lifecycle: deleted\n'),
          }
        : f.path === 'components/api.yaml'
          ? { ...f, content: f.content.replace('    to: payment-provider\n', '    to: payment-provider\n    lifecycle: deleted\n') }
          : f.path === 'flows/checkout.yaml'
            ? { ...f, content: f.content }
            : f,
    );
    const m = validateModel(files).model!;
    const entry = listViews(m).find((v) => v.view.id === 'view-overview')!;
    expect(ids(deriveView(m, entry.view))).not.toContain('payment-provider');
    expect(ids(deriveView(m, entry.view, false, { showDeleted: true }))).toContain('payment-provider');
    // The flow still references it: the step to a hidden participant is dropped, not redrawn elsewhere.
    expect(view(m, 'view-checkout').edges.map((e) => e.step?.id)).toEqual(['submit', 'create-order']);
  });
});

describe('identity across views', () => {
  it('the same element object appears in every view that shows it', () => {
    const m = sample();
    const element = m.elements.find((e) => e.id === 'public-api');
    const views = viewsContaining(m, 'public-api');
    expect(views.map((v) => v.id)).toEqual(['view-overview', 'view-dependencies', 'view-deployment', `${BUILTIN_PREFIX}data`, 'view-checkout']);
    for (const v of views) {
      const d = deriveView(m, v);
      expect(d.nodes.find((n) => n.id === 'public-api')?.element).toBe(element);
    }
  });
});

describe('searchElements', () => {
  it('finds by name, ID, code path and tag', () => {
    const m = sample();
    expect(searchElements(m, 'storefront')[0]).toMatchObject({ id: 'web-storefront', matched: 'name' });
    expect(searchElements(m, 'env-prod')[0]).toMatchObject({ id: 'env-production', matched: 'id' });
    expect(searchElements(m, 'repository.ts')[0]).toMatchObject({ id: 'orders-repository', matched: 'code' });
    expect(searchElements(m, 'OrdersRepository')[0]).toMatchObject({ id: 'orders-repository', matched: 'code' });
    expect(searchElements(m, '  ')).toEqual([]);
  });
});

describe('layoutView', () => {
  it('uses saved positions and auto-places the rest without overlap at the top level', () => {
    const m = sample();
    const boxes = layoutView(view(m, 'view-overview'));
    expect(boxes['customer']).toEqual({ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT });
    expect(boxes['payment-provider']).toMatchObject({ x: 900, y: 0 });
  });

  it('places nodes left to right following relations', () => {
    const boxes = layoutView(view(sample(), `${BUILTIN_PREFIX}data`));
    expect(boxes['public-api']!.x).toBeLessThan(boxes['orders-db']!.x);
  });

  it('makes groups enclose their children', () => {
    const boxes = layoutView(view(sample(), 'view-dependencies'));
    const inside = (child: string, parent: string) => {
      const c = boxes[child]!;
      const p = boxes[parent]!;
      return c.x >= p.x && c.y > p.y && c.x + c.width <= p.x + p.width && c.y + c.height <= p.y + p.height;
    };
    expect(inside('orders-module', 'public-api')).toBe(true);
    expect(inside('orders-repository', 'orders-module')).toBe(true);
    expect(inside('payments-client', 'public-api')).toBe(true);
  });

  it('keeps a saved child position inside its group by growing the group', () => {
    const m = validateModel(
      editFile('views/dependencies.yaml', (c) => `${c}  layout:\n    payments-client: { x: 2000, y: 900, width: 200 }\n`),
    ).model!;
    const boxes = layoutView(view(m, 'view-dependencies'));
    expect(boxes['payments-client']).toMatchObject({ x: 2000, y: 900, width: 200 });
    expect(boxes['public-api']!.x + boxes['public-api']!.width).toBeGreaterThanOrEqual(2200);
  });

  it('is deterministic', () => {
    const d = view(sample(), 'view-dependencies');
    expect(layoutView(d)).toEqual(layoutView(d));
  });
});
