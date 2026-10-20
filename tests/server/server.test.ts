import { createServer, request } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main.js';
import { HOST, listenWithFallback, PortInUseError } from '../../src/server/listen.js';
import type { RunningServer } from '../../src/server/serve.js';
import { SAMPLE_REPO } from '../helpers.js';
import { call, start } from './helpers.js';

const running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.stop()));
});
const track = (s: RunningServer) => (running.push(s), s);

describe('listening', () => {
  it('binds to loopback only', async () => {
    const s = track(await start(SAMPLE_REPO));
    const addr = s.server.address();
    expect(typeof addr === 'object' && addr?.address).toBe(HOST);
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/`);
  });

  it('falls back to the next free port and reports the busy one', async () => {
    const blocker = createServer();
    const { port } = await listenWithFallback(blocker, 0, true);
    try {
      const server = createServer();
      const result = await listenWithFallback(server, port, false);
      expect(result.busy).toEqual([port]);
      expect(result.port).not.toBe(port);
      server.close();
    } finally {
      blocker.close();
    }
  });

  it('fails with a clear error in strict mode', async () => {
    const blocker = createServer();
    const { port } = await listenWithFallback(blocker, 0, true);
    try {
      await expect(listenWithFallback(createServer(), port, true)).rejects.toBeInstanceOf(PortInUseError);
    } finally {
      blocker.close();
    }
  });
});

describe('request checks', () => {
  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const s = track(await start(SAMPLE_REPO));
    const r = await call(s, 'GET', '/api/state', undefined, { Host: 'attacker.example:80' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden-host');
  });

  it('rejects cross-origin requests', async () => {
    const s = track(await start());
    const r = await call(s, 'POST', '/api/repo', { path: SAMPLE_REPO }, { Origin: 'https://attacker.example' });
    expect(r.status).toBe(403);
    expect(s.workspace.root).toBeNull();
  });

  it('accepts same-origin requests from localhost names', async () => {
    const s = track(await start(SAMPLE_REPO));
    for (const host of [`localhost:${s.port}`, `127.0.0.1:${s.port}`, `[::1]:${s.port}`]) {
      const r = await call(s, 'GET', '/api/state', undefined, { Host: host, Origin: `http://${host}` });
      expect(r.status, host).toBe(200);
    }
  });

  it('requires JSON bodies for writes', async () => {
    const s = track(await start());
    const r = await call(s, 'POST', '/api/repo', undefined, { 'Content-Type': 'text/plain' });
    expect(r.status).toBe(415);
  });

  it('returns 404 for unknown API routes', async () => {
    const s = track(await start(SAMPLE_REPO));
    expect((await call(s, 'GET', '/api/nope')).status).toBe(404);
  });
});

describe('state and repository selection', () => {
  it('serves the validated model of the repository given on the command line', async () => {
    const s = track(await start(SAMPLE_REPO));
    const r = await call(s, 'GET', '/api/state');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'valid', repoFixed: true, issues: [] });
    expect(r.body.model.elements).toHaveLength(11);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('lets the UI choose a repository when none was given, only once', async () => {
    const s = track(await start());
    expect((await call(s, 'GET', '/api/state')).body.status).toBe('no-repo');
    const opened = await call(s, 'POST', '/api/repo', { path: SAMPLE_REPO });
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('valid');
    const again = await call(s, 'POST', '/api/repo', { path: '/' });
    expect(again.status).toBe(400);
    expect(s.workspace.root).toBe(opened.body.repo);
  });

  it('refuses to change a repository fixed on the command line', async () => {
    const s = track(await start(SAMPLE_REPO));
    const r = await call(s, 'POST', '/api/repo', { path: '/' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/command line/);
  });

  it('gives understandable errors for bad paths', async () => {
    const s = track(await start());
    const r = await call(s, 'POST', '/api/repo', { path: path.join(tmpdir(), 'archflow-missing-dir') });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'not-found' });
    expect((await call(s, 'POST', '/api/repo', {})).status).toBe(400);
  });

  it('reports a repository without a model', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'archflow-nomodel-'));
    try {
      const s = track(await start(dir));
      expect((await call(s, 'GET', '/api/state')).body.status).toBe('no-model');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pushes state over server-sent events', async () => {
    const s = track(await start(SAMPLE_REPO));
    const first = await new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: s.port, path: '/api/events', headers: { Host: `127.0.0.1:${s.port}` } }, (res) => {
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        res.once('data', (c: Buffer) => {
          resolve(c.toString('utf8'));
          req.destroy();
        });
      });
      req.on('error', reject);
      req.end();
    });
    expect(first).toMatch(/^event: state\ndata: \{"repo"/);
  });
});

