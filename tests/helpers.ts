import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelFile } from '../src/core/index.js';

export const SAMPLE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/sample');
const SAMPLE_MODEL_DIR = path.join(SAMPLE_REPO, '.archflow');

/** Loads the sample model as in-memory files. */
export function sampleFiles(): ModelFile[] {
  return (readdirSync(SAMPLE_MODEL_DIR, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((p) => p.endsWith('.yaml'))
    .map((p) => ({ path: p.split(path.sep).join('/'), content: readFileSync(path.join(SAMPLE_MODEL_DIR, p), 'utf8') }));
}

/** Returns the sample files with one file replaced (or added) and others removed. */
export function withFiles(overrides: Record<string, string | null>): ModelFile[] {
  const files = sampleFiles().filter((f) => !(f.path in overrides));
  for (const [p, content] of Object.entries(overrides)) if (content !== null) files.push({ path: p, content });
  return files;
}

export function editFile(file: string, edit: (content: string) => string): ModelFile[] {
  return sampleFiles().map((f) => (f.path === file ? { ...f, content: edit(f.content) } : f));
}
