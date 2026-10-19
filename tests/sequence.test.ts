import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSequenceSvg } from '../src/visualization/sequence.ts';
import type { Trace, TraceEvent } from '../src/core/types.ts';
function fixture(count = 2): Trace {
  return {
    language: 'python',
    events: Array.from({ length: count }, (_, sequence): TraceEvent => ({
      id: `e${sequence}`,
      sequence,
      type: sequence % 2 ? 'return' : 'call',
      provenance: 'observed',
      location: { sourceId: 'main', line: sequence + 1 },
      frames: ['callee', 'caller'].map((name) => ({
        id: name,
        name,
        location: { sourceId: 'main', line: 1 },
        locals: {},
      })),
      heap: {},
      output: { stdout: '', stderr: '' },
    })),
  } as Trace;
}
test('observed calls and returns follow normalized active-first stacks', () => {
  const svg = renderSequenceSvg(fixture(), 1, { locale: 'en' });
  assert.ok(
    svg.indexOf('<title>caller</title>') < svg.indexOf('<title>callee</title>'),
  );
  assert.match(svg, /d="M110 112 H290"/);
  assert.match(svg, /d="M290 168 H110"/);
  assert.match(svg, /stroke-dasharray="5 4"/);
  assert.match(svg, /1\. call/);
  assert.match(svg, /2\. return/);
});
test('backward selection excludes future messages and line events invent no calls', () => {
  const input = fixture(3);
  assert.match(renderSequenceSvg(input, 2, { locale: 'en' }), /3\. call/);
  assert.doesNotMatch(
    renderSequenceSvg(input, 0, { locale: 'en' }),
    /2\. return|3\. call/,
  );
  input.events[0].type = 'line';
  assert.match(
    renderSequenceSvg(input, 0, { locale: 'en' }),
    /No calls observed/,
  );
  assert.match(renderSequenceSvg(fixture(0), 0), /Aún no hay llamadas/);
});
test('bounded messages and participants display truncation notices', () => {
  const input = fixture(75);
  const svg = renderSequenceSvg(input, 74, { locale: 'en' });
  assert.equal((svg.match(/marker-end="url\(#seq-arrow\)"/g) ?? []).length, 60);
  assert.match(svg, /limited to 60 messages and 10 participants/);
  const varied = fixture(20);
  varied.events.forEach((event, i) => {
    event.frames[0].name = `worker${i}`;
  });
  const bounded = renderSequenceSvg(varied, 19, { locale: 'en' });
  assert.equal((bounded.match(/<title>/g) ?? []).length, 10);
  assert.match(bounded, /limited to 60 messages and 10 participants/);
});
test('SVG escapes untrusted names and represents recursion as a self call', () => {
  const input = fixture(1);
  input.events[0].frames.forEach((frame) => {
    frame.name = '<script>&"unsafe';
  });
  const svg = renderSequenceSvg(input, 0, { locale: 'en', theme: 'dark' });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;&amp;/);
  assert.match(svg, /h54 v18 h-54/);
  assert.match(svg, /fill="#16202a"/);
});
