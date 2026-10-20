/**
 * The authorized repository and its model as seen by the running service.
 *
 * Invariant: `snapshot` only ever holds a fully valid model. Reloading invalid
 * files updates `issues` and `status` but keeps the last valid snapshot, so the
 * UI never shows a partially applied change.
 */
import type { AppState, WorkspaceStatus } from '../core/api.js';
import { hashValue } from '../core/hash.js';
import { hasErrors, type Issue, type Model } from '../core/index.js';
import { readModelFiles, RepoAccessError, resolveRepoRoot } from './repo.js';
import { validateModel } from '../core/validate.js';

export interface Snapshot {
  files: Map<string, string>;
  model: Model;
  version: string;
  at: string;
}

export type Listener = (state: AppState) => void;

export function versionOf(files: Map<string, string>): string {
  return hashValue([...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export class Workspace {
  private rootPath: string | null = null;
  private snapshotValue: Snapshot | null = null;
  private issues: Issue[] = [];
  private status: WorkspaceStatus = 'no-repo';
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly repoFixed: boolean) {}

  get root(): string | null {
    return this.rootPath;
  }

  get snapshot(): Snapshot | null {
    return this.snapshotValue;
  }

  /** Runs `fn` after every previously scheduled operation, so reads and writes never interleave. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Authorizes a repository. Only allowed once, and never when fixed on the command line. */
  async open(path: string): Promise<AppState> {
    return this.exclusive(async () => {
      if (this.rootPath !== null) {
        throw new RepoAccessError(
          'invalid-path',
          this.repoFixed
            ? 'The repository was set on the command line and cannot be changed from the UI'
            : 'A repository is already open. Restart Archflow to open another one.',
        );
      }
      this.rootPath = await resolveRepoRoot(path);
      return this.reloadUnlocked();
    });
  }

  reload(): Promise<AppState> {
    return this.exclusive(() => this.reloadUnlocked());
  }

  /** Re-reads the model from disk. Must run inside {@link exclusive}. */
  async reloadUnlocked(): Promise<AppState> {
    if (this.rootPath === null) return this.state();
    const read = await readModelFiles(this.rootPath);
    if (!read.modelDirExists && read.issues.length === 0) {
      this.status = 'no-model';
      this.issues = [];
      this.snapshotValue = null;
      return this.notify();
    }
    const files = new Map(read.files.map((f) => [f.path, f.content]));
    const version = versionOf(files);
    if (this.status === 'valid' && this.snapshotValue?.version === version && !hasErrors(read.issues)) {
      // Nothing changed (e.g. our own write echoed by the watcher).
      return this.state();
    }
    const result = validateModel(read.files);
    this.issues = [...read.issues, ...result.issues];
    if (result.model && !hasErrors(this.issues)) {
      this.snapshotValue = { files, model: result.model, version, at: new Date().toISOString() };
      this.status = 'valid';
    } else {
      this.status = 'invalid';
    }
    return this.notify();
  }

  /** Installs a snapshot produced by a validated write. Must run inside {@link exclusive}. */
  commitSnapshot(snapshot: Snapshot, issues: Issue[]): AppState {
    this.snapshotValue = snapshot;
    this.issues = issues;
    this.status = 'valid';
    return this.notify();
  }

  state(): AppState {
    return {
      repo: this.rootPath,
      repoFixed: this.repoFixed,
      status: this.rootPath === null ? 'no-repo' : this.status,
      model: this.snapshotValue?.model ?? null,
      version: this.snapshotValue?.version ?? null,
      lastValidAt: this.snapshotValue?.at ?? null,
      issues: this.issues,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): AppState {
    const s = this.state();
    for (const l of this.listeners) l(s);
    return s;
  }
}
