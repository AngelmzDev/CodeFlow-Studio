import { Playback } from '../src/core/playback.ts';
import {
  formatValue,
  selectViews,
  renderStateSvg,
} from '../src/visualization/views.ts';
import { validateTrace } from '../src/core/trace.ts';
import { validateAnalysis } from '../src/core/analysis.ts';
import {
  renderActivitySvg,
  renderClassSvg,
} from '../src/visualization/activity.ts';
import { applyTranslations, t } from './i18n.js';
import { renderSequenceSvg } from '../src/visualization/sequence.ts';
import { initLayout, setLayoutLocale } from './layout.js';
import { initExplanation } from './explanation.js';

const $ = (id) => document.getElementById(id);
const $q = (selector) => document.querySelector(selector);
const CAP_LABELS = {
  stepping: 'Stepping',
  variables: 'Variables',
  callStack: 'Call stack',
  objects: 'Objects',
  arrays: 'Arrays',
  memory: 'Memory view',
  stdin: 'Standard input',
  stdout: 'Output',
  exceptions: 'Exceptions',
  conditionValues: 'Condition values',
  loopEvents: 'Loop events',
  reverseExecution: 'Reverse debuggee',
};
const CAP_KEYS = Object.keys(CAP_LABELS);
const MAX_SOURCE_CHARS = 100000;
const MAX_SOURCE_LINES = 10000;
const MAX_TRACE_JSON_BYTES = 32 * 1024 * 1024;
const state = {
  adapters: [],
  examples: [],
  adapter: null,
  source: '',
  filename: '',
  originalSource: '',
  trace: null,
  playback: null,
  unsubscribe: null,
  offline: false,
  runId: 0,
  dirty: false,
  selectedLanguage: '',
  errorTimer: null,
  currentlyShownViews: [],
  analysis: null,
  analysisSource: null,
  analysisCurrent: false,
  selectedDiagramId: null,
  uiLanguage: localStorage.getItem('codeflow-language') || 'es',
  visitedLines: new Set(),
  entryExplicit: false,
  filenameExplicit: false,
};

