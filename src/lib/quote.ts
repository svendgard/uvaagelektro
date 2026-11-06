/**
 * Tilbudsberegning. Regnes nøyaktig som i Uvaag Elektros Excel-mal:
 *   Sum eks. mva = (Delsum × påslag + avrunding) × garantiansvar
 *   Sum inkl. mva = Sum eks. mva × (1 + mva)
 * Prisene i e-posten regnes alltid ut her, aldri av AI.
 */

export interface PriceItem { id: string; group: string; name: string; unitPrice: number; unit: string }
export interface PriceList { items: PriceItem[]; markup: number; warranty: number; vatRate: number; updatedAt?: string; source?: string }

export interface QuoteLine {
  id: string;
  /** Post i prislisten, eller tom for egen linje. */
  itemId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  unit: string;
  /** Pris mangler eller posten finnes ikke i prislisten: eieren må ta stilling før godkjenning. */
  needsReview?: boolean;
  note?: string;
}

export type CustomerKind = 'privat' | 'naering';

export interface Quote {
  id: string;
  caseId: string;
  lines: QuoteLine[];
  markup: number;
  warranty: number;
  vatRate: number;
  rounding: number;
  customerType: CustomerKind;
  status: 'draft' | 'approved' | 'sent';
  source: 'ai' | 'owner';
  reason?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface QuoteCalc {
  subtotal: number;
  totalEx: number;
  totalInc: number;
  /** Linjer slik kunden ser dem: beløp inkl. påslag og garanti (og mva for privatkunder), avrundet til hele kroner. */
  shown: { name: string; qty: number; unit: string; amount: number }[];
  /** Summen kunden ser (inkl. mva for privat, eks. mva for bedrift). Lik summen av linjene. */
  shownTotal: number;
  includesVat: boolean;
  blocking: QuoteLine[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcQuote(q: Pick<Quote, 'lines' | 'markup' | 'warranty' | 'vatRate' | 'rounding' | 'customerType'>): QuoteCalc {
  const lines = q.lines.filter((l) => l.qty > 0);
  const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const totalEx = r2((subtotal * q.markup + q.rounding) * q.warranty);
  const totalInc = r2(totalEx * (1 + q.vatRate));
  const includesVat = q.customerType === 'privat';
  const factor = q.markup * q.warranty * (includesVat ? 1 + q.vatRate : 1);
  const shown = lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, amount: Math.round(l.qty * l.unitPrice * factor) }));
  const roundingShown = Math.round(q.rounding * q.warranty * (includesVat ? 1 + q.vatRate : 1));
  if (roundingShown !== 0) shown.push({ name: q.rounding < 0 ? 'Rabatt' : 'Tillegg', qty: 1, unit: '', amount: roundingShown });
  // Summen skal være lik summen av linjene kunden ser. Øredifferanse fra avrunding legges på største linje.
  const target = Math.round(includesVat ? totalInc : totalEx);
  const diff = target - shown.reduce((s, l) => s + l.amount, 0);
  if (diff !== 0 && shown.length && Math.abs(diff) <= shown.length) {
    const i = shown.reduce((best, l, k) => (l.amount > shown[best].amount ? k : best), 0);
    shown[i] = { ...shown[i], amount: shown[i].amount + diff };
  }
  const blocking = q.lines.filter((l) => l.qty > 0 && (l.needsReview || !(l.unitPrice > 0)));
  return { subtotal, totalEx, totalInc, shown, shownTotal: shown.reduce((s, l) => s + l.amount, 0), includesVat, blocking };
}

export const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO').replace(/ /g, ' ')} kr`;

const qtyText = (qty: number, unit: string) => {
  const q = Number.isInteger(qty) ? String(qty) : String(qty).replace('.', ',');
  return unit ? `${q} ${unit}` : q;
};

/** Prisblokken i tilbuds-e-posten: linjer og sum. */
export function quoteText(q: Parameters<typeof calcQuote>[0]): string {
  const c = calcQuote(q);
  const rows = c.shown.map((l) => `• ${l.name}${l.unit ? `, ${qtyText(l.qty, l.unit)}` : ''}: ${kr(l.amount)}`);
  return `${rows.join('\n')}\n\nSum ${c.includesVat ? 'inkl.' : 'eks.'} mva: ${kr(c.shownTotal)}`;
}

/** Setter prisblokken inn der AI har skrevet [[PRISER]], ellers før siste avsnitt. */
export function insertPrices(body: string, block: string): string {
  if (body.includes('[[PRISER]]')) return body.replace('[[PRISER]]', block);
  const parts = body.replace(/\s+$/, '').split(/\n{2,}/);
  if (parts.length <= 1) return `${body.trim()}\n\n${block}`;
  return [...parts.slice(0, -1), block, parts.at(-1)].join('\n\n');
}
