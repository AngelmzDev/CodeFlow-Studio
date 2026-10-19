#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createRegistry } from '../adapters/index.ts';
import { createExecutionGrant, normalizeExecution } from './security.ts';

const HELP = `Create a one-use authorization for an exact CodeFlow MCP execution.

node src/mcp/authorize.ts FILE [--language java|python] [--entry NAME]
  [--stdin TEXT | --stdin-file FILE] [--arg TEXT ...]
  [--timeout 10000] [--max-events 250]

This command must be run interactively by the user. It does not execute the source.
`;

function parse(args: string[]) {
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  const valueFlags = new Set([
    'language',
    'entry',
    'stdin',
    'stdin-file',
    'arg',
    'timeout',
    'max-events',
  ]);
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'help') return { help: true, positional, options };
    if (!valueFlags.has(key)) throw new Error('Unknown authorization option');
    const value = args[++index];
    if (value === undefined)
      throw new Error('Missing authorization option value');
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  return { help: false, positional, options };
}

async function readRegularFile(
  path: string,
  maxBytes: number,
): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw new Error(
      `Input must be a regular file of at most ${maxBytes} bytes`,
    );
  return readFile(path, 'utf8');
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parse(args);
  if (parsed.help || !parsed.positional[0]) {
    console.log(HELP);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Execution authorization requires an interactive terminal');
  const sourcePath = resolve(parsed.positional[0]);
  if (parsed.options.get('stdin') && parsed.options.get('stdin-file'))
    throw new Error('Choose either --stdin or --stdin-file');
  const filename = basename(sourcePath);
  const registry = await createRegistry();
  const stdinFile = parsed.options.get('stdin-file')?.at(-1);
  const input = normalizeExecution({
    language:
      parsed.options.get('language')?.at(-1) ?? registry.infer(filename),
    filename,
    source: await readRegularFile(sourcePath, 100_000),
    entry: parsed.options.get('entry')?.at(-1),
    stdin: stdinFile
      ? await readRegularFile(resolve(stdinFile), 32_768)
      : parsed.options.get('stdin')?.at(-1),
    args: parsed.options.get('arg'),
    maxEvents: Number(parsed.options.get('max-events')?.at(-1) ?? 250),
    timeoutMs: Number(parsed.options.get('timeout')?.at(-1) ?? 10_000),
  });
  console.log(`\nSource: ${input.filename}`);
  console.log(`Language: ${input.language}`);
  console.log(`Limits: ${input.maxEvents} events, ${input.timeoutMs} ms`);
  console.log(
    'WARNING: the program will run with your operating-system permissions.',
  );
  console.log(
    'CodeFlow Studio is not a sandbox. Review and trust the exact source first.',
  );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await terminal.question(
    'Type AUTORIZAR to create a five-minute, one-use grant: ',
  );
  terminal.close();
  if (answer !== 'AUTORIZAR') throw new Error('Authorization cancelled');
  const grant = await createExecutionGrant(input);
  console.log(`\nGrant ID: ${grant.grantId}`);
  console.log(`Expires: ${grant.expiresAt}`);
  console.log(`Source SHA-256: ${grant.sourceDigest}`);
  console.log(
    'The grant works only for the exact source and parameters above, and is consumed once.',
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Authorization failed',
  );
  process.exitCode = 1;
});
