import type {
  Trace,
  TraceEvent,
  Change,
  Value,
  Location,
  Capabilities,
} from './types.ts';
export function deriveChanges(
  previous: TraceEvent | undefined,
  next: TraceEvent,
): Change[] {
  const changes: Change[] = [];
  for (const frame of next.frames) {
    const old = previous?.frames.find((f) => f.id === frame.id)?.locals ?? {};
    for (const name of [
      ...new Set([...Object.keys(old), ...Object.keys(frame.locals)]),
    ].sort()) {
      if (JSON.stringify(old[name]) !== JSON.stringify(frame.locals[name]))
        changes.push({
          frameId: frame.id,
          name,
          before: old[name],
          after: frame.locals[name],
          provenance: 'derived',
        });
    }
  }
  return changes;
}
const kinds = new Set([
  'line',
  'call',
  'return',
  'exception',
  'stdout',
  'stderr',
  'terminated',
  'limit',
  'condition',
  'loop.start',
  'loop.end',
  'variable.create',
  'variable.update',
  'variable.delete',
]);
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function fail(message: string): never {
  throw new Error('Invalid trace: ' + message);
}
function text(v: unknown, max = 4096): v is string {
  return typeof v === 'string' && v.length <= max;
}
function keys(v: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(v).some((k) => !allowed.includes(k))) fail('unknown field');
}
function checkValue(v: unknown): Value {
  if (!record(v) || !text(v.type, 256)) fail('malformed value');
  keys(v, ['kind', 'type', 'value', 'ref', 'reason']);
  if (v.kind === 'primitive') {
    if (
      v.value !== null &&
      !['string', 'number', 'boolean'].includes(typeof v.value)
    )
      fail('primitive');
    if (typeof v.value === 'number' && !Number.isFinite(v.value))
      fail('nonfinite primitive');
    if (typeof v.value === 'string' && v.value.length > 16384)
      fail('primitive string limit');
    return {
      kind: 'primitive',
      type: v.type,
      value: v.value as string | number | boolean | null,
    };
  }
  if (v.kind === 'reference' && text(v.ref, 128))
    return { kind: 'reference', type: v.type, ref: v.ref };
  if (v.kind === 'unavailable' && text(v.reason))
    return { kind: 'unavailable', type: v.type, reason: v.reason };
  return fail('value kind');
}
function detail(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (text(v, 16384)) return v;
  if (depth >= 5) fail('detail depth');
  if (Array.isArray(v) && v.length <= 128)
    return v.map((x) => detail(x, depth + 1));
  if (record(v) && Object.keys(v).length <= 128)
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, detail(x, depth + 1)]),
    );
  return fail('detail shape');
}
export function validateTrace(value: unknown): Trace {
  if (!record(value) || value.schemaVersion !== '1.0')
    fail('unsupported schema version');
  keys(value, [
    'schemaVersion',
    'language',
    'adapter',
    'sources',
    'events',
    'status',
    'limits',
    'diagnostics',
  ]);
  if (
    !text(value.language, 64) ||
    !record(value.adapter) ||
    !text(value.adapter.id, 128) ||
    !text(value.adapter.version, 64) ||
    !record(value.adapter.capabilities)
  )
    fail('adapter');
  keys(value.adapter, ['id', 'version', 'capabilities']);
  const caps = value.adapter.capabilities;
  const capNames = [
    'stepping',
    'variables',
    'callStack',
    'objects',
    'arrays',
    'memory',
    'stdin',
    'stdout',
    'exceptions',
    'conditionValues',
    'loopEvents',
    'reverseExecution',
  ];
  keys(caps, [...capNames, 'limitations']);
  for (const key of capNames)
    if (typeof caps[key] !== 'boolean') fail('capability ' + key);
  if (
    !Array.isArray(caps.limitations) ||
    caps.limitations.length > 32 ||
    !caps.limitations.every((x) => text(x))
  )
    fail('limitations');
  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 50
  )
    fail('sources');
  const sourceLines = new Map<string, number>();
  const sources = value.sources.map((source) => {
    if (
      !record(source) ||
      !text(source.id, 128) ||
      sourceLines.has(source.id) ||
      !text(source.name, 256) ||
      !text(source.content, 100000)
    )
      return fail('source');
    keys(source, ['id', 'name', 'content']);
    const lines = source.content.split('\n').length;
    if (lines > 10000) fail('source line limit');
    sourceLines.set(source.id, lines);
    return { id: source.id, name: source.name, content: source.content };
  });
  function location(v: unknown): Location {
    if (
      !record(v) ||
      !text(v.sourceId, 128) ||
      !sourceLines.has(v.sourceId) ||
      !Number.isInteger(v.line) ||
      Number(v.line) < 1 ||
      Number(v.line) > sourceLines.get(v.sourceId)!
    )
      fail('source location');
    keys(v, ['sourceId', 'line', 'column']);
    if (
      v.column !== undefined &&
      (!Number.isInteger(v.column) || Number(v.column) < 1)
    )
      fail('column');
    return {
      sourceId: v.sourceId,
      line: Number(v.line),
      ...(v.column === undefined ? {} : { column: Number(v.column) }),
    };
  }
  if (
    !Array.isArray(value.events) ||
    !value.events.length ||
    value.events.length > 10002
  )
    fail('event count');
  const events: TraceEvent[] = [];
  for (const [i, event] of value.events.entries()) {
    if (
      !record(event) ||
      event.id !== 'e' + i ||
      event.sequence !== i ||
      !kinds.has(String(event.type)) ||
      event.provenance !== 'observed'
    )
      fail('event order/type');
    keys(event, [
      'id',
      'sequence',
      'type',
      'provenance',
      'location',
      'frames',
      'heap',
      'output',
      'detail',
      'changes',
    ]);
    if (
      !Array.isArray(event.frames) ||
      event.frames.length > 256 ||
      !record(event.heap) ||
      Object.keys(event.heap).length > 256 ||
      !record(event.output) ||
      !text(event.output.stdout, 65536) ||
      !text(event.output.stderr, 65536)
    )
      fail('snapshot');
    keys(event.output, ['stdout', 'stderr']);
    const frameIds = new Set<string>();
    const frames = event.frames.map((frame) => {
      if (
        !record(frame) ||
        !text(frame.id, 128) ||
        frameIds.has(frame.id) ||
        !text(frame.name, 512) ||
        !record(frame.locals) ||
        Object.keys(frame.locals).length > 256
      )
        fail('frame');
      keys(frame, ['id', 'name', 'location', 'locals']);
      frameIds.add(frame.id);
      return {
        id: frame.id,
        name: frame.name,
        location: location(frame.location),
        locals: Object.fromEntries(
          Object.entries(frame.locals).map(([k, v]) => [k, checkValue(v)]),
        ),
      };
    });
    const heap = Object.fromEntries(
      Object.entries(event.heap).map(([key, obj]) => {
        if (
          !record(obj) ||
          obj.id !== key ||
          !text(obj.type, 256) ||
          !['array', 'object'].includes(String(obj.kind))
        )
          fail('heap object');
        keys(obj, [
          'id',
          'type',
          'kind',
          'elements',
          'fields',
          'length',
          'truncated',
        ]);
        if (
          obj.elements !== undefined &&
          (!Array.isArray(obj.elements) || obj.elements.length > 128)
        )
          fail('elements');
        if (
          obj.fields !== undefined &&
          (!record(obj.fields) || Object.keys(obj.fields).length > 128)
        )
          fail('fields');
        if (
          obj.length !== undefined &&
          (!Number.isInteger(obj.length) || Number(obj.length) < 0)
        )
          fail('length');
        if (obj.truncated !== undefined && typeof obj.truncated !== 'boolean')
          fail('truncation');
        return [
          key,
          {
            id: key,
            type: obj.type,
            kind: obj.kind as 'array' | 'object',
            ...(obj.elements === undefined
              ? {}
              : { elements: (obj.elements as unknown[]).map(checkValue) }),
            ...(obj.fields === undefined
              ? {}
              : {
                  fields: Object.fromEntries(
                    Object.entries(obj.fields as Record<string, unknown>).map(
                      ([k, v]) => [k, checkValue(v)],
                    ),
                  ),
                }),
            ...(obj.length === undefined ? {} : { length: Number(obj.length) }),
            ...(obj.truncated === undefined
              ? {}
              : { truncated: obj.truncated as boolean }),
          },
        ];
      }),
    );
    const clean: TraceEvent = {
      id: event.id as string,
      sequence: i,
      type: event.type as TraceEvent['type'],
      provenance: 'observed',
      frames,
      heap,
      output: {
        stdout: event.output.stdout as string,
        stderr: event.output.stderr as string,
      },
      ...(event.location === undefined
        ? {}
        : { location: location(event.location) }),
      ...(event.detail === undefined
        ? {}
        : { detail: detail(event.detail) as Record<string, unknown> }),
    };
    if (clean.detail !== undefined && !record(clean.detail))
      fail('detail object');
    if (
      clean.type === 'condition' &&
      (!caps.conditionValues || typeof clean.detail?.result !== 'boolean')
    )
      fail('condition evidence requires adapter capability and boolean result');
    if (
      clean.type.startsWith('loop.') &&
      (!caps.loopEvents ||
        !text(clean.detail?.loopId, 128) ||
        !Number.isInteger(clean.detail?.iteration) ||
        Number(clean.detail?.iteration) < 0)
    )
      fail('loop evidence requires adapter capability and iteration identity');
    if (
      clean.type.startsWith('variable.') &&
      (!text(clean.detail?.frameId, 128) || !text(clean.detail?.name, 256))
    )
      fail('variable event identity');
    clean.changes = deriveChanges(events.at(-1), clean);
    events.push(clean);
  }
  if (
    !['completed', 'exception', 'limited'].includes(String(value.status)) ||
    !record(value.limits) ||
    !Number.isInteger(value.limits.maxEvents) ||
    Number(value.limits.maxEvents) < 1 ||
    Number(value.limits.maxEvents) > 10000 ||
    !Number.isInteger(value.limits.timeoutMs) ||
    Number(value.limits.timeoutMs) < 1 ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > 100 ||
    !value.diagnostics.every((x) => text(x))
  )
    fail('metadata');
  keys(value.limits, ['maxEvents', 'timeoutMs']);
  return {
    schemaVersion: '1.0',
    language: value.language,
    adapter: {
      id: value.adapter.id,
      version: value.adapter.version,
      capabilities: structuredClone(caps) as unknown as Capabilities,
    },
    sources,
    events,
    status: value.status as Trace['status'],
    limits: {
      maxEvents: Number(value.limits.maxEvents),
      timeoutMs: Number(value.limits.timeoutMs),
    },
    diagnostics: value.diagnostics as string[],
  };
}
export function freezeTrace(trace: Trace): Trace {
  const pending: unknown[] = [trace];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const v = pending.pop();
    if (v && typeof v === 'object' && !seen.has(v)) {
      seen.add(v);
      Object.freeze(v);
      pending.push(...Object.values(v));
    }
  }
  return trace;
}
