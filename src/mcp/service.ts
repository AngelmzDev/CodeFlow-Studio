import type { AdapterRegistry } from '../adapters/index.ts';
import { createRegistry } from '../adapters/index.ts';
import { validateTrace } from '../core/trace.ts';
import { explainStep } from '../core/explanation.ts';
import { exportTrace, type ExportFormat } from '../exports/export.ts';
import {
  renderActivitySvg,
  renderClassSvg,
} from '../visualization/activity.ts';
import type { Trace } from '../core/types.ts';
import {
  consumeExecutionGrant,
  normalizeExecution,
  type AuthorizedExecution,
} from './security.ts';

export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RESULT_BYTES = 900 * 1024;

export type AnalyzeInput = {
  language: 'java' | 'python';
  source: string;
  filename?: string;
  entry?: string;
};

export type TraceInput = AuthorizedExecution & { grantId: string };

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function bounded<T>(value: T): T {
  if (byteLength(value) > MAX_RESULT_BYTES)
    throw new Error(
      'Result exceeds the MCP output limit; request a smaller trace',
    );
  return value;
}

function assertTraceInput(value: unknown): Trace {
  if (byteLength(value) > MAX_INPUT_BYTES)
    throw new Error('Trace input exceeds the MCP limit');
  return validateTrace(value);
}

export class CodeFlowService {
  private readonly registry: AdapterRegistry;

  constructor(registry: AdapterRegistry) {
    this.registry = registry;
  }

  async analyze(input: AnalyzeInput, signal?: AbortSignal) {
    const analysis = await this.registry.analyze(input, signal);
    return bounded({
      kind: 'static-analysis' as const,
      provenance: 'static' as const,
      analysis,
    });
  }

  async diagram(
    input: AnalyzeInput & {
      diagramType?: 'activity' | 'class';
      diagramId?: string;
      theme?: 'light' | 'dark';
      locale?: 'es' | 'en';
    },
    signal?: AbortSignal,
  ) {
    const analysis = await this.registry.analyze(input, signal);
    const type = input.diagramType ?? 'activity';
    if (type === 'class') {
      if (!analysis.classes.length)
        throw new Error('No class diagram is available for this source');
      return bounded({
        kind: 'diagram' as const,
        provenance: 'static' as const,
        diagramType: 'class' as const,
        format: 'svg' as const,
        content: renderClassSvg(analysis.classes, {
          theme: input.theme,
          locale: input.locale,
        }),
      });
    }
    const id = input.diagramId ?? analysis.defaultDiagramId;
    const diagram = analysis.diagrams.find((item) => item.id === id);
    if (!diagram) throw new Error('Requested activity diagram is unavailable');
    return bounded({
      kind: 'diagram' as const,
      provenance: 'static' as const,
      diagramType: 'activity' as const,
      diagramId: diagram.id,
      format: 'svg' as const,
      content: renderActivitySvg(diagram, {
        theme: input.theme,
        locale: input.locale,
        source: analysis.source.content,
      }),
    });
  }

  async trace(input: TraceInput, signal?: AbortSignal) {
    const normalized = normalizeExecution(input);
    await consumeExecutionGrant(input.grantId, normalized);
    const trace = await this.registry.run(
      { ...normalized, allowLocalExecution: true },
      signal,
    );
    return bounded({
      kind: 'execution-trace' as const,
      provenance: 'observed' as const,
      trace,
    });
  }

  variables(input: { trace: unknown; index: number }) {
    const trace = assertTraceInput(input.trace);
    if (
      !Number.isInteger(input.index) ||
      input.index < 0 ||
      input.index >= trace.events.length
    )
      throw new Error('Event index is out of range');
    const event = trace.events[input.index]!;
    return bounded({
      kind: 'variables' as const,
      provenance: 'observed' as const,
      index: input.index,
      eventId: event.id,
      location: event.location ?? null,
      frames: event.frames,
      heap: event.heap,
      changes: event.changes ?? [],
      output: event.output,
    });
  }

  explain(input: {
    trace: unknown;
    index: number;
    locale?: 'es' | 'en';
    detail?: 'brief' | 'detailed';
  }) {
    const trace = assertTraceInput(input.trace);
    return bounded({
      kind: 'explanation' as const,
      provenance: 'derived-from-observed-trace' as const,
      explanation: explainStep(trace, input.index, {
        locale: input.locale,
        detail: input.detail,
      }),
    });
  }

  async export(input: {
    trace: unknown;
    format: ExportFormat;
    index?: number;
  }) {
    const trace = assertTraceInput(input.trace);
    const content = await exportTrace(trace, input.format, input.index ?? 0);
    const mimeType =
      input.format === 'json'
        ? 'application/json'
        : input.format === 'svg'
          ? 'image/svg+xml'
          : 'text/html';
    return bounded({
      kind: 'export' as const,
      provenance: 'derived-from-observed-trace' as const,
      format: input.format,
      mimeType,
      content,
    });
  }
}

export async function createCodeFlowService(): Promise<CodeFlowService> {
  return new CodeFlowService(await createRegistry());
}
