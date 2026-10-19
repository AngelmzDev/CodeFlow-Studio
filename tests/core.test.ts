import test from 'node:test';
import assert from 'node:assert/strict';
import { Playback } from '../src/core/playback.ts';
import { deriveChanges, validateTrace } from '../src/core/trace.ts';
import type { Capabilities, Trace, TraceEvent } from '../src/core/types.ts';

const capabilities: Capabilities = {
  stepping: true,
  variables: true,
  callStack: true,
  objects: true,
  arrays: true,
  memory: false,
  stdin: true,
  stdout: true,
  exceptions: true,
  conditionValues: false,
  loopEvents: false,
  reverseExecution: false,
  limitations: ['single source'],
};

function makeTrace(eventCount = 3): Trace {
  const events: TraceEvent[] = Array.from(
    { length: eventCount },
    (_, sequence) => ({
      id: `e${sequence}`,
      sequence,
      type: 'line',
      provenance: 'observed',
      location: { sourceId: 'main', line: sequence + 1 },
      frames: [
        {
          id: 'f1',
          name: 'main',
          location: { sourceId: 'main', line: sequence + 1 },
          locals: {
            count: { kind: 'primitive', type: 'int', value: sequence },
          },
        },
      ],
      heap: {},
      output: { stdout: '', stderr: '' },
    }),
  );
  return {
    schemaVersion: '1.0',
    language: 'python',
    adapter: {
      id: 'fixture',
      version: '1',
      capabilities: structuredClone(capabilities),
    },
    sources: [{ id: 'main', name: 'main.py', content: 'a\nb\nc\n' }],
    events,
    status: 'completed',
    limits: { maxEvents: 100, timeoutMs: 1000 },
    diagnostics: [],
  };
}

test('Playback takes an immutable snapshot of the trace', () => {
  const input = makeTrace();
  const playback = new Playback(input);
  input.events[0]!.frames[0]!.locals.count = {
    kind: 'primitive',
    type: 'int',
    value: 99,
  };
  const count = playback.state?.frames[0]?.locals.count;
  assert.equal(count?.kind === 'primitive' ? count.value : undefined, 0);
  assert.equal(
    Object.isFrozen(playback.trace.events[0]?.frames[0]?.locals),
    true,
  );
  assert.throws(() => {
    (
      playback.trace.events[0]!.frames[0]!.locals as Record<string, unknown>
    ).count = {};
  }, TypeError);
});

test('seek clamps, next and previous move one event, and reset returns to the start', () => {
  const playback = new Playback(makeTrace());
  playback.seek(50);
  assert.equal(playback.index, 2);
  playback.seek(-10);
  assert.equal(playback.index, 0);
  playback.seek(1.8);
  assert.equal(playback.index, 1);
  playback.next();
  assert.equal(playback.state?.id, 'e2');
  playback.previous();
  assert.equal(playback.state?.id, 'e1');
  playback.reset();
  assert.equal(playback.index, 0);
  assert.equal(playback.playing, false);
});

test('playback rejects unsupported speeds', () => {
  const playback = new Playback(makeTrace());
  for (const speed of [0, 0.09, 16.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => playback.setSpeed(speed),
      /Speed must be between 0.1 and 16/,
    );
  }
  playback.setSpeed(0.1);
  assert.equal(playback.speed, 0.1);
  playback.setSpeed(16);
  assert.equal(playback.speed, 16);
});

