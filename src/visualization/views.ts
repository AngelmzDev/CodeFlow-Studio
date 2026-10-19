import type { Capabilities, TraceEvent, Value } from '../core/types.ts';
export function formatValue(value: Value | undefined): string {
  if (!value) return '∅';
  if (value.kind === 'reference') return '@' + value.ref;
  if (value.kind === 'unavailable') return 'unavailable: ' + value.reason;
  return typeof value.value === 'string'
    ? JSON.stringify(value.value)
    : String(value.value);
}
export function selectViews(c: Partial<Capabilities>): string[] {
  const out = ['timeline'];
  if (c.variables) out.push('variables');
  if (c.callStack) out.push('callStack');
  if (c.arrays) out.push('arrays');
  if (c.objects) out.push('objects');
  return out;
}
export function escapeXml(value: unknown): string {
  return String(value).replace(
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
}
function short(value: string, max = 44): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
export function renderStateSvg(
  event: TraceEvent | null,
  options: { theme?: string } = {},
): string {
  const dark = options.theme === 'dark';
  const color = dark
    ? {
        bg: '#101820',
        panel: '#18252e',
        ink: '#f1f5f7',
        muted: '#b3c4cf',
        stroke: '#465d69',
        accent: '#6ee7c8',
      }
    : {
        bg: '#f4f7f6',
        panel: '#ffffff',
        ink: '#172e39',
        muted: '#4b6270',
        stroke: '#b7c8cb',
        accent: '#116653',
      };
  const vars =
    event?.frames
      .flatMap((f) =>
        Object.entries(f.locals).map(([name, value]) => ({
          name,
          frame: f.name,
          value,
        })),
      )
      .slice(0, 18) ?? [];
  const objects = Object.values(event?.heap ?? {}).slice(0, 8);
  const height = Math.max(
    420,
    182 +
      Math.max(
        vars.length * 30,
        objects.length * 94,
        (event?.frames.length ?? 0) * 62,
      ),
  );
  const rect = (x: number, y: number, w: number, h: number) =>
    '<rect x="' +
    x +
    '" y="' +
    y +
    '" width="' +
    w +
    '" height="' +
    h +
    '" rx="8" fill="' +
    color.panel +
    '" stroke="' +
    color.stroke +
    '"/>';
  const text = (x: number, y: number, t: string, size = 13, fill = color.ink) =>
    '<text x="' +
    x +
    '" y="' +
    y +
    '" font-size="' +
    size +
    '" fill="' +
    fill +
    '">' +
    escapeXml(t) +
    '</text>';
  let content =
    rect(22, 100, 330, height - 122) +
    rect(366, 100, 386, height - 122) +
    rect(766, 100, 252, height - 122);
  content +=
    text(40, 128, 'VARIABLES', 12, color.muted) +
    text(384, 128, 'ARRAYS & OBJECTS', 12, color.muted) +
    text(784, 128, 'CALL STACK', 12, color.muted);
  vars.forEach((v, i) => {
    content +=
      text(40, 162 + i * 30, short(v.name, 17), 13, color.muted) +
      text(181, 162 + i * 30, short(formatValue(v.value), 20));
  });
  if (!vars.length)
    content += text(40, 165, 'No visible variables', 13, color.muted);
  objects.forEach((o, i) => {
    const y = 147 + i * 94;
    content +=
      rect(382, y, 354, 80) +
      text(
        394,
        y + 23,
        short('@' + o.id + ' · ' + o.type, 39),
        12,
        color.accent,
      );
    const values =
      o.kind === 'array'
        ? '[' + (o.elements ?? []).map(formatValue).join(', ') + ']'
        : Object.entries(o.fields ?? {})
            .map(([k, v]) => k + ': ' + formatValue(v))
            .join(', ');
    content +=
      text(394, y + 49, short(values, 41)) +
      text(
        394,
        y + 67,
        o.truncated
          ? 'Snapshot truncated at adapter limit'
          : o.kind === 'array'
            ? String(o.length ?? o.elements?.length ?? 0) + ' elements'
            : 'Observed fields',
        10,
        color.muted,
      );
  });
  if (!objects.length)
    content += text(384, 165, 'No referenced objects', 13, color.muted);
  (event?.frames ?? []).slice(0, 30).forEach((f, i) => {
    const y = 148 + i * 62;
    if (i)
      content +=
        '<path d="M892 ' +
        (y - 13) +
        ' V' +
        (y - 2) +
        '" fill="none" stroke="' +
        color.accent +
        '"/>';
    content +=
      rect(782, y, 220, 48) +
      text(794, y + 20, short(f.name, 25), 12) +
      text(
        794,
        y + 37,
        'line ' + f.location.line + ' · ' + f.id,
        10,
        color.muted,
      );
  });
  if (!event?.frames.length)
    content += text(784, 165, 'No active frames', 13, color.muted);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 ' +
    height +
    '" role="img" aria-labelledby="cf-title cf-desc"><title id="cf-title">CodeFlow execution state</title><desc id="cf-desc">Observed variable and heap snapshot. Layout and stack connections are derived. ' +
    escapeXml(
      event
        ? 'Event ' + event.sequence + ', ' + event.type
        : 'No trace selected',
    ) +
    '</desc><rect width="1040" height="' +
    height +
    '" fill="' +
    color.bg +
    '"/><g font-family="ui-monospace,Consolas,monospace">' +
    text(24, 38, 'CODEFLOW / EXECUTION STATE', 19) +
    text(
      24,
      66,
      event
        ? 'EVENT ' +
            event.sequence +
            ' · ' +
            event.type.toUpperCase() +
            (event.location ? ' · BEFORE LINE ' + event.location.line : '')
        : 'Run trusted code to record a real trace',
      12,
      color.muted,
    ) +
    content +
    '</g></svg>'
  );
}
