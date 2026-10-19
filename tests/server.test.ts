import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/server.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let token: string;

before(async () => {
  server = await startServer({ port: 0 });
  const response = await fetch(server.url + '/api/session');
  assert.equal(response.status, 200);
  token = ((await response.json()) as { token: string }).token;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.server.close((error) => (error ? reject(error) : resolve())),
  );
});

function post(
  path: string,
  body: string,
  options: { origin?: string; token?: string; contentType?: string } = {},
) {
  return fetch(server.url + path, {
    method: 'POST',
    headers: {
      Origin: options.origin ?? server.url,
      'X-CodeFlow-Token': options.token ?? token,
      'Content-Type': options.contentType ?? 'application/json',
    },
    body,
  });
}

test('serves health and rejects unknown static paths', async () => {
  const health = await fetch(server.url + '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const traversal = await fetch(server.url + '/%2e%2e/README.md');
  assert.equal(traversal.status, 404);
});

test('requires a same-origin session token and JSON for POST requests', async () => {
  const foreign = await post('/api/trace', '{}', {
    origin: 'https://attacker.invalid',
  });
  assert.equal(foreign.status, 403);
  const missingToken = await post('/api/trace', '{}', { token: '' });
  assert.equal(missingToken.status, 403);
  const wrongType = await post('/api/trace', '{}', {
    contentType: 'text/plain',
  });
  assert.equal(wrongType.status, 415);
});

test('returns structured errors for malformed trace and export payloads', async () => {
  const malformedJson = await post('/api/trace', '{');
  assert.equal(malformedJson.status, 400);
  assert.match(
    ((await malformedJson.json()) as { error: string }).error,
    /JSON/,
  );

  const emptyTrace = await post(
    '/api/trace',
    JSON.stringify({
      language: 'python',
      filename: 'empty.py',
      source: '',
      allowLocalExecution: true,
    }),
  );
  assert.equal(emptyTrace.status, 400);

  const malformedExport = await post(
    '/api/export',
    JSON.stringify({ trace: {}, format: 'html' }),
  );
  assert.equal(malformedExport.status, 400);
});

test('runs an authorized same-origin Python trace and exports it as offline HTML', async () => {
  const traced = await post(
    '/api/trace',
    JSON.stringify({
      language: 'python',
      filename: 'server_example.py',
      source: 'value = [2, 3, 5]\nprint(sum(value))\n',
      allowLocalExecution: true,
    }),
  );
  assert.equal(traced.status, 200, JSON.stringify(await traced.clone().json()));
  const trace = (await traced.json()) as {
    language: string;
    events: { output: { stdout: string } }[];
  };
  assert.equal(trace.language, 'python');
  assert.equal(
    trace.events.at(-1)?.output.stdout.replace(/\r\n/g, '\n'),
    '10\n',
  );

  const exported = await post(
    '/api/export',
    JSON.stringify({ trace, format: 'html', index: 0 }),
  );
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type') ?? '', /text\/html/);
  const html = await exported.text();
  assert.match(html, /embedded-trace/);
  assert.match(html, /server_example\.py/);
});

test('rejects a simultaneous trace while the first execution is still running', async () => {
  const first = post(
    '/api/trace',
    JSON.stringify({
      language: 'python',
      filename: 'slow_server_example.py',
      source: "import time\ntime.sleep(1)\nprint('done')\n",
      allowLocalExecution: true,
      timeoutMs: 5000,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = await post(
    '/api/trace',
    JSON.stringify({
      language: 'python',
      filename: 'second_server_example.py',
      source: "print('second')\n",
      allowLocalExecution: true,
    }),
  );
  assert.equal(second.status, 409);
  const completed = await first;
  assert.equal(completed.status, 200);
});
