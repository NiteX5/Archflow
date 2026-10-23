/**
 * Schema migrations. Each step upgrades the model files by one version and
 * keeps everything else (IDs, relations, notes, comments) untouched; the
 * result must validate before anything is written.
 */
import { parseDocument } from 'yaml';
import { SCHEMA_VERSION } from './schema.js';

export class MigrationError extends Error {}

type Step = (files: Map<string, string>) => { files: Map<string, string>; notes: string[] };

/** Version N → N+1. */
const STEPS: Record<number, Step> = {
  // v2 only adds optional fields, element kinds and relation types: every v1
  // model is already a valid v2 model, so only the declared version changes.
  1: (files) => ({ files: setManifestVersion(files, 2), notes: ['Schema 2 adds functional dependencies, didactic fields and process steps; no data changes.'] }),
};

function setManifestVersion(files: Map<string, string>, version: number): Map<string, string> {
  const manifest = files.get('manifest.yaml');
  if (manifest === undefined) throw new MigrationError('The model has no manifest.yaml');
  const doc = parseDocument(manifest);
  if (doc.errors.length) throw new MigrationError('manifest.yaml is not valid YAML; fix it before migrating');
  doc.set('schemaVersion', version);
  return new Map(files).set('manifest.yaml', doc.toString({ lineWidth: 0 }));
}

export function manifestVersion(files: Map<string, string>): number | undefined {
  const manifest = files.get('manifest.yaml');
  if (manifest === undefined) return undefined;
  const v = parseDocument(manifest).get('schemaVersion');
  return typeof v === 'number' ? v : undefined;
}

export interface MigrationPlan {
  from: number;
  to: number;
  files: Map<string, string>;
  notes: string[];
}

/** Upgrades the file set to {@link SCHEMA_VERSION}, one version at a time. */
export function migrateFiles(files: Map<string, string>): MigrationPlan {
  const from = manifestVersion(files);
  if (from === undefined) throw new MigrationError('manifest.yaml does not declare a numeric schemaVersion');
  if (from > SCHEMA_VERSION) throw new MigrationError(`Schema version ${from} is newer than this Archflow (${SCHEMA_VERSION}); upgrade Archflow instead`);
  let current = files;
  const notes: string[] = [];
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new MigrationError(`No migration exists from schema version ${v}`);
    const r = step(current);
    current = r.files;
    notes.push(...r.notes);
  }
  return { from, to: SCHEMA_VERSION, files: current, notes };
}
