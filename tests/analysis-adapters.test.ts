import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findJava, findPython, ROOT } from '../src/adapters/runtime.ts';

const pythonAnalyzer = join(ROOT, 'adapters', 'python', 'analyze.py');
const javaAnalyzer = join(ROOT, 'adapters', 'java', 'CodeFlowAnalyze.java');

async function harness(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'codeflow-analysis-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [python, java] = await Promise.all([findPython(), findJava()]);
  const compiled = spawnSync(java.javac, ['-d', dir, javaAnalyzer], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(compiled.status, 0, compiled.stderr);
  async function analyze(language: 'python' | 'java', source: string) {
    const filename = language === 'python' ? 'sample.py' : 'Main.java';
    const file = join(dir, `${language}-${filename}`);
    await writeFile(file, source, 'utf8');
    const run =
      language === 'python'
        ? spawnSync(python, ['-I', pythonAnalyzer, file], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
          })
        : spawnSync(java.java, ['-cp', dir, 'CodeFlowAnalyze', file], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
          });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    return JSON.parse(run.stdout) as {
      source: { content: string };
      diagrams: Array<{
        id: string;
        label: string;
        nodes: Array<{ id: string; kind: string; label: string; line: number }>;
        edges: Array<{ from: string; to: string; label?: string }>;
        warnings: string[];
      }>;
      classes: Array<{
        name: string;
        fields: string[];
        methods: string[];
        extends: string[];
        implements: string[];
      }>;
      diagnostics: string[];
      defaultDiagramId: string;
      primaryEntry?: string;
    };
  }
  return { analyze, dir };
}

test('Python AST analysis models branches, nested loops, transfer, and returns', async (t) => {
  const { analyze } = await harness(t);
  const source = `def choose(items):
    total = 0
    for item in items:
        if item < 0:
            continue
        if item == 0:
            break
        total += item
    if total:
        return total
    return 0
`;
  const result = await analyze('python', source);
  const diagram = result.diagrams[0]!;
  assert.equal(diagram.id, 'choose@1');
  assert.ok(diagram.nodes.some((n) => n.kind === 'decision'));
  assert.ok(diagram.nodes.some((n) => n.label.startsWith('continue')));
  assert.ok(diagram.nodes.some((n) => n.label.startsWith('break')));
  assert.equal(diagram.nodes.filter((n) => n.kind === 'return').length, 2);
  assert.ok(diagram.edges.some((e) => e.label === 'repeat'));
  const returnIds = new Set(
    diagram.nodes.filter((n) => n.kind === 'return').map((n) => n.id),
  );
  assert.ok(
    [...returnIds].every((id) =>
      diagram.edges.some(
        (e) =>
          e.from === id &&
          e.to === diagram.nodes.find((n) => n.kind === 'end')!.id,
      ),
    ),
  );
  assert.equal(result.source.content, source);
});

test('Python warns on loop else and with while keeping loop guards explicit', async (t) => {
  const { analyze } = await harness(t);
  const source = `def loop(xs):
    for item in xs:
        work(item)
    else:
        finished()
    with resource() as handle:
        read(handle)
def plain(xs):
    while ready():
        work(xs)
`;
  const result = await analyze('python', source);
  const loop = result.diagrams.find((d) => d.label === 'loop')!;
  assert.ok(loop.warnings.some((w) => w.includes('loop with else')));
  assert.ok(loop.warnings.some((w) => w.includes('With')));
  assert.ok(
    loop.nodes.some((n) => n.kind === 'note' && n.label.includes('else')),
  );
  const plain = result.diagrams.find((d) => d.label === 'plain')!;
  const decision = plain.nodes.find((n) => n.kind === 'decision')!;
  assert.ok(
    plain.edges.some((e) => e.from === decision.id && e.label === 'true'),
  );
});

test('Python repeated function names receive unique diagram IDs', async (t) => {
  const { analyze } = await harness(t);
  const result = await analyze(
    'python',
    'def same():\n    pass\ndef same():\n    pass\n',
  );
  const same = result.diagrams.filter((d) => d.label === 'same');
  assert.equal(same.length, 2);
  assert.equal(new Set(same.map((d) => d.id)).size, 2);
});

