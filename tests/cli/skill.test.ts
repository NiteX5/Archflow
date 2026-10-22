import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main.js';
import { bundledSkillDir } from '../../src/node/skill.js';

let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'archflow-skill-'));
  out.length = 0;
  err.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the skill', () => {
  it('has frontmatter and covers the rules required by the specification', async () => {
    const skill = await readFile(path.join(bundledSkillDir(), 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\nname: archflow\ndescription: .+\n---\n/);
    for (const rule of [
      'manifest.yaml',
      'overview.yaml',
      'Explore the real code before implementing',
      'reuse',
      'Keep IDs stable',
      'Do not invent',
      'inferred',
      'pending-review',
      'archflow validate --repo .',
      'not validated',
      'Never regenerate the whole model',
      'Report at the end',
      'lifecycle: deleted',
      // v2: hierarchy, functional dependencies, didactic fields, processes
      'Identify the architecture style',
      'Functional dependencies',
      'via',
      'howItWorks',
      'archflow migrate --repo .',
      'archflow verify --repo .',
      'Do not model',
    ]) {
      expect(skill, rule).toContain(rule);
    }
  });

  it('installs into .claude/skills/archflow without overwriting local changes', async () => {
    expect(await runCli(['skill', 'install', '--repo', dir], io)).toBe(0);
    const target = path.join(dir, '.claude', 'skills', 'archflow');
    expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toContain('name: archflow');
    expect(await readFile(path.join(target, 'reference.md'), 'utf8')).toContain('schema version 2');

    expect(await runCli(['skill', 'install', '--repo', dir], io)).toBe(0);
    expect(out.join('\n')).toContain('Up to date');

    await writeFile(path.join(target, 'SKILL.md'), 'local edit');
    expect(await runCli(['skill', 'install', '--repo', dir], io)).toBe(1);
    expect(err.join('\n')).toContain('local changes');
    expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('local edit');

    expect(await runCli(['skill', 'install', '--repo', dir, '--force'], io)).toBe(0);
    expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toContain('name: archflow');
  });

  it('rejects unknown subcommands', async () => {
    expect(await runCli(['skill', 'remove', '--repo', dir], io)).toBe(2);
  });
});
