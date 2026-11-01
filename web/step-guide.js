const eventTitles = {
  es: {
    line: 'Siguiente instrucción',
    call: 'Llamada a función',
    return: 'Retorno de función',
    exception: 'Excepción',
    stdout: 'Salida del programa',
    stderr: 'Error escrito en salida',
    terminated: 'Fin del programa',
    limit: 'Límite de ejecución',
    condition: 'Evaluación de condición',
    'loop.start': 'Inicio de iteración',
    'loop.end': 'Fin de iteración',
    'variable.create': 'Creación de variable',
    'variable.update': 'Actualización de variable',
    'variable.delete': 'Fin del ámbito de variable',
  },
  en: {
    line: 'Next instruction',
    call: 'Function call',
    return: 'Function return',
    exception: 'Exception',
    stdout: 'Program output',
    stderr: 'Output error',
    terminated: 'Program ended',
    limit: 'Execution limit',
    condition: 'Condition evaluation',
    'loop.start': 'Iteration begins',
    'loop.end': 'Iteration ends',
    'variable.create': 'Variable created',
    'variable.update': 'Variable updated',
    'variable.delete': 'Variable leaves scope',
  },
};

const MAX_CHANGES = 12;
const MAX_TEXT = 120;

function formatValue(value, locale) {
  const es = locale !== 'en';
  if (value === undefined) return '—';
  if (value.kind === 'primitive') {
    if (typeof value.value === 'string') {
      const safe =
        value.value.length > MAX_TEXT
          ? `${value.value.slice(0, MAX_TEXT)}…`
          : value.value;
      return JSON.stringify(safe);
    }
    return String(value.value);
  }
  if (value.kind === 'reference')
    return `${value.type || (es ? 'referencia' : 'reference')} · ${String(value.ref).slice(0, MAX_TEXT)}`;
  if (value.kind === 'unavailable')
    return `${es ? 'no disponible' : 'unavailable'}${value.reason ? `: ${String(value.reason).slice(0, MAX_TEXT)}` : ''}`;
  return es ? 'valor no reconocido' : 'unrecognized value';
}

