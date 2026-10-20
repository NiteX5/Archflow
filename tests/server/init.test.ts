import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main.js';
import { call, start } from './helpers.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'archflow-init-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('init', () => {
  it('creates only a manifest from the CLI and never overwrites it', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    expect(await runCli(['init', '--repo', dir, '--name', 'My: "project"'], io)).toBe(0);
    const manifest = await readFile(path.join(dir, '.archflow', 'manifest.yaml'), 'utf8');
    expect(manifest).toContain('schemaVersion: 1');
    expect(await runCli(['validate', '--repo', dir], io)).toBe(0);
    expect(out.join('\n')).toContain('Model valid: 0 elements');
    expect(await runCli(['init', '--repo', dir], io)).toBe(1);
    expect(err.join('\n')).toMatch(/already exists/);
    expect(await readFile(path.join(dir, '.archflow', 'manifest.yaml'), 'utf8')).toBe(manifest);
  });

  it('creates a model from the UI for a repository without one', async () => {
    const s = await start(dir);
    try {
      expect((await call(s, 'GET', '/api/state')).body.status).toBe('no-model');
      const r = await call(s, 'POST', '/api/init', { name: 'Demo' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'valid', model: { manifest: { project: { name: 'Demo' } }, elements: [] } });
      expect((await call(s, 'POST', '/api/init', { name: 'Again' })).status).toBe(409);
      expect((await call(s, 'POST', '/api/init', { name: '' })).status).toBe(409);
      // The new model is editable right away.
      const created = await call(s, 'POST', '/api/ops', { ops: [{ op: 'create', entity: 'element', value: { id: 'api', kind: 'api', name: 'API' } }] });
      expect(created.status).toBe(200);
    } finally {
      await s.stop();
    }
  });
});
