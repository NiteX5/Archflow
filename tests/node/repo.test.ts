import { cp, mkdir, mkdtemp, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITS,
  loadModel,
  readModelFiles,
  RepoAccessError,
  resolveInside,
  resolveInsideReal,
  resolveRepoRoot,
} from '../../src/node/repo.js';
import { SAMPLE_REPO } from '../helpers.js';

// Creating symlinks needs extra privileges on Windows; chmod does not restrict reads there.
const win = process.platform === 'win32';

let work: string;
let repo: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'archflow-test-'));
  repo = path.join(work, 'repo');
  await cp(SAMPLE_REPO, repo, { recursive: true });
  repo = await resolveRepoRoot(repo);
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

const accessCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RepoAccessError);
    return (err as RepoAccessError).code;
  }
  return 'resolved';
};

describe('resolveRepoRoot', () => {
  it('returns the canonical path of an existing directory', async () => {
    expect(path.isAbsolute(repo)).toBe(true);
  });

  it('gives understandable errors for bad paths', async () => {
    expect(await accessCode(resolveRepoRoot(path.join(work, 'missing')))).toBe('not-found');
    await writeFile(path.join(work, 'file.txt'), 'x');
    expect(await accessCode(resolveRepoRoot(path.join(work, 'file.txt')))).toBe('not-directory');
    expect(await accessCode(resolveRepoRoot(''))).toBe('invalid-path');
    expect(await accessCode(resolveRepoRoot('a\0b'))).toBe('invalid-path');
  });

  it.skipIf(win || process.getuid?.() === 0)('reports missing permissions', async () => {
    const locked = path.join(work, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);
    try {
      expect(await accessCode(resolveRepoRoot(locked))).toBe('permission-denied');
    } finally {
      await chmod(locked, 0o755);
    }
  });
});

describe('path confinement', () => {
  it.each(['../outside', 'a/../../outside', '/etc/passwd', 'C:\\Windows', 'x\0y'])('rejects %s', (p) => {
    expect(() => resolveInside(repo, p)).toThrow(RepoAccessError);
  });

  it('accepts paths inside the repository', () => {
    expect(resolveInside(repo, '.archflow/manifest.yaml')).toBe(path.join(repo, '.archflow/manifest.yaml'));
    expect(resolveInside(repo, 'a/../b')).toBe(path.join(repo, 'b'));
  });

  it.skipIf(win)('rejects symlinks that escape the repository', async () => {
    await writeFile(path.join(work, 'secret.txt'), 'top secret');
    await symlink(path.join(work, 'secret.txt'), path.join(repo, 'link.txt'));
    expect(await accessCode(resolveInsideReal(repo, 'link.txt'))).toBe('outside-root');
  });
});

describe('readModelFiles / loadModel', () => {
  it('loads the sample model from disk', async () => {
    const result = await loadModel(repo);
    expect(result.issues).toEqual([]);
    expect(result.model?.elements.length).toBe(11);
  });

  it('reports a repository without a model directory', async () => {
    const empty = path.join(work, 'empty');
    await mkdir(empty);
    const result = await loadModel(empty);
    expect(result.model).toBeUndefined();
    expect(result.issues[0]!.message).toContain('.archflow');
  });

  it.skipIf(win)('never follows symlinks inside the model directory', async () => {
    await writeFile(path.join(work, 'outside.yaml'), 'elements: []\n');
    await symlink(path.join(work, 'outside.yaml'), path.join(repo, '.archflow', 'linked.yaml'));
    const result = await readModelFiles(repo);
    expect(result.files.map((f) => f.path)).not.toContain('linked.yaml');
    expect(result.issues).toMatchObject([{ severity: 'warning', code: 'ignored-file', file: 'linked.yaml' }]);
  });

  it.skipIf(win)('refuses a model directory that is itself a symlink', async () => {
    const other = path.join(work, 'other');
    await cp(path.join(repo, '.archflow'), other, { recursive: true });
    await rm(path.join(repo, '.archflow'), { recursive: true });
    await symlink(other, path.join(repo, '.archflow'));
    const result = await loadModel(repo);
    expect(result.model).toBeUndefined();
    expect(result.issues[0]!.message).toContain('symbolic link');
  });

  it('skips history, dotfiles and reports other non-YAML files', async () => {
    await mkdir(path.join(repo, '.archflow', 'history'));
    await writeFile(path.join(repo, '.archflow', 'history', 'old.yaml'), 'not: [valid');
    await writeFile(path.join(repo, '.archflow', '.gitkeep'), '');
    await writeFile(path.join(repo, '.archflow', 'notes.md'), '# notes');
    const result = await loadModel(repo);
    expect(result.model).toBeDefined();
    expect(result.issues).toMatchObject([{ code: 'ignored-file', file: 'notes.md' }]);
  });

  it('rejects oversized files without returning a partial model', async () => {
    await writeFile(path.join(repo, '.archflow', 'huge.yaml'), `# ${'x'.repeat(LIMITS.maxFileBytes)}\n`);
    const result = await loadModel(repo);
    expect(result.model).toBeUndefined();
    expect(result.issues).toMatchObject([{ code: 'limit-exceeded', file: 'huge.yaml' }]);
  });
});
