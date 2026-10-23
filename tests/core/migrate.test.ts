import { describe, expect, it } from 'vitest';
import { manifestVersion, migrateFiles, MigrationError } from '../../src/core/migrate.js';
import { SCHEMA_VERSION } from '../../src/core/schema.js';
import { validateModel } from '../../src/core/index.js';
import { sampleFiles } from '../helpers.js';

const asV1 = () =>
  new Map(sampleFiles().map((f) => [f.path, f.path === 'manifest.yaml' ? `# keep me\n${f.content.replace('schemaVersion: 2', 'schemaVersion: 1')}` : f.content]));

describe('schema migration', () => {
  it('asks for a migration instead of loading a v1 model', () => {
    const files = [...asV1()].map(([path, content]) => ({ path, content }));
    const { model, issues } = validateModel(files);
    expect(model).toBeUndefined();
    expect(issues).toMatchObject([{ code: 'migration-required', file: 'manifest.yaml', path: 'schemaVersion' }]);
    expect(issues[0]!.hint).toMatch(/archflow migrate/);
  });

  it('upgrades v1 to the current version keeping everything else, comments included', () => {
    const before = asV1();
    const plan = migrateFiles(before);
    expect(plan).toMatchObject({ from: 1, to: SCHEMA_VERSION });
    expect(manifestVersion(plan.files)).toBe(SCHEMA_VERSION);
    expect(plan.files.get('manifest.yaml')).toContain('# keep me');
    for (const [path, content] of before) if (path !== 'manifest.yaml') expect(plan.files.get(path)).toBe(content);
    const result = validateModel([...plan.files].map(([path, content]) => ({ path, content })));
    expect(result.issues).toEqual([]);
    expect(result.model!.elements).toHaveLength(11);
  });

  it('is a no-op on current models and refuses newer or unknown ones', () => {
    const current = new Map(sampleFiles().map((f) => [f.path, f.content]));
    expect(migrateFiles(current)).toMatchObject({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, notes: [] });
    const newer = new Map(current).set('manifest.yaml', 'schemaVersion: 99\nproject: { name: X }\n');
    expect(() => migrateFiles(newer)).toThrow(/newer than this Archflow/);
    const none = new Map(current).set('manifest.yaml', 'project: { name: X }\n');
    expect(() => migrateFiles(none)).toThrow(MigrationError);
  });
});
