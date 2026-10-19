export type ActivityKind =
  | 'start'
  | 'end'
  | 'action'
  | 'decision'
  | 'merge'
  | 'call'
  | 'return'
  | 'note';
export interface ActivityNode {
  id: string;
  kind: ActivityKind;
  label: string;
  line: number;
  endLine?: number;
}
export interface ActivityEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}
export interface ActivityDiagram {
  id: string;
  label: string;
  startLine: number;
  endLine: number;
  nodes: ActivityNode[];
  edges: ActivityEdge[];
  warnings: string[];
}
export interface ClassInfo {
  id: string;
  name: string;
  kind: 'class' | 'interface' | 'enum';
  line: number;
  fields: string[];
  methods: string[];
  extends: string[];
  implements: string[];
}
export interface Analysis {
  schemaVersion: '1.0';
  language: string;
  provenance: 'static';
  source: { name: string; content: string };
  primaryEntry?: string;
  defaultDiagramId: string;
  diagrams: ActivityDiagram[];
  classes: ClassInfo[];
  diagnostics: string[];
}

export interface AnalysisRequest {
  language: string;
  source: string;
  filename?: string;
  entry?: string;
}
