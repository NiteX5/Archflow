import { opsRequestSchema, type OpsResult } from '../core/ops.js';
import { formatPath } from '../core/issues.js';
import { History, planRevert } from '../node/history.js';
import { initModel, InitError } from '../node/init.js';
import { MigrationFailed, migrateRepository } from '../node/migrate.js';
import { watchModel, type ModelWatcher } from '../node/watch.js';
import type { Workspace } from '../node/workspace.js';
import { applyOps, commitFiles, freshValidSnapshot, WriteError } from '../node/writer.js';
import { HttpError, type Route } from './http.js';
import { interopRoutes } from './interop.js';

const STATUS: Record<WriteError['code'], number> = {
  conflict: 409,
  'model-invalid': 409,
  'invalid-result': 422,
  'invalid-operation': 400,
  'no-repo': 409,
};

export function toHttpError(err: unknown): unknown {
  if (err instanceof WriteError) {
    return new HttpError(STATUS[err.code], err.code, err.message, {
      ...(err.conflicts.length ? { conflicts: err.conflicts } : {}),
      ...(err.issues.length ? { issues: err.issues } : {}),
    });
  }
  return err;
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toHttpError(err);
  }
}

/** Routes and background services for editing, history and file watching. */
export function serverExtensions(workspace: Workspace): { routes: Route[]; start?: () => Promise<void>; stop?: () => void } {
  let history: History | null = null;
  let watcher: ModelWatcher | null = null;
  const historyOf = (): History => {
    if (!history) throw new HttpError(409, 'no-repo', 'No repository is open');
    return history;
  };

  const attach = (root: string) => {
    history = new History(root);
    watcher?.stop();
    watcher = watchModel(workspace, root, (m) => process.stderr.write(`${m}\n`));
  };
  workspace.onOpen = attach;
  workspace.onExternalChange = async (previous, next) => {
    const changes = [...new Set([...previous.files.keys(), ...next.files.keys()])].map((file) => ({
      file,
      before: previous.files.get(file) ?? null,
      after: next.files.get(file) ?? null,
    }));
    await history?.record('external', 'Model files changed outside Archflow', changes);
  };

  const routes: Route[] = [
    {
      method: 'POST',
      path: '/api/migrate',
      handler: async () =>
        workspace.exclusive(async () => {
          if (!workspace.root) throw new HttpError(409, 'no-repo', 'No repository is open');
          try {
            const result = await migrateRepository(workspace.root, historyOf());
            return { result, state: await workspace.reloadUnlocked() };
          } catch (err) {
            if (err instanceof MigrationFailed) throw new HttpError(422, 'migration-failed', err.message, err.issues.length ? { issues: err.issues } : {});
            throw err;
          }
        }),
    },
    {
      method: 'POST',
      path: '/api/init',
      handler: async ({ body }) => {
        const name = (await body()) as { name?: unknown };
        if (typeof name?.name !== 'string') throw new HttpError(400, 'invalid-request', '"name" must be a string');
        const projectName = name.name;
        return workspace.exclusive(async () => {
          if (!workspace.root) throw new HttpError(409, 'no-repo', 'No repository is open');
          try {
            await initModel(workspace.root, projectName);
          } catch (err) {
            if (err instanceof InitError) throw new HttpError(409, 'init-failed', err.message);
            throw err;
          }
          return workspace.reloadUnlocked();
        });
      },
    },
    {
      method: 'POST',
      path: '/api/ops',
      handler: async ({ body }) => {
        const parsed = opsRequestSchema.safeParse(await body());
        if (!parsed.success) {
          const first = parsed.error.issues[0]!;
          throw new HttpError(400, 'invalid-request', `Invalid operation at ${formatPath(first.path.filter((p) => typeof p !== 'symbol')) || 'body'}: ${first.message}`);
        }
        const createdViews = await guard(() => applyOps(workspace, historyOf(), parsed.data.ops));
        return { state: workspace.state(), createdViews } satisfies OpsResult;
      },
    },
    { method: 'GET', path: '/api/history', handler: async () => historyOf().list() },
    {
      method: 'GET',
      path: '/api/history/:id',
      handler: async ({ params }) => {
        const entry = await historyOf().get(params.id!);
        if (!entry) throw new HttpError(404, 'not-found', 'History entry not found');
        return entry;
      },
    },
    {
      method: 'POST',
      path: '/api/history/:id/restore',
      handler: async ({ params }) =>
        guard(() =>
          workspace.exclusive(async () => {
            const h = historyOf();
            const snapshot = await freshValidSnapshot(workspace);
            const entries = await h.since(params.id!);
            if (!entries) throw new HttpError(404, 'not-found', 'History entry not found');
            const { target, diverged } = planRevert(entries, snapshot.files);
            if (diverged.length > 0) {
              throw new HttpError(
                409,
                'history-diverged',
                `These files changed in ways the history does not cover, so restoring could lose work: ${diverged.join(', ')}`,
              );
            }
            const next = new Map(snapshot.files);
            for (const [file, content] of target) {
              if (content === null) next.delete(file);
              else next.set(file, content);
            }
            const first = entries[0]!;
            await commitFiles(workspace, h, next, 'restore', `Restored the state before "${first.summary}" (${first.at})`);
            return workspace.state();
          }),
        ),
    },
  ];

  routes.push(...interopRoutes(workspace, historyOf));

  return {
    routes,
    start: async () => {
      if (workspace.root) attach(workspace.root);
    },
    stop: () => watcher?.stop(),
  };
}