function instructionAction(code, locale) {
  const es = locale !== 'en';
  const text = code.trim();
  if (!text)
    return es
      ? 'No hay código fuente disponible para esta ubicación.'
      : 'No source code is available for this location.';
  if (/^\s*(if|while)\b|^\s*(?:else\s+)?if\s*\(/.test(text))
    return es
      ? 'Ahora se evaluará esta condición; su resultado todavía no se conoce en este paso.'
      : 'This condition will now be evaluated; its outcome is not known at this step yet.';
  if (/^\s*(for|foreach)\b/.test(text))
    return es
      ? 'Ahora se comprobará el siguiente elemento del recorrido; la iteración aún no se ha confirmado.'
      : 'The next item in the iteration will now be checked; the iteration is not confirmed yet.';
  if (/^\s*return\b/.test(text))
    return es
      ? 'Esta instrucción prepara un valor para devolver al llamador; el retorno aún no se ha observado.'
      : 'This statement prepares a value for the caller; the return has not been observed yet.';
  if (/^\s*(print|println|printf|console\.log|System\.out\.)\b/.test(text))
    return es
      ? 'Esta instrucción intentará escribir en la salida; el efecto aún no se ha observado.'
      : 'This statement will attempt to write to output; the effect has not been observed yet.';
  if (/^\s*[\w$.]+\s*(\+\+|--)/.test(text) || /^(\+\+|--)\s*[\w$.]+/.test(text))
    return es
      ? 'Esta instrucción incrementa o decrementa una variable; el nuevo valor aún no se ha observado.'
      : 'This statement increments or decrements a variable; the new value has not been observed yet.';
  if (/^\s*[\w$.]+\s*(\+=|-=|\*=|\/=|%=)/.test(text))
    return es
      ? 'Esta instrucción actualiza una variable con una operación; el nuevo valor aún no se ha observado.'
      : 'This statement updates a variable with an operation; the new value has not been observed yet.';
  if (/^\s*[\w$.]+\s*=(?!=|>)/.test(text))
    return es
      ? 'Esta instrucción asigna una expresión a una variable; el valor resultante aún no se ha observado.'
      : 'This statement assigns an expression to a variable; the resulting value has not been observed yet.';
  if (/^\s*(def|function|class)\b/.test(text))
    return es
      ? 'Aquí comienza una declaración; su cuerpo aún no se ha ejecutado.'
      : 'A declaration begins here; its body has not run yet.';
  return es
    ? 'Esta instrucción está por ejecutarse; sus efectos aún no se han observado.'
    : 'This instruction is about to run; its effects have not been observed yet.';
}

function observedAction(type, locale) {
  const messages = {
    es: {
      call: 'La traza registró una llamada a función.',
      return: 'La traza registró el retorno de una función.',
      exception: 'La traza registró una excepción.',
      stdout: 'La traza registró datos escritos en la salida.',
      stderr: 'La traza registró datos escritos en la salida de error.',
      terminated: 'La traza registró que el programa terminó.',
      limit: 'La traza registró que se alcanzó un límite de ejecución.',
      condition: 'La traza registró la evaluación de una condición.',
      'loop.start': 'La traza registró el inicio de una iteración.',
      'loop.end': 'La traza registró el fin de una iteración.',
      'variable.create': 'La traza registró la creación de una variable.',
      'variable.update': 'La traza registró la actualización de una variable.',
      'variable.delete': 'La traza registró que una variable salió de ámbito.',
    },
    en: {
      call: 'The trace recorded a function call.',
      return: 'The trace recorded a function return.',
      exception: 'The trace recorded an exception.',
      stdout: 'The trace recorded data written to output.',
      stderr: 'The trace recorded data written to error output.',
      terminated: 'The trace recorded that the program ended.',
      limit: 'The trace recorded that an execution limit was reached.',
      condition: 'The trace recorded a condition evaluation.',
      'loop.start': 'The trace recorded the start of an iteration.',
      'loop.end': 'The trace recorded the end of an iteration.',
      'variable.create': 'The trace recorded a variable creation.',
      'variable.update': 'The trace recorded a variable update.',
      'variable.delete': 'The trace recorded that a variable left scope.',
    },
  };
  return (
    messages[locale === 'en' ? 'en' : 'es'][type] ??
    (locale === 'en'
      ? 'The trace recorded this event.'
      : 'La traza registró este evento.')
  );
}

function collectChanges(previous, current, locale) {
  const es = locale !== 'en';
  const changes = [];
  const oldFrames = previous?.frames ?? [];
  const currentIds = new Set(current.frames.map((frame) => frame.id));
  const framesById = new Map(
    [...oldFrames, ...current.frames].map((frame) => [frame.id, frame]),
  );
  const nameCounts = new Map();
  for (const frame of framesById.values())
    nameCounts.set(frame.name, (nameCounts.get(frame.name) ?? 0) + 1);
  const displayName = (name, frame) =>
    (nameCounts.get(frame.name) ?? 0) > 1
      ? `${name} (${frame.name} · ${frame.id})`
      : name;

  for (const frame of current.frames) {
    const old =
      oldFrames.find((candidate) => candidate.id === frame.id)?.locals ?? {};
    for (const name of [
      ...new Set([...Object.keys(old), ...Object.keys(frame.locals)]),
    ].sort()) {
      if (JSON.stringify(old[name]) === JSON.stringify(frame.locals[name]))
        continue;
      changes.push({
        name: displayName(name, frame),
        before: formatValue(old[name], locale),
        after:
          frame.locals[name] === undefined
            ? es
              ? 'fuera de ámbito'
              : 'out of scope'
            : formatValue(frame.locals[name], locale),
      });
    }
  }

  for (const frame of oldFrames) {
    if (currentIds.has(frame.id)) continue;
    for (const name of Object.keys(frame.locals).sort())
      changes.push({
        name: displayName(name, frame),
        before: formatValue(frame.locals[name], locale),
        after: es ? 'fuera de ámbito' : 'out of scope',
      });
  }

  return changes.slice(0, MAX_CHANGES);
}

/** Describe the selected trace event without executing its source code. */
export function describeStep(trace, index, locale = 'es') {
  if (
    !trace ||
    !Array.isArray(trace.events) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= trace.events.length
  )
    throw new RangeError('Step index is outside the trace');
  const language = locale === 'en' ? 'en' : 'es';
  const event = trace.events[index];
  const previous = index > 0 ? trace.events[index - 1] : undefined;
  const location = event.location ?? event.frames[0]?.location;
  const source =
    location && trace.sources.find((item) => item.id === location.sourceId);
  const code =
    source && location?.line > 0
      ? (source.content.split(/\r?\n/)[location.line - 1] ?? '')
      : '';
  const title =
    eventTitles[language][event.type] ??
    (language === 'es' ? 'Paso de ejecución' : 'Execution step');
  const comparison =
    language === 'es'
      ? index === 0
        ? 'Primer paso de la traza; no hay un paso anterior para comparar.'
        : `Cambios entre el paso ${index} y este paso. No son el resultado de la instrucción pendiente.`
      : index === 0
        ? 'First step in the trace; there is no previous step to compare.'
        : `Changes between step ${index} and this step. They are not the result of the pending instruction.`;

  return {
    title,
    code,
    line: location?.line ?? null,
    action:
      event.type === 'line'
        ? instructionAction(code, language)
        : observedAction(event.type, language),
    changes: collectChanges(previous, event, language),
    comparison,
  };
}
