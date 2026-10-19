import dagre from '@dagrejs/dagre';
import type {
  ActivityDiagram,
  ActivityEdge,
  ActivityNode,
  ClassInfo,
} from './activity-types.ts';

type RenderOptions = {
  theme?: 'light' | 'dark';
  locale?: 'es' | 'en';
  activeLine?: number;
  visitedLines?: number[];
  source?: string;
};

const palette = (theme: 'light' | 'dark') =>
  theme === 'dark'
    ? {
        bg: '#101820',
        panel: '#18252e',
        ink: '#f1f5f7',
        muted: '#b3c4cf',
        stroke: '#718995',
        accent: '#6ee7c8',
        active: '#ffd166',
        visited: '#24483f',
        edge: '#b3c4cf',
      }
    : {
        bg: '#f4f7f6',
        panel: '#ffffff',
        ink: '#172e39',
        muted: '#4b6270',
        stroke: '#7d969d',
        accent: '#116653',
        active: '#9a5b00',
        visited: '#e1f2eb',
        edge: '#4b6270',
      };

const esc = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
const bounded = (value: unknown, max: number): string => {
  const s = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
function wrap(value: string, width: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    let rest = word;
    while (rest.length > width) {
      if (lines.length === maxLines)
        return [
          ...lines.slice(0, maxLines - 1),
          lines[maxLines - 1]!.slice(0, width - 1) + '…',
        ];
      if (lines.length && lines.at(-1)!.length < width) {
        const room = width - lines.at(-1)!.length - 1;
        lines[lines.length - 1] += ' ' + rest.slice(0, room);
        rest = rest.slice(room);
      } else {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
    }
    const last = lines.at(-1);
    if (last && last.length + rest.length + 1 <= width)
      lines[lines.length - 1] = last + ' ' + rest;
    else if (lines.length < maxLines) lines.push(rest);
    else {
      lines[maxLines - 1] = lines[maxLines - 1]!.slice(0, width - 1) + '…';
      return lines;
    }
  }
  return lines.length ? lines : [''];
}
const multiline = (
  x: number,
  y: number,
  lines: string[],
  color: string,
  size = 13,
  anchor = 'middle',
) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${color}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? 16 : 0}">${esc(line)}</tspan>`).join('')}</text>`;
const localizeEdge = (label: string, locale: 'es' | 'en') => {
  const key = label.trim().toLowerCase();
  const es: Record<string, string> = {
    true: 'Sí',
    false: 'No',
    repeat: 'Repetir',
    next: 'Siguiente',
  };
  const en: Record<string, string> = {
    true: 'Yes',
    false: 'No',
    repeat: 'Repeat',
    next: 'Next',
  };
  return (locale === 'es' ? es : en)[key] ?? label;
};
function cleanNodes(nodes: ActivityNode[]): ActivityNode[] {
  const used = new Set<string>();
  return nodes
    .slice(0, 200)
    .filter((n) => {
      if (!n || typeof n.id !== 'string' || !n.id || used.has(n.id))
        return false;
      used.add(n.id);
      return true;
    })
    .map((n) => ({
      ...n,
      id: bounded(n.id, 120),
      label: bounded(n.label, 1000),
      line: Number.isFinite(n.line) ? Math.max(0, n.line) : 0,
      endLine: Number.isFinite(n.endLine)
        ? Math.max(n.line, n.endLine!)
        : undefined,
    }));
}

function nodesForLine(nodes: ActivityNode[], line: number): ActivityNode[] {
  if (!Number.isFinite(line)) return [];
  const matches = nodes
    .filter(
      (n) =>
        !['start', 'end', 'merge'].includes(n.kind) &&
        n.line <= line &&
        (n.endLine ?? n.line) >= line,
    )
    .sort(
      (a, b) =>
        (a.endLine ?? a.line) - a.line - ((b.endLine ?? b.line) - b.line) ||
        a.id.localeCompare(b.id),
    );
  if (!matches.length) return [];
  const smallestSpan =
    (matches[0]!.endLine ?? matches[0]!.line) - matches[0]!.line;
  return matches.filter((n) => (n.endLine ?? n.line) - n.line === smallestSpan);
}

