import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityNodeForLine,
  renderActivitySvg,
  renderClassSvg,
} from '../src/visualization/activity.ts';
import type {
  ActivityDiagram,
  ActivityNode,
  ClassInfo,
} from '../src/visualization/activity-types.ts';

const nodes: ActivityNode[] = [
  { id: 'initial', kind: 'start', label: 'Start', line: 0 },
  { id: 'check', kind: 'decision', label: 'if score < 3', line: 2 },
  { id: 'low', kind: 'action', label: 'print("low")', line: 3 },
  { id: 'high', kind: 'call', label: 'send_report()', line: 5 },
  { id: 'finish', kind: 'end', label: 'End', line: 6 },
];
const diagram: ActivityDiagram = {
  id: 'sample',
  label: 'Sample activity',
  startLine: 1,
  endLine: 6,
  nodes,
  edges: [
    { id: 'a', from: 'initial', to: 'check' },
    { id: 'b', from: 'check', to: 'low', label: 'true' },
    { id: 'c', from: 'check', to: 'high', label: 'false' },
    { id: 'd', from: 'low', to: 'finish' },
    { id: 'e', from: 'high', to: 'finish' },
  ],
  warnings: [],
};

test('activity SVG is deterministic, escaped, localized, and accessible', () => {
  const hostile = {
    ...diagram,
    label: '<script>alert("x")</script>',
    nodes: nodes.map((n) =>
      n.id === 'low' ? { ...n, label: '<img onerror="x"> & value' } : n,
    ),
  };
  const svg = renderActivitySvg(hostile, { locale: 'es' });
  assert.equal(svg, renderActivitySvg(hostile, { locale: 'es' }));
  assert.match(svg, /role="img" aria-labelledby="cf-title cf-desc"/);
  assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(svg, /&lt;img onerror=&quot;x&quot;&gt; &amp; value/);
  assert.doesNotMatch(svg, /<script|<img onerror/);
  assert.match(svg, />Sí</);
  assert.match(svg, />No</);
  assert.match(svg, /diagrama estático/i);
  assert.match(svg, /no el resultado de una condición/i);
});

test('activity highlights identify observed lines without claiming branch results', () => {
  const plain = renderActivitySvg(diagram, { locale: 'en' });
  const seen = renderActivitySvg(diagram, {
    locale: 'en',
    activeLine: 3,
    visitedLines: [2, 5],
  });
  assert.notEqual(plain, seen);
  assert.match(
    seen,
    /class="node-action active" data-node-id="low" data-source-line="3"/,
  );
  assert.match(
    seen,
    /class="node-decision visited" data-node-id="check" data-source-line="2"/,
  );
  assert.match(seen, /branches describe structure/i);
  assert.doesNotMatch(seen, /branch (?:was )?true|condition evaluated to/i);
  assert.equal(activityNodeForLine(diagram, 3)?.id, 'low');
  assert.equal(activityNodeForLine(diagram, 1), undefined);
});

test('activity layout includes initial/final markers, routes every valid edge, and separates node boxes', () => {
  const svg = renderActivitySvg(diagram);
  assert.match(svg, /<circle[^>]+r="10"/);
  assert.match(svg, /<circle[^>]+r="12"/);
  assert.equal(
    (svg.match(/marker-end="url\(#cf-arrow\)"/g) ?? []).length,
    diagram.edges.length,
  );
  assert.equal((svg.match(/data-node-id=/g) ?? []).length, nodes.length);
  const boxes = [
    ...svg.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="(?:10|2)"/g,
    ),
  ].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!,
        b = boxes[j]!;
      assert.ok(
        a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y,
        'action boxes must not overlap',
      );
    }
});

