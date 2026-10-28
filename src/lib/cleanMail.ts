/**
 * Rydder e-posttekst for visning og for AI. Originalen lagres alltid uendret i databasen.
 *
 * Fjernes:
 *  - Bannere fra e-postfiltre (INKY «Report This Email», «External», «CAUTION: This email originated …», «[EXTERNAL]» o.l.)
 *  - Plassholdere for innebygde bilder: [cid:…], [IMG_1234.jpeg] (bildene vises som vedlegg)
 *  - «tekst<https://lenke>» blir «tekst»; «x@y.no<mailto:x@y.no>» blir «x@y.no»
 *  - Overflødige tomme linjer og mellomrom
 * Sitert historikk («Fra: … Sendt: …», «Den … skrev:», «> …») skilles ut, så den kan skjules bak en knapp.
 */

export interface CleanMail { text: string; quoted: string }

const BANNER_LINE = [
  /^\s*\[cid:[^\]]*\]\s*$/i,
  /^\s*External\s*\(.*\)\s*$/i,
  /^\s*Report This Email\s*<[^>]*>?\s*$/i,
  /^\s*Report This Email\b.*$/i,
  /^\s*FAQ\s*<https?:\/\/(www\.)?inky\.com[^>]*>\s*$/i,
  /^\s*Protection by INKY.*$/i,
  /^\s*\[?EXTERNAL\]?\s*[:\-–]?\s*(email|e-post|sender)?.*originated.*$/i,
  /^\s*\[(EXTERNAL|EKSTERN)\]\s*$/i,
  /^\s*CAUTION:\s*This (e-?mail|message) (originated|was sent) from outside.*$/i,
  /^\s*(OBS|ADVARSEL|FORSIKTIG):?\s*(Denne|Dette) e-?post(en)? (kommer|er sendt) (fra|utenfor).*$/i,
  /^\s*You don'?t often get email from .*$/i,
  /^\s*Du mottar ikke ofte e-post fra .*$/i,
  /^\s*Learn why this is important.*$/i,
  /^\s*Finn ut hvorfor dette er viktig.*$/i,
  /^\s*(Sendt|Sent) (fra|from) (min|my) (iPhone|iPad|Android|Samsung.*|mobil.*)\s*$/i,
  /^\s*(Sendt|Sent) (fra|from|via) Outlook( for (iOS|Android))?\s*$/i,
  /^\s*(Get|Hent) Outlook for (iOS|Android)\s*<?[^>]*>?\s*$/i,
];

/** Start på sitert historikk. */
const QUOTE_START = [
  /^\s*(-{2,}\s*)?(Original Message|Opprinnelig melding|Videresendt melding|Forwarded message)\s*-*\s*$/i,
  /^\s*(From|Fra)\s*:\s*.+$/i, // etterfølges av Sent/Sendt/Date/Dato rett under
  /^\s*(On|Den|På)\s.+(wrote|skrev)\s*:\s*$/i,
  /^\s*_{10,}\s*$/,
];

const INLINE_IMAGE = /\[(cid:[^\]]+|[^\]\n]{1,80}\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?))\]/gi;

export function cleanMail(raw: string): CleanMail {
  if (!raw) return { text: '', quoted: '' };
  let s = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[​-‍﻿]/g, '');

  // INKY legger et banner øverst: forhåndsvisning av teksten, logoer, «External», «Report This Email» og «FAQ».
  // Alt til og med FAQ-linjen er banner.
  const inky = s.match(/^[\s\S]{0,3000}?FAQ\s*<https?:\/\/(?:www\.)?inky\.com[^>]*>[^\n]*\n?/i);
  if (inky && /inky/i.test(inky[0])) s = s.slice(inky[0].length);

  let lines = s.split('\n').filter((l) => !BANNER_LINE.some((r) => r.test(l)));

  // Skill ut sitert historikk.
  let cut = -1;
  for (let i = 0; i < lines.length && cut < 0; i++) {
    const l = lines[i];
    if (/^\s*(From|Fra)\s*:/i.test(l)) {
      const near = lines.slice(i + 1, i + 5).join('\n');
      if (/^\s*(Sent|Sendt|Date|Dato|To|Til)\s*:/im.test(near)) cut = i;
    } else if (QUOTE_START.some((r, k) => k !== 1 && r.test(l))) cut = i;
    else if (/^\s*>/.test(l) && lines.slice(i).filter((x) => x.trim()).every((x) => /^\s*>/.test(x))) cut = i;
  }
  let quoted = '';
  if (cut > 0) { quoted = lines.slice(cut).join('\n'); lines = lines.slice(0, cut); }
  else if (cut === 0) { /* hele e-posten er sitat (f.eks. videresending): vis den */ }

  const tidy = (t: string) => t
    .replace(INLINE_IMAGE, '')
    // «tekst<mailto:x>» → «tekst», «tekst<https://…>» → «tekst», men behold lenken når teksten er tom
    .replace(/([^\s<>]+@[^\s<>]+)\s*<mailto:[^>]+>/gi, '$1')
    .replace(/(\S[^<>\n]*?)\s*<(https?:\/\/[^>\s]+)>/g, (_m, label: string, url: string) => (label.trim().length > 1 ? label : url))
    .split('\n').map((l) => l.replace(/[ \t]+$/g, '').replace(/^[ \t]{2,}(?=\S)/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: tidy(lines.join('\n')), quoted: tidy(quoted) };
}

/** Kort, ren tekst til forhåndsvisning i lister. */
export const previewText = (raw: string, n = 110) => cleanMail(raw).text.replace(/\s+/g, ' ').slice(0, n);

/** Deler tekst i vanlig tekst og lenker, så lange adresser kan vises kort og klikkbart. */
export function linkify(text: string): ({ t: string } | { href: string; label: string })[] {
  const out: ({ t: string } | { href: string; label: string })[] = [];
  const re = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»]/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index) });
    let host = m[0];
    try { const u = new URL(m[0]); host = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? '/…' : ''); } catch { /* behold */ }
    out.push({ href: m[0], label: host });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}
