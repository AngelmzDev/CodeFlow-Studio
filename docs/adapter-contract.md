# Working implementation contract — trace v1

Runtime: Node.js 24+, JDK 21+ (jdk.jdi), Python 3.11+. No runtime npm dependencies.
Repository folders: src/core, src/adapters, src/visualization, src/exports, src/server, web, adapters/java, adapters/python, tests, examples, docs, skills/codeflow-studio.
Trace shape:
{schemaVersion:"1.0",language:string,adapter:{id,version,capabilities},sources:[{id:"main",name,content}],events:Event[],status:"completed"|"exception"|"limited",limits:{maxEvents,timeoutMs},diagnostics:string[]}
Event: {id:"e0",sequence:0,type:"line"|"call"|"return"|"exception"|"stdout"|"stderr"|"terminated"|"limit",provenance:"observed",location?:{sourceId:"main",line:number,column?:number},frames:Frame[],heap:Record<string,HeapObject>,output:{stdout:string,stderr:string},detail?:object,changes?:Change[]}.
Frame: {id:"f1",name:string,location:{sourceId:"main",line:number},locals:Record<string,Value>}
Value: {kind:"primitive",type:string,value:string|number|boolean|null} | {kind:"reference",type:string,ref:string} | {kind:"unavailable",type:string,reason:string}.
HeapObject: {id:string,type:string,kind:"array"|"object",elements?:Value[],fields?:Record<string,Value>,length?:number,truncated?:boolean}
Change derived by core from snapshots: {frameId,name,before?:Value,after?:Value,provenance:"derived"}; empty states well defined.
Capabilities: {stepping,variables,callStack,objects,arrays,memory,stdin,stdout,exceptions,conditionValues,loopEvents,reverseExecution:boolean,limitations:string[]}. reverseExecution=false refers to debuggee; playback always reversible. conditionValues/loopEvents false initially; never invent boolean results or iteration counts.
Each raw tracer emits NDJSON Event objects to its private protocol stdout. Python writes target stdout into snapshots; Java drains target streams and snapshots cumulative output. Node normalizes event id/sequence, validates, adds deltas, wraps Trace.
Source stop locations are BEFORE executing the highlighted line. Snapshots immutable; previous line effects visible at next stop. Returns carry final locals and detail.value.
Java only same source file (including nested classes), Python only target file. Sequential programs. No instruction-level memory snapshots. Graphs derived from observed events explicitly marked derived.
CLI: node src/cli.ts doctor | serve [--port 4310] | trace FILE --allow-local-execution [--language java|python] [--entry Main] [--stdin TEXT] [--arg ARG repeated] [--out trace.json] [--timeout 10000] [--max-events 2000] | export TRACE --format html|svg|json --out PATH.
API: GET /api/adapters -> {adapters:[{id,language,label,extensions,available,reason?,capabilities}],examples:[{id,label,language,filename,source,stdin?,entry?}]}; POST /api/trace JSON {language,source,filename,entry?,stdin?,args?:string[],allowLocalExecution:true,maxEvents?,timeoutMs?} -> Trace, errors {error:string}; GET /api/health -> {ok:true}.
POST requires same-origin and per-session token from GET /api/session -> {token}; send X-CodeFlow-Token. Host strictly loopback, no wildcard CORS.
UI source web/index.html, web/styles.css, web/app.js (bundled with esbuild). main app imports Playback from ../src/core/playback.ts and SVG helpers from ../src/visualization/views.ts.
Playback: new Playback(trace); .index starts 0; .state getter returns trace.events[index] or null; .seek(index), .next(), .previous(), .reset(), .setSpeed(number), .play(), .pause(), .subscribe(callback) returning unsubscribe; index clamped; end pauses; callback receives event and index. .playing, .speed properties.
Visualization exports: formatValue(value), selectViews(capabilities), renderStateSvg(event, {theme?}={}) -> SVG string; selectViews -> string[] among variables,arrays,callStack,timeline,objects based capabilities.
Core: validateTrace(unknown)->Trace; deriveChanges(previousEvent|undefined,nextEvent)->Change[].
Offline viewer: index.html same UI + app bundle and CSS inline. Embedded JSON in script type application/json id embedded-trace. UI detects it and offers playback without any fetch/execution. Exports in online UI via POST /api/export {trace,format:"html"|"svg"|"json",index?} same token -> text attachment. Offline UI can download original JSON and current SVG locally.

## Diagramas estáticos opcionales

Un adaptador de trazado puede añadir `analyze(request, context): Promise<Analysis>` y declarar `analysis: true` en el resultado de detección cuando el analizador esté disponible. El contrato neutral está en `src/core/analysis-types.ts`; `validateAnalysis` valida fuente, lenguaje, ubicaciones, identificadores, extremos de aristas y límites antes de mostrar o exportar datos. No depende de Java ni de Python.

El analizador debe obtener estructura sin ejecutar, importar ni evaluar el programa objetivo. Sus diagramas usan `provenance: "static"` y se mantienen separados de los eventos observados. Una declaración sintáctica no demuestra que una rama haya sido tomada. Los elementos no modelados se representan como notas opacas con avisos explícitos. Los límites actuales son 24 actividades, 200 nodos y 600 aristas por actividad, 24 clases y 64 campos/métodos por clase. Toda omisión debe avisarse.

`POST /api/analyze` usa la protección de sesión local, sin requerir consentimiento de ejecución. Las trazas siguen funcionando con adaptadores que no implementen análisis. Para comprobar un nuevo analizador, prueba tanto estructura válida como código que produciría un efecto lateral si se ejecutara: el efecto no debe ocurrir. Incluye errores sintácticos, Unicode, condiciones, ciclos, saltos, límites y casos que deban quedar opacos.
