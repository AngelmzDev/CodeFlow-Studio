import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRegistry } from '../src/adapters/index.ts';
import type { Trace } from '../src/core/types.ts';
import { ROOT } from '../src/adapters/runtime.ts';
import { CodeFlowService } from '../src/mcp/service.ts';
import {
  consumeExecutionGrant,
  createExecutionGrant,
  type AuthorizedExecution,
} from '../src/mcp/security.ts';

const execution: AuthorizedExecution = {
  language: 'python',
  filename: 'example.py',
  source: 'value = 1\n',
  maxEvents: 50,
  timeoutMs: 2_000,
};

function mcpTestEnvironment(): Record<string, string> {
  const allowed = [
    'PATH',
    'Path',
    'SystemRoot',
    'ComSpec',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'XDG_RUNTIME_DIR',
    'CODEFLOW_PYTHON',
    'CODEFLOW_JAVA_HOME',
    'JAVA_HOME',
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

const capabilities = {
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

const trace: Trace = {
  schemaVersion: '1.0',
  language: 'python',
  adapter: { id: 'test', version: '1.0.0', capabilities },
  sources: [{ id: 'main', name: 'example.py', content: 'value = 1\n' }],
  events: [
    {
      id: 'e0',
      sequence: 0,
      type: 'line',
      provenance: 'observed',
      location: { sourceId: 'main', line: 1 },
      frames: [
        {
          id: 'f0',
          name: '<module>',
          location: { sourceId: 'main', line: 1 },
          locals: {},
        },
      ],
      heap: {},
      output: { stdout: '', stderr: '' },
    },
    {
      id: 'e1',
      sequence: 1,
      type: 'terminated',
      provenance: 'observed',
      frames: [],
      heap: {},
      output: { stdout: '', stderr: '' },
      detail: { status: 'completed' },
    },
  ],
  status: 'completed',
  limits: { maxEvents: 50, timeoutMs: 2_000 },
  diagnostics: [],
};

test('execution grants are exact, short-lived, and one-use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeflow-mcp-grants-'));
  const previous = process.env.CODEFLOW_MCP_EXECUTION;
  process.env.CODEFLOW_MCP_EXECUTION = 'authorized';
  try {
    const grant = await createExecutionGrant(execution, {
      directory,
      now: 1_000,
    });
    await consumeExecutionGrant(grant.grantId, execution, {
      directory,
      now: 2_000,
    });
    await assert.rejects(
      consumeExecutionGrant(grant.grantId, execution, {
        directory,
        now: 2_000,
      }),
      /unavailable/,
    );

    const mismatch = await createExecutionGrant(execution, {
      directory,
      now: 1_000,
    });
    await assert.rejects(
      consumeExecutionGrant(
        mismatch.grantId,
        { ...execution, source: 'value = 2\n' },
        { directory, now: 2_000 },
      ),
      /does not match/,
    );

    const expired = await createExecutionGrant(execution, {
      directory,
      now: 1_000,
    });
    await assert.rejects(
      consumeExecutionGrant(expired.grantId, execution, {
        directory,
        now: 1_000 + 5 * 60 * 1_000 + 1,
      }),
      /does not match/,
    );
  } finally {
    if (previous === undefined) delete process.env.CODEFLOW_MCP_EXECUTION;
    else process.env.CODEFLOW_MCP_EXECUTION = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('read-only MCP services preserve evidence provenance', async () => {
  const service = new CodeFlowService(await createRegistry());
  const variables = service.variables({ trace, index: 0 });
  assert.equal(variables.provenance, 'observed');
  assert.equal(variables.eventId, 'e0');

  const explanation = service.explain({ trace, index: 0, locale: 'en' });
  assert.equal(explanation.provenance, 'derived-from-observed-trace');
  assert.match(explanation.explanation.notes[0]!, /does not establish/);

  const exported = await service.export({ trace, format: 'json' });
  assert.equal(exported.mimeType, 'application/json');
  assert.equal(JSON.parse(exported.content).events[0].provenance, 'observed');
});

test('MCP stdio exposes the six CodeFlow tools and keeps execution disabled', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp/server.ts'],
    cwd: ROOT,
    env: mcpTestEnvironment(),
    stderr: 'pipe',
    maxBufferSize: 2 * 1024 * 1024,
  });
  const client = new Client({ name: 'codeflow-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'codeflow_analyze',
      'codeflow_diagram',
      'codeflow_explain',
      'codeflow_export',
      'codeflow_trace',
      'codeflow_variables',
    ]);
    const denied = await client.callTool({
      name: 'codeflow_trace',
      arguments: {
        ...execution,
        grantId: '00000000-0000-4000-8000-000000000000',
      },
    });
    assert.equal(denied.isError, true);
    assert.match((denied.content[0] as { text: string }).text, /disabled/);

    if (process.env.CODEFLOW_PYTHON) {
      const source = 'value = 1\nif value:\n    print(value)\n';
      const analyzed = await client.callTool({
        name: 'codeflow_analyze',
        arguments: { language: 'python', filename: 'lesson.py', source },
      });
      assert.notEqual(analyzed.isError, true);
      assert.equal(
        (analyzed.structuredContent as { provenance: string }).provenance,
        'static',
      );
      const diagram = await client.callTool({
        name: 'codeflow_diagram',
        arguments: { language: 'python', filename: 'lesson.py', source },
      });
      assert.notEqual(diagram.isError, true);
      assert.match(
        (diagram.structuredContent as { content: string }).content,
        /^<svg/,
      );
    }
  } finally {
    await client.close();
  }
});

test('static analysis and SVG diagrams are available through the shared registry', async (t) => {
  const registry = await createRegistry();
  const python = (await registry.detect()).find(
    (item) => item.language === 'python',
  );
  if (!python?.available) {
    t.skip('Python is unavailable in this environment');
    return;
  }
  const service = new CodeFlowService(registry);
  const analysis = await service.analyze({
    language: 'python',
    filename: 'lesson.py',
    source: 'value = 1\nif value:\n    print(value)\n',
  });
  assert.equal(analysis.provenance, 'static');
  const diagram = await service.diagram({
    language: 'python',
    filename: 'lesson.py',
    source: 'value = 1\nif value:\n    print(value)\n',
  });
  assert.equal(diagram.provenance, 'static');
  assert.match(diagram.content, /^<svg/);
});
