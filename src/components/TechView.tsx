import { useState } from 'react';
import { useStore } from '../state/store';
import type { Case, ChatMessage } from '../domain/types';
import { DOC_LABEL } from '../config/tenant';
import { Icon } from './ui';
import { JobStageBadge, TechAvatar } from './Projects';
import { cx, fmtTime, dayStr } from '../lib/util';

/**
 * Montørvisningen slik den vil oppleves i Slack eller Teams: en bot poster dagens jobber,
 * montøren svarer i tråden med knapper, bilder og notater. Her simulert i nettleseren.
 */

function Bubble({ m, techName, onChoose }: { m: ChatMessage; techName: string; onChoose?: (caseId: string) => void }) {
  const mine = m.from === 'tech';
  return (
    <div className={cx('flex gap-2', mine && 'flex-row-reverse')}>
      {!mine && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-[10px] font-bold text-surface">AK</span>}
      <div className={cx('max-w-[82%] rounded-2xl px-3 py-2 text-[13px]', mine ? 'rounded-tr-sm bg-brand text-surface' : 'rounded-tl-sm bg-sunk')}>
        <p className={cx('mb-0.5 text-[10px] font-semibold', mine ? 'text-surface/70' : 'text-faint')}>{mine ? techName : 'Agentkontoret'} · {fmtTime(m.at)}</p>
        {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
        {m.photos && m.photos.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.photos.map((p) => (
              <span key={p.id} className={cx('flex h-14 w-14 flex-col items-center justify-center rounded-lg text-[9px]', mine ? 'bg-surface/20' : 'bg-surface')}>
                <Icon name={p.kind === 'pdf' ? 'file' : 'image'} className="h-5 w-5" />{p.kind === 'pdf' ? 'PDF' : 'Bilde'}
              </span>
            ))}
          </div>
        )}
        {m.choices && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.choices.map((c) => <button key={c.caseId} disabled={m.resolved} onClick={() => onChoose?.(c.caseId)} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink disabled:opacity-50">{c.label}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

function CompleteForm({ c, onDone }: { c: Case; onDone: () => void }) {
  const { tenant, actions } = useStore();
  const j = c.job!;
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState(2);
  const [hours, setHours] = useState(j.plannedHours);
  const [logged, setLogged] = useState(true);
  const [mats, setMats] = useState(j.plannedMaterials.map((m) => ({ elnr: m.elnr, qty: m.qty })));
  const [addMat, setAddMat] = useState('');
  const [extra, setExtra] = useState<{ description: string; hours: number }[]>([]);
  const [docs, setDocs] = useState<Record<string, boolean>>(Object.fromEntries(j.requiredDocs.filter((d) => d !== 'nettselskap').map((d) => [d, true])));
  const [busy, setBusy] = useState(false);
  const fid = c.id;
  return (
    <form className="mt-2 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await actions.techComplete(c.id, { note, photoCount: photos, hoursReported: hours, loggedInTripletex: logged, materials: mats, extraWork: extra, docs });
      setBusy(false); onDone();
    }}>
      <p className="text-[13px] font-semibold">Ferdigmelding</p>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor={`n-${fid}`}>Hva ble gjort? (tekst eller talenotat)
        <textarea id={`n-${fid}`} className="field min-h-[70px] text-[13px] font-normal text-ink" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. Montert og testet. Kunden ville også ha ny kontakt i gangen." />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-muted">Bilder</span>
        <button type="button" className="btn btn-ghost !px-2 !py-1" onClick={() => setPhotos((p) => Math.max(0, p - 1))} aria-label="Færre bilder">−</button>
        <span className="tnum font-semibold">{photos}</span>
        <button type="button" className="btn btn-ghost !px-2 !py-1" onClick={() => setPhotos((p) => Math.min(6, p + 1))} aria-label="Flere bilder"><Icon name="image" className="h-3.5 w-3.5" />+</button>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted">Materiell brukt</p>
        <ul className="flex flex-col gap-1">
          {mats.map((m, i) => (
            <li key={m.elnr} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{tenant.billing.materials[m.elnr]?.name.replace(/ \(eksempel\)/, '')}</span>
              <label className="sr-only" htmlFor={`m-${fid}-${i}`}>Antall</label>
              <input id={`m-${fid}-${i}`} type="number" min={0} step={1} className="field w-16 !py-1 text-right tnum" value={m.qty} onChange={(e) => setMats(mats.map((x, k) => k === i ? { ...x, qty: Number(e.target.value) } : x))} />
              <span className="w-6 text-faint">{tenant.billing.materials[m.elnr]?.unit}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex gap-1.5">
          <label className="sr-only" htmlFor={`am-${fid}`}>Legg til materiell</label>
          <select id={`am-${fid}`} className="field !py-1 text-xs" value={addMat} onChange={(e) => setAddMat(e.target.value)}>
            <option value="">Legg til materiell …</option>
            {Object.entries(tenant.billing.materials).filter(([k]) => !mats.some((m) => m.elnr === k)).map(([k, v]) => <option key={k} value={k}>{v.name.replace(/ \(eksempel\)/, '')}</option>)}
          </select>
          <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" disabled={!addMat} onClick={() => { setMats([...mats, { elnr: addMat, qty: 1 }]); setAddMat(''); }}>Legg til</button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted">Tilleggsarbeid (ikke i tilbudet)</p>
        {extra.map((x, i) => (
          <div key={i} className="mb-1 flex gap-1.5">
            <label className="sr-only" htmlFor={`x-${fid}-${i}`}>Beskrivelse</label>
            <input id={`x-${fid}-${i}`} className="field !py-1 text-xs" value={x.description} onChange={(e) => setExtra(extra.map((y, k) => k === i ? { ...y, description: e.target.value } : y))} placeholder="Hva ble gjort i tillegg?" />
            <label className="sr-only" htmlFor={`xh-${fid}-${i}`}>Timer</label>
            <input id={`xh-${fid}-${i}`} type="number" min={0} step={0.25} className="field w-20 !py-1 text-right text-xs tnum" value={x.hours} onChange={(e) => setExtra(extra.map((y, k) => k === i ? { ...y, hours: Number(e.target.value) } : y))} />
          </div>
        ))}
        <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setExtra([...extra, { description: '', hours: 0.5 }])}>+ Legg til tillegg</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label htmlFor={`h-${fid}`} className="font-semibold text-muted">Timer totalt</label>
        <input id={`h-${fid}`} type="number" min={0} step={0.25} className="field w-20 !py-1 text-right tnum" value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        <label className="flex items-center gap-1.5"><input type="checkbox" id={`l-${fid}`} checked={logged} onChange={(e) => setLogged(e.target.checked)} />Ført i Tripletex på {j.tripletexProjectNo}</label>
      </div>
      {j.requiredDocs.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {j.requiredDocs.map((d) => <label key={d} className="flex items-center gap-1.5"><input type="checkbox" id={`d-${fid}-${d}`} checked={!!docs[d]} onChange={(e) => setDocs({ ...docs, [d]: e.target.checked })} />{DOC_LABEL[d]} {d === 'nettselskap' ? 'sendt' : 'lastet opp'}</label>)}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-accent" disabled={busy}><Icon name="check" />{busy ? 'Sender …' : 'Send ferdigmelding'}</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Avbryt</button>
      </div>
    </form>
  );
}

function JobCard({ c, techName }: { c: Case; techName: string }) {
  const { actions } = useStore();
  const j = c.job!;
  const [mode, setMode] = useState<'none' | 'done' | 'help'>('none');
  const [help, setHelp] = useState('');
  const first = j.thread[0];
  const replies = j.thread.slice(1);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-[10px] font-bold text-surface">AK</span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-line bg-surface p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-faint">{j.slot} · {c.number}</span>
            <JobStageBadge stage={j.stage} short />
          </div>
          <p className="whitespace-pre-wrap text-[13px]">{first?.text}</p>
          {j.fixedPrice && <p className="mt-1 text-xs text-muted">Fastpris. Planlagt {j.plannedHours.toLocaleString('nb-NO')} t.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {j.stage === 'scheduled' && <button className="btn btn-primary !py-1 text-xs" onClick={() => actions.techStart(c.id)}>Start</button>}
            {j.stage === 'in_progress' && <>
              <button className="btn btn-accent !py-1 text-xs" onClick={() => setMode(mode === 'done' ? 'none' : 'done')}><Icon name="check" className="h-3.5 w-3.5" />Ferdig</button>
              <button className="btn btn-ghost !py-1 text-xs" onClick={() => setMode(mode === 'help' ? 'none' : 'help')}><Icon name="help" className="h-3.5 w-3.5" />Trenger hjelp</button>
            </>}
            {(j.stage === 'reported' || j.stage === 'controlled' || j.stage === 'invoiced') && <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok"><Icon name="check" className="h-3.5 w-3.5" />Ferdigmeldt</span>}
          </div>
        </div>
      </div>
      {replies.length > 0 && <div className="ml-9 flex flex-col gap-1.5 border-l-2 border-line pl-3">{replies.map((m) => <Bubble key={m.id} m={m} techName={techName} />)}</div>}
      {mode === 'help' && (
        <form className="ml-9 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (help.trim()) { actions.techHelp(c.id, help); setHelp(''); setMode('none'); } }}>
          <label className="sr-only" htmlFor={`hp-${c.id}`}>Hva trenger du hjelp med?</label>
          <input id={`hp-${c.id}`} className="field text-[13px]" value={help} onChange={(e) => setHelp(e.target.value)} placeholder="Hva trenger du hjelp med?" />
          <button className="btn btn-danger">Send</button>
        </form>
      )}
      {mode === 'done' && <div className="ml-9"><CompleteForm c={c} onDone={() => setMode('none')} /></div>}
    </div>
  );
}

export function TechView() {
  const { state, tenant, actions } = useStore();
  const [techId, setTechId] = useState('marius');
  const t = tenant.technicians.find((x) => x.id === techId)!;
  const today = dayStr(0);
  const jobs = state.cases.filter((c) => c.job?.technicianId === techId && c.job.scheduledDate === today)
    .sort((a, b) => (a.job!.slot === 'formiddag' ? 0 : 1) - (b.job!.slot === 'formiddag' ? 0 : 1));
  const tomorrow = state.cases.filter((c) => c.job?.technicianId === techId && c.job.scheduledDate === dayStr(1));
  const chat = state.techChat[techId] ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Montørvisning</h1>
          <p className="max-w-[62ch] text-[13px] text-muted">Slik vil montørene oppleve det i Slack eller Teams. De svarer i tråden til hver jobb, og alt havner på riktig sak. Her simulert.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Velg montør">
          {tenant.technicians.map((x) => (
            <button key={x.id} role="tab" aria-selected={x.id === techId} onClick={() => setTechId(x.id)} className={cx('flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold', x.id === techId ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-muted')}>
              <TechAvatar t={x} size={22} />{x.firstName}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[440px] overflow-hidden rounded-[22px] border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <TechAvatar t={t} size={32} />
          <div className="leading-tight"><p className="text-[13px] font-semibold">Agentkontoret</p><p className="text-[11px] text-muted">Direktemelding med {t.firstName}</p></div>
          <span className="ml-auto rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold text-warn">Simulert</span>
        </div>
        <div className="flex max-h-[70vh] min-h-[420px] flex-col gap-4 overflow-y-auto px-3 py-4">
          {chat.slice(0, 1).map((m) => <Bubble key={m.id} m={m} techName={t.firstName} />)}
          {jobs.map((c) => <JobCard key={c.id} c={c} techName={t.firstName} />)}
          {jobs.length === 0 && <p className="py-4 text-center text-xs text-faint">Ingen jobber i dag.</p>}
          {chat.slice(1).map((m) => <Bubble key={m.id} m={m} techName={t.firstName} onChoose={(cid) => actions.chooseLoosePhoto(techId, m.id, cid)} />)}
          {tomorrow.length > 0 && (
            <div className="rounded-xl bg-sunk/70 px-3 py-2 text-xs text-muted">
              <b className="text-ink">I morgen:</b> {tomorrow.map((c) => `${c.job!.slot} ${c.customer.address?.split(',')[0]}`).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => actions.postLoosePhoto(techId)}><Icon name="image" className="h-3.5 w-3.5" />Send bilde uten tråd</button>
          <span className="text-[11px] text-faint">Agenten sorterer, eller spør hvis den er usikker.</span>
        </div>
      </div>
    </div>
  );
}
