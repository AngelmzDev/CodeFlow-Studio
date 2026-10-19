import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

export const EXECUTION_MODE = 'authorized';
export const GRANT_TTL_MS = 5 * 60 * 1000;

export interface AuthorizedExecution {
  language: string;
  filename: string;
  source: string;
  entry?: string;
  stdin?: string;
  args?: string[];
  maxEvents: number;
  timeoutMs: number;
}

type GrantRecord = {
  version: 1;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
};

type GrantOptions = { directory?: string; now?: number };

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) =>
    process.platform === 'win32'
      ? resolve(value).toLowerCase()
      : resolve(value);
  return normalize(a) === normalize(b);
}

function defaultGrantDirectory(): string {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA;
    return join(
      base || join(homedir(), 'AppData', 'Local'),
      'CodeFlowStudio',
      'mcp-grants',
    );
  }
  const runtime = process.env.XDG_RUNTIME_DIR;
  const identity =
    typeof process.getuid === 'function' ? process.getuid() : 'user';
  return runtime
    ? join(runtime, 'codeflow-studio', 'mcp-grants')
    : join(tmpdir(), `codeflow-studio-${identity}`, 'mcp-grants');
}

async function secureGrantDirectory(requested?: string): Promise<string> {
  const directory = resolve(requested ?? defaultGrantDirectory());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Execution authorization storage is unsafe');
  const canonical = await realpath(directory);
  if (!samePath(directory, canonical))
    throw new Error(
      'Execution authorization storage cannot use symbolic links',
    );
  await chmod(directory, 0o700).catch(() => undefined);
  return canonical;
}

function grantPath(directory: string, grantId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(grantId))
    throw new Error('Invalid execution grant');
  const candidate = resolve(directory, `${grantId}.json`);
  const prefix = directory.endsWith(sep) ? directory : directory + sep;
  const comparable =
    process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const comparablePrefix =
    process.platform === 'win32' ? prefix.toLowerCase() : prefix;
  if (!comparable.startsWith(comparablePrefix))
    throw new Error('Invalid execution grant');
  return candidate;
}

export function normalizeExecution(
  input: AuthorizedExecution,
): AuthorizedExecution {
  const language = input.language;
  const filename = basename(input.filename);
  const args = input.args ?? [];
  if (!['java', 'python'].includes(language))
    throw new Error('Unsupported language');
  if (
    typeof input.source !== 'string' ||
    !input.source.trim() ||
    input.source.length > 100_000 ||
    input.source.split('\n').length > 10_000
  )
    throw new Error('Source exceeds the supported limits');
  if (
    filename !== input.filename ||
    !/^[-\w.]{1,100}$/.test(filename) ||
    filename.startsWith('.')
  )
    throw new Error('Filename must not contain a path');
  if (
    (language === 'java' && !filename.endsWith('.java')) ||
    (language === 'python' && !filename.endsWith('.py'))
  )
    throw new Error('Filename extension does not match language');
  if (
    input.entry !== undefined &&
    (input.entry.length > 256 || input.entry.includes('\0'))
  )
    throw new Error('Entry point is invalid');
  if (input.stdin !== undefined && input.stdin.length > 32_768)
    throw new Error('Standard input exceeds the supported limit');
  if (
    args.length > 50 ||
    args.some(
      (value) =>
        typeof value !== 'string' ||
        value.length > 4096 ||
        value.includes('\0'),
    )
  )
    throw new Error('Arguments exceed the supported limits');
  if (
    !Number.isInteger(input.maxEvents) ||
    input.maxEvents < 2 ||
    input.maxEvents > 2_000
  )
    throw new Error('Event limit must be between 2 and 2,000');
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 250 ||
    input.timeoutMs > 30_000
  )
    throw new Error('Timeout must be between 250 and 30,000 ms');
  return {
    language,
    filename,
    source: input.source,
    ...(input.entry === undefined ? {} : { entry: input.entry }),
    ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
    ...(args.length ? { args: [...args] } : {}),
    maxEvents: input.maxEvents,
    timeoutMs: input.timeoutMs,
  };
}

export function executionFingerprint(input: AuthorizedExecution): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeExecution(input)))
    .digest('hex');
}

export async function createExecutionGrant(
  input: AuthorizedExecution,
  options: GrantOptions = {},
): Promise<{ grantId: string; expiresAt: string; sourceDigest: string }> {
  const directory = await secureGrantDirectory(options.directory);
  const now = options.now ?? Date.now();
  const grantId = randomUUID();
  const record: GrantRecord = {
    version: 1,
    fingerprint: executionFingerprint(input),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
  };
  const path = grantPath(directory, grantId);
  await writeFile(path, JSON.stringify(record), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(path, 0o600).catch(() => undefined);
  return {
    grantId,
    expiresAt: record.expiresAt,
    sourceDigest: createHash('sha256').update(input.source).digest('hex'),
  };
}

export async function consumeExecutionGrant(
  grantId: string,
  input: AuthorizedExecution,
  options: GrantOptions = {},
): Promise<void> {
  if (process.env.CODEFLOW_MCP_EXECUTION !== EXECUTION_MODE)
    throw new Error('MCP execution is disabled');
  const directory = await secureGrantDirectory(options.directory);
  const original = grantPath(directory, grantId);
  const lockPath = resolve(directory, `${grantId}.lock`);
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch {
    throw new Error('Execution grant is unavailable');
  }
  try {
    const info = await lstat(original).catch(() => undefined);
    if (!info?.isFile() || info.isSymbolicLink())
      throw new Error('Execution grant is unavailable');
    const canonical = await realpath(original);
    if (!samePath(original, canonical))
      throw new Error('Execution grant is invalid');
    if (info.size < 20 || info.size > 2048)
      throw new Error('Execution grant is invalid');
    const record = JSON.parse(
      await readFile(original, 'utf8'),
    ) as Partial<GrantRecord>;
    const now = options.now ?? Date.now();
    if (
      record.version !== 1 ||
      typeof record.expiresAt !== 'string' ||
      Date.parse(record.expiresAt) < now ||
      record.fingerprint !== executionFingerprint(input)
    )
      throw new Error('Execution grant does not match this exact request');
  } finally {
    await rm(original, { force: true });
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true });
  }
}
