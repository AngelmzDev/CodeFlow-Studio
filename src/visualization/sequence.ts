import type { Trace } from '../core/types.ts';
import { escapeXml } from './views.ts';

/** Only observed call/return events are drawn; source syntax never invents calls. */
export function renderSequenceSvg(
  trace: Trace,
  index: number,
  options: { locale?: string; theme?: string } = {},
): string {
  const es = options.locale !== 'en';
  const dark = options.theme === 'dark';
  const bg = dark ? '#16202a' : '#ffffff';
  const ink = dark ? '#e5edf5' : '#213547';
  const muted = dark ? '#92a6ba' : '#51667a';
  const accent = dark ? '#65c3ff' : '#0066a8';
  const end = Math.max(0, Math.min(trace.events.length - 1, index));
  const candidates = trace.events.slice(0, end + 1).flatMap((event, i) => {
    if (!['call', 'return'].includes(event.type) || !event.frames.length)
      return [];
    const callee = event.frames[0]!.name;
    const caller = event.frames[1]?.name ?? (es ? 'Programa' : 'Program');
    return [
      {
        from: event.type === 'call' ? caller : callee,
        to: event.type === 'call' ? callee : caller,
        type: event.type,
        i,
        line: event.location?.line,
      },
    ];
  });
  const recent = candidates.slice(-60);
  const participants: string[] = [];
  const messages = recent.filter((m) => {
    const additions = [m.from, m.to].filter(
      (p, i, all) => !participants.includes(p) && all.indexOf(p) === i,
    );
    if (participants.length + additions.length > 10) return false;
    participants.push(...additions);
    return true;
  });
  const width = Math.max(420, participants.length * 180 + 40);
  const height = Math.max(150, messages.length * 56 + 145);
  const text = (x: number, y: number, value: string, size = 12) =>
    `<text x="${x}" y="${y}" text-anchor="middle" fill="${ink}" font-size="${size}">${escapeXml(value)}</text>`;
  const name = (s: string) => (s.length > 22 ? s.slice(0, 21) + '…' : s);
  let body = `<rect width="100%" height="100%" fill="${bg}"/><defs><marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="none" stroke="${accent}"/></marker></defs>`;
  body += text(
    width / 2,
    24,
    `${es ? 'Paso' : 'Step'} ${end + 1} · ${es ? 'Llamadas y retornos observados' : 'Observed calls and returns'}`,
    13,
  );
  participants.forEach((p, i) => {
    const x = 110 + i * 180;
    body += `<path d="M${x} 74 V${height - 30}" stroke="${muted}" stroke-dasharray="5 5"/><rect x="${x - 78}" y="40" width="156" height="34" rx="5" fill="${bg}" stroke="${accent}"/><g><title>${escapeXml(p)}</title>${text(x, 62, name(p))}</g>`;
  });
  messages.forEach((m, row) => {
    const x1 = 110 + participants.indexOf(m.from) * 180;
    const x2 = 110 + participants.indexOf(m.to) * 180;
    const y = 112 + row * 56;
    if (m.i === end)
      body += `<rect x="10" y="${y - 25}" width="${width - 20}" height="48" rx="6" fill="${dark ? '#20445b' : '#e2f3ff'}"/>`;
    const d = x1 === x2 ? `M${x1} ${y} h54 v18 h-54` : `M${x1} ${y} H${x2}`;
    body += `<path d="${d}" fill="none" stroke="${accent}" ${m.type === 'return' ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#seq-arrow)"/>`;
    const label = `${m.i + 1}. ${m.type === 'call' ? (es ? 'llamada' : 'call') : es ? 'retorno' : 'return'}${m.line ? ` · L${m.line}` : ''}`;
    body += text((x1 + x2) / 2 + (x1 === x2 ? 40 : 0), y - 7, label);
  });
  if (!messages.length)
    body += text(
      width / 2,
      105,
      es
        ? 'Aún no hay llamadas observadas en este paso.'
        : 'No calls observed at this step yet.',
    );
  if (messages.length < candidates.length)
    body += text(
      width / 2,
      height - 9,
      es
        ? 'Vista limitada a 60 mensajes y 10 participantes.'
        : 'View limited to 60 messages and 10 participants.',
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${es ? 'Diagrama de secuencia observado' : 'Observed sequence diagram'}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="font-family:system-ui,sans-serif">${body}</svg>`;
}
