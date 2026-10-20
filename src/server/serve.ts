import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '../node/workspace.js';
import { createAppServer } from './app.js';
import type { Route } from './http.js';
import { HOST, listenWithFallback } from './listen.js';

export interface ServeOptions {
  repo?: string;
  port: number;
  strictPort: boolean;
  webDir?: string | null;
  log: (line: string) => void;
  /** Extra routes and background services bound to the workspace. */
  extensions?: (workspace: Workspace) => { routes: Route[]; start?: () => Promise<void>; stop?: () => void };
}

export interface RunningServer {
  server: Server;
  workspace: Workspace;
  url: string;
  port: number;
  busy: number[];
  stop: () => Promise<void>;
}

/** The built UI lives next to the compiled server: dist/server → dist/web. */
export function defaultWebDir(): string | null {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
  return existsSync(path.join(dir, 'index.html')) && existsSync(path.join(dir, 'assets')) ? dir : null;
}

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const workspace = new Workspace(options.repo !== undefined);
  // Validate the repository before listening, so a bad path fails fast with a clear message.
  if (options.repo !== undefined) await workspace.open(options.repo);
  const ext = options.extensions?.(workspace);
  const server = createAppServer({
    workspace,
    webDir: options.webDir === undefined ? defaultWebDir() : options.webDir,
    log: options.log,
    routes: ext?.routes ?? [],
  });
  const { port, busy } = await listenWithFallback(server, options.port, options.strictPort);
  await ext?.start?.();
  const url = `http://${HOST}:${port}/`;
  return {
    server,
    workspace,
    url,
    port,
    busy,
    stop: async () => {
      ext?.stop?.();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Opens the URL with the platform's default browser. The command is fixed; nothing comes from the model. */
export function openBrowser(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
