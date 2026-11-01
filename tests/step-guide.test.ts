import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStep } from '../web/step-guide.js';
import type { Trace } from '../src/core/types.ts';

function fixture(): Trace {
  const capabilities = {
    stepping: true,
    variables: true,
    callStack: true,
    objects: false,
    arrays: false,
    memory: false,
    stdin: false,
    stdout: true,
    exceptions: true,
    conditionValues: false,
    loopEvents: false,
    reverseExecution: false,
    limitations: [],
  };
  return {
    schemaVersion: '1.0',
    language: 'python',
    adapter: { id: 'fixture', version: '1', capabilities },
    sources: [
      { id: 'main', name: 'main.py', content: 'x = 1\nif x > 0:\nprint(x)' },
      { id: 'other', name: 'other.py', content: 'y = 7' },
    ],
    events: [
      {
        id: 'e0',
        sequence: 0,
        type: 'line',
        provenance: 'observed',
        location: { sourceId: 'main', line: 1 },
        frames: [
          {
            id: 'f1',
            name: 'main',
            location: { sourceId: 'main', line: 1 },
            locals: {
              x: { kind: 'primitive', type: 'int', value: 1 },
              gone: { kind: 'primitive', type: 'str', value: 'old' },
              ref: { kind: 'reference', type: 'list', ref: 'obj-2' },
            },
          },
        ],
        heap: {},
        output: { stdout: '', stderr: '' },
      },
      {
        id: 'e1',
        sequence: 1,
        type: 'condition',
        provenance: 'observed',
        location: { sourceId: 'main', line: 2 },
        frames: [
          {
            id: 'f1',
            name: 'main',
            location: { sourceId: 'main', line: 2 },
            locals: {
              x: { kind: 'primitive', type: 'int', value: 2 },
              added: { kind: 'primitive', type: 'boolean', value: true },
              ref: { kind: 'reference', type: 'list', ref: 'obj-1' },
            },
          },
          {
            id: 'f2',
            name: 'child',
            location: { sourceId: 'main', line: 2 },
            locals: {
              fresh: {
                kind: 'unavailable',
                type: 'object',
                reason: 'not captured',
              },
            },
          },
        ],
        heap: {},
        output: { stdout: '', stderr: '' },
      },
      {
        id: 'e2',
        sequence: 2,
        type: 'variable.delete',
        provenance: 'observed',
        location: { sourceId: 'other', line: 1 },
        frames: [],
        heap: {},
        output: { stdout: '', stderr: '' },
      },
    ],
    status: 'completed',
    limits: { maxEvents: 100, timeoutMs: 1000 },
    diagnostics: [],
  };
}

test('describes source by sourceId and distinguishes observed conditions from pending lines', () => {
  const result = describeStep(fixture(), 1, 'en');
  assert.deepEqual(
    { title: result.title, code: result.code, line: result.line },
    { title: 'Condition evaluation', code: 'if x > 0:', line: 2 },
  );
  assert.match(result.action, /trace recorded a condition evaluation/);
  assert.match(result.comparison, /Changes between step 1 and this step/);
  assert.match(
    result.changes.find((change) => change.name === 'x')!.before,
    /1/,
  );
  assert.equal(
    result.changes.find((change) => change.name === 'x')!.after,
    '2',
  );
  assert.equal(
    result.changes.find((change) => change.name === 'added')!.before,
    '—',
  );
  assert.equal(
    result.changes.find((change) => change.name === 'gone')!.after,
    'out of scope',
  );
  assert.match(
    result.changes.find((change) => change.name === 'ref')!.after,
    /list · obj-1/,
  );
  assert.match(
    result.changes.find((change) => change.name === 'fresh')!.after,
    /unavailable/,
  );
  const pending = fixture();
  pending.events[0].location = { sourceId: 'main', line: 2 };
  assert.match(describeStep(pending, 0, 'en').action, /outcome is not known/);
});

test('first and later steps keep a fixed chronological comparison when viewed backward', () => {
  const trace = fixture();
  const first = describeStep(trace, 0);
  assert.equal(
    first.comparison,
    'Primer paso de la traza; no hay un paso anterior para comparar.',
  );
  const later = describeStep(trace, 2);
  assert.equal(
    later.comparison,
    'Cambios entre el paso 2 y este paso. No son el resultado de la instrucción pendiente.',
  );
  assert.equal(later.code, 'y = 7');
  assert.equal(later.title, 'Fin del ámbito de variable');
  assert.equal(later.changes[0].after, 'fuera de ámbito');
});

test('event actions report observed events and localize values in both languages', () => {
  const trace = fixture();
  trace.events[2].type = 'terminated';
  trace.events[2].location = { sourceId: 'main', line: 3 };
  const spanish = describeStep(trace, 2);
  const english = describeStep(trace, 2, 'en');
  assert.match(spanish.action, /el programa terminó/);
  assert.doesNotMatch(spanish.action, /intentará escribir/);
  assert.match(english.action, /program ended/);
  assert.equal(english.title, 'Program ended');
  assert.match(english.changes[0].after, /out of scope/);
});

test('qualifies changes when frames share a name', () => {
  const trace = fixture();
  trace.events[1].frames[0].name = 'worker';
  trace.events[1].frames[1].name = 'worker';
  const result = describeStep(trace, 1, 'en');
  assert.ok(result.changes.some((change) => change.name === 'x (worker · f1)'));
  assert.ok(
    result.changes.some((change) => change.name === 'fresh (worker · f2)'),
  );
});

test('describes common syntax without evaluating it, and caps displayed changes', () => {
  for (const [code, expected] of [
    ['count += 1', /actualiza una variable/],
    ['return x', /devolver al llamador/],
    ['print(x)', /escribir en la salida/],
  ] as const) {
    const trace = fixture();
    trace.sources[0].content = code;
    const result = describeStep(trace, 0);
    assert.match(result.action, expected);
    assert.match(result.action, /aún no/);
  }
  const trace = fixture();
  trace.events[1].frames = [
    {
      id: 'f1',
      name: 'main',
      location: { sourceId: 'main', line: 2 },
      locals: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          `v${i}`,
          { kind: 'primitive', type: 'int', value: i },
        ]),
      ),
    },
  ];
  assert.equal(describeStep(trace, 1).changes.length, 12);
});

test('rejects indexes outside the trace', () => {
  assert.throws(() => describeStep(fixture(), -1), RangeError);
  assert.throws(() => describeStep(fixture(), 3), RangeError);
});
