import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRegistry,
  AdapterRegistry,
  loadExample,
} from '../src/adapters/index.ts';
import type {
  LanguageAdapter,
  TraceEvent,
  TraceRequest,
  RunContext,
  AdapterInfo,
} from '../src/core/types.ts';

const registry = await createRegistry();

async function trace(
  language: string,
  filename: string,
  source: string,
  options: Partial<TraceRequest> = {},
) {
  return registry.run({
    language,
    filename,
    source,
    allowLocalExecution: true,
    ...options,
  } as TraceRequest);
}

function output(value: Awaited<ReturnType<typeof registry.run>>) {
  return value.events.at(-1)?.output.stdout.replace(/\r\n/g, '\n');
}

test('detects real Java and Python runtimes and infers their source extensions', async () => {
  const results = await registry.detect();
  assert.deepEqual(results.map((item) => item.language).sort(), [
    'java',
    'python',
  ]);
  for (const result of results) {
    assert.equal(result.available, true, result.reason);
    assert.ok(result.capabilities.stepping);
    assert.equal(result.capabilities.conditionValues, false);
    assert.equal(result.capabilities.loopEvents, false);
  }
  assert.equal(registry.infer('Example.JAVA'), 'java');
  assert.equal(registry.infer('example.PY'), 'python');
});

test('Java trace accepts preview API imports with the installed JDK', async () => {
  const source = `import java.lang.foreign.ValueLayout;
public class PreviewImport {
  public static void main(String[] args) {
    System.out.println("listo");
  }
}`;
  const result = await trace('java', 'PreviewImport.java', source);
  assert.equal(output(result), 'listo\n');
});

test('traces equivalent Java and Python array sums with observed events', async () => {
  const java = await trace(
    'java',
    'Main.java',
    await loadExample('java', 'Main.java'),
    { entry: 'Main' },
  );
  const python = await trace(
    'python',
    'sum.py',
    await loadExample('python', 'sum.py'),
  );
  assert.equal(output(java), '17\n');
  assert.equal(output(python), '20\n');
  for (const value of [java, python]) {
    assert.equal(value.status, 'completed');
    assert.ok(value.events.some((event) => event.type === 'line'));
    assert.ok(value.events.every((event) => event.provenance === 'observed'));
  }
});

test('line events snapshot locals before the highlighted line executes', async () => {
  const python = await trace(
    'python',
    'before.py',
    'value = 1\nvalue = value + 1\nprint(value)\n',
  );
  const secondLine = python.events.find(
    (event) => event.type === 'line' && event.location?.line === 2,
  );
  const pythonValue = secondLine?.frames[0]?.locals.value;
  assert.equal(
    pythonValue?.kind === 'primitive' ? pythonValue.value : undefined,
    1,
  );

  const java = await trace(
    'java',
    'Before.java',
    [
      'public class Before {',
      '  public static void main(String[] args) {',
      '    int value = 1;',
      '    value = value + 1;',
      '    System.out.println(value);',
      '  }',
      '}',
    ].join('\n'),
    { entry: 'Before' },
  );
  const javaUpdate = java.events.find(
    (event) => event.type === 'line' && event.location?.line === 4,
  );
  const javaValue = javaUpdate?.frames[0]?.locals.value;
  assert.equal(
    javaValue?.kind === 'primitive' ? javaValue.value : undefined,
    1,
  );
});

test('supports Java recursion and Scanner standard input', async () => {
  const recursion = await trace(
    'java',
    'Recursion.java',
    await loadExample('java', 'Recursion.java'),
    { entry: 'Recursion' },
  );
  const input = await trace(
    'java',
    'Input.java',
    await loadExample('java', 'Input.java'),
    { entry: 'Input', stdin: '5\n' },
  );
  assert.equal(output(recursion), '120\n');
  assert.equal(output(input), '15\n');
  assert.ok(
    recursion.events.some(
      (event) =>
        event.type === 'call' &&
        event.frames.some((frame) => frame.name.endsWith('.factorial')),
    ),
  );
});

test('captures Java object state and caught and uncaught exceptions', async () => {
  const caught = await trace(
    'java',
    'Objects.java',
    await loadExample('java', 'Objects.java'),
    { entry: 'Objects' },
  );
  assert.equal(caught.status, 'completed');
  assert.equal(output(caught), 'caught: ArrayIndexOutOfBoundsException\n');
  assert.ok(caught.events.some((event) => event.type === 'exception'));
  assert.ok(
    Object.values(
      caught.events.flatMap((event) => Object.values(event.heap)),
    ).some((object) => {
      const value = Object.entries(object.fields ?? {}).find(([name]) =>
        name.endsWith('.value'),
      )?.[1];
      return value?.kind === 'primitive' && value.value === 5;
    }),
  );

  const uncaught = await trace(
    'java',
    'Crash.java',
    [
      'public class Crash {',
      '  public static void main(String[] args) { throw new IllegalStateException("broken"); }',
      '}',
    ].join('\n'),
    { entry: 'Crash' },
  );
  assert.equal(uncaught.status, 'exception');
  assert.ok(uncaught.events.some((event) => event.type === 'exception'));
});

test('reports abnormal Java VM exit as an exception instead of losing the trace', async () => {
  const result = await trace(
    'java',
    'Exit.java',
    [
      'public class Exit {',
      '  public static void main(String[] args) { System.exit(0); }',
      '}',
    ].join('\n'),
    { entry: 'Exit' },
  );
  assert.equal(result.status, 'exception');
  assert.equal(result.events.at(-1)?.type, 'terminated');
  assert.match(
    String(result.events.at(-1)?.detail?.reason),
    /without normal completion/,
  );
});

