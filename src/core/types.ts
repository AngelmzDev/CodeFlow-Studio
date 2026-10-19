import type { Analysis, AnalysisRequest } from './analysis-types.ts';
/** Trace v1: all locations are 1-based and refer to the next instruction. */
export interface Capabilities {
  stepping: boolean;
  variables: boolean;
  callStack: boolean;
  objects: boolean;
  arrays: boolean;
  memory: boolean;
  stdin: boolean;
  stdout: boolean;
  exceptions: boolean;
  conditionValues: boolean;
  loopEvents: boolean;
  reverseExecution: boolean;
  limitations: string[];
}
export type Value =
  | { kind: 'primitive'; type: string; value: string | number | boolean | null }
  | { kind: 'reference'; type: string; ref: string }
  | { kind: 'unavailable'; type: string; reason: string };
export interface Location {
  sourceId: string;
  line: number;
  column?: number;
}
export interface Frame {
  id: string;
  name: string;
  location: Location;
  locals: Record<string, Value>;
}
export interface HeapObject {
  id: string;
  type: string;
  kind: 'array' | 'object';
  elements?: Value[];
  fields?: Record<string, Value>;
  length?: number;
  truncated?: boolean;
}
export interface Change {
  frameId: string;
  name: string;
  before?: Value;
  after?: Value;
  provenance: 'derived';
}
export type EventType =
  | 'line'
  | 'call'
  | 'return'
  | 'exception'
  | 'stdout'
  | 'stderr'
  | 'terminated'
  | 'limit'
  | 'condition'
  | 'loop.start'
  | 'loop.end'
  | 'variable.create'
  | 'variable.update'
  | 'variable.delete';
export interface TraceEvent {
  id: string;
  sequence: number;
  type: EventType;
  provenance: 'observed';
  location?: Location;
  frames: Frame[];
  heap: Record<string, HeapObject>;
  output: { stdout: string; stderr: string };
  detail?: Record<string, unknown>;
  changes?: Change[];
}
export interface Trace {
  schemaVersion: '1.0';
  language: string;
  adapter: { id: string; version: string; capabilities: Capabilities };
  sources: { id: string; name: string; content: string }[];
  events: TraceEvent[];
  status: 'completed' | 'exception' | 'limited';
  limits: { maxEvents: number; timeoutMs: number };
  diagnostics: string[];
}
export interface TraceRequest {
  language: string;
  source: string;
  filename: string;
  entry?: string;
  stdin?: string;
  args?: string[];
  allowLocalExecution?: boolean;
  maxEvents?: number;
  timeoutMs?: number;
}
export interface AdapterInfo {
  id: string;
  language: string;
  label: string;
  extensions: string[];
  available: boolean;
  reason?: string;
  analysis?: boolean;
  capabilities: Capabilities;
}
export interface LanguageAdapter {
  id: string;
  language: string;
  label: string;
  extensions: string[];
  capabilities: Capabilities;
  detect(): Promise<AdapterInfo>;
  trace(request: TraceRequest, context: RunContext): Promise<TraceEvent[]>;
  analyze?(request: AnalysisRequest, context: RunContext): Promise<Analysis>;
}
export interface RunContext {
  directory: string;
  timeoutMs: number;
  maxEvents: number;
  signal?: AbortSignal;
}
