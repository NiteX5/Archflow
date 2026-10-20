import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main.js';
import { SAMPLE_REPO } from '../helpers.js';

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('archflow validate', () => {
  it('exits 0 and summarizes a valid model', async () => {
    const r = await run(['validate', '--repo', SAMPLE_REPO]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Model valid: 11 elements, 8 relations');
  });

  it('exits 1 with located errors for an invalid model', async () => {
    const work = await mkdtemp(path.join(tmpdir(), 'archflow-cli-'));
    try {
      await cp(SAMPLE_REPO, work, { recursive: true });
      await writeFile(path.join(work, '.archflow', 'extra.yaml'), 'relations:\n  - { id: r-x, type: calls, from: public-api, to: ghost }\n');
      const r = await run(['validate', '--repo', work]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/ERROR extra\.yaml:2:\d+ relations\[0\]\.to: .*"ghost"/);
      expect(r.out).toContain('Nothing was modified');

      const json = await run(['validate', '--repo', work, '--json']);
      expect(json.code).toBe(1);
      expect(JSON.parse(json.out)).toMatchObject({ valid: false, issues: [{ code: 'broken-reference' }] });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('exits 2 with a clear message for an unusable repository path', async () => {
    const r = await run(['validate', '--repo', path.join(tmpdir(), 'archflow-does-not-exist')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Cannot open repository: .* does not exist/);
  });

  it('exits 2 on usage errors', async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(['validate'])).code).toBe(2);
    expect((await run(['explode'])).code).toBe(2);
    expect((await run(['validate', '--bogus'])).code).toBe(2);
    expect((await run(['--help'])).code).toBe(0);
  });
});
