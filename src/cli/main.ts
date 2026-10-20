import { parseArgs } from 'node:util';
import { formatIssue, hasErrors } from '../core/index.js';
import { loadModel, RepoAccessError, resolveRepoRoot } from '../node/repo.js';

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `Usage:
  archflow validate --repo <path> [--json]   Validate the model in <path>/.archflow

Options:
  --repo <path>   Repository to open (required for validate)
  --json          Print the validation result as JSON
  -h, --help      Show this help`;

/** Runs the CLI and returns the process exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: 'string' },
        json: { type: 'boolean', default: false },
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
  if (command !== 'validate') {
    io.err(`Unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }
  if (!values.repo) {
    io.err(`"validate" requires --repo <path>\n\n${USAGE}`);
    return 2;
  }

  let root: string;
  try {
    root = await resolveRepoRoot(values.repo);
  } catch (err) {
    if (err instanceof RepoAccessError) {
      io.err(`Cannot open repository: ${err.message}`);
      return 2;
    }
    throw err;
  }

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
