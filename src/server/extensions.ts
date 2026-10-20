import type { Workspace } from '../node/workspace.js';
import type { Route } from './http.js';

/** Routes and background services beyond read-only access. Filled in by later units. */
export function serverExtensions(_workspace: Workspace): { routes: Route[]; start?: () => Promise<void>; stop?: () => void } {
  return { routes: [] };
}
