/**
 * E-postsignaturen hentes fra e-poster eieren har sendt fra Outlook, så svar fra Agentkontoret får nøyaktig
 * samme signatur, med logo. Microsoft gir ikke tilgang til signaturinnstillingene via API, men signaturen er
 * merket i e-postene: Outlook for Windows bruker <a name="_MailAutoSig">, Outlook på nett og ny Outlook bruker
 * <div id="Signature">.
 */

export interface SignatureImage { contentId: string; name: string; contentType: string; base64: string }
export interface StoredSignature { html: string; images: SignatureImage[]; fetchedAt: string; sourceMessageId: string }

/** Starten på sitert tekst i et svar. Alt etter dette er ikke eierens egen tekst. */
const QUOTE_MARKERS = [
  /<div[^>]*\bid=["']?(?:x_)?divRplyFwdMsg/i,
  /<div[^>]*\bid=["']?(?:x_)?appendonsend/i,
  /<div[^>]*\bid=["']?mail-editor-reference-message-container/i,
  /<div[^>]*\bclass=["']?gmail_quote/i,
  /<hr[^>]*>/i,
  /<blockquote/i,
  /<div[^>]*border-top:\s*solid\s*#?[a-z0-9]+\s*1\.0pt/i, // Outlook for Windows: linje over «Fra:»
];

/** Eierens egen del av en HTML-e-post: innholdet i <body> fram til sitert tekst. */
export function ownPart(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  let cut = body.length;
  for (const r of QUOTE_MARKERS) { const i = body.search(r); if (i >= 0 && i < cut) cut = i; }
  return body.slice(0, cut);
}

/** Fjerner alt som kan kjøre kode eller hente innhold utenfra uten at mottakeren ber om det. */
export function sanitizeHtml(h: string): string {
  return h
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|form|button|textarea|select)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"');
}

/** Finner signaturen i en sendt e-post. Returnerer null hvis den ikke er merket. */
export function extractSignature(html: string): string | null {
  const own = ownPart(html);
  let i = own.search(/<div[^>]*\bid=["']?(?:x_)?Signature\b/i);
  if (i < 0) {
    const j = own.search(/<a\s[^>]*name=["']?_MailAutoSig/i);
    if (j >= 0) {
      // Start fra avsnittet som inneholder merket, så signaturen ikke begynner midt i en tagg.
      const p = Math.max(own.lastIndexOf('<p ', j), own.lastIndexOf('<p>', j), own.lastIndexOf('<div', j));
      i = p >= 0 && j - p < 400 ? p : j;
    }
  }
  if (i < 0) return null;
  const sig = sanitizeHtml(own.slice(i)).trim();
  const text = sig.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= 3 ? sig : null;
}

/** cid-referanser (innebygde bilder, f.eks. logo) i signaturen. */
export const cidsIn = (sig: string) => [...sig.matchAll(/src=["']cid:([^"']+)["']/gi)].map((m) => m[1]);

/** Signaturen med bildene som data-URL, for forhåndsvisning i Agentkontoret. */
export function previewHtml(s: StoredSignature): string {
  let h = s.html;
  for (const img of s.images) h = h.split(`cid:${img.contentId}`).join(`data:${img.contentType};base64,${img.base64}`);
  return h;
}

/**
 * Fjerner hilsen og tekstsignatur på slutten av et utkast når den ekte signaturen legges til automatisk,
 * så det ikke blir dobbelt («Med vennlig hilsen» står allerede i signaturen).
 * Fjerner bare når alt etter hilsenen er kjent signaturinnhold (navn, firma, telefon, e-post) – aldri et «PS:».
 */
export function stripClosing(text: string, knownLines: string[] = []): string {
  const t = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const known = new Set(knownLines.flatMap((l) => l.split('\n')).map((l) => l.trim().toLowerCase()).filter(Boolean));
  const isSigLine = (l: string) => {
    const x = l.trim().toLowerCase();
    return !x || known.has(x) || /^(m|mob|tlf|tel|telefon|e|e-post|epost|w|web)\s*[:.]?\s*[+\d\s]{8,}$/.test(x) || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(x);
  };
  const lines = t.split('\n');
  for (let k = Math.max(0, lines.length - 6); k < lines.length; k++) {
    if (/^\s*(med vennlig hilsen|vennlig hilsen|med hilsen|mvh|hilsen|best regards|kind regards|regards)\b/i.test(lines[k])) {
      // Resten av hilsen-linjen (f.eks. «Hilsen Espen») og linjene under må være kjent signatur.
      const rest = lines[k].replace(/^\s*(med vennlig hilsen|vennlig hilsen|med hilsen|mvh|hilsen|best regards|kind regards|regards)[,.!]?\s*/i, '');
      if ((rest === '' || isSigLine(rest)) && lines.slice(k + 1).every(isSigLine)) return lines.slice(0, k).join('\n').replace(/\s+$/, '');
      return t;
    }
  }
  return t;
}
