import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../adapters/runtime.ts';
import { createRegistry, type AdapterRegistry } from '../adapters/index.ts';
import type { TraceRequest } from '../core/types.ts';
import type { AnalysisRequest, Analysis } from '../core/analysis-types.ts';
import { exportTrace, type ExportFormat } from '../exports/export.ts';
import { createExplanationService } from './explanation.ts';
async function examples() {
  const catalog = JSON.parse(
    await readFile(join(ROOT, 'examples/catalog.json'), 'utf8'),
  ) as {
    language: string;
    filename: string;
    entry?: string;
    stdin?: string;
    label: string;
  }[];
  return Promise.all(
    catalog.map(async (item) => ({
      ...item,
      id: item.language + '/' + item.filename,
      source: await readFile(
        join(ROOT, 'examples', item.language, item.filename),
        'utf8',
      ),
    })),
  );
}
async function body(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  let bytes = 0;
  const parts: Buffer[] = [];
  for await (const part of request) {
    bytes += part.length;
    if (bytes > maxBytes) throw new Error('Request body exceeds size limit');
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new Error('Request body must be JSON');
  }
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}
export async function startServer(
  options: { port?: number; registry?: AdapterRegistry } = {},
) {
  const registry = options.registry ?? (await createRegistry());
  const token = randomBytes(32).toString('hex');
  let busy = false;
  const explanations = createExplanationService();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const actualPort = (server.address() as { port: number })?.port;
    const hosts = new Set([
      '127.0.0.1:' + actualPort,
      'localhost:' + actualPort,
    ]);
    const origins = new Set([
      'http://127.0.0.1:' + actualPort,
      'http://localhost:' + actualPort,
    ]);
    if (
      !hosts.has(request.headers.host ?? '') ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      json(response, 403, { error: 'Only direct localhost access is allowed' });
      return;
    }
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    try {
      if (request.method === 'GET') {
        if (path === '/api/session') {
          json(response, 200, { token });
          return;
        }
        if (path === '/api/explanation/status') {
          json(response, 200, await explanations.status());
          return;
        }
        if (path === '/api/health') {
          json(response, 200, { ok: true });
          return;
        }
        if (path === '/api/adapters') {
          json(response, 200, {
            adapters: await registry.detect(),
            examples: await examples(),
          });
          return;
        }
        const files: Record<string, [string, string]> = {
          '/': ['web/index.html', 'text/html'],
          '/styles.css': ['web/styles.css', 'text/css'],
          '/app.js': ['.build/app.js', 'text/javascript'],
        };
        const file = files[path];
        if (!file) {
          json(response, 404, { error: 'Not found' });
          return;
        }
        response.writeHead(200, {
          'Content-Type': file[1] + '; charset=utf-8',
        });
        response.end(await readFile(join(ROOT, file[0])));
        return;
      }
      if (request.method !== 'POST') {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      const supplied = Buffer.from(
        String(request.headers['x-codeflow-token'] ?? ''),
      );
      if (
        !origins.has(request.headers.origin ?? '') ||
        supplied.length !== token.length ||
        !timingSafeEqual(supplied, Buffer.from(token))
      ) {
        json(response, 403, {
          error: 'A same-origin session token is required',
        });
        return;
      }
      if (
        !(request.headers['content-type'] ?? '').startsWith('application/json')
      ) {
        json(response, 415, { error: 'Use application/json' });
        return;
      }
      if (path === '/api/explain') {
        const input = await body(request, 32 * 1024 * 1024);
        if (!input || typeof input !== 'object')
          throw new Error('Explanation request must be an object');
        const controller = new AbortController();
        response.on('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        json(
          response,
          200,
          await explanations.explain(
            input as Parameters<typeof explanations.explain>[0],
            controller.signal,
          ),
        );
        return;
      }
      if (path === '/api/analyze') {
        const input = await body(request, 256 * 1024);
        if (!input || typeof input !== 'object')
          throw new Error('Source analysis request must be an object');
        const controller = new AbortController();
        response.on('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        json(
          response,
          200,
          await registry.analyze(input as AnalysisRequest, controller.signal),
        );
        return;
      }
      if (path === '/api/trace') {
        if (busy) {
          json(response, 409, {
            error: 'Another local trace is running. Wait for it to finish.',
          });
          return;
        }
        const input = await body(request, 256 * 1024);
        if (!input || typeof input !== 'object')
          throw new Error('Trace request must be an object');
        if (busy) {
          json(response, 409, {
            error: 'Another local trace is running. Wait for it to finish.',
          });
          return;
        }
        busy = true;
        const controller = new AbortController();
        response.on('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        try {
          json(
            response,
            200,
            await registry.run(input as TraceRequest, controller.signal),
          );
        } finally {
          busy = false;
        }
        return;
      }
      if (path === '/api/export') {
        const input = (await body(request, 32 * 1024 * 1024)) as {
          trace: unknown;
          format: ExportFormat;
          index?: number;
          analysis?: Analysis;
        };
        if (!input || !['html', 'svg', 'json'].includes(input.format))
          throw new Error('Choose html, svg or json');
        const output = await exportTrace(
          input.trace as never,
          input.format,
          input.index ?? 0,
          input.analysis,
        );
        const mime = {
          html: 'text/html',
          svg: 'image/svg+xml',
          json: 'application/json',
        }[input.format];
        response.writeHead(200, {
          'Content-Type': mime + '; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="codeflow-trace.' + input.format + '"',
        });
        response.end(output);
        return;
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      if (!response.headersSent)
        json(response, 400, { error: (error as Error).message });
      else response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4310, '127.0.0.1', resolve);
  });
  return {
    server,
    url: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
    registry,
  };
}
