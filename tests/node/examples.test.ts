import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../../src/node/repo.js';
import { SAMPLE_REPO } from '../helpers.js';

describe('bundled examples', () => {
  it.each([
    ['sample', SAMPLE_REPO],
    ['modular-app', path.resolve(SAMPLE_REPO, '../modular-app')],
  ])('%s is a valid model', async (_name, repo) => {
    const { model, issues } = await loadModel(repo);
    expect(issues).toEqual([]);
    expect(model).toBeDefined();
  });

  it('modular-app shows every schema 2 feature', async () => {
    const { model } = await loadModel(path.resolve(SAMPLE_REPO, '../modular-app'));
    const kinds = new Set(model!.elements.map((e) => e.kind));
    for (const k of ['guard', 'policy', 'dto', 'enum', 'contract', 'event', 'use-case', 'table', 'cloud-provider', 'method']) expect(kinds, k).toContain(k);
    expect(model!.relations.some((r) => r.via?.length)).toBe(true);
    expect(model!.relations.some((r) => r.type === 'references' && r.cardinality)).toBe(true);
    expect(model!.flows[0]!.steps!.some((s) => s.type === 'decision' && s.branches?.length)).toBe(true);
  });
});
