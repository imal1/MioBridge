#!/usr/bin/env node
import { CLI_VERSION, runCli } from './command.js';
import { createNodeCore } from './composition.js';

const output = {
  stdout(message: string) { process.stdout.write(`${message}\n`); },
  stderr(message: string) { process.stderr.write(`${message}\n`); },
};

const exitCode = await runCli(process.argv.slice(2), {
  createCore: () => createNodeCore({ metadata: { version: CLI_VERSION } }).core,
  output,
  version: CLI_VERSION,
});
process.exitCode = exitCode;
