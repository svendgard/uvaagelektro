import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../lib/api';
import { calcQuote, kr, quoteText, type CustomerKind, type PriceList, type QuoteLine } from '../lib/quote';
import { Icon } from './ui';
import { cx } from '../lib/util';

/**
 * Tilbudsberegning i saken. AIOliver foreslår poster og antall fra prislisten; eieren justerer og godkjenner.
 * Når beregningen er godkjent, lager AIOliver tilbuds-e-posten med eksakte linjer og sum.
 */

let priceListCache: Promise<PriceList> | null = null;
const loadPriceList = () => (priceListCache ??= api<PriceList>('/api/pricelist').catch((e) => { priceListCache = null; throw e; }));
export const invalidatePriceList = () => { priceListCache = null; };

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `l-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function QuoteStartButton({ caseId }: { caseId: string }) {
  const { state, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const c = state.cases.find((x) => x.id === caseId);
  if (!c || state.role !== 'owner') return null;
  return (
    <button className="btn btn-primary" disabled={busy} onClick={async () => {
      setBusy(true);
      // AI foreslår poster; finner den ingen, startes en tom beregning.
      const ok = await actions.suggestQuote(caseId);
      if (!ok) await actions.saveQuote(caseId, { lines: [], markup: 1, rounding: 0, customerType: c.customer.type === 'naering' ? 'naering' : 'privat' });
      setBusy(false);
    }}>
      <Icon name="sparkle" />{busy ? 'AIOliver ser på saken …' : 'Lag tilbudsberegning'}
    </button>
  );
}

export function QuotePanel({ caseId }: { caseId: string }) {
  const { state, actions } = useStore();
  const quote = state.quotes.find((q) => q.caseId === caseId);
  const [pl, setPl] = useState<PriceList | null>(null);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [markupPct, setMarkupPct] = useState('0');
  const [rounding, setRounding] = useState('0');
  const [customerType, setCustomerType] = useState<CustomerKind>('privat');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'approve' | 'suggest' | 'reopen'>(null);
  const [add, setAdd] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { loadPriceList().then(setPl).catch(() => setPl({ items: [], markup: 1, warranty: 1, vatRate: 0.25 })); }, []);
  // Hent serverens versjon når den endres, men aldri over ulagrede endringer.
  useEffect(() => {
    if (!quote || dirty) return;
    setLines(quote.lines);
    setMarkupPct(String(Math.round((quote.markup - 1) * 1000) / 10));
    setRounding(String(quote.rounding));
    setCustomerType(quote.customerType);
  }, [quote?.id, quote?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const markup = 1 + (Number(markupPct.replace(',', '.')) || 0) / 100;
  const roundingN = Number(rounding.replace(',', '.')) || 0;
  const draft = { lines, markup, rounding: roundingN, customerType, warranty: quote?.warranty ?? 1, vatRate: quote?.vatRate ?? 0.25 };
  const calc = useMemo(() => calcQuote(draft), [lines, markup, roundingN, customerType, quote?.warranty, quote?.vatRate]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!quote) return null;

  const editable = quote.status === 'draft' && state.role === 'owner';
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };
  const setLine = (id: string, patch: Partial<QuoteLine>) => { setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch, needsReview: patch.unitPrice !== undefined ? !(patch.unitPrice > 0) && !!l.needsReview : l.needsReview } : l))); setDirty(true); };
  const removeLine = (id: string) => { setLines((ls) => ls.filter((l) => l.id !== id)); setDirty(true); };
  const addLine = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const item = pl?.items.find((i) => i.name.toLowerCase() === t.toLowerCase());
    setLines((ls) => [...ls, item
      ? { id: newId(), itemId: item.id, name: item.name, qty: 1, unitPrice: item.unitPrice, unit: item.unit, needsReview: !(item.unitPrice > 0) }
      : { id: newId(), name: t, qty: 1, unitPrice: 0, unit: 'stk', needsReview: true, note: 'Egen linje' }]);
    setAdd(''); setDirty(true);
  };
  const save = async () => { setBusy('save'); const ok = await actions.saveQuote(caseId, { lines, markup, rounding: roundingN, customerType }); if (ok) setDirty(false); setBusy(null); return ok; };
  const approve = async () => {
    setBusy('approve');
    if (dirty && !(await actions.saveQuote(caseId, { lines, markup, rounding: roundingN, customerType }))) { setBusy(null); return; }
    setDirty(false);
    await actions.approveQuote(caseId);
    setBusy(null);
  };
  const statusPill = { draft: ['Kladd', 'bg-accent-soft text-accent-ink'], approved: ['Godkjent · tilbud laget', 'bg-ok-soft text-ok'], sent: ['Sendt til kunden', 'bg-info-soft text-info'] }[quote.status];

  return (
    <section className="rounded-xl border-2 border-brand/30 bg-surface p-4" aria-label="Tilbudsberegning">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base font-semibold">Tilbudsberegning</h3>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', statusPill[1])}>{statusPill[0]}</span>
        {quote.source === 'ai' && quote.reason && quote.status === 'draft' && <span className="w-full text-xs text-muted">Forslag fra AIOliver: {quote.reason}</span>}
      </div>

      {lines.length === 0 && <p className="mb-3 rounded-lg bg-sunk px-3 py-2 text-[13px] text-muted">Ingen poster ennå. Legg til fra prislisten under{editable ? ', eller la AIOliver foreslå' : ''}.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {lines.map((l) => {
          const review = l.qty > 0 && (l.needsReview || !(l.unitPrice > 0));
          return (
            <li key={l.id} className="flex flex-col gap-1.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[13px] font-semibold">{l.name}{l.note && <span className="block text-[11px] font-normal text-muted">{l.note}</span>}</span>
                {editable && <button type="button" aria-label={`Fjern ${l.name}`} className="text-muted hover:text-bad" onClick={() => removeLine(l.id)}><Icon name="x" className="h-4 w-4" /></button>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <label className="flex items-center gap-1"><span className="sr-only">Antall</span>
                  <input type="number" inputMode="decimal" min={0} step="any" value={l.qty} disabled={!editable} onChange={(e) => setLine(l.id, { qty: Math.max(0, Number(e.target.value) || 0) })} className="field !w-20 !py-1 text-right tnum" />
                  <span className="text-muted">{l.unit}</span>
                </label>
                <span className="text-muted">×</span>
                <label className="flex items-center gap-1"><span className="sr-only">Pris per {l.unit}</span>
                  <input type="number" inputMode="numeric" min={0} step={50} value={l.unitPrice} disabled={!editable} onChange={(e) => setLine(l.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })} className={cx('field !w-24 !py-1 text-right tnum', review && 'border-warn')} />
                  <span className="text-muted">kr</span>
                </label>
                <span className="ml-auto font-semibold tnum">{kr(l.qty * l.unitPrice)}</span>
              </div>
              {review && <span className="inline-flex items-center gap-1 text-xs font-semibold text-warn"><Icon name="alert" className="h-3.5 w-3.5" />Krever din vurdering: sett pris{l.itemId ? '' : ' (finnes ikke i prislisten)'}</span>}
            </li>
          );
        })}
      </ul>

      {editable && (
        <div className="mt-2 flex gap-2">
          <label className="sr-only" htmlFor={`add-${caseId}`}>Legg til post</label>
          <input id={`add-${caseId}`} list={`pl-${caseId}`} value={add} placeholder="Legg til post fra prislisten …" onChange={(e) => setAdd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine(add); } }} className="field flex-1" />
          <datalist id={`pl-${caseId}`}>{pl?.items.map((i) => <option key={i.id} value={i.name}>{`${i.group} · ${kr(i.unitPrice)}/${i.unit}`}</option>)}</datalist>
          <button type="button" className="btn btn-ghost" disabled={!add.trim()} onClick={() => addLine(add)}><Icon name="plus" />Legg til</button>
        </div>
      )}

      <div className="mt-3 grid gap-2 rounded-lg bg-sunk/70 p-3 text-[13px] sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Kunde</span>
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Kundetype">
            {(['privat', 'naering'] as const).map((k) => (
              <button key={k} type="button" disabled={!editable} onClick={() => touch(setCustomerType)(k)}
                className={cx('flex-1 rounded-md px-2 py-1 text-xs font-semibold', customerType === k ? 'bg-brand text-surface' : 'text-muted')}>{k === 'privat' ? 'Privat (inkl. mva)' : 'Bedrift (eks. mva)'}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Påslag / rabatt (%)</span>
          <input type="number" inputMode="decimal" step="any" value={markupPct} disabled={!editable} onChange={(e) => touch(setMarkupPct)(e.target.value)} className="field !py-1 text-right tnum" />
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Avrunding (kr eks. mva)</span>
          <input type="number" inputMode="numeric" step={100} value={rounding} disabled={!editable} onChange={(e) => touch(setRounding)(e.target.value)} className="field !py-1 text-right tnum" />
        </label>
      </div>

      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-muted">Delsum</dt><dd className="text-right tnum">{kr(calc.subtotal)}</dd>
        <dt className="text-muted">Garantiansvar</dt><dd className="text-right tnum">{Math.round(((quote.warranty ?? 1) - 1) * 1000) / 10} %</dd>
        <dt className="text-muted">Sum eks. mva</dt><dd className="text-right tnum">{kr(calc.totalEx)}</dd>
        <dt className="text-muted">Sum inkl. mva</dt><dd className="text-right tnum">{kr(calc.totalInc)}</dd>
        <dt className="font-semibold">Kunden ser</dt><dd className="text-right font-display text-lg font-semibold tnum">{kr(calc.shownTotal)} <span className="text-xs font-normal text-muted">{calc.includesVat ? 'inkl.' : 'eks.'} mva</span></dd>
      </dl>

      {calc.shown.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setShowPreview((v) => !v)}>{showPreview ? 'Skjul' : 'Vis'} slik det står i e-posten</button>
          {showPreview && <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-sunk p-3 font-sans text-[13px]">{quoteText(draft)}</pre>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editable && <>
          <button className="btn btn-accent" disabled={!!busy || calc.blocking.length > 0 || calc.shown.length === 0} onClick={() => void approve()}>
            <Icon name="check" />{busy === 'approve' ? 'Lager tilbud …' : 'Godkjenn beregning og lag tilbud'}
          </button>
          {dirty && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? 'Lagrer …' : 'Lagre'}</button>}
          <button className="btn btn-ghost" disabled={!!busy} onClick={async () => { setBusy('suggest'); setDirty(false); await actions.suggestQuote(caseId); setBusy(null); }}>
            <Icon name="sparkle" />{busy === 'suggest' ? 'Foreslår …' : 'Foreslå på nytt'}
          </button>
        </>}
        {quote.status === 'approved' && state.role === 'owner' && (
          <button className="btn btn-ghost" disabled={!!busy} onClick={async () => { setBusy('reopen'); await actions.reopenQuote(caseId); setBusy(null); }}><Icon name="pen" />Endre beregning</button>
        )}
        {quote.status === 'sent' && state.role === 'owner' && (
          <button className="btn btn-ghost" disabled={!!busy} onClick={async () => { setBusy('save'); await actions.saveQuote(caseId, { lines: quote.lines, markup: quote.markup, rounding: quote.rounding, customerType: quote.customerType }); setBusy(null); }}><Icon name="plus" />Ny beregning</button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {editable
          ? calc.blocking.length ? `${calc.blocking.length} post${calc.blocking.length > 1 ? 'er' : ''} trenger pris før du kan godkjenne.` : 'Når du godkjenner, skriver AIOliver tilbudet med disse linjene og summen. Ingenting sendes før du har trykket Godkjenn og Send.'
          : quote.status === 'approved' ? 'Tilbudet ligger som utkast under. Les over og send.' : quote.status === 'sent' ? 'Tilbudet er sendt. «Ny beregning» lager en ny versjon.' : 'Din rolle kan se, men ikke endre.'}
      </p>
    </section>
  );
}
