import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../lib/api';
import { kr, type PriceItem, type PriceList } from '../lib/quote';
import { invalidatePriceList } from './QuotePanel';
import { Icon } from './ui';
import { cx, fmtDateTime } from '../lib/util';

/** Prislisten AIOliver bruker i tilbudsberegninger. Redigeres her, eller ved å laste opp Excel-arket på nytt. */
export function PriceListCard({ canEdit }: { canEdit: boolean }) {
  const { actions } = useStore();
  const [pl, setPl] = useState<PriceList | null>(null);
  const [items, setItems] = useState<PriceItem[]>([]);
  const [warrantyPct, setWarrantyPct] = useState('5');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const apply = (v: PriceList) => { setPl(v); setItems(v.items); setWarrantyPct(String(Math.round((v.warranty - 1) * 1000) / 10)); setDirty(false); invalidatePriceList(); };
  useEffect(() => { api<PriceList>('/api/pricelist').then(apply).catch(() => setPl(null)); }, []);

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const m = new Map<string, PriceItem[]>();
    for (const it of items) if (!ql || it.name.toLowerCase().includes(ql)) m.set(it.group, [...(m.get(it.group) ?? []), it]);
    return [...m.entries()];
  }, [items, q]);

  const run = async (fn: () => Promise<PriceList>, ok: string) => {
    setBusy(true);
    try { apply(await fn()); actions.toast(ok, 'success'); } catch (e) { actions.toast(e instanceof Error ? e.message : 'Noe gikk galt.', 'danger'); } finally { setBusy(false); }
  };
  const save = () => run(() => api('/api/pricelist', { method: 'PUT', body: { items, markup: pl?.markup ?? 1, warranty: 1 + (Number(warrantyPct.replace(',', '.')) || 0) / 100 } }), 'Prislisten er lagret.');
  const upload = async (f: File) => {
    if (f.size > 3 * 1024 * 1024) { actions.toast('Filen er for stor (maks 3 MB).', 'danger'); return; }
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
    await run(() => api('/api/pricelist/import', { body: { fileBase64: b64, fileName: f.name } }), `Prislisten er lest inn fra ${f.name}.`);
  };

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-display text-base font-semibold">Prisliste</h2>
      <p className="mb-3 text-[13px] text-muted">AIOliver bruker bare priser herfra i tilbudsberegninger. Priser eks. mva, ferdig montert. Poster med 0 kr må du alltid prise selv.</p>
      {!pl ? <p className="text-[13px] text-muted">Henter …</p> : <>
        <p className="mb-3 text-xs text-muted">{items.length} poster{pl.source ? ` · ${pl.source}` : ''}{pl.updatedAt ? ` · oppdatert ${fmtDateTime(pl.updatedAt)}` : ''}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-faint" />
            <label className="sr-only" htmlFor="pl-search">Søk i prislisten</label>
            <input id="pl-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk post" className="field" style={{ paddingLeft: 32 }} />
          </div>
          {canEdit && <>
            <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
            <button className="btn btn-ghost" disabled={busy} onClick={() => file.current?.click()}><Icon name="file" />Last opp Excel</button>
          </>}
        </div>
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {groups.map(([g, list]) => {
            const isOpen = open === g || !!q.trim();
            return (
              <li key={g}>
                <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] font-semibold hover:bg-sunk/60" onClick={() => setOpen(isOpen && !q ? null : g)}>
                  {g}<span className="text-xs font-normal text-muted">{list.length} poster {isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && (
                  <ul className="divide-y divide-line border-t border-line bg-sunk/40">
                    {list.map((it) => (
                      <li key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                        <span className="min-w-0 flex-1">{it.name}</span>
                        {canEdit ? (
                          <label className="flex items-center gap-1"><span className="sr-only">Pris for {it.name}</span>
                            <input type="number" inputMode="numeric" min={0} step={50} value={it.unitPrice}
                              onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, unitPrice: v } : x))); setDirty(true); }}
                              className={cx('field !w-24 !py-1 text-right tnum', it.unitPrice === 0 && 'border-warn')} />
                            <span className="w-12 text-xs text-muted">kr/{it.unit}</span>
                          </label>
                        ) : <span className="tnum">{kr(it.unitPrice)}/{it.unit}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px]"><span className="text-xs font-semibold text-muted">Garantiansvar (%)</span>
            <input type="number" inputMode="decimal" step="any" min={0} value={warrantyPct} disabled={!canEdit} onChange={(e) => { setWarrantyPct(e.target.value); setDirty(true); }} className="field !w-24 !py-1 text-right tnum" />
          </label>
          {canEdit && dirty && <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Lagrer …' : 'Lagre prislisten'}</button>}
          {canEdit && dirty && <button className="btn btn-ghost" disabled={busy} onClick={() => apply(pl)}>Angre</button>}
        </div>
      </>}
    </section>
  );
}
