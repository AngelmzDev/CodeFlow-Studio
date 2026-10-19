import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../src/adapters/index.ts';
import { validateAnalysis } from '../src/core/analysis.ts';
import { startServer } from '../src/server/server.ts';
const registry = await createRegistry();
test('static analysis of Java and Python does not run pasted code or require execution consent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codeflow-analysis-evidence-'));
  const marker = join(dir, 'must-not-exist.txt');
  try {
    const path = JSON.stringify(marker);
    const programs = [
      {
        language: 'python',
        filename: 'pasted.py',
        source:
          'open(' +
          path +
          ', "w").write("ran")\nx = 1\nif x > 0:\n    x += 1\nelse:\n    x = 0\n',
      },
      {
        language: 'java',
        filename: 'Pasted.java',
        source:
          'public class OtroNombre { static { try { java.nio.file.Files.writeString(java.nio.file.Path.of(' +
          path +
          '), "ran"); } catch(Exception ignored){} } public static void main(String[] args) { int x=1; if(x>0){x++;}else{x=0;} } }',
      },
    ];
    for (const program of programs) {
      const analysis = await registry.analyze(program);
      assert.equal(analysis.provenance, 'static');
      assert.equal('events' in analysis, false);
      assert.equal(analysis.source.content, program.source);
      assert.ok(
        analysis.diagrams.some((d) =>
          d.nodes.some((n) => n.kind === 'decision'),
        ),
      );
      assert.ok(
        analysis.diagrams.some(
          (d) =>
            d.edges.some((e) => e.label === 'true') &&
            d.edges.some((e) => e.label === 'false'),
        ),
      );
      await assert.rejects(access(marker));
      if (program.language === 'java') {
        assert.equal(analysis.primaryEntry, 'OtroNombre');
        assert.ok(
          analysis.classes.every((c) =>
            c.methods.every((m) => !m.includes('{')),
          ),
        );
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('static diagrams remain deterministic and reject source/edge mismatches', async () => {
  const request = {
    language: 'python',
    source: 'value = 1\nwhile value < 3:\n    value += 1\n',
    filename: 'repeat.py',
  };
  const first = await registry.analyze(request),
    second = await registry.analyze(request);
  assert.deepEqual(first, second);
  assert.throws(
    () => validateAnalysis(first, { source: 'other', language: 'python' }),
    /does not match source/,
  );
  const malformed = structuredClone(first);
  malformed.diagrams[0].edges[0].to = 'missing';
  assert.throws(() => validateAnalysis(malformed), /activity edge/);
  await assert.rejects(
    registry.analyze({ ...request, filename: '../escape.py' }),
    /plain source filename/,
  );
  await assert.rejects(
    registry.analyze({ ...request, source: 'def broken(:\n' }),
    /Source analysis failed/,
  );
});
test('analysis API requires local session protection but never execution consent', async () => {
  const { server, url } = await startServer({ port: 0 });
  try {
    const request = {
      language: 'python',
      source: 'if ready:\n    print("yes")\nelse:\n    print("no")\n',
    };
    const session = (await (await fetch(url + '/api/session')).json()) as {
      token: string;
    };
    const headers = {
      'Content-Type': 'application/json',
      Origin: url,
      'X-CodeFlow-Token': session.token,
    };
    assert.equal(
      (
        await fetch(url + '/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      ).status,
      403,
    );
    const response = await fetch(url + '/api/analyze', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const analysis = validateAnalysis(await response.json());
    assert.equal(analysis.provenance, 'static');
    assert.ok(analysis.diagrams[0].nodes.some((n) => n.kind === 'decision'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Python static analysis accepts Unicode source and preserves non-ASCII diagram labels', async () => {
  const source = 'mensaje = "¡Hola, estudiante! 🐍"\nprint(mensaje)\n';
  const analysis = await registry.analyze({ language: 'python', source });
  assert.equal(analysis.source.content, source);
  assert.ok(
    analysis.diagrams.some((d) => d.nodes.some((n) => n.label.includes('🐍'))),
  );
});
