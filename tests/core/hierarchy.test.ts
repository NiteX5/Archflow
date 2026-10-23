import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { aggregateEdges, ancestorsOf, buildTree, levelOf, usagesOf, visibleNodes, type MapTree } from '../../src/core/hierarchy.js';
import type { Model } from '../../src/core/index.js';
import { loadModel } from '../../src/node/repo.js';
import { SAMPLE_REPO } from '../helpers.js';

let model: Model;
let tree: MapTree;
beforeAll(async () => {
  model = (await loadModel(path.resolve(SAMPLE_REPO, '../modular-app'))).model!;
  tree = buildTree(model);
});
const vis = (expanded: string[], detail = false) => visibleNodes(tree, { expanded: new Set(expanded), detail });
const edgeIds = (visible: string[]) => aggregateEdges(model, tree, visible).map((e) => e.id).sort();

describe('levels', () => {
  it('derive from kinds; diagram-only kinds stay off the map', () => {
    expect(levelOf('cloud-provider')).toBe('infrastructure');
    expect(levelOf('api')).toBe('systems');
    expect(levelOf('module')).toBe('modules');
    expect(levelOf('guard')).toBe('components');
    expect(levelOf('method')).toBe('functions');
    expect(levelOf('use-case')).toBeNull();
    expect(tree.nodes.has('book-use-case')).toBe(false);
  });
});

describe('tree', () => {
  it('puts declared infrastructure on top and nests deployed apps in it', () => {
    expect(tree.hasInfrastructure).toBe(true);
    expect(tree.roots).toEqual(['patient', 'receptionist', 'aws-cloud', 'vercel', 'clinic-platform', 'stripe', 'sendgrid']);
    expect(tree.nodes.get('clinic-api')!.parent).toBe('ecs-cluster');
    expect(ancestorsOf(tree, 'jwt-guard')).toEqual(['aws-cloud', 'ecs-cluster', 'clinic-api', 'auth-module']);
    expect(tree.nestingRelations).toEqual(new Set(['rel-api-deploy', 'rel-web-deploy']));
  });

  it('uses declared parents when there is no infrastructure', async () => {
    const sample = (await loadModel(SAMPLE_REPO)).model!;
    const noInfra = { ...sample, elements: sample.elements.filter((e) => !['env-production', 'api-container', 'orders-db', 'orders-table'].includes(e.id)) };
    const t = buildTree(noInfra);
    expect(t.hasInfrastructure).toBe(false);
    expect(t.nodes.get('orders-module')!.parent).toBe('public-api');
    expect(t.roots).toContain('public-api');
  });
});

describe('visibility (semantic zoom)', () => {
  it('shows only roots until containers are expanded', () => {
    expect(vis([])).toEqual(tree.roots);
  });

  it('reveals the content of expanded containers, functional details only up close', () => {
    const mid = vis(['aws-cloud', 'ecs-cluster', 'clinic-api', 'auth-module']);
    expect(mid).toContain('auth-service');
    expect(mid).not.toContain('jwt-guard');
    const close = vis(['aws-cloud', 'ecs-cluster', 'clinic-api', 'auth-module'], true);
    expect(close).toContain('jwt-guard');
    expect(close).toContain('role-enum');
  });

  it('never reveals the children of a collapsed container', () => {
    expect(vis(['auth-module'])).not.toContain('auth-service');
  });
});

describe('aggregated edges', () => {
  it('merges relations between collapsed containers into one edge with count and functional chips', () => {
    const edges = aggregateEdges(model, tree, vis([]));
    const webToAws = edges.find((e) => e.from === 'vercel' && e.to === 'aws-cloud')!;
    expect(webToAws.relations.sort()).toEqual(['rel-web-api-appointments', 'rel-web-api-auth']);
    expect(webToAws.via).toEqual(['jwt-guard', 'roles-guard', 'book-appointment-dto', 'login-dto']);
    // Deployment is drawn as containment, not as an edge.
    expect(edges.some((e) => e.relations.includes('rel-api-deploy'))).toBe(false);
  });

  it('drops relations that stay inside one visible node', () => {
    const ids = edgeIds(vis(['aws-cloud', 'ecs-cluster']));
    expect(ids).not.toContain('clinic-api>clinic-api');
    expect(ids.every((id) => !id.startsWith('auth-'))).toBe(true);
  });

  it('turns hidden functional dependencies at the end of "uses" into chips', () => {
    const visible = vis(['aws-cloud', 'ecs-cluster', 'clinic-api', 'appointments-module', 'notifications-module']);
    const e = aggregateEdges(model, tree, visible).find((x) => x.from === 'appointments-controller' && x.to === 'auth-module')!;
    expect(e.types).toEqual(['uses']);
    expect(e.via.sort()).toEqual(['jwt-guard', 'roles-guard']);
  });

  it('draws the dependency itself when it is visible', () => {
    const visible = vis(['aws-cloud', 'ecs-cluster', 'clinic-api', 'appointments-module', 'auth-module'], true);
    const ids = edgeIds(visible);
    expect(ids).toContain('appointments-controller>jwt-guard');
    expect(ids).toContain('appointments-controller>roles-guard');
  });
});

describe('usages of a functional dependency', () => {
  it('lists the relations that pass through it or use it', () => {
    expect(usagesOf(model, 'jwt-guard').map((r) => r.id).sort()).toEqual(['rel-ctrl-jwt', 'rel-web-api-appointments']);
  });
});
