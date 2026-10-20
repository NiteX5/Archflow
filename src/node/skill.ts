import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInside } from './repo.js';

export const SKILL_FILES = ['SKILL.md', 'reference.md'] as const;
export const SKILL_TARGET = '.claude/skills/archflow';

/** The skill shipped with Archflow: <package>/skills/archflow (from src/node or dist/node). */
export function bundledSkillDir(): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/archflow');
  if (!existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`The bundled skill was not found at ${dir}`);
  return dir;
}

export interface SkillInstallResult {
  written: string[];
  unchanged: string[];
  /** Files that exist with different content and were left untouched. */
  skipped: string[];
}

/** Copies the skill into <repo>/.claude/skills/archflow. Never overwrites local changes unless `force`. */
export async function installSkill(root: string, force: boolean, source = bundledSkillDir()): Promise<SkillInstallResult> {
  const target = resolveInside(root, SKILL_TARGET);
  await mkdir(target, { recursive: true });
  const result: SkillInstallResult = { written: [], unchanged: [], skipped: [] };
  for (const name of SKILL_FILES) {
    const content = await readFile(path.join(source, name), 'utf8');
    const dest = path.join(target, name);
    const existing = await readFile(dest, 'utf8').catch(() => null);
    const rel = `${SKILL_TARGET}/${name}`;
    if (existing === content) result.unchanged.push(rel);
    else if (existing !== null && !force) result.skipped.push(rel);
    else {
      await writeFile(dest, content, 'utf8');
      result.written.push(rel);
    }
  }
  return result;
}