test('Java parser reports class metadata, main entry, and source-aligned static flow', async (t) => {
  const { analyze } = await harness(t);
  const source = `package demo;
class Main extends Base implements Runnable {
  int count;
  public static void main(String[] args) {
    int i = 0;
    do {
      if (i++ > 2) continue;
      if (i == 2) break;
    } while (i < 5);
    return;
  }
  public void run() {
    for (int j = 0; j < 3; j++) {
      if (j == 1) continue;
      System.out.println(j);
    }
  }
}`;
  const result = await analyze('java', source);
  assert.equal(result.primaryEntry, 'demo.Main');
  assert.equal(result.defaultDiagramId, 'demo.Main.main(String[])');
  assert.equal(result.classes[0]?.name, 'demo.Main');
  assert.deepEqual(result.classes[0]?.extends, ['Base']);
  assert.deepEqual(result.classes[0]?.implements, ['Runnable']);
  assert.ok(result.classes[0]?.fields.some((x) => x.includes('count')));
  assert.ok(
    result.classes[0]?.methods.some((x) =>
      x.includes('public static void main(String[] args)'),
    ),
  );
  assert.ok(result.classes[0]?.methods.every((x) => !x.includes('{')));
  const diagram = result.diagrams.find((d) => d.id.includes('main('))!;
  assert.ok(
    diagram.nodes.some(
      (n) => n.kind === 'decision' && n.label.includes('i < 5'),
    ),
  );
  assert.ok(diagram.edges.some((e) => e.label === 'true'));
  assert.ok(diagram.edges.some((e) => e.label === 'false'));
  const forDiagram = result.diagrams.find((d) => d.id.includes('run('))!;
  const update = forDiagram.nodes.find(
    (n) => n.kind === 'action' && n.label.includes('j++'),
  )!;
  const continueNode = forDiagram.nodes.find((n) =>
    n.label.startsWith('continue'),
  )!;
  assert.ok(
    forDiagram.edges.some(
      (e) => e.from === continueNode.id && e.to === update.id,
    ),
  );
  assert.ok(
    forDiagram.edges.some((e) => e.from === update.id && e.label === 'repeat'),
  );
  assert.ok(
    diagram.nodes.every(
      (n) => n.line >= 1 && n.line <= source.split('\n').length,
    ),
  );
});

test('Java menu analysis explains a ternary and follows arrow switch cases', async (t) => {
  const { analyze } = await harness(t);
  const source = `class Main {
    public static void main(String[] args) {
      int opcionPrimerMenu = 6;
      String opcionNoDisp = opcionPrimerMenu < 1 || opcionPrimerMenu >= 5 ? "Esta opción no existe" : "";
      switch (opcionPrimerMenu) {
        case 1 -> System.out.println("Menú de opciones");
        case 2 -> System.out.println("Calculadora");
        default -> System.out.println("Salir");
      }
    }
  }`;
  const result = await analyze('java', source);
  const diagram = result.diagrams[0]!;
  assert.ok(diagram.nodes.some((n) => n.label.includes('está fuera de 1 a 4')));
  assert.ok(
    diagram.nodes.some((n) =>
      n.label.includes('Guardar «Esta opción no existe» en opcionNoDisp'),
    ),
  );
  assert.ok(
    diagram.nodes.some((n) => n.label === 'Guardar vacío en opcionNoDisp'),
  );
  assert.ok(
    diagram.nodes.some((n) => n.label === 'Elegir según opcionPrimerMenu'),
  );
  assert.ok(diagram.edges.some((e) => e.label === 'caso 1'));
  assert.ok(diagram.edges.some((e) => e.label === 'caso 2'));
  assert.ok(diagram.edges.some((e) => e.label === 'otro'));
  assert.equal(
    diagram.warnings.some((w) => w.includes('switch')),
    false,
  );
});

test('parsers never execute source and disclose unsupported flow as opaque notes', async (t) => {
  const { analyze, dir } = await harness(t);
  const marker = join(dir, 'must-not-exist');
  const py = `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('bad')\ndef f():\n    try:\n        dangerous()\n    except Exception:\n        pass\n`;
  const p = await analyze('python', py);
  assert.equal(await exists(marker), false);
  assert.ok(p.diagrams.some((d) => d.nodes.some((n) => n.kind === 'note')));
  assert.ok(
    p.diagrams.some((d) =>
      d.warnings.some((w) => w.includes('Unsupported Try')),
    ),
  );
  const java = `class Main { static { System.setProperty(${JSON.stringify(marker)}, "bad"); } public static void main(String[] a) { try { danger(); } finally { cleanup(); } } }`;
  const j = await analyze('java', java);
  assert.equal(await exists(marker), false);
  assert.ok(j.diagrams[0]?.nodes.some((n) => n.kind === 'note'));
  assert.ok(
    j.diagrams[0]?.warnings.some((w) => w.includes('Unsupported try/finally')),
  );
  assert.ok(
    j.diagrams[0]?.nodes
      .find((n) => n.kind === 'note')
      ?.label.includes('cleanup'),
  );
  const opaqueId = j.diagrams[0]!.nodes.find((n) => n.kind === 'note')!.id;
  assert.equal(
    j.diagrams[0]!.edges.filter((e) => e.from === opaqueId || e.to === opaqueId)
      .length,
    2,
  );
  assert.equal(
    j.diagrams[0]!.nodes.filter(
      (n) => n.label.includes('danger()') || n.label.includes('cleanup()'),
    ).length,
    1,
  );
});

