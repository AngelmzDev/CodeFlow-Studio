# Technical research and selected scope

The repository started at a7504fb with only README.md and the existing Amzdev MIT license. No implementation/dependencies required preservation; the history and original license were retained.

## Runtime evidence

- [JDI step events](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.jdi/com/sun/jdi/event/StepEvent.html) report the location before the instruction executes. [StackFrame](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.jdi/com/sun/jdi/StackFrame.html) exposes locals only while suspended. Selected for Java because it reuses the JVM and preserves Java semantics, rather than implementing an interpreter. Target compilation uses -g and -proc:none.
- [JDK Compiler Tree API](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.compiler/com/sun/source/util/JavacTask.html), [JavaParser](https://github.com/javaparser/javaparser) and bytecode instrumentation were considered for source semantics/probes. They may later provide branch or mutation details; v0.1 avoids claiming those facts from line stepping.
- [Python sys.settrace](https://docs.python.org/3.12/library/sys.html#sys.settrace) provides real call/line/return/exception observations with no additional debugger dependency. It runs inside the target process, so it is appropriate only for trusted sequential code.
- [DAP](https://microsoft.github.io/debug-adapter-protocol/overview.html) offers a shared debugger transport and explicit capability negotiation. It is the intended extension path for JS/TS, C/C++, C#, Go, Rust and Kotlin where suitable adapters exist. DAP launch arguments differ, reverse execution is optional, and variable handles expire on resume. A recorder must materialize snapshots while stopped and must not treat those handles as stable heap identities. No generic DAP support is advertised in v0.1.
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) is an incremental syntax parser. It can support language detection, source structure and syntax-aware views; it cannot establish executed variable values. No parser is passed off as a working runtime adapter.

## Visualization and portability

The first views need deterministic coordinates and modest state sizes. Native SVG and DOM rendering provide transparent geometry, accessibility hooks and standalone exports without a graph-library runtime. A graph layout library can be added when larger control/recursion graphs justify it. Playback is an independent state selector and clock; it does not mutate the trace.

Node.js 24 handles the CLI, process supervision and loopback server. TypeScript checks the contracts, esbuild bundles the browser/offline viewer, Node's test runner checks the core and adapters, and Playwright plus axe verify complete browser flows. @dagrejs/dagre provides local deterministic diagram layout; no CDN is required.

## Diagram Design review

Reviewed the upstream [skill organization and diagram routing](https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/SKILL.md), [visual profiles](https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/references/profiles.md), [deterministic animation guidance](https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/references/animation.md) and [validation/export scripts](https://github.com/cathrynlavery/diagram-design/tree/main/scripts).
Useful ideas applied here: separate behavioral meaning from layout; select a relevant state view by capabilities; keep overview/details bounded; use semantic theme tokens; drive motion from a stable event position; export self-contained HTML/SVG; and validate in the browser. The bundled Agent Skill follows the standard SKILL.md entrypoint for different hosts.
No upstream source, templates, fonts, images or animation code were reused. CodeFlow obtains execution evidence from actual runtimes; editorial diagram rules are not used to invent program events.

## Modo de estudiantes y UML

El modo Básico muestra un editor vacío y un diagrama, con los paneles de depuración ocultos. La interfaz incluye español/inglés, claro/oscuro, selección de actividad o clases, descarga SVG y ampliación. El trazado continúa disponible desde la sección opcional de ejecución y desde Avanzado.

Los analizadores nativos usan [Python ast.parse](https://docs.python.org/3.12/library/ast.html) y [Java JavacTask.parse](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.compiler/com/sun/source/util/JavacTask.html). La fase de análisis no ejecuta ni importa el objetivo ni activa procesadores de anotaciones. [Dagre](https://github.com/dagrejs/dagre) calcula la disposición local de nodos y aristas. Los símbolos de actividad y las relaciones de generalización/realización siguen un subconjunto de [UML](https://www.omg.org/spec/UML/2.5.1/About-UML); no se anuncia conformidad completa con la especificación.

Los diagramas estáticos, las trazas observadas y el resaltado de una línea permanecen separados. Los resultados exactos de las condiciones y los caminos realmente tomados requieren evidencia adicional que los adaptadores actuales no declaran. Las construcciones no modeladas aparecen como notas opacas con avisos.
