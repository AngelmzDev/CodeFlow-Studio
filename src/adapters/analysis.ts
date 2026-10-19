import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, findJava, findPython } from './runtime.ts';
import { runProcess } from './process.ts';
import type { Analysis, AnalysisRequest } from '../core/analysis-types.ts';
import type { RunContext } from '../core/types.ts';

const JAVA_ANALYSIS_BUILD = join(tmpdir(), 'analysis-java-' + process.pid);
let preparation: Promise<void> | undefined;

async function prepareJava(): Promise<void> {
  if (!preparation)
    preparation = (async () => {
      const { javac } = await findJava();
      await mkdir(JAVA_ANALYSIS_BUILD, { recursive: true });
      const result = await runProcess(
        javac,
        [
          '-encoding',
          'UTF-8',
          '-d',
          JAVA_ANALYSIS_BUILD,
          join(ROOT, 'adapters/java/CodeFlowAnalyze.java'),
        ],
        { cwd: ROOT, timeoutMs: 20000 },
      );
      if (result.code !== 0 || result.limited)
        throw new Error(
          'Cannot prepare Java syntax analyzer: ' +
            (result.limited ?? result.stderr),
        );
    })().catch((error) => {
      preparation = undefined;
      throw error;
    });
  return preparation;
}

export async function analyzeWithRuntime(
  request: AnalysisRequest,
  context: RunContext,
): Promise<Analysis> {
  const source = join(context.directory, request.filename!);
  await writeFile(source, request.source, 'utf8');
  let command: string, args: string[];
  if (request.language === 'java') {
    await prepareJava();
    command = (await findJava()).java;
    args = ['-Xmx128m', '-cp', JAVA_ANALYSIS_BUILD, 'CodeFlowAnalyze', source];
  } else if (request.language === 'python') {
    command = await findPython();
    args = [
      '-I',
      '-X',
      'utf8',
      join(ROOT, 'adapters/python/analyze.py'),
      source,
    ];
  } else throw new Error('Static analysis is not available for this adapter');
  const result = await runProcess(command, args, {
    cwd: context.directory,
    timeoutMs: context.timeoutMs,
    maxBytes: 4 * 1024 * 1024,
    signal: context.signal,
  });
  if (result.limited || result.code !== 0)
    throw new Error(
      'Source analysis failed: ' +
        (result.limited ?? (result.stderr || result.stdout)).replaceAll(
          context.directory,
          '<source>',
        ),
    );
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('Syntax analyzer returned invalid JSON');
  }
  if (
    Array.isArray(parsed.diagrams) &&
    parsed.diagrams.length === 0 &&
    Array.isArray(parsed.classes) &&
    parsed.classes.length === 0 &&
    Array.isArray(parsed.diagnostics) &&
    parsed.diagnostics.length
  ) {
    throw new Error('Source analysis failed: ' + parsed.diagnostics.join('\n'));
  }
  return {
    ...parsed,
    schemaVersion: '1.0',
    language: request.language,
    provenance: 'static',
    source: { name: request.filename!, content: request.source },
  } as unknown as Analysis;
}
