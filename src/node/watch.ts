/**
 * Detects changes to the model files made outside Archflow (Claude, an editor,
 * git checkout...) and reloads the workspace. Events are debounced and the
 * whole model is re-validated, so a burst of writes is applied as one update.
 */
import { watch, type FSWatcher } from 'node:fs';
import { MODEL_DIR } from '../core/schema.js';
import { resolveInside } from './repo.js';
import type { Workspace } from './workspace.js';

export const DEBOUNCE_MS = 150;
export const POLL_MS = 2000;

export interface ModelWatcher {
  stop(): void;
  /** "watch" when native events are used, "poll" when the platform could not watch. */
  readonly mode: 'watch' | 'poll';
}

function relevant(filename: string | null): boolean {
  if (filename === null) return true;
  const rel = filename.split(/[\\/]/);
  // Our own history and temporary files never trigger a reload.
  if (rel[0] === 'history') return false;
  return !rel[rel.length - 1]!.startsWith('.');
}

export function watchModel(workspace: Workspace, root: string, onError: (message: string) => void): ModelWatcher {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      workspace.reload().catch((err: unknown) => onError(`Reload failed: ${err instanceof Error ? err.message : String(err)}`));
    }, DEBOUNCE_MS);
  };

  const modelDir = resolveInside(root, MODEL_DIR);
  const watchers: FSWatcher[] = [];
  let modelWatcher: FSWatcher | undefined;
  const watchModelDir = () => {
    if (modelWatcher) return;
    try {
      modelWatcher = watch(modelDir, { recursive: true }, (_event, filename) => {
        if (relevant(filename)) schedule();
      });
      modelWatcher.on('error', () => {
        // The directory was removed or renamed: drop the watcher and reload.
        modelWatcher?.close();
        modelWatcher = undefined;
        schedule();
      });
    } catch {
      modelWatcher = undefined; // does not exist yet
    }
  };

  try {
    // The repository root is watched (non-recursively) to notice .archflow being created or replaced.
    const rootWatcher = watch(root, (_event, filename) => {
      if (filename === MODEL_DIR || filename === null) {
        modelWatcher?.close();
        modelWatcher = undefined;
        watchModelDir();
        schedule();
      }
    });
    watchers.push(rootWatcher);
    watchModelDir();
  } catch (err) {
    onError(`File watching is unavailable (${err instanceof Error ? err.message : String(err)}); polling every ${POLL_MS / 1000}s instead.`);
    const interval = setInterval(schedule, POLL_MS);
    return {
      mode: 'poll',
      stop: () => {
        stopped = true;
        clearInterval(interval);
        clearTimeout(timer);
      },
    };
  }

  return {
    mode: 'watch',
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      modelWatcher?.close();
      for (const w of watchers) w.close();
    },
  };
}