test('play pauses once it reaches the last event', async () => {
  const playback = new Playback(makeTrace(2));
  playback.setSpeed(16);
  playback.play();
  assert.equal(playback.playing, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(playback.index, 1);
  assert.equal(playback.playing, false);
});

test('validateTrace rejects malformed schema, event order, and source locations', () => {
  assert.throws(
    () => validateTrace({ ...makeTrace(), schemaVersion: '2.0' }),
    /schema version/,
  );

  const badOrder = makeTrace();
  badOrder.events[1]!.sequence = 0;
  assert.throws(() => validateTrace(badOrder), /event order\/type/);

  const badLocation = makeTrace();
  badLocation.events[0]!.location = { sourceId: 'missing', line: 1 };
  assert.throws(() => validateTrace(badLocation), /source location/);

  const outOfRange = makeTrace();
  outOfRange.events[0]!.location = { sourceId: 'main', line: 5 };
  assert.throws(() => validateTrace(outOfRange), /source location/);
});

test('rejects deeply nested untrusted detail before cloning or retaining it', () => {
  const trace = makeTrace(1);
  let nested: Record<string, unknown> = { attacker: true };
  for (let index = 0; index < 10_000; index += 1) nested = { unknown: nested };
  trace.events[0]!.detail = nested;
  assert.throws(() => validateTrace(trace), /detail depth/);
});

test('preserves a valid return value in event detail', () => {
  const trace = makeTrace(1);
  trace.events[0]!.type = 'return';
  trace.events[0]!.detail = {
    value: { kind: 'primitive', type: 'int', value: 42 },
  };
  const validated = validateTrace(trace);
  assert.deepEqual(validated.events[0]!.detail, {
    value: { kind: 'primitive', type: 'int', value: 42 },
  });
});

test('projects imported changes into derived data without exposing nested attacker content', () => {
  const trace = makeTrace(2);
  let nested: Record<string, unknown> = { execute: 'not a trace field' };
  for (let index = 0; index < 10_000; index += 1) nested = { injected: nested };
  trace.events[1]!.changes = [
    {
      frameId: 'attacker',
      name: 'injected',
      after: nested as never,
      provenance: 'derived',
    },
  ];

  const playback = new Playback(trace);
  assert.deepEqual(playback.trace.events[1]!.changes, [
    {
      frameId: 'f1',
      name: 'count',
      before: { kind: 'primitive', type: 'int', value: 0 },
      after: { kind: 'primitive', type: 'int', value: 1 },
      provenance: 'derived',
    },
  ]);
  assert.equal(JSON.stringify(playback.trace).includes('injected'), false);
});

test("validateTrace returns a projected copy and leaves its caller's trace untouched", () => {
  const input = makeTrace();
  input.events[0]!.changes = [
    { frameId: 'forged', name: 'forged', provenance: 'derived' },
  ];
  const before = structuredClone(input);
  const validated = validateTrace(input);
  assert.deepEqual(input, before);
  assert.notEqual(validated, input);
  assert.notEqual(validated.events, input.events);
  assert.notEqual(validated.sources, input.sources);
  assert.notEqual(validated.events[0], input.events[0]);
});

test('condition and loop evidence requires its advertised adapter capability', () => {
  const conditionTrace = makeTrace(1);
  conditionTrace.events[0]!.type = 'condition' as never;
  conditionTrace.events[0]!.detail = { result: true };
  assert.throws(
    () => validateTrace(conditionTrace),
    /condition evidence requires adapter capability/,
  );
  conditionTrace.adapter.capabilities.conditionValues = true;
  assert.equal(validateTrace(conditionTrace).events[0]!.type, 'condition');

  for (const type of ['loop.start', 'loop.end'] as const) {
    const loopTrace = makeTrace(1);
    loopTrace.events[0]!.type = type as never;
    loopTrace.events[0]!.detail = { loopId: 'loop-1', iteration: 0 };
    assert.throws(
      () => validateTrace(loopTrace),
      /loop evidence requires adapter capability/,
    );
    loopTrace.adapter.capabilities.loopEvents = true;
    assert.equal(validateTrace(loopTrace).events[0]!.type, type);
  }
});

test('validateTrace rejects invalid values and derives trusted changes', () => {
  const malformed = makeTrace();
  malformed.events[0]!.frames[0]!.locals.count = {
    kind: 'primitive',
    type: 'number',
    value: Number.NaN,
  };
  assert.throws(() => validateTrace(malformed), /nonfinite primitive/);

  const trace = makeTrace();
  trace.events[0]!.changes = [
    { frameId: 'forged', name: 'fake', provenance: 'derived' },
  ];
  const validated = validateTrace(trace);
  assert.deepEqual(validated.events[1]!.changes, [
    {
      frameId: 'f1',
      name: 'count',
      before: { kind: 'primitive', type: 'int', value: 0 },
      after: { kind: 'primitive', type: 'int', value: 1 },
      provenance: 'derived',
    },
  ]);
  assert.deepEqual(validated.events[0]!.changes, [
    {
      frameId: 'f1',
      name: 'count',
      before: undefined,
      after: { kind: 'primitive', type: 'int', value: 0 },
      provenance: 'derived',
    },
  ]);
});

test('deriveChanges reports added, changed, and removed locals from adjacent snapshots', () => {
  const before = makeTrace(1).events[0]!;
  before.frames[0]!.locals.retired = {
    kind: 'primitive',
    type: 'bool',
    value: true,
  };
  const after: TraceEvent = {
    ...before,
    id: 'e1',
    sequence: 1,
    frames: [
      {
        ...before.frames[0]!,
        locals: {
          count: { kind: 'primitive', type: 'int', value: 1 },
          added: { kind: 'primitive', type: 'str', value: 'new' },
        },
      },
    ],
  };
  assert.deepEqual(deriveChanges(before, after), [
    {
      frameId: 'f1',
      name: 'added',
      before: undefined,
      after: { kind: 'primitive', type: 'str', value: 'new' },
      provenance: 'derived',
    },
    {
      frameId: 'f1',
      name: 'count',
      before: { kind: 'primitive', type: 'int', value: 0 },
      after: { kind: 'primitive', type: 'int', value: 1 },
      provenance: 'derived',
    },
    {
      frameId: 'f1',
      name: 'retired',
      before: { kind: 'primitive', type: 'bool', value: true },
      after: undefined,
      provenance: 'derived',
    },
  ]);
});
