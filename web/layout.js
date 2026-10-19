const STORAGE_KEY = 'codeflow-layout-v1';
const DEFAULT_ORDER = [
  'console-panel',
  'state-panel',
  'sequence-panel',
  'explanation-panel',
];
const PANEL_IDS = [...DEFAULT_ORDER, 'diagram-panel', 'editor-panel'];
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
let initialized = false;
let board;
let saved = { order: DEFAULT_ORDER, sizes: {} };

function validLayout(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.order) ||
    !value.sizes ||
    typeof value.sizes !== 'object'
  )
    return null;
  const order = DEFAULT_ORDER.filter((id) => value.order.includes(id));
  if (
    order.length !== DEFAULT_ORDER.length ||
    value.order.some((id) => !DEFAULT_ORDER.includes(id))
  )
    return null;
  const sizes = {};
  for (const id of PANEL_IDS) {
    const size = value.sizes[id];
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
      sizes[id] = {
        width: Math.min(1600, Math.max(240, size.width)),
        height: Math.min(1200, Math.max(150, size.height)),
      };
    }
  }
  return { order, sizes };
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* storage may be disabled */
  }
}
function panelTitle(id) {
  return id === 'sequence-panel'
    ? 'sequence'
    : id === 'explanation-panel'
      ? 'explanation'
      : id === 'console-panel'
        ? 'console'
        : 'programState';
}
function attachControls(panel, reorderable) {
  const head = panel.querySelector('.panel-heading');
  if (!head) return;
  const actions = document.createElement('div');
  actions.className = 'layout-panel-actions';
  if (reorderable) {
    for (const [direction, glyph] of [
      ['up', '↑'],
      ['down', '↓'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'layout-move';
      button.dataset.move = direction;
      button.setAttribute('aria-label', labels[locale][direction]);
      button.textContent = glyph;
      button.addEventListener('click', () =>
        movePanel(panel.id, direction === 'up' ? -1 : 1),
      );
      actions.append(button);
    }
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'layout-drag';
    grip.draggable = true;
    grip.setAttribute(
      'aria-label',
      locale === 'es' ? 'Arrastrar para reordenar' : 'Drag to reorder',
    );
    grip.textContent = '⠿';
    grip.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', panel.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    actions.prepend(grip);
  }
  const resize = document.createElement('button');
  resize.type = 'button';
  resize.className = 'layout-resize';
  resize.setAttribute('aria-label', labels[locale].resize);
  resize.title = labels[locale].resize;
  resize.textContent = '↘';
  resize.addEventListener('pointerdown', (event) => startResize(event, panel));
  resize.addEventListener('keydown', (event) => keyboardResize(event, panel));
  actions.append(resize);
  head.append(actions);
}
function startResize(event, panel) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX,
    startY = event.clientY;
  const startW = panel.getBoundingClientRect().width,
    startH = panel.getBoundingClientRect().height;
  const move = (e) =>
    setSize(panel, startW + e.clientX - startX, startH + e.clientY - startY);
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    saveSizes();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop, { once: true });
}
function setSize(panel, width, height) {
  if (matchMedia('(max-width: 767px)').matches) return;
  const requestedWidth = Math.max(240, Math.min(board.clientWidth, width));
  panel.style.width = `${requestedWidth}px`;
  panel.style.gridColumn =
    requestedWidth > board.clientWidth / 2 ? '1 / -1' : '';
  panel.style.height = `${Math.max(150, Math.min(window.innerHeight * 1.2, height))}px`;
}
function keyboardResize(event, panel) {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return;
  event.preventDefault();
  const rect = panel.getBoundingClientRect();
  const step = event.shiftKey ? 40 : 16;
  setSize(
    panel,
    rect.width +
      (event.key === 'ArrowRight'
        ? step
        : event.key === 'ArrowLeft'
          ? -step
          : 0),
    rect.height +
      (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
  );
  saveSizes();
}
function saveSizes() {
  for (const id of PANEL_IDS) {
    const panel = document.getElementById(id);
    if (panel && panel.style.width && panel.style.height)
      saved.sizes[id] = {
        width: parseFloat(panel.style.width),
        height: parseFloat(panel.style.height),
      };
  }
  persist();
}
function movePanel(id, delta) {
  const index = saved.order.indexOf(id),
    next = index + delta;
  if (index < 0 || next < 0 || next >= saved.order.length) return;
  [saved.order[index], saved.order[next]] = [
    saved.order[next],
    saved.order[index],
  ];
  renderOrder();
  persist();
  document.getElementById(id)?.querySelector('.layout-move')?.focus();
}
function renderOrder() {
  board.prepend(...saved.order.map((id) => document.getElementById(id)));
}
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
export function setLayoutLocale(nextLocale) {
  locale = nextLocale === 'en' ? 'en' : 'es';
  const strings = labels[locale];
  const reset = document.getElementById('layout-reset');
  if (reset) reset.textContent = strings.reset;
  document.querySelectorAll('[data-layout-title]').forEach((node) => {
    node.textContent = strings[node.dataset.layoutTitle];
  });
  document.querySelectorAll('[data-layout-text]').forEach((node) => {
    node.textContent = strings[node.dataset.layoutText];
  });
  document.querySelectorAll('[data-layout-option]').forEach((node) => {
    node.textContent = strings[node.dataset.layoutOption];
  });
  document
    .querySelectorAll('.layout-move')
    .forEach((node) =>
      node.setAttribute('aria-label', strings[node.dataset.move]),
    );
  document.querySelectorAll('.layout-resize').forEach((node) => {
    node.setAttribute('aria-label', strings.resize);
    node.title = strings.resize;
  });
  for (const id of ['sequence-panel', 'explanation-panel'])
    document
      .getElementById(id)
      ?.setAttribute('aria-label', strings[panelTitle(id)]);
}
export function initLayout() {
  if (initialized) return;
  initialized = true;
  const main = document.querySelector('.main-area');
  if (!main) return;
  try {
    saved = validLayout(JSON.parse(localStorage.getItem(STORAGE_KEY))) || saved;
  } catch {
    /* ignore invalid preference */
  }
  board = document.createElement('section');
  board.id = 'layout-board';
  board.setAttribute(
    'aria-label',
    locale === 'es' ? 'Paneles de trabajo' : 'Workspace panels',
  );
  const anchor = document.querySelector('.basic-hint');
  anchor?.after(board);
  buildExtraPanels();
  for (const id of PANEL_IDS) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    panel.classList.add('layout-panel');
    board.append(panel);
    attachControls(panel, DEFAULT_ORDER.includes(id));
    const size = saved.sizes[id];
    if (size) {
      panel.style.width = `${size.width}px`;
      panel.style.height = `${size.height}px`;
    }
  }
  // Keep the orderable set contiguous, with the editor and static diagram following it.
  renderOrder();
  const diagram = document.getElementById('diagram-panel'),
    editor = document.getElementById('editor-panel');
  if (diagram) board.append(diagram);
  if (editor) board.append(editor);
  board.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('text/plain'))
      event.preventDefault();
  });
  board.addEventListener('drop', (event) => {
    event.preventDefault();
    const from = event.dataTransfer?.getData('text/plain');
    const target = event.target.closest('.layout-panel');
    if (
      !from ||
      !target ||
      !DEFAULT_ORDER.includes(target.id) ||
      from === target.id
    )
      return;
    const fromIndex = saved.order.indexOf(from),
      targetIndex = saved.order.indexOf(target.id);
    saved.order.splice(fromIndex, 1);
    saved.order.splice(targetIndex, 0, from);
    renderOrder();
    persist();
  });
  document.getElementById('layout-reset')?.addEventListener('click', () => {
    saved = { order: [...DEFAULT_ORDER], sizes: {} };
    for (const id of PANEL_IDS) {
      const panel = document.getElementById(id);
      if (panel) {
        panel.style.width = '';
        panel.style.height = '';
      }
    }
    renderOrder();
    persist();
  });
  setLayoutLocale(locale);
}
