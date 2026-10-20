/**
 * Filesystem access restricted to one explicitly authorized repository.
 * Every path coming from outside (CLI, HTTP, model content) goes through here.
 */
import { constants } from 'node:fs';
import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_DIR, validateModel, type Issue, type ModelFile, type ValidationResult } from '../core/index.js';

export const LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 1024 * 1024,
  maxDepth: 8,
} as const;

export type RepoAccessErrorCode = 'not-found' | 'not-directory' | 'permission-denied' | 'invalid-path' | 'outside-root';

export class RepoAccessError extends Error {
  constructor(
    readonly code: RepoAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepoAccessError';
  }
}

/** Resolves and checks the repository the user authorized. Returns its canonical path. */
export async function resolveRepoRoot(input: string): Promise<string> {
  if (!input || input.includes('\0')) throw new RepoAccessError('invalid-path', 'The repository path is empty or invalid');
  const absolute = path.resolve(input);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch (err) {
    throw fsError(err, absolute);
  }
  const info = await stat(real);
  if (!info.isDirectory()) throw new RepoAccessError('not-directory', `"${absolute}" is not a directory`);
  try {
    await access(real, constants.R_OK | constants.X_OK);
  } catch (err) {
    throw fsError(err, absolute);
  }
  return real;
}

/**
 * Resolves a repository-relative path, rejecting anything that would escape the
 * root lexically (absolute paths, "..", NUL bytes). Symlinks are handled by
 * {@link resolveInsideReal}.
 */
export function resolveInside(root: string, relative: string): string {
  if (relative.includes('\0') || path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    throw new RepoAccessError('invalid-path', 'Paths must be relative to the repository root');
  }
  const resolved = path.resolve(root, relative);
  if (!isWithin(root, resolved)) {
    throw new RepoAccessError('outside-root', 'The path points outside the authorized repository');
  }
  return resolved;
}

/** Like {@link resolveInside}, but also follows symlinks and re-checks the target. */
export async function resolveInsideReal(root: string, relative: string): Promise<string> {
  const resolved = resolveInside(root, relative);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch (err) {
    throw fsError(err, relative);
  }
  if (!isWithin(root, real)) {
    throw new RepoAccessError('outside-root', 'The path points outside the authorized repository');
  }
  return real;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function fsError(err: unknown, shownPath: string): RepoAccessError {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new RepoAccessError('not-found', `"${shownPath}" does not exist`);
  if (code === 'EACCES' || code === 'EPERM') {
    return new RepoAccessError('permission-denied', `No permission to read "${shownPath}"`);
  }
  return new RepoAccessError('invalid-path', `Cannot access "${shownPath}" (${code ?? 'unknown error'})`);
}

export interface ReadModelResult {
  files: ModelFile[];
  issues: Issue[];
  modelDirExists: boolean;
}

/**
 * Reads the model files below `<root>/.archflow`. Symlinks are never followed,
 * `history/` is skipped and size limits are enforced before reading.
 */
export async function readModelFiles(root: string): Promise<ReadModelResult> {
  const modelDir = resolveInside(root, MODEL_DIR);
  const files: ModelFile[] = [];
  const issues: Issue[] = [];

  try {
    const info = await lstat(modelDir);
    if (!info.isDirectory()) {
      const what = info.isSymbolicLink() ? 'is a symbolic link, which is not followed' : 'is not a directory';
      issues.push({ severity: 'error', code: 'unreadable-file', message: `${MODEL_DIR} ${what}` });
      return { files, issues, modelDirExists: false };
    }
  } catch {
    return { files, issues, modelDirExists: false };
  }

  let count = 0;
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > LIMITS.maxDepth) {
      issues.push({
        severity: 'error',
        code: 'limit-exceeded',
        file: rel,
        message: `Directory nesting exceeds ${LIMITS.maxDepth} levels`,
      });
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (relPath === 'history') continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push({
          severity: 'warning',
          code: 'ignored-file',
          file: relPath,
          message: 'Symbolic links are not followed inside the model directory',
          hint: 'Replace the link with a regular file.',
        });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full, relPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.yaml')) {
        issues.push({
          severity: 'warning',
          code: 'ignored-file',
          file: relPath,
          message: 'File is not part of the model and was ignored',
          hint: 'Model files must use the ".yaml" extension.',
        });
        continue;
      }
      if (++count > LIMITS.maxFiles) {
        if (count === LIMITS.maxFiles + 1) {
          issues.push({
            severity: 'error',
            code: 'limit-exceeded',
            message: `The model has more than ${LIMITS.maxFiles} files`,
            hint: 'Split the repository into several models or reduce the number of files.',
          });
        }
        continue;
      }
      const size = (await stat(full)).size;
      if (size > LIMITS.maxFileBytes) {
        issues.push({
          severity: 'error',
          code: 'limit-exceeded',
          file: relPath,
          message: `File is ${size} bytes; the limit is ${LIMITS.maxFileBytes}`,
          hint: 'Split the file by domain or module.',
        });
        continue;
      }
      try {
        files.push({ path: relPath, content: await readFile(full, 'utf8') });
      } catch (err) {
        issues.push({
          severity: 'error',
          code: 'unreadable-file',
          file: relPath,
          message: `Cannot read file (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
        });
      }
    }
  };

  await walk(modelDir, '', 0);
  return { files, issues, modelDirExists: true };
}

/** Reads and validates the model of an authorized repository. */
export async function loadModel(root: string): Promise<ValidationResult> {
  const read = await readModelFiles(root);
  if (!read.modelDirExists && read.issues.length === 0) {
    return {
      issues: [
        {
          severity: 'error',
          code: 'missing-manifest',
          message: `The repository has no ${MODEL_DIR}/ directory`,
          hint: `Run "archflow init --repo <path>" or create ${MODEL_DIR}/manifest.yaml (see the Archflow model format reference).`,
        },
      ],
    };
  }
  const result = validateModel(read.files);
  const issues = [...read.issues, ...result.issues];
  // Read errors (limits, unreadable files) make the set incomplete: never return a model then.
  if (read.issues.some((i) => i.severity === 'error')) return { issues };
  return { ...result, issues };
}