test('diagram, node, and class caps produce explicit diagnostics', async (t) => {
  const { analyze } = await harness(t);
  const functions = Array.from(
    { length: 27 },
    (_, i) => `def f${i}():\n    pass`,
  ).join('\n');
  const manyClasses = Array.from(
    { length: 26 },
    (_, i) => `class C${i}:\n    value${i} = ${i}`,
  ).join('\n');
  const wideFields = Array.from(
    { length: 70 },
    (_, i) => `    field${i} = ${i}`,
  ).join('\n');
  const wideMethods = Array.from(
    { length: 70 },
    (_, i) => `    def method${i}(self):\n        pass`,
  ).join('\n');
  const python = await analyze(
    'python',
    `class Wide:\n${wideFields}\n${wideMethods}\n${functions}\n${manyClasses}\n`,
  );
  assert.ok(python.diagrams.length <= 24);
  assert.ok(python.diagnostics.some((d) => d.includes('Diagram limit')));
  assert.equal(python.classes.length, 24);
  assert.equal(python.classes[0]?.fields.length, 64);
  assert.equal(python.classes[0]?.methods.length, 64);
  assert.ok(python.diagnostics.some((d) => d.includes('Class limit')));
  assert.ok(python.diagnostics.some((d) => d.includes('Class field limit')));
  assert.ok(python.diagnostics.some((d) => d.includes('Class method limit')));

  const assignments = Array.from(
    { length: 230 },
    (_, i) => `    int value${i} = ${i};`,
  ).join('\n');
  const java = await analyze(
    'java',
    `class Main { void work() {\n${assignments}\n} }`,
  );
  const graph = java.diagrams[0]!;
  assert.ok(graph.nodes.length <= 200);
  assert.ok(graph.warnings.some((w) => w.includes('Node limit')));

  const javaFields = Array.from(
    { length: 70 },
    (_, i) => `  int field${i};`,
  ).join('\n');
  const javaMethods = Array.from(
    { length: 70 },
    (_, i) => `  void method${i}() {}`,
  ).join('\n');
  const wideJava = await analyze(
    'java',
    `class Wide {\n${javaFields}\n${javaMethods}\n}`,
  );
  assert.equal(wideJava.classes[0]?.fields.length, 64);
  assert.equal(wideJava.classes[0]?.methods.length, 64);
  assert.ok(wideJava.diagnostics.some((d) => d.includes('Class field limit')));
  assert.ok(wideJava.diagnostics.some((d) => d.includes('Class method limit')));
});

test('Java JSON preserves CRLF, tabs, and Unicode source exactly', async (t) => {
  const { analyze } = await harness(t);
  const source = 'class Main {\r\n\tString texto = "niño\tmañana";\r\n}\r\n';
  const result = await analyze('java', source);
  assert.equal(result.source.content, source);
  assert.equal(result.classes[0]?.fields[0], 'String texto = "niño mañana";');
});

test('Java keeps unconditional loops open and warns on labeled or synchronized flow', async (t) => {
  const { analyze } = await harness(t);
  const infinite = await analyze(
    'java',
    'class Main { void spin() { for (;;) { break; } } }',
  );
  const spin = infinite.diagrams[0]!;
  const decision = spin.nodes.find((n) => n.kind === 'decision')!;
  assert.equal(
    spin.edges.some((e) => e.from === decision.id && e.label === 'false'),
    false,
  );

  const opaque = await analyze(
    'java',
    'class Main { void work() { outer: for (;;) { if (flag) break outer; } synchronized (this) { danger(); } } }',
  );
  const graph = opaque.diagrams[0]!;
  assert.ok(graph.warnings.some((w) => w.includes('labeled statement')));
  assert.ok(graph.warnings.some((w) => w.includes('synchronized block')));
  assert.ok(
    graph.nodes.some((n) => n.kind === 'note' && n.label.startsWith('outer:')),
  );
  assert.ok(
    graph.nodes.some(
      (n) => n.kind === 'note' && n.label.includes('synchronized'),
    ),
  );
  assert.equal(
    graph.nodes.some((n) => n.label.startsWith('break')),
    false,
  );
  assert.equal(
    graph.nodes.filter((n) => n.label.includes('danger()')).length,
    1,
  );
});

test('Java safely truncates a loop at the node cap', async (t) => {
  const { analyze } = await harness(t);
  const prefix = Array.from({ length: 197 }, (_, i) => `value${i}++;`).join(
    '\n',
  );
  const result = await analyze(
    'java',
    `class Main { void work() {\n${prefix}\nwhile (ready()) { work(); }\n} }`,
  );
  const graph = result.diagrams[0]!;
  assert.ok(graph.nodes.length <= 200);
  assert.ok(graph.warnings.some((w) => w.includes('Node limit')));
});

test('syntax errors return diagnostics without fabricating diagrams', async (t) => {
  const { analyze } = await harness(t);
  const py = await analyze('python', 'def broken(:\n    pass\n');
  const java = await analyze('java', 'class Broken { void x( { }');
  assert.equal(py.diagrams.length, 0);
  assert.ok(py.diagnostics.some((d) => d.includes('syntax error')));
  assert.equal(java.diagrams.length, 0);
  assert.ok(java.diagnostics.some((d) => d.includes('syntax error')));
});

async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
