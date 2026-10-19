import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type {
  Capabilities,
  LanguageAdapter,
  AdapterInfo,
  TraceRequest,
  RunContext,
  TraceEvent,
  Trace,
} from '../core/types.ts';
import { validateTrace, deriveChanges } from '../core/trace.ts';
import { ROOT, findJava, findPython } from './runtime.ts';
import { runProcess } from './process.ts';
import { analyzeWithRuntime } from './analysis.ts';
import { validateAnalysis } from '../core/analysis.ts';
import type { Analysis, AnalysisRequest } from '../core/analysis-types.ts';
const baseCapabilities: Capabilities = {
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
  limitations: [
    'Single source file and sequential programs only.',
    'Line stops occur before execution; intermediate values on the same line are not visible.',
    'Snapshots are capped (depth, fields, strings and collection elements).',
    'No exact condition outcomes, loop boundaries, native memory or library stepping.',
    'Trusted local execution with OS permissions; no sandbox.',
  ],
};
abstract class LocalAdapter implements LanguageAdapter {
  abstract id: string;
  abstract language: string;
  abstract label: string;
  abstract extensions: string[];
  capabilities = structuredClone(baseCapabilities);
  abstract available(): Promise<void>;
  abstract trace(
    request: TraceRequest,
    context: RunContext,
  ): Promise<TraceEvent[]>;
  async detect(): Promise<AdapterInfo> {
    try {
      await this.available();
      return {
        id: this.id,
        language: this.language,
        label: this.label,
        extensions: this.extensions,
        available: true,
        analysis: typeof (this as LanguageAdapter).analyze === 'function',
        capabilities: this.capabilities,
      };
    } catch (error) {
      return {
        id: this.id,
        language: this.language,
        label: this.label,
        extensions: this.extensions,
        available: false,
        analysis: false,
        reason: (error as Error).message,
        capabilities: this.capabilities,
      };
    }
  }
}
function parseEvents(
  text: string,
  maxEvents: number,
  reason?: string,
): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      if (!reason) throw new Error('Adapter produced invalid trace data');
    }
  }
  if (reason) {
    const previous = events.at(-1);
    events.push({
      id: '',
      sequence: 0,
      type: 'limit',
      provenance: 'observed',
      frames: previous?.frames ?? [],
      heap: previous?.heap ?? {},
      output: previous?.output ?? { stdout: '', stderr: '' },
      detail: { reason, status: 'limited' },
    });
  }
  if (!events.length) throw new Error('Adapter produced no execution evidence');
  if (events.length > maxEvents + 2) {
    const limited = events.some((e) => e.type === 'limit') || reason;
    const terminal = events.at(-1)!;
    events.splice(maxEvents);
    if (limited)
      events.push({
        ...terminal,
        type: 'limit',
        detail: { reason: 'Event budget exceeded', status: 'limited' },
      });
    events.push({
      ...terminal,
      detail: { ...terminal.detail, ...(limited ? { status: 'limited' } : {}) },
    });
  }
  return events.map((event, sequence) => ({
    ...event,
    id: 'e' + sequence,
    sequence,
    changes: deriveChanges(sequence ? events[sequence - 1] : undefined, event),
  }));
}
const JAVA_BUILD = join(tmpdir(), 'codeflow-java-tracer-' + process.pid);
let compilePromise: Promise<void> | undefined;
export class JavaAdapter extends LocalAdapter {
  id = 'java-jdi';
  language = 'java';
  label = 'Java · JDI';
  extensions = ['.java'];
  async available(): Promise<void> {
    await findJava();
  }
  async analyze(
    request: AnalysisRequest,
    context: RunContext,
  ): Promise<Analysis> {
    return analyzeWithRuntime(request, context);
  }
  private async prepare(): Promise<void> {
    if (!compilePromise)
      compilePromise = (async () => {
        const { javac } = await findJava();
        const output = JAVA_BUILD;
        await mkdir(output, { recursive: true });
        const result = await runProcess(
          javac,
          [
            '--add-modules',
            'jdk.jdi',
            '-g',
            '-d',
            output,
            join(ROOT, 'adapters/java/CodeFlowTracer.java'),
            join(ROOT, 'adapters/java/CodeFlowTarget.java'),
          ],
          { cwd: ROOT, timeoutMs: 20000 },
        );
        if (result.code !== 0 || result.limited)
          throw new Error(
            'Cannot compile Java tracer: ' + (result.limited ?? result.stderr),
          );
      })().catch((error) => {
        compilePromise = undefined;
        throw error;
      });
    await compilePromise;
  }
  async trace(
    request: TraceRequest,
    context: RunContext,
  ): Promise<TraceEvent[]> {
    const { java, javac, major } = await findJava();
    await this.prepare();
    if (
      !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(
        request.entry ?? basename(request.filename, '.java'),
      )
    )
      throw new Error('Entry must be a fully qualified Java class name');
    const file = join(context.directory, request.filename);
    const classes = join(context.directory, 'classes');
    await mkdir(classes);
    await writeFile(file, request.source, 'utf8');
    const compiled = await runProcess(
      javac,
      [
        '-J-Xmx128m',
        '--enable-preview',
        '--release',
        String(major),
        '-g',
        '-encoding',
        'UTF-8',
        '-proc:none',
        '-d',
        classes,
        file,
      ],
      { cwd: context.directory, timeoutMs: 20000, signal: context.signal },
    );
    if (compiled.limited || compiled.code !== 0)
      throw new Error(
        'Java compilation failed:\n' +
          (compiled.limited ?? compiled.stderr).replaceAll(
            context.directory,
            '<source>',
          ),
      );
    const stdin = join(context.directory, 'stdin.txt'),
      args = join(context.directory, 'args.txt');
    await writeFile(stdin, request.stdin ?? '', 'utf8');
    await writeFile(
      args,
      (request.args ?? [])
        .map((s) => Buffer.from(s, 'utf8').toString('base64'))
        .join('\n'),
      'utf8',
    );
    const result = await runProcess(
      java,
      [
        '--add-modules',
        'jdk.jdi',
        '-Xmx128m',
        '-cp',
        JAVA_BUILD,
        'CodeFlowTracer',
        classes,
        request.entry ?? basename(request.filename, '.java'),
        stdin,
        args,
        String(context.maxEvents),
        String(context.timeoutMs),
      ],
      {
        cwd: context.directory,
        timeoutMs: context.timeoutMs + 5000,
        signal: context.signal,
      },
    );
    if (result.code !== 0 && !result.limited)
      throw new Error('Java debugger failed:\n' + result.stderr);
    return parseEvents(result.stdout, context.maxEvents, result.limited);
  }
}
export class PythonAdapter extends LocalAdapter {
  id = 'python-trace';
  language = 'python';
  label = 'Python · sys.settrace';
  extensions = ['.py'];
  constructor() {
    super();
    this.capabilities.limitations.push(
      'User tracing hooks can be changed by target code. Python has no enforced heap limit.',
      'Dynamic property evaluation is not supported; generator/coroutine source is rejected before execution. Imported and dynamically generated code are not stepped into.',
    );
  }
  async available(): Promise<void> {
    await findPython();
  }
  async analyze(
    request: AnalysisRequest,
    context: RunContext,
  ): Promise<Analysis> {
    return analyzeWithRuntime(request, context);
  }
  async trace(
    request: TraceRequest,
    context: RunContext,
  ): Promise<TraceEvent[]> {
    const python = await findPython();
    const source = join(context.directory, request.filename);
    const stdin = join(context.directory, 'stdin.txt');
    await writeFile(source, request.source, 'utf8');
    await writeFile(stdin, request.stdin ?? '', 'utf8');
    const result = await runProcess(
      python,
      [
        '-I',
        join(ROOT, 'adapters/python/tracer.py'),
        source,
        stdin,
        String(context.maxEvents),
        ...(request.args ?? []),
      ],
      {
        cwd: context.directory,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
      },
    );
    if (result.code !== 0 && !result.limited)
      throw new Error('Python tracer failed:\n' + result.stderr);
    return parseEvents(result.stdout, context.maxEvents, result.limited);
  }
}
export class AdapterRegistry {
  private adapters: LanguageAdapter[] = [];
  register(adapter: LanguageAdapter): void {
    if (
      !adapter.id ||
      !adapter.language ||
      typeof adapter.trace !== 'function' ||
      typeof adapter.detect !== 'function'
    )
      throw new Error('Invalid language adapter');
    if (
      this.adapters.some(
        (a) => a.id === adapter.id || a.language === adapter.language,
      )
    )
      throw new Error('Adapter already registered: ' + adapter.language);
    this.adapters.push(adapter);
  }
  async detect(): Promise<AdapterInfo[]> {
    return Promise.all(this.adapters.map((a) => a.detect()));
  }
  get(language: string): LanguageAdapter {
    const adapter = this.adapters.find((a) => a.language === language);
    if (!adapter)
      throw new Error('No working adapter registered for ' + language);
    return adapter;
  }
  infer(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const adapter = this.adapters.find((a) => a.extensions.includes(ext));
    if (!adapter) throw new Error('No adapter registered for ' + ext);
    return adapter.language;
  }
  async analyze(
    request: AnalysisRequest,
    signal?: AbortSignal,
  ): Promise<Analysis> {
    if (
      typeof request.source !== 'string' ||
      !request.source.trim() ||
      request.source.length > 100000 ||
      request.source.split('\n').length > 10000
    )
      throw new Error(
        'Source must contain 1–100,000 characters and at most 10,000 lines',
      );
    const adapter = this.get(request.language);
    if (!adapter.analyze)
      throw new Error(
        'Static diagrams are not available for this language adapter',
      );
    const filename = request.filename ?? 'Program' + adapter.extensions[0];
    if (
      !/^[-\w.]{1,100}$/.test(filename) ||
      filename.startsWith('.') ||
      basename(filename) !== filename
    )
      throw new Error(
        'Filename must be a plain source filename, without directories',
      );
    const detected = await adapter.detect();
    if (!detected.available) throw new Error(detected.reason);
    const directory = await mkdtemp(join(tmpdir(), 'codeflow-analysis-'));
    try {
      return validateAnalysis(
        await adapter.analyze(
          { ...request, filename },
          { directory, maxEvents: 2000, timeoutMs: 10000, signal },
        ),
        { source: request.source, language: request.language },
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  async run(request: TraceRequest, signal?: AbortSignal): Promise<Trace> {
    if (request.allowLocalExecution !== true)
      throw new Error(
        'Local execution requires explicit allowLocalExecution consent',
      );
    if (
      typeof request.source !== 'string' ||
      !request.source.trim() ||
      request.source.length > 100000
    )
      throw new Error('Source must contain 1–100,000 characters');
    if (
      typeof request.filename !== 'string' ||
      !/^[-\w.]{1,100}$/.test(request.filename) ||
      request.filename.startsWith('.') ||
      basename(request.filename) !== request.filename
    )
      throw new Error(
        'Filename must be a plain source filename, without directories',
      );
    if (
      request.args !== undefined &&
      (!Array.isArray(request.args) ||
        request.args.length > 50 ||
        !request.args.every(
          (a) => typeof a === 'string' && a.length <= 4096 && !a.includes('\0'),
        ))
    )
      throw new Error('Arguments must be an array of at most 50 strings');
    if (
      request.stdin !== undefined &&
      (typeof request.stdin !== 'string' || request.stdin.length > 32768)
    )
      throw new Error('Standard input must be at most 32,768 characters');
    const maxEvents = request.maxEvents ?? 2000,
      timeoutMs = request.timeoutMs ?? 10000;
    if (
      !Number.isInteger(maxEvents) ||
      maxEvents < 2 ||
      maxEvents > 10000 ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 250 ||
      timeoutMs > 30000
    )
      throw new Error('Limits: 2–10,000 events and 250–30,000 ms');
    const adapter = this.get(request.language);
    if (!adapter.extensions.includes(extname(request.filename)))
      throw new Error('Filename extension does not match adapter');
    const detected = await adapter.detect();
    if (!detected.available) throw new Error(detected.reason);
    const directory = await mkdtemp(join(tmpdir(), 'codeflow-'));
    try {
      const events = await adapter.trace(request, {
        directory,
        maxEvents,
        timeoutMs,
        signal,
      });
      if (!['terminated', 'limit'].includes(events.at(-1)?.type ?? ''))
        throw new Error('Adapter ended without a termination record');
      const status = events.some(
        (e) => e.type === 'limit' || e.detail?.status === 'limited',
      )
        ? 'limited'
        : events.at(-1)?.detail?.status === 'exception'
          ? 'exception'
          : 'completed';
      const trace: Trace = {
        schemaVersion: '1.0',
        language: adapter.language,
        adapter: {
          id: adapter.id,
          version: '0.1.0',
          capabilities: adapter.capabilities,
        },
        sources: [
          { id: 'main', name: request.filename, content: request.source },
        ],
        events,
        status,
        limits: { maxEvents, timeoutMs },
        diagnostics:
          status === 'limited'
            ? [
                'Execution stopped at a resource limit. This is a partial trace.',
              ]
            : [],
      };
      return validateTrace(trace);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
export async function createRegistry(
  pluginPaths: string[] = [],
): Promise<AdapterRegistry> {
  const registry = new AdapterRegistry();
  registry.register(new PythonAdapter());
  registry.register(new JavaAdapter());
  for (const path of pluginPaths) {
    const plugin = await import(pathToFileURL(resolve(path)).href);
    registry.register(plugin.default);
  }
  return registry;
}
export async function loadExample(
  language: string,
  filename: string,
): Promise<string> {
  return readFile(join(ROOT, 'examples', language, filename), 'utf8');
}