/** Returns the smallest matching span; equally narrow ties resolve to the first node by ID. */
export function activityNodeForLine(
  diagram: ActivityDiagram,
  line: number,
): ActivityNode | undefined {
  return nodesForLine(diagram.nodes, line)[0];
}

export function renderActivitySvg(
  diagram: ActivityDiagram,
  options: RenderOptions = {},
): string {
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const locale = options.locale === 'en' ? 'en' : 'es';
  const c = palette(theme);
  const nodes = cleanNodes(Array.isArray(diagram?.nodes) ? diagram.nodes : []);
  const ids = new Set(nodes.map((n) => n.id));
  const edges: ActivityEdge[] = (
    Array.isArray(diagram?.edges) ? diagram.edges : []
  )
    .slice(0, 600)
    .filter((e) => e && ids.has(e.from) && ids.has(e.to))
    .map((e, i) => ({
      ...e,
      id: bounded(e.id || `edge-${i}`, 120),
      label: e.label === undefined ? undefined : bounded(e.label, 120),
    }));
  const g = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({
      rankdir: 'TB',
      nodesep: 46,
      ranksep: 66,
      edgesep: 24,
      marginx: 28,
      marginy: 34,
      acyclicer: 'greedy',
      ranker: 'network-simplex',
    })
    .setDefaultEdgeLabel(() => ({}));
  const dimensions = new Map<
    string,
    { w: number; h: number; lines: string[] }
  >();
  const sourceLines = options.source?.split(/\r?\n/) ?? [];
  for (const n of nodes) {
    const label =
      locale === 'es' && n.kind === 'merge'
        ? n.label === 'Loop exit'
          ? 'Salida del bucle'
          : n.label === 'Merge'
            ? 'Unión'
            : n.label
        : n.label;
    const lines = wrap(label, 34, 4);
    const h =
      n.kind === 'start'
        ? 28
        : n.kind === 'end'
          ? 36
          : Math.max(58, lines.length * 16 + 24);
    const w =
      n.kind === 'decision' || n.kind === 'merge'
        ? 102
        : n.kind === 'start' || n.kind === 'end'
          ? 32
          : 224;
    dimensions.set(n.id, { w, h, lines });
    g.setNode(n.id, { width: w, height: h });
  }
  edges.forEach((e, i) =>
    g.setEdge(
      e.from,
      e.to,
      {
        width: e.label ? Math.min(140, e.label.length * 8 + 18) : 0,
        height: e.label ? 24 : 0,
        labelpos: 'c',
      },
      `${e.id}-${i}`,
    ),
  );
  if (nodes.length) dagre.layout(g);
  const graph = g.graph() as { width?: number; height?: number };
  const width = Math.max(320, Math.ceil(graph.width ?? 320) + 24);
  const height = Math.max(170, Math.ceil(graph.height ?? 170) + 24);
  const active = options.activeLine;
  const visited = new Set((options.visitedLines ?? []).filter(Number.isFinite));
  const activeIds = new Set(
    active === undefined ? [] : nodesForLine(nodes, active).map((n) => n.id),
  );
  const visitedIds = new Set(
    [...visited].flatMap((line) => nodesForLine(nodes, line).map((n) => n.id)),
  );
  let body =
    '<defs><marker id="cf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="' +
    c.edge +
    '"/></marker></defs>';
  for (const [i, e] of edges.entries()) {
    const routed = g.edge({ v: e.from, w: e.to, name: `${e.id}-${i}` }) as
      | { points?: { x: number; y: number }[]; x?: number; y?: number }
      | undefined;
    const pts = routed?.points ?? [];
    if (pts.length < 2) continue;
    const d = pts
      .map((p, j) => `${j ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    body += `<path d="${d}" fill="none" stroke="${c.edge}" stroke-width="1.7" marker-end="url(#cf-arrow)"/>`;
    if (e.label) {
      const label = localizeEdge(e.label, locale),
        x = routed?.x ?? pts[Math.floor(pts.length / 2)]!.x,
        y = routed?.y ?? pts[Math.floor(pts.length / 2)]!.y;
      const tw = Math.min(150, Math.max(34, label.length * 8 + 16));
      body += `<rect x="${x - tw / 2}" y="${y - 13}" width="${tw}" height="22" rx="7" fill="${c.bg}"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="12" font-weight="600" fill="${c.ink}">${esc(label)}</text>`;
    }
  }
  for (const n of nodes) {
    const pos = g.node(n.id) as { x: number; y: number };
    const { w, h, lines } = dimensions.get(n.id)!;
    const x = pos.x,
      y = pos.y,
      x0 = x - w / 2,
      y0 = y - h / 2;
    const isActive = activeIds.has(n.id);
    const isVisited = visitedIds.has(n.id);
    const fill = isActive ? c.active : isVisited ? c.visited : c.panel;
    const ink = isActive ? (theme === 'dark' ? '#17212a' : '#ffffff') : c.ink;
    const cls = `node-${n.kind}${isActive ? ' active' : ''}${isVisited ? ' visited' : ''}`;
    const lineAttr = Number.isFinite(n.line)
      ? ` data-source-line="${n.line}"`
      : '';
    const sourceNote = sourceLines
      .slice(n.line - 1, Math.min(n.endLine ?? n.line, n.line + 3))
      .join('\n');
    body += `<g class="${cls}" data-node-id="${esc(n.id)}"${lineAttr}><title>${esc(bounded(n.label + (sourceNote ? '\n\n' + (locale === 'es' ? 'Código original:\n' : 'Original code:\n') + sourceNote : ''), 1200))}</title>`;
    if (n.kind === 'start')
      body += `<circle cx="${x}" cy="${y}" r="10" fill="${c.ink}"/>`;
    else if (n.kind === 'end')
      body += `<circle cx="${x}" cy="${y}" r="12" fill="${c.panel}" stroke="${c.ink}" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="7" fill="${c.ink}"/>`;
    else if (n.kind === 'decision' || n.kind === 'merge') {
      body += `<path d="M ${x} ${y0} L ${x + w / 2} ${y} L ${x} ${y + h / 2} L ${x - w / 2} ${y} Z" fill="${fill}" stroke="${isActive ? c.active : c.stroke}" stroke-width="${isActive ? 3 : 1.5}"/>`;
      body += multiline(x, y - (lines.length - 1) * 8 + 4, lines, ink, 12);
    } else {
      const rx =
        n.kind === 'action' || n.kind === 'call' || n.kind === 'return'
          ? 10
          : 2;
      body += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${isActive ? c.active : c.stroke}" stroke-width="${isActive ? 3 : 1.5}"/>`;
      const shift = n.kind === 'call' ? 9 : 0;
      if (n.kind === 'call')
        body += `<path d="M ${x0 + 14} ${y - 7} h 10 v 14 h -10 z M ${x0 + 17} ${y - 11} v 4 M ${x0 + 21} ${y - 11} v 4" fill="none" stroke="${c.accent}" stroke-width="1.7"/>`;
      body += multiline(
        x + shift,
        y - (lines.length - 1) * 8 + 4,
        lines,
        ink,
        13,
      );
    }
    body += '</g>';
  }
  const caption =
    locale === 'es'
      ? 'Diagrama estático derivado del código fuente. Las ramas describen la estructura; el resaltado indica una línea observada y no el resultado de una condición.'
      : 'Static diagram derived from source code. Branches describe structure; highlighting marks an observed line and does not indicate a condition result.';
  const title = bounded(
    diagram?.label ||
      (locale === 'es' ? 'Diagrama de actividad' : 'Activity diagram'),
    240,
  );
  const empty = nodes.length
    ? ''
    : `<text x="24" y="108" font-size="14" fill="${c.muted}">${locale === 'es' ? 'No hay pasos que mostrar.' : 'There are no steps to display.'}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="cf-title cf-desc" width="100%" style="max-width:${width}px;height:auto"><title id="cf-title">${esc(title)}</title><desc id="cf-desc">${esc(caption)}</desc><rect width="${width}" height="${height}" fill="${c.bg}"/><g font-family="system-ui,-apple-system,Segoe UI,sans-serif">${body}${empty}<text x="18" y="${height - 12}" font-size="11" fill="${c.muted}">${esc(caption)}</text></g></svg>`;
}

