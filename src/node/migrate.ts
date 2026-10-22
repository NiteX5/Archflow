import { hasErrors, type Issue } from '../core/issues.js';
import { migrateFiles, MigrationError } from '../core/migrate.js';
import { validateModel } from '../core/validate.js';
import type { History } from './history.js';
import { readModelFiles } from './repo.js';
import { writeFileSet } from './writer.js';

export interface MigrationResult {
  from: number;
  to: number;
  changedFiles: string[];
  notes: string[];
}

export class MigrationFailed extends Error {
  constructor(
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
}

/**
 * Migrates the model of `root` on disk. The previous files are recorded in the
 * history, and nothing is written unless the migrated model is valid.
 */
export async function migrateRepository(root: string, history: History): Promise<MigrationResult> {
  const read = await readModelFiles(root);
  if (!read.modelDirExists) throw new MigrationFailed('The repository has no model to migrate');
  if (hasErrors(read.issues)) throw new MigrationFailed('Some model files cannot be read; fix them first', read.issues);
  const files = new Map(read.files.map((f) => [f.path, f.content]));
  let plan;
  try {
    plan = migrateFiles(files);
  } catch (err) {
    if (err instanceof MigrationError) throw new MigrationFailed(err.message);
    throw err;
  }
  if (plan.from === plan.to) return { from: plan.from, to: plan.to, changedFiles: [], notes: ['Already up to date'] };
  const result = validateModel([...plan.files].map(([path, content]) => ({ path, content })));
  if (!result.model || hasErrors(result.issues)) {
    // Rollback is implicit: nothing has been written yet.
    throw new MigrationFailed(`The migrated model would be invalid; nothing was written. Fix these issues and migrate again.`, result.issues);
  }
  const changes = await writeFileSet(root, history, files, plan.files, 'migrate', `Migrated schema ${plan.from} → ${plan.to}`);
  return { from: plan.from, to: plan.to, changedFiles: changes.map((c) => c.file), notes: plan.notes };
}
