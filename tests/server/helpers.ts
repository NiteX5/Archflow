import { cp, mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, type RunningServer } from '../../src/server/serve.js';
import { serverExtensions } from '../../src/server/extensions.js';
import { SAMPLE_REPO } from '../helpers.js';

export async function copySample(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'archflow-srv-'));
  await cp(SAMPLE_REPO, dir, { recursive: true });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function start(repo?: string, opts: { webDir?: string | null } = {}): Promise<RunningServer> {
  return startServer({ repo, port: 0, strictPort: true, webDir: opts.webDir ?? null, log: () => {}, extensions: serverExtensions });
}

export interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  text: string;
}

/** Raw HTTP request so tests can control Host and Origin headers. */
export function call(
  server: RunningServer,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        method,
        path: pathname,
        headers: {
          Host: `127.0.0.1:${server.port}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
