import path from 'node:path';
import { parseArgs } from 'node:util';
import { initModel, InitError } from '../node/init.js';
import { installSkill } from '../node/skill.js';
import { formatIssue, hasErrors } from '../core/index.js';
import { loadModel, RepoAccessError, resolveRepoRoot } from '../node/repo.js';
import { DEFAULT_PORT, FALLBACK_RANGE, PortInUseError } from '../server/listen.js';
import { openBrowser, startServer, type RunningServer } from '../server/serve.js';
import { serverExtensions } from '../server/extensions.js';

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Called with the running server so tests (or the entry point) can stop it. */
  onServerStarted?: (server: RunningServer) => void;
}

const USAGE = `Usage:
  archflow serve [--repo <path>] [--port <n>] [--strict-port] [--no-open]
      Start the local web UI (http://127.0.0.1 only). Without --repo, choose the repository in the UI.
  archflow validate --repo <path> [--json]
      Validate the model in <path>/.archflow.
  archflow init --repo <path> [--name <project name>]
      Create an empty model (manifest only). Never overwrites an existing model.
  archflow skill install --repo <path> [--force]
      Install the Claude Code skill into <path>/.claude/skills/archflow.

Options:
  --repo <path>    Repository to open. Archflow only accesses this directory.
  --port <n>       Port to listen on (default ${DEFAULT_PORT}; 0 = any free port). If busy, the next
                   ${FALLBACK_RANGE} ports are tried, then any free port, unless --strict-port is given.
  --strict-port    Fail instead of falling back to another port.
  --no-open        Do not open the browser.
  --json           Print the validation result as JSON.
  --name <name>    Project name for init (default: the directory name).
  --force          Overwrite locally modified skill files.
  -h, --help       Show this help.`;

/** Runs the CLI and returns the process exit code (`serve` resolves once listening). */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        repo: { type: 'string' },
        name: { type: 'string' },
        force: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        port: { type: 'string' },
        'strict-port': { type: 'boolean', default: false },
        open: { type: 'boolean', default: true },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    io.err(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values.help || command === undefined) {
    (values.help ? io.out : io.err)(USAGE);
    return values.help ? 0 : 2;
  }

  try {
    switch (command) {
      case 'validate':
        return await validate(values, io);
      case 'serve':
        return await serve(values, io);
      case 'init':
        return await init(values, io);
      case 'skill':
        if (positionals[1] !== 'install') {
          io.err(`Unknown skill command "${positionals[1] ?? ''}"\n\n${USAGE}`);
          return 2;
        }
        return await skillInstall(values, io);
      default:
        io.err(`Unknown command "${command}"\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    if (err instanceof RepoAccessError) {
      io.err(`Cannot open repository: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

type Values = { repo?: string; name?: string; force?: boolean; json?: boolean; port?: string; 'strict-port'?: boolean; open?: boolean };

async function validate(values: Values, io: CliIo): Promise<number> {
  if (!values.repo) {
    io.err(`"validate" requires --repo <path>\n\n${USAGE}`);
    return 2;
  }
  const root = await resolveRepoRoot(values.repo);
  const result = await loadModel(root);
  const ok = !hasErrors(result.issues);

  if (values.json) {
    io.out(JSON.stringify({ repository: root, valid: ok, issues: result.issues }, null, 2));
    return ok ? 0 : 1;
  }

  io.out(`Repository: ${root}`);
  for (const issue of result.issues) io.out(formatIssue(issue));
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warnings = result.issues.length - errors;
  if (ok && result.model) {
    const m = result.model;
    io.out(
      `Model valid: ${m.elements.length} elements, ${m.relations.length} relations, ${m.flows.length} flows, ` +
        `${m.decisions.length} decisions, ${m.views.length} views (${warnings} warnings)`,
    );
    return 0;
  }
  io.out(`Model invalid: ${errors} errors, ${warnings} warnings. Nothing was modified.`);
  return 1;
}

async function init(values: Values, io: CliIo): Promise<number> {
  if (!values.repo) {
    io.err(`"init" requires --repo <path>\n\n${USAGE}`);
    return 2;
  }
  const root = await resolveRepoRoot(values.repo);
  try {
    const file = await initModel(root, values.name ?? path.basename(root));
    io.out(`Created ${file}`);
    io.out('Declare elements in the UI (archflow serve) or let Claude Code do it with the Archflow skill.');
    return 0;
  } catch (err) {
    if (err instanceof InitError) {
      io.err(err.message);
      return 1;
    }
    throw err;
  }
}

async function skillInstall(values: Values, io: CliIo): Promise<number> {
  if (!values.repo) {
    io.err(`"skill install" requires --repo <path>\n\n${USAGE}`);
    return 2;
  }
  const root = await resolveRepoRoot(values.repo);
  const result = await installSkill(root, values.force ?? false);
  for (const f of result.written) io.out(`Wrote ${f}`);
  for (const f of result.unchanged) io.out(`Up to date: ${f}`);
  for (const f of result.skipped) io.err(`Skipped ${f}: it has local changes. Use --force to overwrite it.`);
  return result.skipped.length > 0 ? 1 : 0;
}

async function serve(values: Values, io: CliIo): Promise<number> {
  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      io.err(`--port must be an integer between 0 and 65535 (0 = any free port), got "${values.port}"`);
      return 2;
    }
  }
  let running: RunningServer;
  try {
    running = await startServer({
      repo: values.repo,
      port,
      strictPort: values['strict-port'] ?? false,
      log: io.err,
      extensions: serverExtensions,
    });
  } catch (err) {
    if (err instanceof PortInUseError) {
      io.err(`${err.message}. Choose another one with --port <n>, or omit --strict-port to fall back automatically.`);
      return 3;
    }
    throw err;
  }
  if (running.busy.length > 0) {
    io.err(`Port ${running.busy.join(', ')} ${running.busy.length > 1 ? 'were' : 'was'} busy; using port ${running.port} instead.`);
  }
  const state = running.workspace.state();
  io.out(`Archflow is running at ${running.url}`);
  io.out(state.repo ? `Repository: ${state.repo} (${state.status})` : 'No repository selected: choose one in the browser.');
  io.out('Listening on loopback only. Press Ctrl+C to stop.');
  if (!running.workspace.snapshot && state.issues.length > 0) {
    for (const issue of state.issues) io.err(formatIssue(issue));
  }
  if (values.open !== false && !(await openBrowser(running.url))) {
    io.err('Could not open a browser automatically; open the address above manually.');
  }
  io.onServerStarted?.(running);
  return 0;
}