export function renderClassSvg(
  classes: ClassInfo[],
  options: { theme?: 'light' | 'dark'; locale?: 'es' | 'en' } = {},
): string {
  const theme = options.theme === 'dark' ? 'dark' : 'light',
    locale = options.locale === 'en' ? 'en' : 'es',
    c = palette(theme);
  const safe = (Array.isArray(classes) ? classes : [])
    .slice(0, 24)
    .filter((x) => x && typeof x.name === 'string')
    .map((x) => ({
      ...x,
      name: bounded(x.name, 160),
      fields: (Array.isArray(x.fields) ? x.fields : [])
        .slice(0, 32)
        .map((s) => bounded(s, 240)),
      methods: (Array.isArray(x.methods) ? x.methods : [])
        .slice(0, 32)
        .map((s) => bounded(s, 240)),
      extends: (Array.isArray(x.extends) ? x.extends : [])
        .slice(0, 12)
        .map((s) => bounded(s, 160)),
      implements: (Array.isArray(x.implements) ? x.implements : [])
        .slice(0, 12)
        .map((s) => bounded(s, 160)),
    }));
  const cols = Math.max(1, Math.min(3, safe.length));
  const cardW = 360,
    gapX = 54,
    gapY = 74,
    top = 74,
    margin = 28;
  const sizes = safe.map((item) => ({
    fieldLines: item.fields.map((v) => wrap(v, 38, 2)),
    methodLines: item.methods.map((v) => wrap(v, 38, 2)),
  }));
  const rows = Math.ceil(safe.length / cols),
    rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(
        160,
        ...sizes.slice(row * cols, (row + 1) * cols).map(
          ({ fieldLines, methodLines }) =>
            70 +
            Math.max(
              1,
              fieldLines.reduce((a, x) => a + x.length, 0),
            ) *
              18 +
            20 +
            Math.max(
              1,
              methodLines.reduce((a, x) => a + x.length, 0),
            ) *
              18 +
            16,
        ),
      ),
    );
  const width = Math.max(360, margin * 2 + cols * cardW + (cols - 1) * gapX);
  const rowY: number[] = [];
  let y = top;
  rowHeights.forEach((h) => {
    rowY.push(y);
    y += h + gapY;
  });
  const itemX = (i: number) => margin + (i % cols) * (cardW + gapX);
  const itemY = (i: number) => rowY[Math.floor(i / cols)] ?? top;
  const itemH = (i: number) => {
    const d = sizes[i]!;
    return (
      70 +
      Math.max(
        1,
        d.fieldLines.reduce((a, x) => a + x.length, 0),
      ) *
        18 +
      20 +
      Math.max(
        1,
        d.methodLines.reduce((a, x) => a + x.length, 0),
      ) *
        18 +
      16
    );
  };
  const height = Math.max(180, y - gapY + 44);
  const byName = new Map<string, number | null>();
  const bySimpleName = new Map<string, number[]>();
  safe.forEach((item, i) => {
    for (const key of [
      item.id,
      ...(item.name.includes('.') ? [item.name] : []),
    ]) {
      const previous = byName.get(key);
      byName.set(key, previous === undefined || previous === i ? i : null);
    }
    const simpleName = item.name.split('.').at(-1) ?? item.name;
    const matches = bySimpleName.get(simpleName) ?? [];
    matches.push(i);
    bySimpleName.set(simpleName, matches);
  });
  const resolveType = (name: string) => {
    const exact = byName.get(name);
    if (exact !== undefined) return exact ?? undefined;
    const matches = bySimpleName.get(name.split('.').at(-1) ?? name);
    return matches?.length === 1 ? matches[0] : undefined;
  };
  let body = '';
  for (let i = 0; i < safe.length; i++) {
    const item = safe[i]!,
      x = itemX(i),
      cy = itemY(i);
    const relationships = [
      ...item.extends.map((name) => ({ name, realization: false })),
      ...item.implements.map((name) => ({ name, realization: true })),
    ];
    const drawn = new Set<number>();
    for (const relationship of relationships) {
      const p = resolveType(relationship.name);
      const expectedKind =
        relationship.realization || item.kind === 'interface'
          ? 'interface'
          : 'class';
      if (
        p === undefined ||
        p === i ||
        drawn.has(p) ||
        safe[p]!.kind !== expectedKind
      )
        continue;
      drawn.add(p);
      const px = itemX(p) + cardW / 2,
        py = itemY(p) + itemH(p),
        sx = x + cardW / 2,
        sy = cy;
      body += `<path d="M ${sx} ${sy} C ${sx} ${sy - 28}, ${px} ${py + 28}, ${px} ${py}" fill="none" stroke="${c.edge}" stroke-width="1.7"${relationship.realization ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#cf-class-arrow)"/>`;
    }
  }
  body =
    `<defs><marker id="cf-class-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${c.bg}" stroke="${c.edge}" stroke-width="1.4"/></marker></defs>` +
    body;
  for (let i = 0; i < safe.length; i++) {
    const item = safe[i]!,
      d = sizes[i]!,
      x = itemX(i),
      cy = itemY(i),
      h = itemH(i);
    const kind =
      item.kind === 'interface'
        ? locale === 'es'
          ? 'interfaz'
          : 'interface'
        : item.kind === 'enum'
          ? 'enum'
          : locale === 'es'
            ? 'clase'
            : 'class';
    body += `<g data-class-id="${esc(bounded(item.id, 120))}" data-source-line="${Number.isFinite(item.line) ? Math.max(0, item.line) : 0}"><title>${esc(item.name)} · ${esc(kind)}</title><rect x="${x}" y="${cy}" width="${cardW}" height="${h}" rx="8" fill="${c.panel}" stroke="${c.stroke}" stroke-width="1.5"/>`;
    body += multiline(
      x + cardW / 2,
      cy + 24,
      [kind.toUpperCase(), ...wrap(item.name, 34, 2)],
      c.ink,
      14,
    );
    const divider1 = cy + 70;
    body += `<path d="M ${x} ${divider1} H ${x + cardW}" stroke="${c.stroke}"/>`;
    const fieldLines = d.fieldLines.flatMap((lines) => lines);
    let ty = divider1 + 19;
    body += `<text x="${x + 12}" y="${ty}" font-size="10" fill="${c.muted}">${locale === 'es' ? 'CAMPOS' : 'FIELDS'}</text>`;
    ty += 16;
    if (!fieldLines.length) {
      body += `<text x="${x + 14}" y="${ty}" font-size="12" fill="${c.muted}">—</text>`;
      ty += 18;
    }
    for (const line of fieldLines) {
      body += `<text x="${x + 14}" y="${ty}" font-size="12" fill="${c.ink}"><title>${esc(line)}</title>${esc(line)}</text>`;
      ty += 18;
    }
    const divider2 =
      cy +
      h -
      (Math.max(
        1,
        d.methodLines.reduce((a, l) => a + l.length, 0),
      ) *
        18 +
        30);
    body += `<path d="M ${x} ${divider2} H ${x + cardW}" stroke="${c.stroke}"/><text x="${x + 12}" y="${divider2 + 15}" font-size="10" fill="${c.muted}">${locale === 'es' ? 'MÉTODOS' : 'METHODS'}</text>`;
    let my = divider2 + 32;
    const methodLines = d.methodLines.flatMap((lines) => lines);
    if (!methodLines.length)
      body += `<text x="${x + 14}" y="${my}" font-size="12" fill="${c.muted}">—</text>`;
    for (const line of methodLines) {
      body += `<text x="${x + 14}" y="${my}" font-size="12" fill="${c.ink}"><title>${esc(line)}</title>${esc(line)}</text>`;
      my += 18;
    }
    body += '</g>';
  }
  const title = locale === 'es' ? 'Diagrama de clases' : 'Class diagram';
  const desc =
    locale === 'es'
      ? 'Clases, interfaces y enumeraciones declaradas en el código fuente. Las flechas muestran relaciones de herencia declaradas que pueden resolverse entre estos tipos.'
      : 'Classes, interfaces, and enums declared in source code. Arrows show declared inheritance relationships that resolve between these types.';
  const empty = safe.length
    ? ''
    : `<text x="24" y="112" font-size="14" fill="${c.muted}">${locale === 'es' ? 'No se han declarado clases.' : 'No classes are declared.'}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="cf-title cf-desc" width="100%" style="max-width:${width}px;height:auto"><title id="cf-title">${title}</title><desc id="cf-desc">${esc(desc)}</desc><rect width="${width}" height="${height}" fill="${c.bg}"/><g font-family="system-ui,-apple-system,Segoe UI,sans-serif">${body}${empty}</g></svg>`;
}