describe('static UI', () => {
  it('serves the UI with a strict CSP and falls back to index.html', async () => {
    const web = await mkdtemp(path.join(tmpdir(), 'archflow-web-'));
    try {
      await mkdir(path.join(web, 'assets'));
      await writeFile(path.join(web, 'index.html'), '<html>ui</html>');
      await writeFile(path.join(web, 'assets', 'a.js'), 'x');
      const s = track(await start(SAMPLE_REPO, { webDir: web }));
      const index = await call(s, 'GET', '/');
      expect(index.text).toBe('<html>ui</html>');
      expect(index.headers['content-security-policy']).toContain("default-src 'self'");
      expect((await call(s, 'GET', '/some/route')).text).toBe('<html>ui</html>');
      expect((await call(s, 'GET', '/assets/a.js')).headers['content-type']).toMatch(/javascript/);
      expect((await call(s, 'GET', '/assets/missing.js')).status).toBe(404);
      expect((await call(s, 'GET', '/../../etc/passwd')).text).toBe('<html>ui</html>');
    } finally {
      await rm(web, { recursive: true, force: true });
    }
  });

  it('explains when the UI is not built', async () => {
    const s = track(await start(SAMPLE_REPO));
    const r = await call(s, 'GET', '/');
    expect(r.status).toBe(503);
    expect(r.text).toMatch(/npm run build/);
  });
});

describe('archflow serve', () => {
  it('prints the address, repository and loopback notice', async () => {
    const out: string[] = [];
    const err: string[] = [];
    let server: RunningServer | undefined;
    const code = await runCli(['serve', '--repo', SAMPLE_REPO, '--port', '0', '--no-open'], {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      onServerStarted: (s) => (server = track(s)),
    });
    expect(code).toBe(0);
    expect(server).toBeDefined();
    expect(out.join('\n')).toMatch(/Archflow is running at http:\/\/127\.0\.0\.1:\d+\//);
    expect(out.join('\n')).toMatch(/Repository: .*sample \(valid\)/);
    expect(out.join('\n')).toMatch(/loopback only/);
  });

  it('reports a busy port and falls back', async () => {
    const blocker = createServer();
    const { port } = await listenWithFallback(blocker, 0, true);
    try {
      const err: string[] = [];
      const code = await runCli(['serve', '--repo', SAMPLE_REPO, '--port', String(port), '--no-open'], {
        out: () => {},
        err: (l) => err.push(l),
        onServerStarted: (s) => track(s),
      });
      expect(code).toBe(0);
      // Neighbouring ports may be taken by other processes too; all of them are reported.
      expect(err.join('\n')).toMatch(new RegExp(`Port ${port}(, \\d+)* (was|were) busy; using port \\d+ instead`));
      const strict = await runCli(['serve', '--repo', SAMPLE_REPO, '--port', String(port), '--strict-port', '--no-open'], {
        out: () => {},
        err: (l) => err.push(l),
      });
      expect(strict).toBe(3);
      expect(err.join('\n')).toMatch(/already in use/);
    } finally {
      blocker.close();
    }
  });

  it('rejects invalid ports and repositories before listening', async () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l) };
    expect(await runCli(['serve', '--port', 'abc', '--no-open'], io)).toBe(2);
    expect(await runCli(['serve', '--repo', '/definitely/missing/archflow', '--no-open'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/does not exist/);
  });
});
