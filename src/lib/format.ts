/**
 * Enkel tekstformatering i e-poster: **fet**, _kursiv_ og __understreket__.
 * Samme regler brukes i forhåndsvisningen i Agentkontoret og når e-posten sendes som HTML til Outlook.
 * Markeringer gjelder innenfor én linje, og bare når de står ved ordgrense (så e-postadresser og lenker
 * med understrek ikke blir formatert).
 */

export interface Seg { text: string; b?: boolean; i?: boolean; u?: boolean; href?: string }

const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)»]/g;
const MARKERS = ['**', '__', '_'] as const;
type Marker = (typeof MARKERS)[number];
const KEY: Record<Marker, 'b' | 'u' | 'i'> = { '**': 'b', '__': 'u', '_': 'i' };

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const openOk = (s: string, i: number, m: Marker) => {
  const prev = s[i - 1], next = s[i + m.length];
  return (prev === undefined || /[\s([{"'«\-–—/]/.test(prev)) && !isSpace(next) && next !== m[0];
};
const closeOk = (s: string, i: number, m: Marker) => {
  const prev = s[i - 1], next = s[i + m.length];
  return !isSpace(prev) && prev !== m[0] && (next === undefined || /[\s.,;:!?)\]}"'»\-–—/]/.test(next));
};
const markerAt = (s: string, i: number): Marker | null => (s.startsWith('**', i) ? '**' : s.startsWith('__', i) ? '__' : s[i] === '_' ? '_' : null);

/** Formaterer én tekstbit (uten lenker). */
function formatPlain(s: string, base: Omit<Seg, 'text'> = {}): Seg[] {
  const out: Seg[] = [];
  const state: Record<'b' | 'i' | 'u', boolean> = { b: !!base.b, i: !!base.i, u: !!base.u };
  let buf = '';
  const flush = () => { if (buf) { out.push({ text: buf, ...(state.b && { b: true }), ...(state.i && { i: true }), ...(state.u && { u: true }) }); buf = ''; } };
  for (let i = 0; i < s.length;) {
    const m = markerAt(s, i);
    if (m) {
      const k = KEY[m];
      if (state[k] && closeOk(s, i, m)) { flush(); state[k] = false; i += m.length; continue; }
      if (!state[k] && openOk(s, i, m)) {
        // Bare åpne når det finnes en lukking senere på linjen.
        let j = i + m.length, found = false;
        while (j < s.length) { if (s.startsWith(m, j) && closeOk(s, j, m) && (m !== '_' || !s.startsWith('__', j))) { found = true; break; } j++; }
        if (found) { flush(); state[k] = true; i += m.length; continue; }
      }
    }
    buf += s[i]; i++;
  }
  flush();
  return out;
}

/** Én linje: lenker gjøres klikkbare, resten formateres. */
export function formatLine(line: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    if (m.index! > last) out.push(...formatPlain(line.slice(last, m.index)));
    out.push({ text: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push(...formatPlain(line.slice(last)));
  return out;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Segmenter til HTML for e-post (all tekst escapes). */
export function segsToHtml(segs: Seg[]): string {
  return segs.map((s) => {
    let h = s.href ? `<a href="${esc(s.href)}">${esc(s.text)}</a>` : esc(s.text);
    if (s.u) h = `<u>${h}</u>`;
    if (s.i) h = `<i>${h}</i>`;
    if (s.b) h = `<b>${h}</b>`;
    return h;
  }).join('');
}

/** Fjerner markeringene (for «Kopier tekst», mailto og ren tekst). */
export const stripFormatting = (text: string) => text.split('\n').map((l) => formatLine(l).map((s) => s.text).join('')).join('\n');

/** Legger markør rundt markert tekst i et tekstfelt (eller fjerner den hvis den allerede er der). */
export function toggleWrap(value: string, start: number, end: number, m: '**' | '_' | '__'): { value: string; start: number; end: number } {
  // Ikke ta med mellomrom i kantene av markeringen.
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;
  const before = value.slice(0, start), sel = value.slice(start, end), after = value.slice(end);
  if (before.endsWith(m) && after.startsWith(m) && !(m === '_' && (before.endsWith('__') || after.startsWith('__')))) {
    return { value: before.slice(0, -m.length) + sel + after.slice(m.length), start: start - m.length, end: end - m.length };
  }
  if (!sel) return { value: before + m + m + after, start: start + m.length, end: start + m.length };
  return { value: before + m + sel + m + after, start: start + m.length, end: end + m.length };
}
