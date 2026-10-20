/**
 * Change history stored in `.archflow/history/`. Every change applied by
 * Archflow, and every valid external change it observes, is recorded with the
 * full before/after content of the affected files, so any state can be compared
 * and restored. History entries are never part of the model itself.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_DIR } from '../core/schema.js';
import { resolveInside } from './repo.js';

export type HistoryOrigin = 'ui' | 'external' | 'import' | 'restore';

export interface FileChange {
  file: string;
  /** `null` when the file did not exist before / was removed. */
  before: string | null;
  after: string | null;
}

export interface HistoryEntry {
  id: string;
  at: string;
  origin: HistoryOrigin;
  summary: string;
  changes: FileChange[];
}

export type HistorySummary = Omit<HistoryEntry, 'changes'> & { files: string[] };

export const HISTORY_DIR = 'history';
export const MAX_ENTRIES = 500;
const ENTRY_FILE = /^(\d{13}-\d{6})\.json$/;

export class History {
  private readonly dir: string;
  private counter = 0;

  constructor(root: string) {
    this.dir = resolveInside(root, `${MODEL_DIR}/${HISTORY_DIR}`);
  }

  async record(origin: HistoryOrigin, summary: string, changes: FileChange[]): Promise<HistoryEntry | null> {
    const effective = changes.filter((c) => c.before !== c.after);
    if (effective.length === 0) return null;
    await mkdir(this.dir, { recursive: true });
    const id = `${Date.now()}-${String(this.counter++ % 1_000_000).padStart(6, '0')}`;
    const entry: HistoryEntry = { id, at: new Date().toISOString(), origin, summary, changes: effective };
    await writeFile(path.join(this.dir, `${id}.json`), `${JSON.stringify(entry, null, 1)}\n`, 'utf8');
    await this.prune();
    return entry;
  }

  private async ids(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    return names
      .map((n) => ENTRY_FILE.exec(n)?.[1])
      .filter((x): x is string => !!x)
      .sort();
  }

  /** Oldest entries are dropped beyond {@link MAX_ENTRIES}; Git keeps the long-term record. */
  private async prune(): Promise<void> {
    const ids = await this.ids();
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) {
      await rm(path.join(this.dir, `${id}.json`), { force: true });
    }
  }

  async get(id: string): Promise<HistoryEntry | null> {
    if (!/^\d{13}-\d{6}$/.test(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(this.dir, `${id}.json`), 'utf8')) as HistoryEntry;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Newest first. */
  async list(limit = 100): Promise<HistorySummary[]> {
    const ids = (await this.ids()).reverse().slice(0, limit);
    const out: HistorySummary[] = [];
    for (const id of ids) {
      const e = await this.get(id);
      if (e) out.push({ id: e.id, at: e.at, origin: e.origin, summary: e.summary, files: e.changes.map((c) => c.file) });
    }
    return out;
  }

  /** Entries from `id` (inclusive) to the newest, oldest first. */
  async since(id: string): Promise<HistoryEntry[] | null> {
    const ids = await this.ids();
    const idx = ids.indexOf(id);
    if (idx < 0) return null;
    const out: HistoryEntry[] = [];
    for (const x of ids.slice(idx)) {
      const e = await this.get(x);
      if (e) out.push(e);
    }
    return out;
  }
}

/**
 * Computes the file contents that undo `entries` (oldest first): each file goes
 * back to its content before the first entry that touched it. Returns the files
 * whose current content no longer matches the latest recorded state.
 */
export function planRevert(
  entries: HistoryEntry[],
  current: Map<string, string>,
): { target: Map<string, string | null>; diverged: string[] } {
  const target = new Map<string, string | null>();
  const latest = new Map<string, string | null>();
  for (const e of entries) {
    for (const c of e.changes) {
      if (!target.has(c.file)) target.set(c.file, c.before);
      latest.set(c.file, c.after);
    }
  }
  const diverged = [...latest].filter(([file, after]) => (current.get(file) ?? null) !== after).map(([file]) => file);
  return { target, diverged };
}
