import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { MODEL_DIR, SCHEMA_VERSION } from '../core/schema.js';
import { resolveInside } from './repo.js';

export class InitError extends Error {}

/**
 * Creates an empty model: only the manifest. Nothing is inferred from the code;
 * elements are declared afterwards by a person or an agent. Never overwrites.
 */
export async function initModel(root: string, projectName: string): Promise<string> {
  const name = projectName.trim();
  if (!name || name.length > 200) throw new InitError('The project name must have between 1 and 200 characters');
  const dir = resolveInside(root, MODEL_DIR);
  await mkdir(dir, { recursive: true });
  const manifest = path.join(dir, 'manifest.yaml');
  const content = stringify({ schemaVersion: SCHEMA_VERSION, project: { name } });
  try {
    await writeFile(manifest, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new InitError(`${MODEL_DIR}/manifest.yaml already exists; nothing was changed`);
    throw err;
  }
  return manifest;
}
