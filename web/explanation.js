import { explainStep } from '../src/core/explanation.ts';

export function initExplanation(getContext, getToken) {
  const content = document.getElementById('explanation-content');
  const detail = document.getElementById('explanation-detail');
  const ai = document.getElementById('explanation-ai');
  const caches = new WeakMap();
  let generation = 0;
  let timer;
  let controller;
  function paragraph(text, className = '') {
    const p = document.createElement('p');
    p.textContent = text;
    p.className = className;
    return p;
  }
  function show(result) {
    content.replaceChildren();
    content.dataset.index = String(result.index);
    const title = document.createElement('h3');
    title.textContent = result.title;
    content.append(title, paragraph(result.summary));
    content.append(
      paragraph(
        result.locale === 'es'
          ? 'Datos de la traza · observados'
          : 'Trace facts · observed',
        'explanation-provenance',
      ),
    );
    const list = document.createElement('ul');
    for (const value of result.evidence) {
      const li = document.createElement('li');
      li.textContent = value;
      list.append(li);
    }
    content.append(list);
    for (const note of result.notes)
      content.append(paragraph(note, 'explanation-note'));
    if (result.ai) {
      content.append(paragraph(result.ai.label, 'explanation-provenance'));
      content.append(
        paragraph(
          result.ai.text || result.ai.reason || '',
          'explanation-generated',
        ),
      );
    }
  }
  function update() {
    generation++;
    const selected = generation;
    clearTimeout(timer);
    controller?.abort();
    content.setAttribute('aria-busy', 'false');
    const { trace, index, locale, offline, playing } = getContext();
    const es = locale !== 'en';
    ai.disabled = offline;
    if (!trace || !trace.events.length) {
      content.replaceChildren(
        paragraph(
          es
            ? 'Ejecuta un programa y selecciona un paso para entender lo que ocurre.'
            : 'Run a program and select a step to understand what happens.',
        ),
      );
      delete content.dataset.index;
      return;
    }
    const basic = explainStep(trace, index, { locale, detail: detail.value });
    show(basic);
    if (!ai.checked || offline) return;
    if (playing) {
      content.append(
        paragraph(
          es
            ? 'Pausa la reproducción para consultar la IA local sobre este paso.'
            : 'Pause playback to ask local AI about this step.',
          'explanation-note',
        ),
      );
      return;
    }
    let cache = caches.get(trace);
    if (!cache) {
      cache = new Map();
      caches.set(trace, cache);
    }
    const key = `${index}:${locale}:${detail.value}`;
    if (cache.has(key)) {
      show(cache.get(key));
      return;
    }
    const loading = paragraph(
      es
        ? 'Consultando IA local… La explicación básica ya está disponible.'
        : 'Asking local AI… The basic explanation is already available.',
      'explanation-loading',
    );
    content.append(loading);
    content.setAttribute('aria-busy', 'true');
    timer = setTimeout(async () => {
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const token = await getToken();
        if (generation !== selected) return;
        const response = await fetch('/api/explain', {
          method: 'POST',
          signal,
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CodeFlow-Token': token,
          },
          body: JSON.stringify({
            trace,
            index,
            locale,
            detail: detail.value,
            useAI: true,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Request failed');
        if (generation !== selected) return;
        if (result.ai?.status === 'generated') {
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(key, result);
        }
        show(result);
      } catch (error) {
        if (generation !== selected || signal.aborted) return;
        show(basic);
        content.append(
          paragraph(
            es
              ? 'No se pudo consultar la IA local. Puedes seguir estudiando con los datos de la traza.'
              : 'Local AI could not be reached. You can keep studying with the trace facts.',
            'explanation-note',
          ),
        );
      } finally {
        if (generation === selected) content.setAttribute('aria-busy', 'false');
      }
    }, 350);
  }
  detail.addEventListener('change', update);
  ai.addEventListener('change', update);
  return { update };
}
