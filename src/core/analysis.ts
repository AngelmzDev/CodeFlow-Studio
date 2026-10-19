import type {
  Analysis,
  AnalysisRequest,
  ActivityDiagram,
  ActivityNode,
  ActivityEdge,
  ClassInfo,
} from './analysis-types.ts';
function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function string(v: unknown, max = 4096): v is string {
  return typeof v === 'string' && v.length <= max;
}
function fail(reason: string): never {
  throw new Error('Invalid source analysis: ' + reason);
}
const kinds = new Set([
  'start',
  'end',
  'action',
  'decision',
  'merge',
  'call',
  'return',
  'note',
]);
export function validateAnalysis(
  input: unknown,
  expected?: Pick<AnalysisRequest, 'source' | 'language'>,
): Analysis {
  if (
    !object(input) ||
    input.schemaVersion !== '1.0' ||
    input.provenance !== 'static' ||
    !string(input.language, 64) ||
    !object(input.source) ||
    !string(input.source.name, 256) ||
    !string(input.source.content, 100000)
  )
    fail('metadata');
  if (
    expected &&
    (input.language !== expected.language ||
      input.source.content !== expected.source)
  )
    fail('analysis does not match source');
  const source = { name: input.source.name, content: input.source.content },
    lineCount = source.content.split('\n').length;
  if (lineCount > 10000) fail('source line limit');
  const line = (v: unknown) =>
    Number.isInteger(v) && Number(v) >= 1 && Number(v) <= lineCount;
  const strings = (v: unknown, maxCount = 64, maxLength = 512): string[] => {
    if (
      !Array.isArray(v) ||
      v.length > maxCount ||
      !v.every((x) => string(x, maxLength))
    )
      return fail('text list');
    return [...v];
  };
  if (
    !Array.isArray(input.diagrams) ||
    input.diagrams.length > 24 ||
    !Array.isArray(input.classes) ||
    input.classes.length > 24 ||
    !string(input.defaultDiagramId, 128)
  )
    fail('diagram list');
  const graphIds = new Set<string>();
  const diagrams: ActivityDiagram[] = input.diagrams.map((d) => {
    if (
      !object(d) ||
      !string(d.id, 128) ||
      graphIds.has(d.id) ||
      !string(d.label, 256) ||
      !line(d.startLine) ||
      !line(d.endLine) ||
      Number(d.endLine) < Number(d.startLine) ||
      !Array.isArray(d.nodes) ||
      d.nodes.length > 200 ||
      !Array.isArray(d.edges) ||
      d.edges.length > 600
    )
      fail('activity');
    graphIds.add(d.id);
    const ids = new Set<string>();
    const nodes: ActivityNode[] = d.nodes.map((n) => {
      if (
        !object(n) ||
        !string(n.id, 128) ||
        ids.has(n.id) ||
        !kinds.has(String(n.kind)) ||
        !string(n.label, 1024) ||
        !line(n.line) ||
        (n.endLine !== undefined &&
          (!line(n.endLine) || Number(n.endLine) < Number(n.line)))
      )
        fail('activity node');
      ids.add(n.id);
      return {
        id: n.id,
        kind: n.kind as ActivityNode['kind'],
        label: n.label,
        line: Number(n.line),
        ...(n.endLine === undefined ? {} : { endLine: Number(n.endLine) }),
      };
    });
    const edgeIds = new Set<string>();
    const edges: ActivityEdge[] = d.edges.map((e) => {
      if (
        !object(e) ||
        !string(e.id, 128) ||
        edgeIds.has(e.id) ||
        !string(e.from, 128) ||
        !ids.has(e.from) ||
        !string(e.to, 128) ||
        !ids.has(e.to) ||
        (e.label !== undefined && !string(e.label, 256))
      )
        fail('activity edge');
      edgeIds.add(e.id);
      return {
        id: e.id,
        from: e.from,
        to: e.to,
        ...(e.label === undefined ? {} : { label: e.label }),
      };
    });
    return {
      id: d.id,
      label: d.label,
      startLine: Number(d.startLine),
      endLine: Number(d.endLine),
      nodes,
      edges,
      warnings: strings(d.warnings ?? [], 64),
    };
  });
  if (diagrams.length && !graphIds.has(input.defaultDiagramId))
    fail('default diagram');
  const classIds = new Set<string>();
  const classes: ClassInfo[] = input.classes.map((c) => {
    if (
      !object(c) ||
      !string(c.id, 128) ||
      classIds.has(c.id) ||
      !string(c.name, 256) ||
      !['class', 'interface', 'enum'].includes(String(c.kind)) ||
      !line(c.line)
    )
      fail('class');
    classIds.add(c.id);
    return {
      id: c.id,
      name: c.name,
      kind: c.kind as ClassInfo['kind'],
      line: Number(c.line),
      fields: strings(c.fields),
      methods: strings(c.methods),
      extends: strings(c.extends ?? [], 24),
      implements: strings(c.implements ?? [], 24),
    };
  });
  if (input.primaryEntry !== undefined && !string(input.primaryEntry, 256))
    fail('entry point');
  return {
    schemaVersion: '1.0',
    language: input.language,
    provenance: 'static',
    source,
    defaultDiagramId: input.defaultDiagramId,
    diagrams,
    classes,
    diagnostics: strings(input.diagnostics ?? [], 100),
    ...(input.primaryEntry === undefined
      ? {}
      : { primaryEntry: input.primaryEntry }),
  };
}
