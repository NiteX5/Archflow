// Development mode: compiles the service, starts it on ARCHFLOW_PORT (default
// 4870) and starts the Vite dev server for the UI, which proxies /api/ to it.
// Usage: npm run dev [-- --repo <path>]
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.ARCHFLOW_PORT ?? '4870';
const node = process.execPath;
const bin = (rel) => path.join(root, 'node_modules', rel);

const tsc = spawnSync(node, [bin('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const children = [];
const stopAll = (code = 0) => {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(code);
};
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

// --strict-port: the UI proxy needs to know where the service is.
const service = spawn(
  node,
  [path.join(root, 'dist/cli/index.js'), 'serve', '--port', port, '--strict-port', '--no-open', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
children.push(service);
service.on('exit', (code) => {
  console.error(`Archflow service stopped (exit code ${code}).${code === 3 ? ` Port ${port} is busy: set ARCHFLOW_PORT to another port.` : ''}`);
  stopAll(code ?? 1);
});

const vite = spawn(node, [bin('vite/bin/vite.js'), '--open'], { cwd: root, stdio: 'inherit', env: { ...process.env, ARCHFLOW_PORT: port } });
children.push(vite);
vite.on('exit', (code) => stopAll(code ?? 0));
