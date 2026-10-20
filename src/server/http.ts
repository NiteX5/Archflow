import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { ApiError } from '../core/api.js';
import { RepoAccessError } from '../node/repo.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Partial<ApiError> & Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

export interface Route {
  method: 'GET' | 'POST';
  /** Exact path or a pattern with `:param` segments. */
  path: string;
  handler: (ctx: RouteContext) => Promise<unknown>;
  /** Raw handlers write the response themselves (e.g. SSE, downloads). */
  raw?: boolean;
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: () => Promise<unknown>;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Rejects requests that did not come from a local page: a foreign Host header
 * (DNS rebinding) or a foreign Origin (cross-site requests).
 */
export function checkLocalRequest(req: IncomingMessage): void {
  const host = req.headers.host ?? '';
  const hostname = host.replace(/:\d+$/, '');
  if (!LOCAL_HOSTNAMES.has(hostname)) throw new HttpError(403, 'forbidden-host', 'Requests must target localhost');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let ok = false;
    try {
      const u = new URL(origin);
      ok = u.protocol === 'http:' && LOCAL_HOSTNAMES.has(u.hostname);
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(403, 'forbidden-origin', 'Cross-origin requests are not allowed');
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported-media-type', 'Send the request body as application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body-too-large', `Request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid-json', 'The request body is not valid JSON');
  }
}

function match(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = pathname.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

async function serveStatic(res: ServerResponse, webDir: string | null, pathname: string): Promise<void> {
  if (!webDir) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The web UI is not built. Run "npm run build" first.');
    return;
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = path.resolve(webDir, rel || 'index.html');
  const inside = path.relative(webDir, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new HttpError(404, 'not-found', 'Not found');
  const exists = await stat(file).then((s) => s.isFile(), () => false);
  if (!exists) {
    if (rel.startsWith('assets/')) throw new HttpError(404, 'not-found', 'Not found');
    file = path.join(webDir, 'index.html');
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  res.end(body);
}

export function createHandler(routes: Route[], webDir: string | null, log: (line: string) => void) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      checkLocalRequest(req);
      if (url.pathname.startsWith('/api/')) {
        for (const route of routes) {
          if (route.method !== req.method) continue;
          const params = match(route.path, url.pathname);
          if (!params) continue;
          let cached: Promise<unknown> | undefined;
          const result = await route.handler({ req, res, url, params, body: () => (cached ??= readJsonBody(req)) });
          if (!route.raw) sendJson(res, 200, result);
          return;
        }
        throw new HttpError(404, 'not-found', `No API route for ${req.method} ${url.pathname}`);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method-not-allowed', 'Method not allowed');
      await serveStatic(res, webDir, url.pathname);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra });
      } else if (err instanceof RepoAccessError) {
        sendJson(res, 400, { error: err.code, message: err.message });
      } else {
        // Never echo internal details (they may contain file contents); log the message only.
        log(`Internal error on ${req.method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
        sendJson(res, 500, { error: 'internal', message: 'Internal error. See the Archflow terminal output.' });
      }
    }
  };
}
