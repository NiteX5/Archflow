import { describe, expect, it } from 'vitest';
import { validateModel, type Issue } from '../../src/core/index.js';
import { withFiles } from '../helpers.js';

const codes = (issues: Issue[]) => issues.map((i) => [i.severity, i.code, i.path]);

const functional = `elements:
  - id: jwt-guard
    kind: guard
    name: JwtAuthGuard
    parent: orders-module
    summary: Rejects requests without a valid JWT.
    howItWorks:
      - Reads the Authorization header
      - Verifies the token signature
  - { id: create-order-dto, kind: dto, name: CreateOrderDto, parent: orders-module }
  - { id: order-status, kind: enum, name: OrderStatus, parent: orders-module }
relations:
  - id: rel-web-orders
    type: calls
    from: web-storefront
    to: orders-module
    via: [jwt-guard, create-order-dto]
  - { id: rel-repo-uses-status, type: uses, from: orders-repository, to: order-status }
`;

describe('schema v2', () => {
  it('accepts functional dependencies, didactic fields, via and uses', () => {
    const { model, issues } = validateModel(withFiles({ 'components/functional.yaml': functional }));
    expect(issues).toEqual([]);
    expect(model!.elements.find((e) => e.id === 'jwt-guard')).toMatchObject({ kind: 'guard', howItWorks: ['Reads the Authorization header', 'Verifies the token signature'] });
    expect(model!.relations.find((r) => r.id === 'rel-web-orders')!.via).toEqual(['jwt-guard', 'create-order-dto']);
  });

  it('only allows functional dependencies in via', () => {
    const bad = functional.replace('via: [jwt-guard, create-order-dto]', 'via: [jwt-guard, orders-db, ghost]');
    const { model, issues } = validateModel(withFiles({ 'components/functional.yaml': bad }));
    expect(model).toBeUndefined();
    expect(codes(issues)).toEqual([
      ['error', 'relation-config', 'relations[0].via[1]'],
      ['error', 'broken-reference', 'relations[0].via[2]'],
    ]);
  });

  it('allows cardinality only on references', () => {
    const files = withFiles({
      'components/x.yaml': `elements:
  - { id: lines-table, kind: table, name: order_lines, parent: orders-db }
relations:
  - { id: r-fk, type: references, from: lines-table, to: orders-table, cardinality: n-1 }
  - { id: r-bad, type: reads, from: public-api, to: lines-table, cardinality: 1-n }
`,
    });
    expect(codes(validateModel(files).issues)).toEqual([['error', 'relation-config', 'relations[1].cardinality']]);
  });

  const flow = (steps: string) => `flow:
  id: flow-p
  kind: business
  name: Process
  participants: [customer, web-storefront, public-api]
  steps:
${steps}`;

  it('accepts process steps with decisions and branches', () => {
    const { issues } = validateModel(
      withFiles({
        'flows/p.yaml': flow(`    - { id: s1, type: start, from: customer, action: Opens checkout }
    - id: s2
      type: decision
      from: web-storefront
      action: Is the cart empty?
      branches:
        - { condition: "yes", next: s4 }
        - { condition: "no", next: s3 }
    - { id: s3, from: web-storefront, to: public-api, action: Creates order, next: s4 }
    - { id: s4, type: end, from: customer, action: Done }
`),
      }),
    );
    expect(issues).toEqual([]);
  });

  it('reports broken step links, branches outside decisions and loops without a decision', () => {
    const { issues } = validateModel(
      withFiles({
        'flows/p.yaml': flow(`    - { id: s1, from: customer, action: A, next: s2 }
    - { id: s2, from: customer, action: B, next: s1, branches: [{ condition: x, next: s9 }] }
    - { id: s3, type: decision, from: customer, action: C }
`),
      }),
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        ['error', 'flow-config', 'flow.steps[1].branches'],
        ['warning', 'flow-config', 'flow.steps[2]'],
        ['error', 'broken-reference', 'flow.steps[1].branches[0].next'],
        ['error', 'flow-config', 'flow.steps[0].next'],
      ]),
    );
  });
});
