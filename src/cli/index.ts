#!/usr/bin/env node
import { runCli } from './main.js';

runCli(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  onServerStarted: (running) => {
    const shutdown = () => {
      void running.stop().then(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  },
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 70;
  },
);
