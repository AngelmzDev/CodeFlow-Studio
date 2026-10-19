#!/usr/bin/env node
import { readFile, writeFile, access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRegistry } from './adapters/index.ts';
import { ROOT } from './adapters/runtime.ts';
import { exportTrace, type ExportFormat } from './exports/export.ts';
import { startServer } from './server/server.ts';
const HELP = `CodeFlow Studio — real execution, replayable evidence

node src/cli.ts doctor
node src/cli.ts serve [--port 4310] [--adapter ./trusted-adapter.ts]
node src/cli.ts trace FILE --allow-local-execution [--language ID]
  [--entry Main] [--stdin TEXT | --stdin-file PATH] [--arg TEXT ...]
  [--out trace.json] [--timeout 10000] [--max-events 2000]
node src/cli.ts export TRACE --format html|svg|json --out PATH [--index N]

Only run code you trust. Local execution uses your OS permissions and is NOT sandboxed.
Plugins passed with --adapter are executable trusted local modules.
`;
function parse(args: string[]) {
  const positional: string[] = [],
    options = new Map<string, string[]>();
  const flags = new Set<string>();
  const valueFlags = new Set([
    'language',
    'entry',
    'stdin',
    'stdin-file',
    'arg',
    'out',
    'timeout',
    'max-events',
    'format',
    'port',
    'index',
    'adapter',
  ]);
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'allow-local-execution' || key === 'help') {
      flags.add(key);
      continue;
    }
    if (!valueFlags.has(key)) throw new Error('Unknown option: ' + token);
    const value = args[++i];
    if (value === undefined) throw new Error('Missing value for ' + token);
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  return {
    positional,
    options,
    flags,
    get: (name: string) => options.get(name)?.at(-1),
  };
}
async function ensureBuild() {
  try {
    await access(resolve(ROOT, '.build/app.js'));
  } catch {
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.status !== 0)
      throw new Error('Build failed. Run npm install and npm run build.');
  }
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parse(args);
  const command = parsed.positional[0];
  if (!command || parsed.flags.has('help')) {
    console.log(HELP);
    return;
  }
  if (command === 'export') {
    const input = parsed.positional[1];
    if (!input || !parsed.get('out'))
      throw new Error('Export requires TRACE, --format and --out');
    const format = parsed.get('format') as ExportFormat;
    if (format === 'html') await ensureBuild();
    const trace = JSON.parse(await readFile(resolve(input), 'utf8'));
    await writeFile(
      resolve(parsed.get('out')!),
      await exportTrace(trace, format, Number(parsed.get('index') ?? 0)),
      'utf8',
    );
    console.log('Exported ' + format + ' to ' + resolve(parsed.get('out')!));
    return;
  }
  const registry = await createRegistry(parsed.options.get('adapter') ?? []);
  if (command === 'doctor') {
    console.log(
      JSON.stringify(
        { node: process.version, adapters: await registry.detect() },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'serve') {
    await ensureBuild();
    const port = Number(parsed.get('port') ?? 4310);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Port must be 1–65535');
    const { url } = await startServer({ port, registry });
    console.log(
      'CodeFlow Studio: ' +
        url +
        '\nTrusted local execution only. Stop with Ctrl+C.',
    );
    return;
  }
  if (command === 'trace') {
    const input = parsed.positional[1];
    if (!input) throw new Error('Trace requires a source file');
    const filename = basename(input),
      source = await readFile(resolve(input), 'utf8');
    if (parsed.get('stdin') !== undefined && parsed.get('stdin-file'))
      throw new Error('Choose either --stdin or --stdin-file');
    const stdin = parsed.get('stdin-file')
      ? await readFile(resolve(parsed.get('stdin-file')!), 'utf8')
      : parsed.get('stdin');
    const trace = await registry.run({
      language: parsed.get('language') ?? registry.infer(filename),
      filename,
      source,
      entry: parsed.get('entry'),
      stdin,
      args: parsed.options.get('arg'),
      allowLocalExecution: parsed.flags.has('allow-local-execution'),
      maxEvents: Number(parsed.get('max-events') ?? 2000),
      timeoutMs: Number(parsed.get('timeout') ?? 10000),
    });
    const text = JSON.stringify(trace, null, 2) + '\n';
    if (parsed.get('out')) {
      await writeFile(resolve(parsed.get('out')!), text, 'utf8');
      console.log(
        trace.status +
          ': ' +
          trace.events.length +
          ' real events -> ' +
          resolve(parsed.get('out')!),
      );
    } else process.stdout.write(text);
    return;
  }
  throw new Error('Unknown command: ' + command);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
