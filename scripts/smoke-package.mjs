// Installs the packed tarball into a temporary prefix (offline: dependencies are
// bundled) and checks that the installed command works without compiling anything.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const releaseDir = path.join(root, 'release');
const tarball = readdirSync(releaseDir).filter((f) => f.endsWith('.tgz')).sort().pop();
if (!tarball) throw new Error('No tarball in release/. Run "npm run package" first.');

const prefix = mkdtempSync(path.join(tmpdir(), 'archflow-install-'));
const work = mkdtempSync(path.join(tmpdir(), 'archflow-smoke-'));
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const bin = win ? path.join(prefix, 'archflow.cmd') : path.join(prefix, 'bin', 'archflow');
const run = (args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', shell: win, ...opts });

try {
  execFileSync(npm, ['install', '--global', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', path.join(releaseDir, tarball)], {
    stdio: 'inherit',
    shell: win,
  });
  console.log(run(['--help']).split('\n')[0]);
  cpSync(path.join(root, 'examples', 'sample'), work, { recursive: true });
  const out = run(['validate', '--repo', work]);
  if (!out.includes('Model valid')) throw new Error(`validate failed:\n${out}`);
  console.log(out.trim().split('\n').pop());
  const skill = run(['skill', 'install', '--repo', work]);
  if (!skill.includes('SKILL.md')) throw new Error(`skill install failed:\n${skill}`);
  console.log(skill.trim());

  // The installed service must start, report its address and serve the built UI.
  const child = spawn(bin, ['serve', '--repo', work, '--port', '0', '--no-open'], { shell: win });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('serve did not start in time')), 15000);
    child.stdout.on('data', (d) => {
      const m = /running at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(d));
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on('exit', (code) => reject(new Error(`serve exited with ${code}`)));
  });
  const html = await (await fetch(url)).text();
  if (!html.includes('<div id="root">')) throw new Error('UI was not served');
  const state = await (await fetch(`${url}api/state`)).json();
  if (state.status !== 'valid') throw new Error(`unexpected state ${state.status}`);
  console.log(`serve OK at ${url}`);
  child.kill();
  console.log('Package smoke test passed.');
} finally {
  rmSync(prefix, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}
