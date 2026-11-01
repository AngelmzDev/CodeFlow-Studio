import assert from 'node:assert/strict';
import { createRegistry } from '../src/adapters/index.ts';
import { exportTrace } from '../src/exports/export.ts';
import { startServer } from '../src/server/server.ts';
import { ROOT, findJava, findPython } from '../src/adapters/runtime.ts';
const registry = await createRegistry();
const adapters = await registry.detect();
assert.equal(
  adapters.filter((a) => a.available).length,
  2,
  JSON.stringify(adapters),
);
const python = await findPython();
const java = await findJava();
assert.ok(python.startsWith(ROOT));
assert.ok(java.java.startsWith(ROOT));
for (const language of ['python', 'java']) {
  const source =
    language === 'python'
      ? 'total = 1\ntotal += 1\nprint(total)\n'
      : 'public class Main { public static void main(String[] args) { int total=1; total+=1; System.out.println(total); } }';
  const filename = language === 'python' ? 'main.py' : 'Main.java';
  const analysis = await registry.analyze({ language, source, filename });
  assert.ok(analysis.diagrams.length);
  const trace = await registry.run({
    language,
    source,
    filename,
    entry: language === 'java' ? 'Main' : undefined,
    allowLocalExecution: true,
  });
  assert.equal(trace.status, 'completed', JSON.stringify(trace.diagnostics));
  assert.ok(trace.events.some((e) => e.output?.stdout.includes('2')));
  const html = await exportTrace(trace, 'html', 0, analysis);
  assert.ok(html.includes('embedded-trace') && html.includes('step-guide'));
}
const { server, url } = await startServer({ port: 0, registry });
try {
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + '/api/health')).status, 200);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
console.log(
  JSON.stringify(
    {
      ok: true,
      root: ROOT,
      python,
      java: java.java,
      checks: [
        'python trace',
        'java trace',
        'static analysis',
        'offline export',
        'http server',
      ],
    },
    null,
    2,
  ),
);
