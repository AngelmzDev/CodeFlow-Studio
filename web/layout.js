const labels = {
  es: {
    reset: 'Restaurar distribución',
    up: 'Subir panel',
    down: 'Bajar panel',
    resize: 'Redimensionar panel',
    sequence: 'Diagrama de secuencia',
    explanation: 'Explicación didáctica',
    detail: 'Nivel de detalle',
    brief: 'Breve',
    detailed: 'Detallada',
    ai: 'IA local (opcional)',
    aiHint: 'Requiere configurar Ollama.',
  },
  en: {
    reset: 'Restore layout',
    up: 'Move panel up',
    down: 'Move panel down',
    resize: 'Resize panel',
    sequence: 'Sequence diagram',
    explanation: 'Guided explanation',
    detail: 'Detail level',
    brief: 'Brief',
    detailed: 'Detailed',
    ai: 'Local AI (optional)',
    aiHint: 'Requires Ollama setup.',
  },
};

let locale = 'es';
let board;
function buildExtraPanels() {
  const sequence = document.createElement('section');
  sequence.id = 'sequence-panel';
  sequence.className = 'panel layout-panel';
  sequence.setAttribute(
    'aria-label',
    locale === 'es' ? labels.es.sequence : labels.en.sequence,
  );
  sequence.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">TRAZA</span><h2 data-layout-title="sequence"></h2></div></div><div class="layout-panel-content" id="sequence-content" aria-live="polite"></div>`;
  const explanation = document.createElement('section');
  explanation.id = 'explanation-panel';
  explanation.className = 'panel layout-panel';
  explanation.setAttribute(
    'aria-label',
    locale === 'es' ? labels.es.explanation : labels.en.explanation,
  );
  explanation.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">APRENDIZAJE</span><h2 data-layout-title="explanation"></h2></div><div class="explanation-controls"><label><span data-layout-text="detail"></span><select id="explanation-detail"><option value="brief" data-layout-option="brief"></option><option value="detailed" data-layout-option="detailed"></option></select></label><label><input id="explanation-ai" type="checkbox"><span data-layout-text="ai"></span></label><small data-layout-text="aiHint"></small></div></div><div class="layout-panel-content" id="explanation-content" aria-live="polite"></div>`;
  board.append(sequence, explanation);
}

const copy = {
  es: {
    code: 'Código',
    diagram: 'Diagrama',
    debug: 'Paso a paso',
    intro: 'Comprende tu código, línea a línea.',
    options: 'Entrada y opciones',
    before:
      'Los valores se muestran antes de ejecutar la línea resaltada. Avanza para ver sus cambios.',
    exports: 'Guardar o abrir una ejecución',
    explain: '¿Qué está pasando?',
  },
  en: {
    code: 'Code',
    diagram: 'Diagram',
    debug: 'Step by step',
    intro: 'Understand your code, one line at a time.',
    options: 'Input and options',
    before:
      'Values are shown before the highlighted line executes. Step forward to see its changes.',
    exports: 'Save or open a recording',
    explain: 'What is happening?',
  },
};
export function setLayoutLocale(nextLocale) {
  locale = nextLocale === 'en' ? 'en' : 'es';
  document.querySelectorAll('[data-studio-text]').forEach((node) => {
    node.textContent = copy[locale][node.dataset.studioText];
  });
  for (const [attr, key] of [
    ['data-layout-title', 'layoutTitle'],
    ['data-layout-text', 'layoutText'],
    ['data-layout-option', 'layoutOption'],
  ]) {
    document.querySelectorAll('[' + attr + ']').forEach((node) => {
      node.textContent = labels[locale][node.dataset[key]];
    });
  }
}
export function initLayout() {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('.main-area');
  board = document.createElement('div');
  board.id = 'layout-board';
  document.querySelector('.basic-hint').after(board);
  buildExtraPanels();
  const heading = (key, number) =>
    '<div class="studio-heading"><span class="section-number">' +
    number +
    '</span><h2 data-studio-text="' +
    key +
    '"></h2></div>';
  const editor = $('editor-panel'),
    diagram = $('diagram-panel');
  editor.insertAdjacentHTML('afterbegin', heading('code', '01'));
  diagram.insertAdjacentHTML('afterbegin', heading('diagram', '02'));
  const debug = document.createElement('section');
  debug.id = 'debugger-panel';
  debug.className = 'panel debugger-panel';
  debug.setAttribute('aria-labelledby', 'debugger-title');
  debug.innerHTML =
    heading('debug', '03') +
    '<div class="debugger-body"><div id="run-setup"></div><p class="step-semantics" data-studio-text="before"></p></div>';
  debug.querySelector('h2').id = 'debugger-title';
  const body = debug.querySelector('.debugger-body');
  board.append(editor, diagram, debug);
  const setup = $('run-setup');
  setup.append($('trust-check-wrap'), $('run-button'));
  const options = $('execution-options');
  options.querySelector('summary').removeAttribute('data-i18n');
  options.querySelector('summary').dataset.studioText = 'options';
  options.querySelector('.basic-run-note').remove();
  for (const id of ['stdin-input', 'args-input', 'entry-input']) {
    const field = $(id);
    $('basic-run-content').append(
      document.querySelector('label[for="' + id + '"]'),
      field,
    );
  }
  setup.append(options);
  body.append(document.querySelector('.timeline-panel'));
  body.append($('state-panel'), $('explanation-panel'), $('console-panel'));
  const exports = document.createElement('details');
  exports.className = 'recording-options';
  exports.innerHTML =
    '<summary data-studio-text="exports"></summary><div class="recording-actions"></div>';
  exports.lastElementChild.append(
    $('import-trace-button'),
    document.querySelector('.timeline-actions'),
  );
  body.append(exports);
  // The sequence renderer is retained for compatibility with offline recordings.
  $('sequence-panel').hidden = true;
  main.append($('sequence-panel'));
  $('explanation-panel').querySelector('.eyebrow').remove();
  const explanationTitle = $('explanation-panel').querySelector('h2');
  explanationTitle.removeAttribute('data-layout-title');
  explanationTitle.dataset.studioText = 'explain';
  const advancedExplanation = document.createElement('details');
  advancedExplanation.className = 'explanation-options';
  advancedExplanation.innerHTML =
    '<summary data-layout-text="detail"></summary>';
  advancedExplanation.append(
    $('explanation-panel').querySelector('.explanation-controls'),
  );
  $('explanation-panel').append(advancedExplanation);
  $('editor-panel')
    .querySelector('.editor-actions')
    .prepend($('import-button'));
  const nav = document.createElement('nav');
  nav.className = 'studio-nav';
  nav.setAttribute('aria-label', 'CodeFlow');
  nav.innerHTML =
    '<a class="studio-brand" href="#editor-panel">CodeFlow<span>STUDIO</span></a><div><a href="#editor-panel" data-studio-text="code"></a><a href="#diagram-panel" data-studio-text="diagram"></a><a href="#debugger-panel" data-studio-text="debug"></a></div>';
  document.querySelector('.topbar').prepend(nav);
  document.querySelector('.basic-hint').removeAttribute('data-i18n');
  document.querySelector('.basic-hint').dataset.studioText = 'intro';
  setLayoutLocale(locale);
}
