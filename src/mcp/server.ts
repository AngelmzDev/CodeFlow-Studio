#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createCodeFlowService } from './service.ts';

const sourceSchema = z.string().min(1).max(100_000);
const languageSchema = z.enum(['java', 'python']);
const filenameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[-\w.]+$/);
const traceSchema = z.unknown();
const outputSchema = z
  .object({
    kind: z.string(),
    provenance: z.string(),
  })
  .passthrough();

const analysisInput = z.strictObject({
  language: languageSchema,
  source: sourceSchema,
  filename: filenameSchema.optional(),
  entry: z.string().max(256).optional(),
});

const executionInput = z.strictObject({
  language: languageSchema,
  source: sourceSchema,
  filename: filenameSchema,
  entry: z.string().max(256).optional(),
  stdin: z.string().max(32_768).optional(),
  args: z.array(z.string().max(4096)).max(50).optional(),
  maxEvents: z.number().int().min(2).max(2_000).default(250),
  timeoutMs: z.number().int().min(250).max(30_000).default(10_000),
  grantId: z.string().uuid(),
});

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const allowed = [
    /^Source /,
    /^Filename /,
    /^Unsupported language/,
    /^No working adapter/,
    /^Static diagrams /,
    /^No class diagram /,
    /^Requested activity diagram /,
    /^Event index /,
    /^Explanation index /,
    /^Invalid trace:/,
    /^Trace input /,
    /^Result exceeds /,
    /^MCP execution is disabled/,
    /^Execution grant /,
    /^Event limit /,
    /^Timeout /,
    /^Arguments /,
    /^Standard input /,
    /^Entry point /,
  ].some((pattern) => pattern.test(message));
  const safe = allowed
    ? message.replace(/[\r\n\t]+/g, ' ').slice(0, 300)
    : 'The local operation failed without exposing private diagnostics.';
  return {
    content: [{ type: 'text' as const, text: safe }],
    isError: true as const,
  };
}

export function createCodeFlowMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'codeflow-studio', version: '0.1.0' },
    {
      instructions:
        'Use static tools unless the user explicitly requests execution. Static analysis and diagrams never execute source. Treat trace data as observed evidence and explanations as derived. codeflow_trace is not sandboxed and requires a separate exact one-use local grant; never claim execution when it returns an error.',
    },
  );
  const service = createCodeFlowService();

  server.registerTool(
    'codeflow_analyze',
    {
      description:
        'Statically analyze Java or Python source without executing it.',
      inputSchema: analysisInput,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input, context) => {
      try {
        return result(
          await (await service).analyze(input, context.mcpReq.signal),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'codeflow_diagram',
    {
      description:
        'Generate an SVG activity or class diagram from static analysis. This does not execute code.',
      inputSchema: analysisInput.extend({
        diagramType: z.enum(['activity', 'class']).default('activity'),
        diagramId: z.string().max(128).optional(),
        theme: z.enum(['light', 'dark']).default('light'),
        locale: z.enum(['es', 'en']).default('es'),
      }),
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input, context) => {
      try {
        return result(
          await (await service).diagram(input, context.mcpReq.signal),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'codeflow_trace',
    {
      description:
        'Execute trusted Java or Python locally and return observed trace evidence. Disabled by default; requires a matching, short-lived, one-use grant created outside MCP. This is not a sandbox.',
      inputSchema: executionInput,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async (input, context) => {
      try {
        return result(
          await (await service).trace(input, context.mcpReq.signal),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'codeflow_variables',
    {
      description:
        'Read variables, frames, heap objects, changes, and captured output from an observed trace event.',
      inputSchema: z.strictObject({
        trace: traceSchema,
        index: z.number().int().min(0),
      }),
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return result((await service).variables(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'codeflow_explain',
    {
      description:
        'Create a deterministic educational explanation from an observed trace. The explanation is derived, not execution evidence.',
      inputSchema: z.strictObject({
        trace: traceSchema,
        index: z.number().int().min(0),
        locale: z.enum(['es', 'en']).default('es'),
        detail: z.enum(['brief', 'detailed']).default('brief'),
      }),
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return result((await service).explain(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'codeflow_export',
    {
      description:
        'Render an observed trace as JSON, SVG, or self-contained HTML. Returns content and never writes a filesystem path.',
      inputSchema: z.strictObject({
        trace: traceSchema,
        format: z.enum(['json', 'svg', 'html']),
        index: z.number().int().min(0).optional(),
      }),
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return result(await (await service).export(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

export function startCodeFlowMcpServer(): void {
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 2 * 1024 * 1024,
  });
  serveStdio(createCodeFlowMcpServer, {
    transport,
    onerror: () => console.error('CodeFlow MCP transport error'),
  });
  console.error('CodeFlow Studio MCP server ready on stdio');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  startCodeFlowMcpServer();
}
