import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Trace } from '../core/types.ts';
import { validateTrace } from '../core/trace.ts';
import type { Analysis } from '../core/analysis-types.ts';
import { validateAnalysis } from '../core/analysis.ts';
import { renderStateSvg } from '../visualization/views.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
export type ExportFormat = 'html' | 'svg' | 'json';
export async function exportTrace(
  input: Trace,
  format: ExportFormat,
  index = 0,
  analysisInput?: Analysis,
): Promise<string> {
  const trace = validateTrace(input);
  const analysis =
    analysisInput === undefined
      ? undefined
      : validateAnalysis(analysisInput, {
          source: trace.sources[0].content,
          language: trace.language,
        });
  if (!Number.isInteger(index))
    throw new Error('Event index must be an integer');
  const selected = Math.max(0, Math.min(trace.events.length - 1, index));
  if (format === 'json') return JSON.stringify(trace, null, 2) + '\n';
  if (format === 'svg') return renderStateSvg(trace.events[selected]);
  if (format !== 'html') throw new Error('Unsupported export format');
  const [html, css, js] = await Promise.all(
    ['web/index.html', 'web/styles.css', '.build/app.js'].map((p) =>
      readFile(resolve(root, p), 'utf8'),
    ),
  );
  const data = JSON.stringify(trace).replace(
    /[<>&\u2028\u2029]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  const analysisData = analysis
    ? JSON.stringify(analysis).replace(
        /[<>&\u2028\u2029]/g,
        (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
      )
    : undefined;
  return html
    .replace(
      /<link[^>]+href=["'][^"']*styles.css["'][^>]*>/i,
      () => '<style>' + css + '</style>',
    )
    .replace(
      /<script[^>]+src=["'][^"']*app.js["'][^>]*>\s*<\/script>/i,
      () =>
        '<script id="embedded-trace" data-event-index="' +
        selected +
        '" type="application/json">' +
        data +
        '</script>' +
        (analysisData === undefined
          ? ''
          : '<script id="embedded-analysis" type="application/json">' +
            analysisData +
            '</script>') +
        '<script type="module">' +
        js.replace(/<\/script/gi, '<\\/script') +
        '</script>',
    );
}
