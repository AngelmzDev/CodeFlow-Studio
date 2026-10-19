import type { Trace, Value } from './types.ts';
export type ExplainLocale = 'es' | 'en';
export type ExplainDetail = 'brief' | 'detailed';
export interface ExplainResult {
  index: number;
  eventId: string;
  locale: ExplainLocale;
  detail: ExplainDetail;
  title: string;
  summary: string;
  evidence: string[];
  notes: string[];
  ai?: {
    status: 'generated' | 'unavailable';
    label: string;
    text?: string;
    reason?: string;
  };
}
function display(value: Value): string {
  return value.kind === 'primitive'
    ? JSON.stringify(value.value)
    : value.kind === 'reference'
      ? `${value.type} → ${value.ref}`
      : `? (${value.reason})`;
}
function teachingSummary(
  type: string,
  code: string | undefined,
  es: boolean,
): string {
  const events: Record<string, [string, string]> = {
    call: [
      'Se ha observado una llamada. La pila de llamadas permite ver qué función está activa y quién la llamó.',
      'A call was observed. The call stack shows the active function and its caller.',
    ],
    return: [
      'Se ha observado un evento de retorno. Compara la pila de llamadas; no se supone ningún valor devuelto.',
      'A return event was observed. Compare the call stack; no return value is assumed.',
    ],
    exception: [
      'Se ha observado una excepción. Revisa el estado y los diagnósticos registrados para localizar el problema.',
      'An exception was observed. Inspect the recorded state and diagnostics to locate the problem.',
    ],
    limit: [
      'La captura alcanzó un límite. No se conoce la ejecución posterior a esta instantánea.',
      'Capture reached a limit. Execution after this snapshot is unknown.',
    ],
    terminated: [
      'La ejecución ha terminado. Revisa los últimos valores y la salida registrada.',
      'Execution has ended. Review the final recorded values and output.',
    ],
    stdout: [
      'Se ha registrado salida estándar. Compara el texto mostrado con la instantánea anterior.',
      'Standard output was recorded. Compare the text with the previous snapshot.',
    ],
    stderr: [
      'Se ha registrado salida de error. Su presencia por sí sola no demuestra una excepción.',
      'Standard error output was recorded. Its presence alone does not establish an exception.',
    ],
  };
  if (events[type]) return events[type][es ? 0 : 1];
  if (type === 'line' && code) {
    let meaning: string | undefined;
    const increment = code.match(/^([A-Za-z_$][\w$]*)\s*\+\+\s*;?$/);
    const assignment = code.match(
      /^(?:(?:int|long|double|float|boolean|String|var|final\s+int)\s+)?([A-Za-z_$][\w$]*)\s*=(?!=)(.+?);?$/,
    );
    if (increment)
      meaning = es
        ? `La próxima instrucción aumenta ${increment[1]} en una unidad`
        : `The next instruction increments ${increment[1]} by one`;
    else if (assignment)
      meaning = es
        ? `El texto de la próxima instrucción asigna una expresión a ${assignment[1]}; su evaluación puede depender del estado y puede fallar`
        : `The next instruction's text assigns an expression to ${assignment[1]}; evaluation may depend on state and may fail`;
    else if (
      /^(?:print\s*\(|System\.out\.(?:print|println|printf)\s*\()/.test(code)
    )
      meaning = es
        ? 'La próxima instrucción intenta escribir salida; sus argumentos aún deben evaluarse'
        : 'The next instruction attempts to write output; its arguments still need evaluation';
    else if (/^return(?:\s|;|$)/.test(code))
      meaning = es
        ? 'La próxima instrucción solicita volver a la función que llamó; cualquier expresión de retorno debe evaluarse primero'
        : 'The next instruction requests a return to the caller; any return expression must first be evaluated';
    else if (/^if\s*\(/.test(code) || /^if\s+.+:\s*$/.test(code))
      meaning = es
        ? 'La próxima instrucción evalúa una condición para elegir una rama; todavía no se conoce su resultado'
        : 'The next instruction evaluates a condition to select a branch; its outcome is not yet known';
    if (meaning)
      return (
        meaning +
        (es
          ? '. Esta instantánea es anterior: todavía no se ha observado su resultado.'
          : '. This snapshot precedes execution: its result has not yet been observed.')
      );
    return es
      ? `La próxima línea es «${code}». Observa los valores actuales y avanza para comparar la siguiente instantánea, sin suponer sus efectos.`
      : `The next line is “${code}”. Inspect current values and advance to compare the next snapshot without assuming its effects.`;
  }
  return es
    ? 'Revisa el evento registrado y compara los valores disponibles con la instantánea anterior.'
    : 'Inspect the recorded event and compare available values with the previous snapshot.';
}
/** Locations are before-instruction snapshots; differences are already observed. */
export function explainStep(
  trace: Trace,
  index: number,
  options: { locale?: ExplainLocale; detail?: ExplainDetail } = {},
): ExplainResult {
  if (!Number.isInteger(index) || index < 0 || index >= trace.events.length)
    throw new Error('Explanation index is out of range');
  const locale = options.locale ?? 'es';
  const detail = options.detail ?? 'brief';
  if (!['es', 'en'].includes(locale) || !['brief', 'detailed'].includes(detail))
    throw new Error('Invalid explanation language or detail');
  const es = locale === 'es';
  const event = trace.events[index];
  const previous = trace.events[index - 1];
  const location = event.location;
  const source = trace.sources.find((item) => item.id === location?.sourceId);
  const code = source?.content
    .split(/\r?\n/)
    [(location?.line ?? 0) - 1]?.trim();
  const evidence: string[] = [];
  const notes = [
    es
      ? 'La ubicación señala la próxima instrucción. Esta instantánea no demuestra su resultado.'
      : 'The location identifies the next instruction. This snapshot does not establish its result.',
  ];
  if (location)
    evidence.push(
      `${source?.name ?? location.sourceId}:${location.line}${code ? ` — ${code}` : ''}`,
    );
  evidence.push(
    es
      ? `Evento observado: ${event.type}. Funciones en la pila de llamadas: ${event.frames.length}.`
      : `Observed event: ${event.type}. Call stack entries: ${event.frames.length}.`,
  );
  for (const frame of event.frames) {
    const old = previous?.frames.find((item) => item.id === frame.id);
    if (previous && !old)
      evidence.push(
        es
          ? `Nueva función observada en la pila: ${frame.name} (${frame.id}).`
          : `Newly observed frame: ${frame.name} (${frame.id}).`,
      );
    for (const [name, value] of Object.entries(frame.locals)) {
      const before = old?.locals[name];
      if (
        detail === 'detailed' ||
        !before ||
        JSON.stringify(before) !== JSON.stringify(value)
      )
        evidence.push(
          `${frame.name} [${frame.id}].${name}: ${before ? `${display(before)} → ` : ''}${display(value)}`,
        );
    }
    for (const name of Object.keys(old?.locals ?? {}))
      if (!(name in frame.locals))
        evidence.push(
          es
            ? `${frame.name} [${frame.id}].${name}: ya no está presente.`
            : `${frame.name} [${frame.id}].${name}: no longer present.`,
        );
  }
  for (const old of previous?.frames ?? [])
    if (!event.frames.some((frame) => frame.id === old.id))
      evidence.push(
        es
          ? `Función ya no presente en la pila: ${old.name} (${old.id}).`
          : `Frame no longer present: ${old.name} (${old.id}).`,
      );
  if (previous)
    notes.push(
      es
        ? 'Los cambios comparan la instantánea anterior con la actual; ocurrieron antes de la instrucción indicada y no se atribuyen a ella.'
        : 'Changes compare the previous snapshot with this one; they preceded the indicated instruction and are not attributed to it.',
    );
  for (const channel of ['stdout', 'stderr'] as const)
    if (
      event.output[channel] !== previous?.output[channel] &&
      event.output[channel]
    )
      evidence.push(`${channel}: ${JSON.stringify(event.output[channel])}`);
  if (event.detail && Object.keys(event.detail).length)
    evidence.push(
      (es ? 'Datos registrados del evento: ' : 'Recorded event data: ') +
        JSON.stringify(event.detail),
    );
  if (detail === 'detailed') {
    notes.push(
      es
        ? 'No se deducen condiciones, iteraciones ni valores de retorno que no estén registrados.'
        : 'Conditions, iterations and return values that are not recorded are not inferred.',
    );
    const next = trace.events[index + 1];
    if (next)
      evidence.push(
        es
          ? `Siguiente instantánea: ${next.type}${next.location ? `, línea ${next.location.line}` : ''}.`
          : `Next snapshot: ${next.type}${next.location ? `, line ${next.location.line}` : ''}.`,
      );
  }
  return {
    index,
    eventId: event.id,
    locale,
    detail,
    title: es
      ? `Paso ${index + 1}: ${event.type}`
      : `Step ${index + 1}: ${event.type}`,
    summary: teachingSummary(event.type, code, es),
    evidence,
    notes,
  };
}
