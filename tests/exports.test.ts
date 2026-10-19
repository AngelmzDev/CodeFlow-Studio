import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportTrace } from '../src/exports/export.ts';
import { renderStateSvg } from '../src/visualization/views.ts';
import type { Capabilities, Trace, TraceEvent } from '../src/core/types.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
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
  limitations: [],
};

const maliciousSource = '</script><script>alert("source")</script> & <tag>';

function fixture(): Trace {
  const event: TraceEvent = {
    id: 'e0',
    sequence: 0,
    type: 'line',
    provenance: 'observed',
    location: { sourceId: 'main', line: 1 },
    frames: [
      {
        id: 'f1',
        name: '<script onload="alert(1)">',
        location: { sourceId: 'main', line: 1 },
        locals: {
          payload: {
            kind: 'primitive',
            type: 'str',
            value: '</text><script>alert("svg")</script>&',
          },
        },
      },
    ],
    heap: {},
    output: { stdout: '', stderr: '' },
  };
  return {
    schemaVersion: '1.0',
    language: 'python',
    adapter: { id: 'fixture', version: '1', capabilities },
    sources: [{ id: 'main', name: 'main.py', content: maliciousSource }],
    events: [event],
    status: 'completed',
    limits: { maxEvents: 10, timeoutMs: 1000 },
    diagnostics: [],
  };
}

test('JSON export preserves source text and validated trace data', async () => {
  const json = await exportTrace(fixture(), 'json');
  const trace = JSON.parse(json) as Trace;
  assert.equal(trace.sources[0]?.content, maliciousSource);
  assert.equal(trace.events[0]?.id, 'e0');
});

test('offline HTML escapes embedded trace JSON and round-trips malicious source', async () => {
  assert.ok(
    existsSync(`${root}/.build/app.js`),
    'Run the build before the offline HTML export test',
  );
  const trace = fixture();
  const secondEvent = structuredClone(trace.events[0]!);
  secondEvent.id = 'e1';
  secondEvent.sequence = 1;
  trace.events.push(secondEvent);
  const html = await exportTrace(trace, 'html', 1);
  assert.match(
    html,
    /<script id="embedded-trace"[^>]*type="application\/json">/,
  );
  const embedded = html.match(
    /<script id="embedded-trace"([^>]*)>([\s\S]*?)<\/script>/,
  );
  assert.ok(embedded, 'embedded trace JSON block exists');
  assert.match(embedded[1]!, /\bdata-event-index="1"/);
  const roundTripped = JSON.parse(embedded[2]!) as Trace;
  assert.equal(roundTripped.sources[0]?.content, maliciousSource);
  assert.equal(roundTripped.events.length, 2);
  assert.equal(roundTripped.events[1]?.id, 'e1');
  assert.ok(!embedded[2]!.includes('</script>'));
  assert.ok(!html.includes('<script>alert("source")</script>'));
  assert.match(html, /<style>/);
  assert.match(html, /<script type="module">/);
});

test('SVG output escapes untrusted names and values as XML text', () => {
  const svg = renderStateSvg(fixture().events[0]!);
  assert.ok(svg.includes('&lt;script onload=&quot;alert(1)…'));
  assert.ok(svg.includes('&quot;&lt;/text&gt;&lt;script&gt;ale…'));
  assert.ok(!svg.includes('<script'));
  assert.ok(!svg.includes('</text><script>'));
});

test('SVG export selects and escapes the requested event snapshot', async () => {
  const svg = await exportTrace(fixture(), 'svg', 20);
  assert.match(svg, /EVENT 0/);
  assert.ok(!svg.includes('<script'));
});

test('SVG layout renders deterministically with non-overlapping heap and stack cards', () => {
  const event = fixture().events[0]!;
  event.heap = {
    o1: { id: 'o1', kind: 'object', type: 'First', fields: {} },
    o2: { id: 'o2', kind: 'array', type: 'Second', elements: [], length: 0 },
  };
  event.frames.push(
    {
      id: 'f2',
      name: 'middle',
      location: { sourceId: 'main', line: 1 },
      locals: {},
    },
    {
      id: 'f3',
      name: 'outer',
      location: { sourceId: 'main', line: 1 },
      locals: {},
    },
  );
  const first = renderStateSvg(event);
  assert.equal(renderStateSvg(event), first);

  const cardY = (pattern: RegExp) =>
    [...first.matchAll(pattern)].map((match) => Number(match[1]));
  const heapY = cardY(/<rect x="382" y="(\d+)" width="354" height="80"/g);
  const stackY = cardY(/<rect x="782" y="(\d+)" width="220" height="48"/g);
  assert.equal(heapY.length, 2);
  assert.equal(stackY.length, 3);
  for (let index = 1; index < heapY.length; index += 1) {
    assert.ok(
      heapY[index]! - heapY[index - 1]! >= 80,
      'heap cards do not overlap',
    );
  }
  for (let index = 1; index < stackY.length; index += 1) {
    assert.ok(
      stackY[index]! - stackY[index - 1]! >= 48,
      'stack cards do not overlap',
    );
  }
});

test('offline HTML embeds validated static analysis without introducing script markup', async () => {
  const trace = fixture();
  const analysis = {
    schemaVersion: '1.0' as const,
    language: trace.language,
    provenance: 'static' as const,
    source: { name: 'main.py', content: maliciousSource },
    defaultDiagramId: 'module',
    diagrams: [
      {
        id: 'module',
        label: maliciousSource,
        startLine: 1,
        endLine: 1,
        nodes: [
          {
            id: 'n1',
            kind: 'action' as const,
            label: maliciousSource,
            line: 1,
          },
        ],
        edges: [],
        warnings: [],
      },
    ],
    classes: [],
    diagnostics: [],
  };
  const html = await exportTrace(trace, 'html', 0, analysis);
  const embedded = html.match(
    /<script id="embedded-analysis"[^>]*>([\s\S]*?)<\/script>/,
  );
  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded[1]!), analysis);
  assert.ok(!embedded[1]!.includes('</script>'));
  await assert.rejects(
    exportTrace(trace, 'html', 0, { ...analysis, language: 'java' }),
    /does not match source/,
  );
});
