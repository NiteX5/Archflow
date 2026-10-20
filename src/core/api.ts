/** Contract between the local service and the web UI. */
import type { Issue } from './issues.js';
import type { Model } from './model.js';

export type WorkspaceStatus = 'no-repo' | 'no-model' | 'valid' | 'invalid';

export interface AppState {
  /** Canonical path of the authorized repository, if any. */
  repo: string | null;
  /** True when the repository was fixed on the command line and cannot be changed from the UI. */
  repoFixed: boolean;
  status: WorkspaceStatus;
  /** Last valid model. Kept while the files on disk are invalid. */
  model: Model | null;
  /** Hash of the file set behind `model`. */
  version: string | null;
  lastValidAt: string | null;
  /** Issues of the files currently on disk (may differ from `model` when invalid). */
  issues: Issue[];
}

export interface ApiError {
  error: string;
  message: string;
  issues?: Issue[];
}
