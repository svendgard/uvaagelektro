// Tester tilbudsberegningen: samme resultat som Excel-malen, og linjer som summerer til totalen kunden ser.
import assert from 'node:assert/strict';
import { calcQuote, insertPrices, quoteText, type QuoteLine } from '../src/lib/quote.ts';
import { PRICE_LIST_UVAAG } from '../src/config/priceList.uvaag.ts';

let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };
const L = (name: string, qty: number, unitPrice: number, extra: Partial<QuoteLine> = {}): QuoteLine => ({ id: name, name, qty, unitPrice, unit: 'stk', ...extra });
const base = { markup: 1, warranty: 1.05, vatRate: 0.25, rounding: 0 };

// 1. Prislisten fra Excel
assert.equal(PRICE_LIST_UVAAG.items.length, 39);
assert.equal(PRICE_LIST_UVAAG.warranty, 1.05);
assert.equal(PRICE_LIST_UVAAG.items.find((i) => i.name === 'Stikkontakt - 2 uttak')!.unitPrice, 800);
assert.ok(PRICE_LIST_UVAAG.items.some((i) => i.name.startsWith('Sikringsskap ny innmat')), 'skrivefeil rettet');
assert.equal(new Set(PRICE_LIST_UVAAG.items.map((i) => i.id)).size, 39, 'unike ID-er');
ok('Prislisten fra Excel: 39 poster, garanti 5 %');

// 2. Samme som Excel: (delsum × påslag + avrunding) × garanti, × 1,25
const lines = [L('Stikkontakt - 2 uttak', 3, 800), L('Lyspunkt - Downlights', 6, 1100), L('Dimmer', 1, 1000)];
const c = calcQuote({ ...base, lines, customerType: 'privat' });
assert.equal(c.subtotal, 10000);
assert.equal(c.totalEx, 10500);
assert.equal(c.totalInc, 13125);
const c2 = calcQuote({ ...base, markup: 1.1, rounding: -500, lines, customerType: 'naering' });
assert.equal(c2.totalEx, (10000 * 1.1 - 500) * 1.05);
ok('Totalen regnes som i Excel-malen (påslag, avrunding, garanti, mva)');

// 3. Linjene kunden ser summerer alltid til summen
for (const q of [{ ...base, lines, customerType: 'privat' as const }, { ...base, markup: 1.07, rounding: -333, lines: [L('A', 3, 799), L('B', 7, 1111), L('C', 1, 33)], customerType: 'privat' as const }, { ...base, lines, customerType: 'naering' as const }]) {
  const r = calcQuote(q);
  assert.equal(r.shown.reduce((s, l) => s + l.amount, 0), r.shownTotal);
  assert.equal(r.shownTotal, Math.round(r.includesVat ? r.totalInc : r.totalEx));
}
assert.equal(c.shown[0].amount, Math.round(3 * 800 * 1.05 * 1.25));
ok('Linjebeløp inkluderer påslag, garanti og mva (privat) og summerer til totalen');

// 4. Linjer uten pris eller utenfor prislisten stopper godkjenning
const r4 = calcQuote({ ...base, customerType: 'privat', lines: [...lines, L('Demontering av eksisterende', 1, 0), L('Flytte sikringsskap', 1, 5000, { needsReview: true }), L('Ikke med', 0, 0)] });
assert.deepEqual(r4.blocking.map((l) => l.name), ['Demontering av eksisterende', 'Flytte sikringsskap']);
ok('Poster uten pris eller utenfor prislisten krever eierens vurdering');

// 5. Prisblokk i e-posten
const text = quoteText({ ...base, lines, customerType: 'privat' });
assert.match(text, /^• Stikkontakt - 2 uttak, 3 stk: 3 150 kr\n/);
assert.match(text, /Sum inkl\. mva: 13 125 kr$/);
assert.match(quoteText({ ...base, lines, customerType: 'naering' }), /Sum eks\. mva: 10 500 kr$/);
assert.equal(insertPrices('Hei,\n\nHer er prisen:\n\n[[PRISER]]\n\nSi fra.', 'X'), 'Hei,\n\nHer er prisen:\n\nX\n\nSi fra.');
assert.equal(insertPrices('Hei,\n\nHer er prisen.\n\nSi fra.', 'X'), 'Hei,\n\nHer er prisen.\n\nX\n\nSi fra.');
ok('Prisblokken: linjer og sum, inkl. mva for privat og eks. mva for bedrift, satt inn i teksten');

console.log(`\n${pass} av 5 tester bestått`);