test('keeps explicit output-limit markers for Java and Python', async () => {
  const java = await trace(
    'java',
    'Output.java',
    [
      'public class Output {',
      '  public static void main(String[] args) { System.out.print("x".repeat(40000)); }',
      '}',
    ].join('\n'),
    { entry: 'Output' },
  );
  const python = await trace('python', 'output.py', "print('x' * 40000)\n");
  for (const result of [java, python]) {
    assert.equal(result.status, 'limited', result.language);
    assert.ok(
      result.events.some((event) => event.type === 'limit'),
      result.language,
    );
    assert.equal(
      result.events.at(-1)?.detail?.status,
      'limited',
      result.language,
    );
  }
});

test('reports Java compilation failures with source context', async () => {
  await assert.rejects(
    trace(
      'java',
      'Broken.java',
      'public class Broken { public static void main(String[] args) { int x = ; } }',
    ),
    /Java compilation failed/,
  );
});

test('produces deterministic event snapshots on repeated traces', async () => {
  const source = 'items = [1, 2, 3]\ntotal = sum(items)\nprint(total)\n';
  const first = await trace('python', 'repeat.py', source);
  const second = await trace('python', 'repeat.py', source);
  assert.deepEqual(first.events, second.events);

  const javaSource = await loadExample('java', 'Main.java');
  const javaFirst = await trace('java', 'Main.java', javaSource, {
    entry: 'Main',
  });
  const javaSecond = await trace('java', 'Main.java', javaSource, {
    entry: 'Main',
  });
  assert.deepEqual(javaFirst.events, javaSecond.events);
});

test('enforces event budgets in both adapters', async () => {
  const python = await trace(
    'python',
    'many.py',
    'for index in range(100):\n    value = index\n',
    { maxEvents: 5 },
  );
  const java = await trace(
    'java',
    'Many.java',
    [
      'public class Many {',
      '  public static void main(String[] args) {',
      '    for (int i = 0; i < 100; i++) {',
      '      int value = i;',
      '      System.out.println(value);',
      '    }',
      '  }',
      '}',
    ].join('\n'),
    { entry: 'Many', maxEvents: 5 },
  );
  for (const value of [python, java]) {
    assert.equal(
      value.status,
      'limited',
      value.language + ' yielded ' + value.events.length + ' events',
    );
    assert.ok(
      value.events.some((event) => event.type === 'limit'),
      value.language,
    );
  }
});

test('bounds a Python sleep loop by wall clock', async () => {
  const start = Date.now();
  const value = await trace(
    'python',
    'slow.py',
    'import time\nwhile True:\n    time.sleep(0.05)\n',
    { timeoutMs: 500 },
  );
  assert.equal(value.status, 'limited');
  assert.ok(
    Date.now() - start < 5000,
    'trace should terminate promptly after the requested time limit',
  );
});

test('rejects missing consent and filename traversal before executing source', async () => {
  const marker = join(tmpdir(), 'codeflow-marker-' + process.pid + '.txt');
  const source =
    'open(' + JSON.stringify(marker) + ', "w").write("ran")\nprint("marker")\n';
  await assert.rejects(
    registry.run({
      language: 'python',
      filename: 'blocked.py',
      source,
      allowLocalExecution: false,
    } as TraceRequest),
    /explicit allowLocalExecution consent/,
  );
  await assert.rejects(
    trace('python', '../blocked.py', source),
    /plain source filename/,
  );
  await assert.rejects(access(marker));
});

test('rejects unknown languages and mismatched extensions', async () => {
  await assert.rejects(
    trace('ruby', 'program.rb', 'puts 1'),
    /No working adapter registered/,
  );
  await assert.rejects(
    trace('python', 'program.java', 'print(1)'),
    /Filename extension does not match/,
  );
});

test('allows a contract-shaped test adapter without changing core trace behavior', async () => {
  const testRegistry = new AdapterRegistry();
  const adapter: LanguageAdapter = {
    id: 'fixture',
    language: 'fixture',
    label: 'Fixture',
    extensions: ['.fixture'],
    capabilities: {
      stepping: true,
      variables: true,
      callStack: true,
      objects: false,
      arrays: false,
      memory: false,
      stdin: false,
      stdout: false,
      exceptions: false,
      conditionValues: false,
      loopEvents: false,
      reverseExecution: false,
      limitations: [],
    },
    async detect(): Promise<AdapterInfo> {
      return {
        id: 'fixture',
        language: 'fixture',
        label: 'Fixture',
        extensions: ['.fixture'],
        available: true,
        capabilities: this.capabilities,
      };
    },
    async trace(
      _request: TraceRequest,
      _context: RunContext,
    ): Promise<TraceEvent[]> {
      return [
        {
          id: 'e0',
          sequence: 0,
          type: 'line',
          provenance: 'observed',
          location: { sourceId: 'main', line: 1 },
          frames: [],
          heap: {},
          output: { stdout: '', stderr: '' },
        },
        {
          id: 'e1',
          sequence: 1,
          type: 'terminated',
          provenance: 'observed',
          frames: [],
          heap: {},
          output: { stdout: '', stderr: '' },
          detail: { status: 'completed' },
        },
      ];
    },
  };
  testRegistry.register(adapter);
  const result = await testRegistry.run({
    language: 'fixture',
    filename: 'x.fixture',
    source: 'x',
    allowLocalExecution: true,
  });
  assert.equal(result.schemaVersion, '1.0');
  assert.equal(result.language, 'fixture');
  assert.equal(result.events[0]?.id, 'e0');
});