test('same-line loop operations receive a line-level highlight without selecting one operation or an edge', () => {
  const loop: ActivityDiagram = {
    id: 'loop',
    label: 'for loop',
    startLine: 1,
    endLine: 5,
    warnings: [],
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', line: 0 },
      {
        id: 'decision',
        kind: 'decision',
        label: 'for condition',
        line: 2,
        endLine: 5,
      },
      { id: 'a-init', kind: 'action', label: 'initialize i', line: 3 },
      { id: 'b-condition', kind: 'decision', label: 'check i < 3', line: 3 },
      { id: 'c-update', kind: 'action', label: 'increment i', line: 3 },
      { id: 'body', kind: 'action', label: 'print(i)', line: 4 },
      { id: 'end', kind: 'end', label: 'End', line: 6 },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'decision' },
      { id: 'e2', from: 'decision', to: 'a-init', label: 'next' },
      { id: 'e3', from: 'a-init', to: 'b-condition' },
      { id: 'e4', from: 'b-condition', to: 'body', label: 'true' },
      { id: 'e5', from: 'b-condition', to: 'end', label: 'false' },
      { id: 'e6', from: 'body', to: 'c-update' },
      { id: 'e7', from: 'c-update', to: 'b-condition', label: 'repeat' },
    ],
  };
  const plain = renderActivitySvg(loop, { locale: 'en' });
  const observed = renderActivitySvg(loop, { locale: 'en', activeLine: 3 });
  for (const id of ['a-init', 'b-condition', 'c-update']) {
    assert.match(
      observed,
      new RegExp(
        `class="node-(?:action|decision) active" data-node-id="${id}"`,
      ),
    );
  }
  assert.doesNotMatch(
    observed,
    /class="node-decision active" data-node-id="decision"/,
  );
  assert.doesNotMatch(
    observed,
    /class="node-action active" data-node-id="body"/,
  );
  assert.deepEqual(
    [...observed.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]),
    [...plain.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]),
    'observing a source line must not change or select any static edge',
  );
  assert.equal(activityNodeForLine(loop, 3)?.id, 'a-init');
});

test('class diagram shows declared members and only resolved declared inheritance', () => {
  const classes: ClassInfo[] = [
    {
      id: 'animal',
      name: 'Animal',
      kind: 'class',
      line: 1,
      fields: ['name: string'],
      methods: ['speak(): void'],
      extends: [],
      implements: [],
    },
    {
      id: 'dog',
      name: 'Dog',
      kind: 'class',
      line: 8,
      fields: [],
      methods: ['bark(): void'],
      extends: ['Animal', 'UnknownBase'],
      implements: [],
    },
  ];
  const svg = renderClassSvg(classes, { locale: 'en' });
  assert.equal(svg, renderClassSvg(classes, { locale: 'en' }));
  assert.match(svg, />Animal</);
  assert.match(svg, />speak\(\): void</);
  assert.match(svg, />Dog</);
  assert.equal(
    (svg.match(/marker-end="url\(#cf-class-arrow\)"/g) ?? []).length,
    1,
  );
  assert.match(svg, /fields/i);
  assert.match(svg, /methods/i);
  assert.match(
    renderClassSvg([], { locale: 'es' }),
    /No se han declarado clases/,
  );
  const hostile: ClassInfo[] = [{ ...classes[0]!, name: '<svg onload="bad">' }];
  assert.doesNotMatch(renderClassSvg(hostile), /<svg onload/);
  assert.match(renderClassSvg(hostile), /&lt;svg onload=&quot;bad&quot;&gt;/);
});

test('class links use UML generalization and realization semantics with safe type resolution', () => {
  const classes: ClassInfo[] = [
    {
      id: 'base',
      name: 'demo.Base',
      kind: 'class',
      line: 1,
      fields: [],
      methods: [],
      extends: [],
      implements: [],
    },
    {
      id: 'child',
      name: 'demo.Child',
      kind: 'class',
      line: 4,
      fields: [],
      methods: [],
      extends: ['Base'],
      implements: [],
    },
    {
      id: 'contract',
      name: 'demo.Contract',
      kind: 'interface',
      line: 7,
      fields: [],
      methods: [],
      extends: [],
      implements: [],
    },
    {
      id: 'extended',
      name: 'demo.ExtendedContract',
      kind: 'interface',
      line: 10,
      fields: [],
      methods: [],
      extends: ['demo.Contract'],
      implements: [],
    },
    {
      id: 'person',
      name: 'demo.Person',
      kind: 'class',
      line: 13,
      fields: [],
      methods: [],
      extends: [],
      implements: ['demo.Contract'],
    },
    {
      id: 'other-contract',
      name: 'other.Contract',
      kind: 'interface',
      line: 16,
      fields: [],
      methods: [],
      extends: [],
      implements: [],
    },
    {
      id: 'ambiguous',
      name: 'demo.Ambiguous',
      kind: 'class',
      line: 19,
      fields: [],
      methods: [],
      extends: [],
      implements: ['Contract'],
    },
  ];
  const svg = renderClassSvg(classes);
  assert.equal(
    (svg.match(/marker-end="url\(#cf-class-arrow\)"/g) ?? []).length,
    3,
  );
  assert.equal(
    (svg.match(/stroke-dasharray="6 4"/g) ?? []).length,
    1,
    'implements is a dashed realization',
  );
  assert.match(
    svg,
    /<path d="M 0 0 L 10 5 L 0 10 z" fill="#f4f7f6" stroke=/,
    'generalization marker is an open triangle',
  );
});