function setText(id, value) {
  $(id).textContent =
    value === null || value === undefined ? '' : String(value);
}
function assertSourceForView(source) {
  if (source.length > MAX_SOURCE_CHARS)
    throw new Error(t('sourceTooLong', state.uiLanguage));
  if (source.split('\n').length > MAX_SOURCE_LINES)
    throw new Error(t('tooManyLines', state.uiLanguage));
}
function escapeName(value) {
  return (
    String(value || 'trace')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'trace'
  );
}
function saveDraft() {
  if (state.offline) return;
  try {
    localStorage.setItem(
      'codeflow-draft',
      JSON.stringify({
        source: state.source,
        filename: state.filename,
        language: state.selectedLanguage,
      }),
    );
  } catch {
    /* The editor remains usable when storage is full. */
  }
}
function showError(message) {
  setText('alert-message', message || t('genericError', state.uiLanguage));
  $('alert-toast').hidden = false;
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(() => {
    $('alert-toast').hidden = true;
  }, 8000);
}
function hideError() {
  $('alert-toast').hidden = true;
}
function setBusy(busy) {
  const b = $('run-button');
  b.disabled = busy;
  b.innerHTML = busy
    ? `<span class="spinner" aria-hidden="true"></span><span>${state.uiLanguage === 'es' ? 'Ejecutando…' : 'Tracing…'}</span>`
    : `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6z"/></svg><span>${t('runTrace', state.uiLanguage)}</span><kbd>Ctrl/⌘ ⇧ ↵</kbd>`;
}
function setEditorMode(replay) {
  $('editor-content').hidden = replay;
  $('trace-source').hidden = !replay;
  $('editor-tab-state').textContent = replay
    ? state.uiLanguage === 'es'
      ? 'CÓDIGO DE LA TRAZA'
      : 'TRACE SOURCE'
    : t('editing', state.uiLanguage);
  $('editor-tab-state').classList.toggle('replaying', replay);
  $('source-editor').readOnly = state.offline;
  $('reset-source').disabled = replay || !state.dirty;
  $('edit-source').hidden = !replay || state.offline;
}
function updateGutter(activeLine = 0) {
  const lines = state.source.split('\n').slice(0, MAX_SOURCE_LINES);
  const gutter = $('line-gutter');
  gutter.replaceChildren();
  for (let n = 1; n <= lines.length; n++) {
    const span = document.createElement('div');
    span.className = `line-number${n === activeLine ? ' current' : ''}`;
    span.textContent = n;
    gutter.append(span);
  }
}
function updatePosition() {
  const el = $('source-editor');
  const before = el.value.slice(0, el.selectionStart);
  const line = before.split('\n').length;
  const col = before.length - before.lastIndexOf('\n');
  setText(
    'editor-position',
    `${t('line', state.uiLanguage)} ${line}, ${t('column', state.uiLanguage)} ${col}`,
  );
  if (!state.playback) updateGutter();
}
function renderTraceSource(line = 0) {
  const gutter = $('trace-gutter');
  const code = $('trace-code');
  gutter.replaceChildren();
  code.replaceChildren();
  const lines = state.source.split('\n').slice(0, MAX_SOURCE_LINES);
  lines.forEach((text, i) => {
    const number = document.createElement('div');
    number.className = `line-number${i + 1 === line ? ' current' : ''}`;
    number.textContent = i + 1;
    gutter.append(number);
    const lineEl = document.createElement('span');
    lineEl.className = `trace-line${i + 1 === line ? ' active' : ''}`;
    lineEl.textContent = text || ' ';
    code.append(lineEl);
  });
  if (line > 0) {
    const item = code.children[line - 1];
    if (item) {
      const pane = $('trace-source');
      const top = 12 + (line - 1) * 22;
      const bottom = top + 22;
      if (top < pane.scrollTop) pane.scrollTop = top;
      else if (bottom > pane.scrollTop + pane.clientHeight)
        pane.scrollTop = bottom - pane.clientHeight;
    }
  }
}
function getLanguageAdapter(language) {
  return state.adapters.find((a) => a.language === language) || null;
}
function extensionFor(language) {
  return getLanguageAdapter(language)?.extensions?.[0] || '';
}
function syncLanguage(language) {
  state.selectedLanguage = language;
  const adapter = getLanguageAdapter(language);
  state.adapter = adapter;
  const label = visibleLanguageLabel(adapter, language);
  const glyph = label.slice(0, 2).toUpperCase();
  setText('language-glyph', glyph);
  setText('editor-language', label.toUpperCase());
  setText('file-meta', label);
  $('language-select').value = language;
  const wantedExtension = extensionFor(language);
  if (!state.filename || !state.filename.includes('.'))
    state.filename = `main${wantedExtension}`;
  setText('file-label', state.filename);
  setText('editor-tab-name', state.filename);
  updateCapabilityUi();
  updateAnalysisAvailability();
}
function visibleLanguageLabel(adapter, language) {
  const normalized = String(language).toLowerCase();
  if (normalized.includes('python'))
    return t('pythonLanguage', state.uiLanguage);
  if (normalized.includes('java')) return t('javaLanguage', state.uiLanguage);
  return adapter?.label || language;
}
function updateAnalysisAvailability() {
  const supported =
    !state.offline &&
    state.adapter?.available === true &&
    state.adapter?.analysis === true;
  $('diagram-generate').disabled = !supported;
  if (!supported && !state.analysisCurrent)
    setText('diagram-explanation', t('noStaticAnalyzer', state.uiLanguage));
}
function invalidateAnalysis() {
  state.analysisCurrent = false;
  $('diagram-export-svg').disabled = true;
  $('diagram-export-jpg').disabled = true;
  const empty = document.createElement('div');
  empty.className = 'diagram-empty';
  const title = document.createElement('strong');
  title.textContent = t('diagramEmptyTitle', state.uiLanguage);
  const detail = document.createElement('p');
  detail.textContent = t(
    state.analysis ? 'changedSource' : 'diagramEmptyText',
    state.uiLanguage,
  );
  empty.append(title, detail);
  $('diagram-stage').replaceChildren(empty);
  $('diagram-warning').hidden = true;
}
function renderLanguageMenu() {
  const select = $('language-select');
  const nav = $('language-list');
  select.replaceChildren();
  nav.replaceChildren();
  const languages = [...new Set(state.adapters.map((a) => a.language))];
  select.disabled = state.offline || !state.adapters.some((a) => a.available);
  if (!languages.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('noRuntimes', state.uiLanguage);
    option.disabled = true;
    select.append(option);
    const empty = document.createElement('div');
    empty.className = 'language-item disabled';
    empty.textContent = t('noRuntimes', state.uiLanguage);
    nav.append(empty);
    setText('adapter-count', '00');
    state.selectedLanguage = '';
    state.adapter = null;
    updateAnalysisAvailability();
    return;
  }
  for (const lang of languages) {
    const adapter =
      getLanguageAdapter(lang) ||
      (lang === state.selectedLanguage ? state.adapter : null);
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = visibleLanguageLabel(adapter, lang);
    if (adapter?.available === false)
      option.textContent += ` — ${t('runtimeMissing', state.uiLanguage)}`;
    option.disabled = !!adapter && !adapter.available;
    select.append(option);
    const item = document.createElement('div');
    item.dataset.language = lang;
    item.className = `language-item${lang === state.selectedLanguage ? ' active' : ''}${adapter?.available === false ? ' disabled' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'lang-icon';
    icon.textContent = lang.slice(0, 2).toUpperCase();
    const label = document.createElement('span');
    label.textContent = visibleLanguageLabel(adapter, lang);
    const availability = document.createElement('span');
    availability.className = 'availability';
    availability.textContent = adapter?.available
      ? t('available', state.uiLanguage).toUpperCase()
      : adapter
        ? t('runtimeMissing', state.uiLanguage).toUpperCase()
        : t('embeddedTrace', state.uiLanguage).toUpperCase();
    item.append(icon, label, availability);
    nav.append(item);
  }
  if (!languages.includes(state.selectedLanguage))
    state.selectedLanguage =
      state.adapters.find((a) => a.available)?.language || languages[0];
  syncLanguage(state.selectedLanguage);
  setText('adapter-count', String(languages.length).padStart(2, '0'));
}
function updateCapabilityUi() {
  const adapter = state.adapter;
  const list = $('capability-list');
  list.replaceChildren();
  if (!adapter?.capabilities) {
    const p = document.createElement('span');
    p.className = 'capability-placeholder';
    p.textContent = t('connectFeatures', state.uiLanguage);
    list.append(p);
    setText('adapter-state', t('adapterUnavailable', state.uiLanguage));
    $('adapter-state').className = 'adapter-state unavailable';
    setText('limitations', adapter?.reason || '');
    $('console-panel').hidden = true;
    return;
  }
  const caps = adapter.capabilities;
  let any = false;
  for (const key of CAP_KEYS) {
    if (!(key in caps)) continue;
    any = true;
    const chip = document.createElement('span');
    chip.className = `cap-chip${caps[key] ? '' : ' off'}`;
    chip.textContent = t(`cap_${key}`, state.uiLanguage);
    list.append(chip);
  }
  if (!any) {
    const p = document.createElement('span');
    p.className = 'capability-placeholder';
    p.textContent = t('noCapabilityDetails', state.uiLanguage);
    list.append(p);
  }
  setText(
    'adapter-state',
    state.offline
      ? t('embeddedTrace', state.uiLanguage)
      : adapter.available
        ? t('available', state.uiLanguage)
        : t('runtimeMissing', state.uiLanguage),
  );
  $('adapter-state').className =
    `adapter-state ${state.offline || adapter.available ? 'available' : 'unavailable'}`;
  const limitations = Array.isArray(caps.limitations) ? caps.limitations : [];
  setText(
    'limitations',
    [adapter.reason, ...limitations].filter(Boolean).join(' · '),
  );
  $('run-button').disabled = !adapter.available || state.offline;
  $('console-panel').hidden = !caps.stdout;
}
function sampleFor(language) {
  return state.examples.find((x) => x.language === language) || null;
}
function reflectTraceLanguage(language) {
  const select = $('language-select');
  let option = [...select.options].find((item) => item.value === language);
  if (!option) {
    option = document.createElement('option');
    option.value = language;
    option.textContent = state.adapter?.label || language;
    select.append(option);
  }
  select.value = language;
  setText('language-glyph', language.slice(0, 2).toUpperCase());
  setText('editor-language', language.toUpperCase());
  setText('file-meta', language);
  const nav = $('language-list');
  let item = [...nav.children].find(
    (node) => node.dataset.language === language,
  );
  if (!item) {
    item = document.createElement('div');
    item.dataset.language = language;
    item.className = 'language-item';
    const icon = document.createElement('span');
    icon.className = 'lang-icon';
    icon.textContent = language.slice(0, 2).toUpperCase();
    const label = document.createElement('span');
    label.textContent = state.adapter?.label || language;
    const availability = document.createElement('span');
    availability.className = 'availability';
    availability.textContent = state.adapter?.available ? 'READY' : 'TRACE';
    item.append(icon, label, availability);
    nav.append(item);
  }
  [...nav.children].forEach((node) =>
    node.classList.toggle('active', node === item),
  );
  setText('adapter-count', String(nav.children.length).padStart(2, '0'));
}
function loadSource(
  source,
  filename,
  dirty = false,
  example = false,
  filenameExplicit = false,
) {
  clearTrace();
  state.source = String(source ?? '');
  state.filename = filename || `main${extensionFor(state.selectedLanguage)}`;
  state.filenameExplicit = filenameExplicit;
  state.dirty = dirty;
  invalidateAnalysis();
  $('source-editor').value = state.source;
  updateGutter();
  setText('file-label', state.filename);
  setText('editor-tab-name', state.filename);
  setText(
    'source-state',
    dirty
      ? t('unsaved', state.uiLanguage)
      : example
        ? t('apiExample', state.uiLanguage)
        : t('ready', state.uiLanguage),
  );
  $('dirty-dot').hidden = !dirty;
  $('reset-source').disabled = !dirty;
  $('entry-input').value = '';
  state.entryExplicit = false;
  $('stdin-input').value = '';
}
function restoreExample() {
  const example = sampleFor(state.selectedLanguage);
  if (example) {
    loadSource(example.source, example.filename, false, true);
    $('entry-input').value = example.entry || '';
    $('stdin-input').value = example.stdin || '';
  } else loadSource('', 'main' + extensionFor(state.selectedLanguage), false);
}
function clearTrace() {
  if (!state.trace && !state.playback) return;
  state.playback?.pause();
  state.unsubscribe?.();
  state.playback = null;
  state.unsubscribe = null;
  state.trace = null;
  state.currentlyShownViews = capabilityViews();
  document.documentElement.dataset.hasTrace = 'false';
  $('timeline-empty').hidden = false;
  $('timeline-content').hidden = true;
  $('trace-status').hidden = true;
  $('export-json').disabled = true;
  $('export-svg').disabled = true;
  $('export-html').disabled = true;
  $('clear-console').disabled = true;
  renderTimeline(0);
  renderState(null);
  renderConsole(null);
  renderSequence();
  explanations.update();
  setEditorMode(false);
}
function capabilityViews() {
  const caps = state.adapter?.capabilities || {};
  try {
    return selectViews(caps) || [];
  } catch {
    return [];
  }
}
function capabilityHas(name, views) {
  return views.includes(name);
}
function makeSection(title, sub = '') {
  const section = document.createElement('section');
  section.className = 'state-section';
  const head = document.createElement('div');
  head.className = 'state-section-head';
  const label = document.createElement('span');
  label.textContent = title;
  head.append(label);
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    head.append(small);
  }
  section.append(head);
  return section;
}
function valueText(value) {
  try {
    return formatValue(value);
  } catch {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
function appendVarRow(parent, name, value, change) {
  const row = document.createElement('div');
  row.className = 'variable-row';
  if (change) row.classList.add('variable-changed');
  const n = document.createElement('span');
  n.className = 'variable-name';
  n.textContent = name;
  const v = document.createElement('span');
  v.className = 'variable-value';
  if (change && Object.prototype.hasOwnProperty.call(change, 'before')) {
    const before = document.createElement('span');
    before.className = 'change-before';
    before.textContent = valueText(change.before);
    v.append(before);
    const arrow = document.createElement('span');
    arrow.className = 'change-arrow';
    arrow.textContent = ' → ';
    v.append(arrow);
  }
  const after = document.createElement('span');
  after.textContent = valueText(value);
  v.append(after);
  if (value?.type) {
    const type = document.createElement('span');
    type.className = 'value-type';
    type.textContent = ` ${value.type}`;
    v.append(type);
  }
  if (change?.provenance === 'derived') {
    const tag = document.createElement('span');
    tag.className = 'derived-tag';
    tag.textContent = state.uiLanguage === 'es' ? 'CAMBIO' : 'CHANGE';
    v.append(tag);
  }
  row.append(n, v);
  parent.append(row);
}
function renderState(event, index) {
  const content = $('state-content');
  content.replaceChildren();
  $('event-type').textContent = event?.location?.line
    ? `${t('line', state.uiLanguage)} ${event.location.line}`
    : event
      ? eventLabel(event)
      : '—';
  $('event-type').className =
    `event-type${event?.type === 'exception' ? ' exception' : ''}`;
  $('event-count').textContent =
    `${state.trace?.events?.length || 0} ${t((state.trace?.events?.length || 0) === 1 ? 'event' : 'events', state.uiLanguage)}`;
  if (!event) {
    const empty = document.createElement('div');
    empty.className = 'state-empty';
    empty.textContent = t('stepToInspect', state.uiLanguage);
    content.append(empty);
    return;
  }
  const views = state.currentlyShownViews;
  const line = event.location?.line;
  renderTraceSource(line || 0);
  if (capabilityHas('variables', views)) {
    const changes = (event.changes || []).filter(
      (c) => c.provenance === 'derived',
    );
    const frames = event.frames || [];
    const section = makeSection(
      t('variables', state.uiLanguage),
      t('observedSnapshot', state.uiLanguage),
    );
    if (!frames.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-section';
      empty.textContent = t('noFrameSnapshot', state.uiLanguage);
      section.append(empty);
    }
    for (const frame of frames) {
      if (frames.length > 1) {
        const frameHead = document.createElement('div');
        frameHead.className = 'frame-row';
        const strong = document.createElement('strong');
        strong.textContent = frame.name || 'frame';
        const loc = document.createElement('span');
        loc.className = 'frame-line';
        loc.textContent = frame.location?.line
          ? `${t('line', state.uiLanguage)} ${frame.location.line}`
          : '';
        frameHead.append(strong, loc);
        section.append(frameHead);
      }
      for (const [name, value] of Object.entries(frame.locals || {})) {
        const change = changes.find(
          (c) => c.frameId === frame.id && c.name === name,
        );
        appendVarRow(section, name, value, change);
      }
    }
    content.append(section);
  }
  if (capabilityHas('callStack', views)) {
    const section = makeSection(
      t('callStack', state.uiLanguage),
      t('observed', state.uiLanguage),
    );
    const frames = event.frames || [];
    if (!frames.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-section';
      empty.textContent = t('noFrames', state.uiLanguage);
      section.append(empty);
    }
    frames.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'frame-row';
      const name = document.createElement('strong');
      name.textContent = f.name || `frame ${i + 1}`;
      const loc = document.createElement('span');
      loc.className = 'frame-line';
      loc.textContent = f.location?.line ? `${f.location.line}` : '';
      row.append(name, loc);
      section.append(row);
    });
    const details = document.createElement('details');
    details.className = 'stack-details';
    const summary = document.createElement('summary');
    summary.textContent = t('callStack', state.uiLanguage);
    details.append(summary, section);
    content.append(details);
  }
  if (
    capabilityHas('arrays', views) ||
    capabilityHas('objects', views) ||
    capabilityHas('memory', views)
  ) {
    const heap = event.heap || {};
    const entries = Object.entries(heap);
    const relevant = entries.filter(
      ([, obj]) =>
        (obj.kind === 'array' && capabilityHas('arrays', views)) ||
        (obj.kind !== 'array' && capabilityHas('objects', views)) ||
        capabilityHas('memory', views),
    );
    const title = capabilityHas('arrays', views)
      ? t('arraysAndObjects', state.uiLanguage)
      : capabilityHas('objects', views)
        ? t('objects', state.uiLanguage)
        : t('memory', state.uiLanguage);
    const section = makeSection(title, t('observedHeap', state.uiLanguage));
    if (!relevant.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-section';
      empty.textContent = t('noHeapObjects', state.uiLanguage);
      section.append(empty);
    }
    for (const [id, obj] of relevant.slice(0, 12)) {
      const card = document.createElement('div');
      card.className = 'object-card';
      const summary =
        obj.kind === 'array'
          ? `[${(obj.elements || []).map(valueText).join(', ')}]${obj.truncated ? ' …' : ''}`
          : `{${Object.entries(obj.fields || {})
              .map(([k, v]) => `${k}: ${valueText(v)}`)
              .join(', ')}}`;
      card.textContent = `${id} · ${obj.type || obj.kind}: ${summary}`;
      section.append(card);
    }
    if (relevant.length) content.append(section);
  }
  if (!content.childElementCount) {
    const empty = document.createElement('div');
    empty.className = 'state-empty';
    empty.textContent = t('noStateViews', state.uiLanguage);
    content.append(empty);
  }
}
function renderConsole(event) {
  const panel = $('console-content');
  panel.replaceChildren();
  const stdout = event?.output?.stdout || '';
  const stderr = event?.output?.stderr || '';
  if (!stdout && !stderr) {
    const empty = document.createElement('div');
    empty.className = 'console-empty';
    empty.textContent = t('noOutputStep', state.uiLanguage);
    panel.append(empty);
    setText('console-live', t('noOutput', state.uiLanguage));
    $('console-live').className = 'console-live';
    return;
  }
  if (stdout) {
    const out = document.createElement('span');
    out.className = 'console-line stdout';
    out.textContent = stdout;
    panel.append(out);
  }
  if (stderr) {
    const err = document.createElement('span');
    err.className = 'console-line stderr';
    err.textContent = stderr;
    panel.append(err);
  }
  panel.scrollTop = panel.scrollHeight;
  setText('console-live', t('cumulative', state.uiLanguage));
  $('console-live').className = 'console-live active';
}
function eventLabel(event) {
  return event.detail?.name || event.detail?.message || event.type;
}
function renderTimeline(index = 0) {
  const events = state.trace?.events || [];
  const strip = $('event-strip');
  strip.replaceChildren();
  const start = Math.max(0, Math.min(index - 39, events.length - 80));
  const end = Math.min(events.length, start + 80);
  for (let i = start; i < end; i++) {
    const event = events[i];
    const button = document.createElement('button');
    button.className = `event-button${i === index ? ' selected' : ''}`;
    button.type = 'button';
    button.dataset.type = event.type;
    button.setAttribute('role', 'listitem');
    button.setAttribute(
      'aria-label',
      `${t('event', state.uiLanguage)} ${i + 1}: ${eventLabel(event)}${event.location?.line ? `, ${t('line', state.uiLanguage)} ${event.location.line}` : ''}`,
    );
    const seq = document.createElement('span');
    seq.className = 'event-seq';
    seq.textContent = String(event.sequence ?? i);
    const name = document.createElement('span');
    name.className = 'event-name';
    name.textContent = eventLabel(event);
    const line = document.createElement('span');
    line.className = 'event-line';
    line.textContent = event.location?.line
      ? `${t('line', state.uiLanguage)} ${event.location.line}`
      : event.type === 'stdout'
        ? state.uiLanguage === 'es'
          ? 'salida'
          : 'output'
        : '—';
    button.append(seq, name, line);
    button.addEventListener('click', () => state.playback?.seek(i));
    strip.append(button);
  }
  const selected = strip.querySelector('.selected');
  if (selected) {
    const left = selected.offsetLeft;
    const right = left + selected.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = right - strip.clientWidth;
  }
  $('seek-slider').max = Math.max(0, events.length - 1);
  $('seek-slider').value = String(index);
  $('seek-slider').disabled = events.length < 2;
  setText('seek-count', `${events.length ? index + 1 : 0} / ${events.length}`);
  setText(
    'event-count',
    `${events.length} ${t(events.length === 1 ? 'event' : 'events', state.uiLanguage)}`,
  );
  const enabled = events.length > 0;
  ['previous-button', 'play-button', 'next-button', 'reset-button'].forEach(
    (id) => ($(id).disabled = !enabled),
  );
  $('previous-button').disabled = !enabled || index <= 0;
  $('next-button').disabled = !enabled || index >= events.length - 1;
  $('play-button').textContent = state.playback?.playing ? 'Ⅱ' : '▶';
  $('play-button').setAttribute(
    'aria-label',
    t(state.playback?.playing ? 'pause' : 'play', state.uiLanguage),
  );
}
function statusLabel(trace) {
  if (trace.status === 'exception')
    return t('traceException', state.uiLanguage);
  if (trace.status === 'limited') return t('traceLimited', state.uiLanguage);
  return t('traceComplete', state.uiLanguage);
}
function onPlayback(event, index) {
  renderTimeline(index);
  const line = event?.location?.line;
  state.visitedLines = new Set(
    state.trace.events
      .slice(0, index + 1)
      .map((item) => item.location?.line)
      .filter(Boolean),
  );
  if (state.analysisCurrent && state.analysis && line)
    renderCurrentDiagram(line);
  renderState(event, index);
  renderConsole(event);
  renderSequence();
  explanations.update();
}
function renderSequence() {
  const panel = $('sequence-content');
  if (state.trace)
    panel.innerHTML = renderSequenceSvg(
      state.trace,
      state.playback?.index ?? 0,
      {
        locale: state.uiLanguage,
        theme: document.documentElement.dataset.theme,
      },
    );
  else
    panel.textContent =
      state.uiLanguage === 'es'
        ? 'Las llamadas y retornos aparecerán al recorrer una traza.'
        : 'Calls and returns appear as you explore a trace.';
}
function applyDiagramZoom() {
  const svg = $('diagram-stage').querySelector('svg');
  $('diagram-zoom').disabled = !svg;
  if (!svg) return;
  const zoom = $('diagram-zoom').value;
  const stage = $('diagram-stage');
  const previousZoom = stage.dataset.zoom;
  stage.style.placeItems = 'start';
  if (zoom === 'fit') {
    const box = svg.viewBox.baseVal;
    const scale = Math.max(
      0.75,
      Math.min(1, (stage.clientWidth - 32) / box.width),
    );
    svg.style.width = `${box.width * scale}px`;
    svg.style.height = `${box.height * scale}px`;
    svg.style.maxHeight = 'none';
    svg.style.maxWidth = 'none';
  } else {
    const box = svg.viewBox.baseVal;
    const scale = Number(zoom);
    svg.style.width = box.width * scale + 'px';
    svg.style.height = box.height * scale + 'px';
    svg.style.maxHeight = 'none';
    svg.style.maxWidth = 'none';
    if (previousZoom === 'fit') {
      const start = svg.querySelector('.node-start');
      if (start) {
        const box = start.getBBox();
        stage.scrollLeft = Math.max(
          0,
          (box.x + box.width / 2) * scale - stage.clientWidth / 2,
        );
        stage.scrollTop = Math.max(
          0,
          (box.y + box.height / 2) * scale - stage.clientHeight / 2,
        );
      }
    }
  }
  stage.dataset.zoom = zoom;
}
function zoomDiagramWithWheel(event) {
  if (!event.ctrlKey) return;
  const stage = $('diagram-stage');
  const svg = stage.querySelector('svg');
  if (!svg) return;
  event.preventDefault();

  const select = $('diagram-zoom');
  const levels = [...select.options]
    .map((option) => Number(option.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const current = Number(select.value);
  const currentIndex = levels.indexOf(current > 0 ? current : 1);
  const nextIndex = Math.max(
    0,
    Math.min(levels.length - 1, currentIndex + (event.deltaY < 0 ? 1 : -1)),
  );
  const next = levels[nextIndex];
  if (next === current) return;
  state.diagramZoomTouched = true;

  const box = svg.viewBox.baseVal;
  const svgRect = svg.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const pointerX = event.clientX - stageRect.left - stage.clientLeft;
  const pointerY = event.clientY - stageRect.top - stage.clientTop;
  const diagramX = (event.clientX - svgRect.left) / (svgRect.width / box.width);
  const diagramY =
    (event.clientY - svgRect.top) / (svgRect.height / box.height);

  select.value = String(next);
  applyDiagramZoom();
  stage.scrollLeft = Math.max(0, 14 + diagramX * next - pointerX);
  stage.scrollTop = Math.max(0, 14 + diagramY * next - pointerY);
}
async function exportDiagramJpg() {
  const svg = $('diagram-stage').querySelector('svg');
  if (!svg) return;
  hideError();
  let objectUrl;
  try {
    const box = svg.viewBox.baseVal;
    if (!box.width || !box.height) throw new Error('Invalid diagram size');
    const imageSvg = svg.cloneNode(true);
    imageSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    imageSvg.setAttribute('width', String(box.width));
    imageSvg.setAttribute('height', String(box.height));
    const svgBlob = new Blob(
      [new XMLSerializer().serializeToString(imageSvg)],
      {
        type: 'image/svg+xml;charset=utf-8',
      },
    );
    objectUrl = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(2, 4096 / Math.max(box.width, box.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.width * scale));
    canvas.height = Math.max(1, Math.round(box.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpg = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('JPG encoding failed')),
        'image/jpeg',
        0.92,
      ),
    );
    safeDownload(jpg, `${escapeName(state.filename)}-diagram.jpg`);
  } catch (error) {
    showError(error?.message || t('exportError', state.uiLanguage));
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
function renderCurrentDiagram(
  activeLine = state.playback?.state?.location?.line || 0,
) {
  if (!state.analysisCurrent || !state.analysis) return;
  const analysis = state.analysis;
  const type = $('diagram-type').value;
  const method = $('diagram-method');
  const stage = $('diagram-stage');
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', t('diagramStage', state.uiLanguage));
  if (type === 'classes') {
    method.hidden = true;
    stage.innerHTML = analysis.classes.length
      ? renderClassSvg(analysis.classes, {
          theme: document.documentElement.dataset.theme,
          locale: state.uiLanguage,
        })
      : '';
    if (!analysis.classes.length) {
      const empty = document.createElement('div');
      empty.className = 'diagram-empty';
      empty.textContent = t('noClasses', state.uiLanguage);
      stage.replaceChildren(empty);
    }
    $('diagram-export-svg').disabled = !analysis.classes.length;
    $('diagram-export-jpg').disabled = !analysis.classes.length;
    applyDiagramZoom();
    $('diagram-warning').hidden = !analysis.diagnostics.length;
    $('diagram-warning').textContent = analysis.diagnostics.join(' · ');
    return;
  }
  const diagrams = analysis.diagrams || [];
  if (activeLine && !state.userSelectedDiagram) {
    const observed = diagrams.find((diagram) =>
      diagram.nodes.some(
        (node) =>
          !['start', 'end', 'merge'].includes(node.kind) &&
          node.line <= activeLine &&
          (node.endLine ?? node.line) >= activeLine,
      ),
    );
    if (observed) state.selectedDiagramId = observed.id;
  }
  method.replaceChildren();
  for (const diagram of diagrams) {
    const option = document.createElement('option');
    option.value = diagram.id;
    option.textContent =
      diagram.id === 'module'
        ? state.uiLanguage === 'es'
          ? 'Programa principal'
          : 'Main program'
        : diagram.label;
    method.append(option);
  }
  method.hidden = diagrams.length < 2;
  const selected =
    diagrams.find((diagram) => diagram.id === state.selectedDiagramId) ||
    diagrams[0];
  if (selected) {
    state.selectedDiagramId = selected.id;
    method.value = selected.id;
    stage.innerHTML = renderActivitySvg(selected, {
      source: analysis.source.content,
      theme: document.documentElement.dataset.theme,
      locale: state.uiLanguage,
      activeLine,
      visitedLines: [...state.visitedLines],
    });
    $('diagram-export-svg').disabled = false;
    $('diagram-export-jpg').disabled = false;
    if (!state.diagramZoomTouched) {
      $('diagram-zoom').value = 'fit';
      stage.dataset.zoom = 'fit';
    }
    applyDiagramZoom();
    const warnings = [
      ...new Set([
        ...(analysis.diagnostics || []),
        ...(selected.warnings || []),
      ]),
    ];
    $('diagram-warning').hidden = !warnings.length;
    $('diagram-warning').textContent = warnings.join(' · ');
    setText(
      'diagram-explanation',
      activeLine
        ? `${t('traceHighlight', state.uiLanguage)} (${t('line', state.uiLanguage)} ${activeLine})`
        : t('diagramReady', state.uiLanguage),
    );
  } else {
    const empty = document.createElement('div');
    empty.className = 'diagram-empty';
    empty.textContent = t('noMethods', state.uiLanguage);
    stage.replaceChildren(empty);
    $('diagram-export-svg').disabled = true;
    $('diagram-export-jpg').disabled = true;
    const warnings = analysis.diagnostics || [];
    $('diagram-warning').hidden = !warnings.length;
    $('diagram-warning').textContent = warnings.join(' · ');
  }
}
function acceptTrace(raw) {
  const trace = validateTrace(raw);
  trace.sources.forEach((source) => assertSourceForView(source.content));
  if (state.unsubscribe) state.unsubscribe();
  if (state.playback) state.playback.pause();
  const source = trace.sources[0];
  const runtimeAdapter = getLanguageAdapter(trace.language);
  state.trace = trace;
  document.documentElement.dataset.hasTrace = 'true';
  state.visitedLines = new Set();
  state.selectedLanguage = trace.language;
  state.filename = source.name;
  state.source = source.content;
  state.dirty = false;
  if (
    state.analysis &&
    (state.analysis.language !== trace.language ||
      state.analysisSource !== source.content)
  )
    invalidateAnalysis();
  state.adapter = {
    ...runtimeAdapter,
    language: trace.language,
    label: runtimeAdapter?.label || trace.language,
    available: runtimeAdapter?.available ?? false,
    reason: runtimeAdapter?.reason,
    extensions: runtimeAdapter?.extensions || [],
    capabilities: trace.adapter.capabilities,
  };
  $('source-editor').value = state.source;
  updateGutter();
  setText('file-label', state.filename);
  setText('editor-tab-name', state.filename);
  setText('source-state', t('traceSourceState', state.uiLanguage));
  $('dirty-dot').hidden = true;
  $('reset-source').disabled = true;
  reflectTraceLanguage(trace.language);
  updateCapabilityUi();
  state.currentlyShownViews = capabilityViews();
  state.playback = new Playback(trace);
  state.unsubscribe = state.playback.subscribe(onPlayback);
  $('timeline-empty').hidden = true;
  $('timeline-content').hidden = false;
  $('trace-status').hidden = false;
  $('trace-status').className =
    `trace-status${trace.status === 'exception' ? ' error' : ''}`;
  setText(
    'trace-status',
    `${statusLabel(trace)}${trace.diagnostics?.length ? ` · ${trace.diagnostics.join(' · ')}` : ''}`,
  );
  $('export-json').disabled = false;
  $('export-svg').disabled = false;
  $('export-html').disabled = state.offline;
  $('clear-console').disabled = false;
  setEditorMode(true);
  $('source-editor').blur();
  state.playback.reset();
}
async function getSessionToken() {
  const response = await fetch('/api/session', { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token)
    throw new Error(
      data.error
        ? `${t('sessionFailed', state.uiLanguage)} ${data.error}`
        : t('sessionFailed', state.uiLanguage),
    );
  return data.token;
}
async function runTrace() {
  if (state.offline) return;
  if (!state.adapter?.available) {
    showError(
      state.adapter?.reason || t('runtimeUnavailable', state.uiLanguage),
    );
    return;
  }
  if (!$('trust-check').checked) {
    $('trust-check-wrap').focus?.();
    showError(t('confirmTrust', state.uiLanguage));
    $('trust-check').focus();
    return;
  }
  try {
    assertSourceForView(state.source);
  } catch (error) {
    showError(error.message);
    return;
  }
  if (
    state.adapter?.analysis === true &&
    (!state.analysisCurrent || state.analysisSource !== state.source)
  ) {
    await createDiagram();
  }
  let args = [];
  try {
    const rawArgs = $('args-input').value.trim();
    args = rawArgs ? JSON.parse(rawArgs) : [];
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
      throw new Error();
  } catch {
    showError(t('argsInvalid', state.uiLanguage));
    $('args-input').focus();
    return;
  }
  hideError();
  if (state.playback) state.playback.pause();
  if (state.unsubscribe) state.unsubscribe();
  state.playback = null;
  state.trace = null;
  state.runId++;
  const thisRun = state.runId;
  setBusy(true);
  $('timeline-empty').hidden = false;
  $('timeline-content').hidden = true;
  $('trace-status').hidden = true;
  $('export-json').disabled = true;
  $('export-svg').disabled = true;
  $('export-html').disabled = true;
  $('clear-console').disabled = true;
  renderState(null);
  $('console-content').replaceChildren();
  const wait = document.createElement('div');
  wait.className = 'console-empty';
  wait.textContent = t('adapterWait', state.uiLanguage);
  $('console-content').append(wait);
  setEditorMode(false);
  try {
    const token = await getSessionToken();
    const payload = {
      language: state.selectedLanguage,
      source: state.source,
      filename: state.filename,
      entry: $('entry-input').value.trim() || undefined,
      stdin: $('stdin-input').value,
      args,
      allowLocalExecution: true,
    };
    const response = await fetch('/api/trace', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CodeFlow-Token': token,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (thisRun !== state.runId) return;
    if (!response.ok)
      throw new Error(
        data.error
          ? `${t('traceRequestFailed', state.uiLanguage)} ${data.error}`
          : `${t('traceRequestFailed', state.uiLanguage)} (${response.status}).`,
      );
    acceptTrace(data);
  } catch (error) {
    if (thisRun !== state.runId) return;
    setEditorMode(false);
    showError(
      error?.message || 'The local runtime could not run this program.',
    );
    renderState(null);
    $('console-content').replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'console-empty';
    empty.textContent = t('noTrace', state.uiLanguage);
    $('console-content').append(empty);
  } finally {
    if (thisRun === state.runId) setBusy(false);
  }
}
function safeDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportTrace(format) {
  if (!state.trace) return;
  hideError();
  try {
    let blob;
    if (state.offline) {
      if (format === 'json')
        blob = new Blob([JSON.stringify(state.trace, null, 2)], {
          type: 'application/json',
        });
      else if (format === 'svg')
        blob = new Blob(
          [
            renderStateSvg(state.playback?.state || state.trace.events[0], {
              theme: document.documentElement.dataset.theme || 'light',
            }),
          ],
          { type: 'image/svg+xml' },
        );
      else throw new Error(t('htmlExportUnavailable', state.uiLanguage));
    } else {
      const token = await getSessionToken();
      const response = await fetch('/api/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CodeFlow-Token': token,
        },
        body: JSON.stringify({
          trace: state.trace,
          analysis:
            state.analysisCurrent && state.analysisSource === state.source
              ? state.analysis
              : undefined,
          format,
          index: state.playback?.index ?? 0,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${response.status}).`);
      }
      blob = await response.blob();
    }
    const ext = format === 'json' ? 'json' : format;
    safeDownload(
      blob,
      `${escapeName(state.filename.replace(/\.[^.]+$/, ''))}-trace.${ext}`,
    );
  } catch (error) {
    showError(error?.message || t('exportError', state.uiLanguage));
  }
}
async function initializeOnline() {
  document.documentElement.dataset.theme =
    localStorage.getItem('codeflow-theme') || 'light';
  state.uiLanguage = localStorage.getItem('codeflow-language') || 'es';
  $('ui-language').value = state.uiLanguage;
  applyTranslations(state.uiLanguage);
  $('theme-select').value = document.documentElement.dataset.theme;
  $('source-editor').placeholder = t('pasteCode', state.uiLanguage);
  setMode();
  setText('workspace-state', t('localWorkspace', state.uiLanguage));
  try {
    const response = await fetch('/api/adapters', {
      credentials: 'same-origin',
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error
          ? `${t('serviceUnavailable', state.uiLanguage)} ${data.error}`
          : t('serviceUnavailable', state.uiLanguage),
      );
    state.adapters = Array.isArray(data.adapters) ? data.adapters : [];
    state.examples = Array.isArray(data.examples) ? data.examples : [];
    renderLanguageMenu();
    const status = $('server-status');
    status.textContent = t('serviceConnected', state.uiLanguage);
    status.previousElementSibling?.classList.add('online');
    setText(
      'workspace-state',
      state.adapters.some((a) => a.available)
        ? t('runtimesReady', state.uiLanguage)
        : t('noRuntimes', state.uiLanguage),
    );
    $('run-button').disabled = !state.adapter?.available;
  } catch (error) {
    renderLanguageMenu();
    $('server-status').textContent = t('serviceUnavailable', state.uiLanguage);
    $('server-status').previousElementSibling?.classList.add('offline');
    setText('workspace-state', t('serviceUnavailable', state.uiLanguage));
    state.adapters = [];
    state.adapter = null;
    updateCapabilityUi();
    updateAnalysisAvailability();
    $('run-button').disabled = true;
    $('timeline-empty').querySelector('p').textContent = t(
      'serviceUnavailable',
      state.uiLanguage,
    );
  }
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem('codeflow-draft'));
  } catch {
    /* Ignore damaged drafts. */
  }
  if (
    draft &&
    typeof draft.source === 'string' &&
    draft.source.length <= MAX_SOURCE_CHARS &&
    typeof draft.filename === 'string' &&
    state.adapters.some((a) => a.language === draft.language)
  ) {
    state.selectedLanguage = draft.language;
    syncLanguage(draft.language);
    renderLanguageMenu();
    loadSource(draft.source, draft.filename, true, false);
  } else loadSource('', `main${extensionFor(state.selectedLanguage)}`, false);
  $('source-editor').disabled = false;
  updatePosition();
}
function initializeOffline() {
  state.offline = true;
  $('source-editor').disabled = false;
  state.uiLanguage = localStorage.getItem('codeflow-language') || 'es';
  $('ui-language').value = state.uiLanguage;
  applyTranslations(state.uiLanguage);
  document.documentElement.dataset.theme =
    localStorage.getItem('codeflow-theme') || 'light';
  $('theme-select').value = document.documentElement.dataset.theme;
  $('source-editor').placeholder = t('pasteCode', state.uiLanguage);
  setMode();
  setText('workspace-state', t('embeddedTrace', state.uiLanguage));
  setText('server-status', t('offlineViewer', state.uiLanguage));
  $('trust-banner').hidden = true;
  $('export-html').hidden = true;
  document.querySelector('.workspace-grid').style.gridTemplateColumns =
    'minmax(0,1.7fr) minmax(250px,.8fr)';
  for (const id of [
    'run-button',
    'import-button',
    'source-file',
    'import-trace-button',
    'trace-file',
  ]) {
    const element = $(id);
    if (element) element.hidden = true;
  }
  $('language-select').disabled = true;
  try {
    const embeddedTrace = $('embedded-trace')
      ? validateTrace(JSON.parse($('embedded-trace').textContent))
      : null;
    const embeddedAnalysis = $('embedded-analysis');
    if (embeddedAnalysis) {
      const expected = embeddedTrace
        ? {
            language: embeddedTrace.language,
            source: embeddedTrace.sources[0].content,
          }
        : undefined;
      state.analysis = validateAnalysis(
        JSON.parse(embeddedAnalysis.textContent),
        expected,
      );
      state.analysisSource = state.analysis.source?.content || '';
      state.source = state.analysisSource;
      state.selectedLanguage = state.analysis.language;
      state.filename = state.analysis.source?.name || 'source';
      $('source-editor').value = state.source;
      updateGutter();
      state.analysisCurrent = true;
      state.selectedDiagramId = state.analysis.defaultDiagramId;
      renderCurrentDiagram();
      $('diagram-generate').hidden = true;
      $('run-button').hidden = true;
      $('trust-banner').hidden = true;
      $('editor-content').hidden = true;
      $('trace-source').hidden = true;
      $('source-editor').readOnly = true;
      if (!$('embedded-trace')) return;
    }
    if (!$('embedded-trace')) {
      $('run-button').hidden = true;
      $('diagram-generate').hidden = true;
      $('diagram-explanation').textContent = t(
        'offlineNoAnalysis',
        state.uiLanguage,
      );
      return;
    }
    $('diagram-explanation').textContent = t(
      'offlineNoAnalysis',
      state.uiLanguage,
    );
    const trace =
      embeddedTrace ||
      validateTrace(JSON.parse($('embedded-trace').textContent));
    const source = trace.sources[0];
    const extension = source.name.match(/\.[^.]+$/)?.[0] || '';
    state.adapters = [
      {
        language: trace.language,
        label: trace.language,
        extensions: extension ? [extension] : [],
        available: false,
        capabilities: trace.adapter.capabilities,
      },
    ];
    state.adapter = state.adapters[0];
    state.selectedLanguage = trace.language;
    const settings = $q('.settings-form');
    [...settings.children].forEach((child) => {
      if (
        !child.classList.contains('capability-head') &&
        child.id !== 'capability-list' &&
        child.id !== 'limitations'
      )
        child.remove();
    });
    $q('.inspector-panel .eyebrow')?.replaceChildren(
      document.createTextNode(t('traceDetails', state.uiLanguage)),
    );
    $q('.inspector-panel h2').textContent = t('capabilities', state.uiLanguage);
    $q('.settings-mark').hidden = true;
    acceptTrace(trace);
    const initialIndex = Number($('embedded-trace').dataset.eventIndex);
    if (Number.isInteger(initialIndex) && initialIndex > 0)
      state.playback.seek(initialIndex);
    for (const id of [
      'run-button',
      'trust-check-wrap',
      'security-caption',
      'edit-source',
      'timeline-empty',
    ]) {
      const element = $(id);
      if (element) element.hidden = true;
    }
  } catch (error) {
    showError(
      `${t('invalidEmbeddedTrace', state.uiLanguage)} ${error.message}`,
    );
  }
}
async function createDiagram() {
  if (state.adapter?.analysis !== true) {
    showError(t('noStaticAnalyzer', state.uiLanguage));
    return;
  }
  if (state.offline) {
    showError(t('sourceRequired', state.uiLanguage));
    return;
  }
  if (!state.source.trim()) {
    showError(t('sourceRequired', state.uiLanguage));
    return;
  }
  try {
    assertSourceForView(state.source);
  } catch (error) {
    showError(error.message);
    return;
  }
  const button = $('diagram-generate');
  button.disabled = true;
  button.textContent = t('createBusy', state.uiLanguage);
  hideError();
  try {
    const token = await getSessionToken();
    const response = await fetch('/api/analyze', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CodeFlow-Token': token,
      },
      body: JSON.stringify({
        language: state.selectedLanguage,
        source: state.source,
        filename: state.filename,
        entry: $('entry-input').value.trim() || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.error
          ? `${t('analyzeError', state.uiLanguage)} ${data.error}`
          : t('analyzeError', state.uiLanguage),
      );
    const analysis = validateAnalysis(data, {
      source: state.source,
      language: state.selectedLanguage,
    });
    state.analysis = analysis;
    state.analysisSource = state.source;
    state.analysisCurrent = true;
    state.selectedDiagramId = analysis.defaultDiagramId;
    state.userSelectedDiagram = false;
    state.visitedLines.clear();
    const primary = analysis.primaryEntry;
    $('diagram-type').value = analysis.diagrams.length
      ? 'activity'
      : analysis.classes.length
        ? 'classes'
        : 'activity';
    if (primary && !state.entryExplicit) $('entry-input').value = primary;
    if (
      state.selectedLanguage.toLowerCase().includes('java') &&
      primary &&
      !state.filenameExplicit
    ) {
      const simpleName = primary.split(/[.$]/).filter(Boolean).at(-1);
      state.filename = `${simpleName}.java`;
      setText('file-label', state.filename);
      setText('editor-tab-name', state.filename);
    }
    renderCurrentDiagram();
    setText('diagram-explanation', t('diagramReady', state.uiLanguage));
    saveDraft();
  } catch (error) {
    showError(
      `${t('analyzeError', state.uiLanguage)} ${error?.message || ''}`.trim(),
    );
  } finally {
    updateAnalysisAvailability();
    button.textContent = t('createDiagram', state.uiLanguage);
  }
}
function setMode() {
  document.documentElement.dataset.mode = 'student';
  $('execution-options').hidden = state.offline;
  $('run-setup').hidden = state.offline;
}

function setLocale(locale) {
  state.uiLanguage = locale;
  localStorage.setItem('codeflow-language', locale);
  applyTranslations(locale);
  setLayoutLocale(locale);
  explanations.update();
  renderSequence();
  $('diagram-generate').textContent = t('createDiagram', locale);
  const runText = $('run-button').querySelector('span:not(.spinner)');
  if (runText) runText.textContent = t('runTrace', locale);
  if (state.adapter) updateCapabilityUi();
  if (state.offline && state.trace) {
    $q('.inspector-panel .eyebrow').textContent = t('traceDetails', locale);
    $q('.inspector-panel h2').textContent = t('capabilities', locale);
  }
  updateAnalysisAvailability();
  if (state.trace) {
    renderTimeline(state.playback?.index ?? 0);
    renderState(state.playback?.state || null, state.playback?.index ?? 0);
    renderConsole(state.playback?.state || null);
  } else {
    setText(
      'source-state',
      state.dirty ? t('unsaved', locale) : t('ready', locale),
    );
    setEditorMode(false);
  }
  if (state.analysisCurrent) renderCurrentDiagram();
}
function setTheme() {
  const next =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  $('theme-select').value = next;
  localStorage.setItem('codeflow-theme', next);
  if (state.analysisCurrent) renderCurrentDiagram();
  renderSequence();
}
function bind() {
  $('entry-input').addEventListener('input', () => {
    state.entryExplicit = true;
  });
  $('source-editor').addEventListener('input', () => {
    clearTrace();
    state.source = $('source-editor').value;
    invalidateAnalysis();
    state.dirty = true;
    if (state.analysis) {
      setText('diagram-explanation', t('changedSource', state.uiLanguage));
      $('diagram-warning').hidden = true;
    }
    setText('source-state', t('unsaved', state.uiLanguage));
    $('dirty-dot').hidden = false;
    $('reset-source').disabled = false;
    updateGutter();
    saveDraft();
  });
  $('source-editor').addEventListener('keyup', updatePosition);
  $('source-editor').addEventListener('click', updatePosition);
  $('source-editor').addEventListener('scroll', () => {
    $('line-gutter').scrollTop = $('source-editor').scrollTop;
  });
  $('reset-source').addEventListener('click', restoreExample);
  $('edit-source').addEventListener('click', () => {
    clearTrace();
    setEditorMode(false);
    $('source-editor').focus();
  });
  $('language-select').addEventListener('change', (e) => {
    const source = state.source;
    const dirty = state.dirty;
    const filenameExplicit = state.filenameExplicit;
    const filename = state.filenameExplicit
      ? state.filename
      : `main${extensionFor(e.target.value)}`;
    const entry = $('entry-input').value;
    const stdin = $('stdin-input').value;
    state.selectedLanguage = e.target.value;
    syncLanguage(e.target.value);
    loadSource(source, filename, dirty, false, filenameExplicit);
    $('entry-input').value = entry;
    $('stdin-input').value = stdin;
    saveDraft();
  });
  $('load-example').addEventListener('click', restoreExample);
  $('run-button').addEventListener('click', runTrace);
  $('import-button').addEventListener('click', () => $('source-file').click());
  $('source-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_SOURCE_CHARS)
        throw new Error(t('sourceTooLong', state.uiLanguage));
      const adapter = state.adapters.find((item) =>
        item.extensions?.some((ext) =>
          file.name.toLowerCase().endsWith(ext.toLowerCase()),
        ),
      );
      if (!adapter) throw new Error(t('unsupportedFile', state.uiLanguage));
      const source = await file.text();
      state.selectedLanguage = adapter.language;
      $('language-select').value = adapter.language;
      syncLanguage(adapter.language);
      loadSource(source, file.name, true, false, true);
      setEditorMode(false);
    } catch (error) {
      showError(error?.message || t('readSourceError', state.uiLanguage));
    } finally {
      e.target.value = '';
    }
  });
  $('import-trace-button').addEventListener('click', () =>
    $('trace-file').click(),
  );
  $('trace-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_TRACE_JSON_BYTES)
        throw new Error(t('traceTooLarge', state.uiLanguage));
      acceptTrace(JSON.parse(await file.text()));
      hideError();
    } catch (error) {
      showError(error?.message || t('importTraceError', state.uiLanguage));
    } finally {
      e.target.value = '';
    }
  });
  $('previous-button').addEventListener('click', () =>
    state.playback?.previous(),
  );
  $('next-button').addEventListener('click', () => state.playback?.next());
  $('play-button').addEventListener('click', () =>
    state.playback?.playing ? state.playback.pause() : state.playback?.play(),
  );
  $('reset-button').addEventListener('click', () => state.playback?.reset());
  $('seek-slider').addEventListener('input', (e) =>
    state.playback?.seek(Number(e.target.value)),
  );
  $('speed-select').addEventListener('change', (e) =>
    state.playback?.setSpeed(Number(e.target.value)),
  );
  $('export-json').addEventListener('click', () => exportTrace('json'));
  $('export-svg').addEventListener('click', () => exportTrace('svg'));
  $('export-html').addEventListener('click', () => exportTrace('html'));
  $('clear-console').addEventListener('click', () => {
    if (state.playback?.state) renderConsole(null);
  });
  $('theme-toggle').addEventListener('click', setTheme);
  $('theme-select').addEventListener('change', (e) => {
    document.documentElement.dataset.theme = e.target.value;
    localStorage.setItem('codeflow-theme', e.target.value);
    if (state.analysisCurrent) renderCurrentDiagram();
    renderSequence();
  });
  $('ui-language').addEventListener('change', (e) => setLocale(e.target.value));
  $('diagram-generate').addEventListener('click', createDiagram);
  $('diagram-type').addEventListener('change', () => renderCurrentDiagram());
  $('diagram-zoom').addEventListener('change', () => {
    state.diagramZoomTouched = true;
    applyDiagramZoom();
  });
  $('diagram-stage').addEventListener('wheel', zoomDiagramWithWheel, {
    passive: false,
  });
  $('diagram-method').addEventListener('change', (e) => {
    state.selectedDiagramId = e.target.value;
    state.userSelectedDiagram = true;
    renderCurrentDiagram();
  });
  $('diagram-export-svg').addEventListener('click', () => {
    const svg = $('diagram-stage').querySelector('svg');
    if (svg)
      safeDownload(
        new Blob([svg.outerHTML], { type: 'image/svg+xml' }),
        `${escapeName(state.filename)}-diagram.svg`,
      );
  });
  $('diagram-export-jpg').addEventListener('click', exportDiagramJpg);
  $('banner-dismiss').addEventListener(
    'click',
    () => ($('trust-banner').hidden = true),
  );
  $('alert-close').addEventListener('click', hideError);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) runTrace();
      else createDiagram();
      return;
    }
    const editing =
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        document.activeElement?.tagName,
      ) || document.activeElement?.isContentEditable;
    if (editing) return;
    if (e.code === 'Space' && state.playback) {
      e.preventDefault();
      state.playback.playing ? state.playback.pause() : state.playback.play();
    } else if (e.key === 'ArrowLeft' && state.playback) {
      e.preventDefault();
      state.playback.previous();
    } else if (e.key === 'ArrowRight' && state.playback) {
      e.preventDefault();
      state.playback.next();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setTheme();
    }
  });
}

initLayout();
setLayoutLocale(state.uiLanguage);
const explanations = initExplanation(
  () => ({
    trace: state.trace,
    index: state.playback?.index ?? 0,
    locale: state.uiLanguage,
    offline: state.offline,
    playing: state.playback?.playing ?? false,
  }),
  getSessionToken,
);
explanations.update();
renderSequence();
bind();
if (
  document.getElementById('embedded-trace') ||
  document.getElementById('embedded-analysis')
)
  initializeOffline();
else initializeOnline();
