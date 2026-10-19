import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findPython } from '../src/adapters/runtime.ts';

const root = resolve(import.meta.dirname, '..');
const tracer = join(root, 'adapters/python/tracer.py');
const python = await findPython();

async function run(
  sourcePath: string,
  stdin = '',
  maxEvents = 2_000,
  args: string[] = [],
) {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-'));
  const stdinFile = join(temp, 'stdin.txt');
  writeFileSync(stdinFile, stdin, 'utf8');
  try {
    const result = spawnSync(
      python,
      [tracer, sourcePath, stdinFile, String(maxEvents), ...args],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(
      result.status,
      0,
      result.stderr || 'tracer exited unsuccessfully',
    );
    const lines = result.stdout.trimEnd().split(/\r?\n/).filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('traces the three runnable examples with expected captured stdout', async () => {
  const cases = [
    ['sum.py', '', '20\n'],
    ['recursion.py', '', '120\n'],
    ['scanner_input.py', '4\n3\n5\n8\n13\n', '29\n'],
  ] as const;
  for (const [file, stdin, stdout] of cases) {
    const events = await run(join(root, 'examples/python', file), stdin);
    const terminal = events.at(-1);
    assert.equal(terminal?.type, 'terminated', file);
    assert.equal(terminal?.detail?.status, 'completed', file);
    assert.equal(terminal?.output?.stdout, stdout, file);
    assert.ok(
      events.some((event) => event.type === 'line'),
      file,
    );
    assert.ok(
      events.every((event) => event.provenance === 'observed'),
      file,
    );
  }
});

test('captures an uncaught exception and reports it on termination', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'bad.py');
  writeFileSync(source, "value = 1\nraise ValueError('broken')\n", 'utf8');
  try {
    const events = await run(source);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'exception' && event.detail?.type === 'ValueError',
      ),
    );
    const terminal = events.at(-1);
    assert.equal(terminal?.type, 'terminated');
    assert.equal(terminal?.detail?.status, 'exception');
    assert.equal(terminal?.detail?.type, 'ValueError');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('stops at the event budget and emits a limit marker', async () => {
  const events = await run(join(root, 'examples/python/sum.py'), '', 3);
  assert.ok(events.some((event) => event.type === 'limit'));
  assert.equal(events.at(-1)?.type, 'terminated');
  assert.equal(events.at(-1)?.detail?.status, 'limited');
});

test('snapshots user fields safely without invoking repr or properties', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'safe.py');
  writeFileSync(
    source,
    [
      'class Tricky:',
      '    def __repr__(self):',
      "        raise RuntimeError('repr called')",
      '    @property',
      '    def dangerous(self):',
      "        raise RuntimeError('property called')",
      '    def __init__(self):',
      '        self.number = 7',
      'value = Tricky()',
      'alias = value',
      'items = [value]',
      "print('safe')",
    ].join('\n'),
    'utf8',
  );
  try {
    const events = await run(source);
    assert.equal(events.at(-1)?.detail?.status, 'completed');
    const snapshots = events.flatMap((event) =>
      Object.values(event.heap ?? {}),
    );
    assert.ok(
      snapshots.some((object: any) => object.fields?.number?.value === 7),
    );
    const aliasState = events.find(
      (event) =>
        event.frames?.[0]?.locals?.alias && event.frames?.[0]?.locals?.value,
    );
    assert.equal(
      aliasState?.frames?.[0]?.locals?.alias?.ref,
      aliasState?.frames?.[0]?.locals?.value?.ref,
    );
    assert.equal(events.at(-1)?.output?.stdout, 'safe\n');
    assert.ok(events.at(-1)?.output?.stderr === '');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test('fails closed when the target starts a Python thread', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'threads.py');
  writeFileSync(
    source,
    [
      'import threading',
      'def worker():',
      "    print('worker ran')",
      'thread = threading.Thread(target=worker)',
      'thread.start()',
      'thread.join()',
      "print('main continued')",
    ].join('\n'),
    'utf8',
  );
  try {
    const events = await run(source);
    const limit = events.find((event) => event.type === 'limit');
    assert.equal(limit?.detail?.reason, 'unsupportedThreads');
    assert.equal(events.at(-1)?.detail?.status, 'limited');
    assert.equal(events.at(-1)?.output?.stdout, '');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("preserves Python integers outside JavaScript's safe range exactly", async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'large-int.py');
  writeFileSync(source, 'value = 9007199254740993\n', 'utf8');
  try {
    const events = await run(source);
    const value = events
      .flatMap((event) => event.frames ?? [])
      .map((frame: any) => frame.locals?.value)
      .find((entry: any) => entry !== undefined);
    assert.deepEqual(value, {
      kind: 'primitive',
      type: 'int',
      value: '9007199254740993',
    });
    assert.equal(events.at(-1)?.detail?.status, 'completed');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('keeps dictionary fields distinct when string and integer keys resemble each other', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'keys.py');
  writeFileSync(
    source,
    "value = {'int:1': 'text key', 1: 'integer key'}\n",
    'utf8',
  );
  try {
    const events = await run(source);
    const dictionary = events
      .flatMap((event) => Object.values(event.heap ?? {}))
      .find(
        (entry: any) =>
          entry.kind === 'object' &&
          entry.fields?.['0: int:1'] &&
          entry.fields?.['1: int:1'],
      );
    assert.ok(dictionary);
    assert.equal((dictionary as any).fields['0: int:1'].value, 'text key');
    assert.equal((dictionary as any).fields['1: int:1'].value, 'integer key');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('caps captured output on a UTF-8 boundary and reports output limiting', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'output.py');
  writeFileSync(source, "print('€' * 10000)\n", 'utf8');
  try {
    const events = await run(source);
    const limit = events.find((event) => event.type === 'limit');
    const terminal = events.at(-1);
    assert.equal(limit?.detail?.reason, 'outputLimit');
    assert.equal(terminal?.detail?.status, 'limited');
    assert.equal(terminal?.detail?.reason, 'outputLimit');
    const captured = terminal?.output?.stdout ?? '';
    assert.ok(Buffer.byteLength(captured, 'utf8') <= 16_384);
    assert.ok(captured.endsWith('€'));
    assert.equal(captured.includes('\uFFFD'), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('caps each snapshot heap at the configured object budget', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-source-'));
  const source = join(temp, 'heap.py');
  writeFileSync(source, 'values = [list((n,)) for n in range(150)]\n', 'utf8');
  try {
    const events = await run(source);
    assert.ok(
      events.every((event) => Object.keys(event.heap ?? {}).length <= 128),
    );
    assert.equal(events.at(-1)?.detail?.status, 'completed');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('rejects generators and async code before target top-level side effects run', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-preflight-'));
  const stdinFile = join(temp, 'stdin.txt');
  writeFileSync(stdinFile, '', 'utf8');
  const cases = [
    ['generator.py', 'def generated():\n    yield 1\n', 'Yield'],
    [
      'coroutine.py',
      'async def work():\n    await something()\n',
      'AsyncFunctionDef',
    ],
  ] as const;
  try {
    for (const [filename, unsupported, construct] of cases) {
      const marker = join(temp, `${filename}.marker`);
      const source = join(temp, filename);
      writeFileSync(
        source,
        [
          'from pathlib import Path',
          `Path(${JSON.stringify(marker)}).write_text('executed', encoding='utf8')`,
          unsupported,
        ].join('\n'),
        'utf8',
      );
      const result = spawnSync(python, [tracer, source, stdinFile, '100'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 3);
      assert.ok(
        result.stderr.includes(`Unsupported Python construct ${construct}`),
        result.stderr,
      );
      assert.equal(result.stdout, '');
      assert.equal(
        existsSync(marker),
        false,
        `${filename} top-level code did not execute`,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test('nested calls normalize active frame first while preserving frame identities on return', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'codeflow-python-stack-'));
  const source = join(temp, 'nested.py');
  writeFileSync(
    source,
    'def inner():\n    return 7\ndef outer():\n    return inner()\nresult = outer()\n',
    'utf8',
  );
  try {
    const events = await run(source);
    const innerCall = events.find(
      (event) => event.type === 'call' && event.frames?.[0]?.name === 'inner',
    );
    assert.ok(innerCall, 'inner call must expose the active function first');
    assert.deepEqual(
      innerCall.frames.map((frame: { name: string }) => frame.name),
      ['inner', 'outer', '<module>'],
    );
    const innerReturn = events.find(
      (event) => event.type === 'return' && event.frames?.[0]?.name === 'inner',
    );
    assert.deepEqual(
      innerReturn.frames.map((frame: { id: string }) => frame.id),
      innerCall.frames.map((frame: { id: string }) => frame.id),
    );
    const outerReturn = events.find(
      (event) => event.type === 'return' && event.frames?.[0]?.name === 'outer',
    );
    assert.equal(outerReturn.frames[0].id, innerCall.frames[1].id);
    assert.equal(outerReturn.frames[1].id, innerCall.frames[2].id);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
