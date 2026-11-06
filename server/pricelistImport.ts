import { inflateRawSync } from 'node:zlib';
import type { PriceItem, PriceList } from '../src/lib/quote';

/**
 * Leser prislisten fra Excel-malen (samme oppsett som «Tilbudsberegning – mal.xlsx»):
 * kolonne A = post, C = pris per stk. Rader uten pris er gruppeoverskrifter.
 * «Påslag/rabatt» og «Garantiansvar» leses fra kolonne B.
 *
 * .xlsx er en zip-fil med XML. Vi leser den uten eksterne biblioteker: bare tekst og tall, ingen makroer eller formler kjøres.
 */

const MAX_UNZIPPED = 20 * 1024 * 1024;

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Filen er ikke en gyldig Excel-fil (.xlsx).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Ødelagt Excel-fil.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels))$/.test(name)) continue;
    total += usize;
    if (total > MAX_UNZIPPED) throw new Error('Excel-filen er for stor.');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }) : Buffer.alloc(0));
  }
  return files;
}

const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** Første regneark som rader: { 'A': verdi, 'B': verdi, ... } */
export function readFirstSheet(buf: Buffer): Record<string, string | number>[] {
  const f = unzip(buf);
  const wb = f.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = f.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : undefined;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = (f.get(sheetPath) ?? f.get('xl/worksheets/sheet1.xml'))?.toString('utf8');
  if (!sheet) throw new Error('Fant ikke noe regneark i filen.');
  const shared = [...(f.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => xmlText([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows: Record<string, string | number>[] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Record<string, string | number> = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? '';
      const col = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!col) continue;
      const t = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (t === 's' && v != null) row[col] = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') row[col] = xmlText([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (t === 'str' && v != null) row[col] = xmlText(v);
      else if (v != null && v !== '' && Number.isFinite(Number(v))) row[col] = Number(v);
    }
    rows.push(row);
  }
  return rows;
}

export async function parsePriceListXlsx(buf: Buffer): Promise<PriceList> {
  const rows = readFirstSheet(buf);
  const items: PriceItem[] = [];
  let group = 'Annet', markup = 1, warranty = 1;
  const skip = /^(delsum|avrunding|sum eks|sum ink|kvadratmeter|pris per|adresse)/i;
  for (const r of rows) {
    const a = r.A, b = r.B, c = r.C;
    if (typeof a !== 'string' || !a.trim()) continue;
    const name = a.trim().replace('Sikirngsskap', 'Sikringsskap');
    if (/^påslag/i.test(name)) { if (typeof b === 'number') markup = b; continue; }
    if (/^garanti/i.test(name)) { if (typeof b === 'number') warranty = b; continue; }
    if (skip.test(name)) continue;
    if (typeof c === 'number') {
      const unit = /-\s*m2\b/i.test(name) ? 'm²' : /antall kurser/i.test(name) ? 'kurs' : 'stk';
      items.push({ id: '', group, name, unitPrice: Math.max(0, Math.round(c)), unit });
    } else if (c == null || typeof c === 'string') group = name;
  }
  if (!items.length) throw new Error('Fant ingen poster med pris i kolonne C.');
  const seen = new Set<string>();
  for (const it of items) {
    const base = it.name.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    let id = base, n = 2; while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id); it.id = id;
  }
  if (!(markup > 0 && markup < 5) || !(warranty >= 1 && warranty < 2)) throw new Error('Påslag eller garanti i arket ser feil ut.');
  return { items, markup, warranty, vatRate: 0.25 };
}
