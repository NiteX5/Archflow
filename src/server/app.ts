import { createServer, type Server } from 'node:http';
import type { AppState } from '../core/api.js';
import type { Workspace } from '../node/workspace.js';
import { createHandler, HttpError, type Route } from './http.js';

export interface AppOptions {
  workspace: Workspace;
  /** Directory with the built UI, or null when it is not available. */
  webDir: string | null;
  log: (line: string) => void;
  /** Extra routes registered by other modules (editing, history, import...). */
  routes?: Route[];
}

function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'invalid-request', `"${field}" must be a non-empty string`);
  }
  return value;
}

export function coreRoutes(workspace: Workspace): Route[] {
  return [
    { method: 'GET', path: '/api/state', handler: async () => workspace.state() },
    {
      method: 'POST',
      path: '/api/repo',
      handler: async ({ body }) => workspace.open(requireString(await body(), 'path')),
    },
    { method: 'POST', path: '/api/reload', handler: async () => workspace.reload() },
    {
      method: 'GET',
      path: '/api/events',
      raw: true,
      handler: async ({ req, res }) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        });
        const send = (state: AppState) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        send(workspace.state());
        const unsubscribe = workspace.subscribe(send);
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.on('close', () => {
          clearInterval(ping);
          unsubscribe();
        });
      },
    },
  ];
}

export function createAppServer(options: AppOptions): Server {
  const routes = [...coreRoutes(options.workspace), ...(options.routes ?? [])];
  return createServer(createHandler(routes, options.webDir, options.log));
}
