import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Case, ChatMessage, ControlCheck, Job, JobStage, Technician } from '../domain/types';
import { DOC_LABEL, JOB_STAGE_META, JOB_STAGE_ORDER } from '../config/tenant';
import { invoiceTotal } from '../adapters/ai/ProjectControl';
import { dayStr } from '../data/jobsSeed';
import { Empty, Icon, Portrait } from './ui';
import { cx, fmtDateTime, fmtRelative, fmtTime, kr } from '../lib/util';

const TECH_TONE: Record<string, string> = {
  brand: 'bg-brand text-surface', info: 'bg-info text-surface', ok: 'bg-ok text-surface', violet: 'bg-violet text-surface',
};

export function TechAvatar({ t, size = 28 }: { t?: Technician; size?: number }) {
  if (!t) return <span className="inline-flex items-center justify-center rounded-full bg-sunk text-[10px] text-faint" style={{ width: size, height: size }}>?</span>;
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold', TECH_TONE[t.color])} style={{ width: size, height: size, fontSize: size * 0.38 }} title={t.name}>{t.initials}</span>;
}

export function JobStageBadge({ stage, short }: { stage: JobStage; short?: boolean }) {
  const m = JOB_STAGE_META[stage];
  return <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', m.tone)}><span className={cx('h-1.5 w-1.5 rounded-full', m.dot)} />{short ? m.short : m.label}</span>;
}

const dayLabel = (d?: string) => {
  if (!d) return 'Ikke satt';
  if (d === dayStr(0)) return 'I dag';
  if (d === dayStr(1)) return 'I morgen';
  if (d === dayStr(-1)) return 'I går';
  return new Date(`${d}T12:00`).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
};

export function verdict(job: Job) {
  const cs = job.checks ?? [];
  const fails = cs.filter((c) => c.status === 'fail').length;
  const warns = cs.filter((c) => c.status === 'warn').length;
  if (!job.checks) return { label: 'Kontrolleres …', tone: 'bg-violet-soft text-violet', fails, warns };
  if (fails) return { label: `${fails} må løses`, tone: 'bg-bad-soft text-bad', fails, warns };
  if (warns) return { label: `${warns} å se på`, tone: 'bg-warn-soft text-warn', fails, warns };
  return { label: 'Klar', tone: 'bg-ok-soft text-ok', fails, warns };
}

/** AIHenriks vaktpunkter for oppdrag. */
export function useWatchpoints() {
  const { state, tenant } = useStore();
  return useMemo(() => {
    const out: { caseId: string; text: string; tone: 'danger' | 'warning' | 'neutral' }[] = [];
    const today = dayStr(0);
    for (const c of state.cases) {
      const j = c.job;
      if (!j) continue;
      const t = tenant.technicians.find((x) => x.id === j.technicianId);
      if (j.help) out.push({ caseId: c.id, text: `${t?.firstName} trenger hjelp hos ${c.customer.name}: «${j.help.text}»`, tone: 'danger' });
      const days = Math.floor((Date.now() - new Date(j.acceptedAt).getTime()) / 864e5);
      if (j.stage === 'to_plan' && days >= 3) out.push({ caseId: c.id, text: `Akseptert for ${days} dager siden, ikke planlagt: ${c.customer.name}`, tone: 'warning' });
      if ((j.stage === 'scheduled' || j.stage === 'in_progress') && j.scheduledDate && j.scheduledDate < today) out.push({ caseId: c.id, text: `Planlagt ${dayLabel(j.scheduledDate).toLowerCase()}, ikke ferdigmeldt: ${c.customer.name}`, tone: 'warning' });
      if (j.stage === 'controlled' && j.controlledAt && Date.now() - new Date(j.controlledAt).getTime() > 24 * 3600e3) out.push({ caseId: c.id, text: `Kontrollert ${fmtRelative(j.controlledAt)}, ikke sendt til Tripletex: ${c.customer.name}`, tone: 'warning' });
      if (j.stage === 'reported' && j.checks?.some((x) => x.id === 'extra' && x.status === 'fail')) out.push({ caseId: c.id, text: `Tilleggsarbeid ikke avklart med ${c.customer.name}`, tone: 'neutral' });
    }
    return out;
  }, [state.cases, tenant]);
}

export function ControlQueue({ openCase, compact }: { openCase: (id: string) => void; compact?: boolean }) {
  const { state, tenant, actions } = useStore();
  const items = state.cases.filter((c) => c.job && (c.job.stage === 'reported' || c.job.stage === 'controlled'))
    .sort((a, b) => (a.job!.stage === 'reported' ? 0 : 1) - (b.job!.stage === 'reported' ? 0 : 1) || (b.job!.report?.at ?? '').localeCompare(a.job!.report?.at ?? ''));
  const sofie = tenant.agents.find((a) => a.id === 'control')!;
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold"><Portrait p={sofie.portrait} size={26} aiBadge={false} />Ferdige oppdrag – venter på deg</h2>
        <span className="text-xs text-muted">AISofie har kontrollert. Du godkjenner før noe går til Tripletex.</span>
      </div>
      {items.length === 0 ? <Empty text="Ingen ferdigmeldte oppdrag venter." /> : (
        <ul className={cx('grid gap-2', !compact && 'md:grid-cols-2')}>
          {items.map((c) => {
            const j = c.job!;
            const v = verdict(j);
            const t = tenant.technicians.find((x) => x.id === (j.report?.by ?? j.technicianId));
            const issues = (j.checks ?? []).filter((x) => x.status !== 'ok' && x.id !== 'basis').slice(0, 2);
            const total = j.invoice ? invoiceTotal(j.invoice.lines) : 0;
            return (
              <li key={c.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <button onClick={() => openCase(c.id)} className="flex items-start gap-3 text-left">
                  <TechAvatar t={t} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-[13px]">{c.customer.name}</b>
                      {j.stage === 'reported' ? <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', v.tone)}>{v.label}</span> : <JobStageBadge stage="controlled" short />}
                      {j.smallJob && <span className="rounded-full bg-sunk px-1.5 text-[10px] font-semibold text-muted">Småjobb</span>}
                    </div>
                    <p className="truncate text-xs text-muted">{tenant.jobTypes[c.jobType].label} · {c.customer.address} · {t?.firstName} {j.report ? fmtRelative(j.report.at) : ''}</p>
                    {issues.length > 0 && <ul className="mt-1 flex flex-col gap-0.5">{issues.map((x) => <li key={x.id} className={cx('text-xs', x.status === 'fail' ? 'text-bad' : 'text-warn')}>• {x.detail}</li>)}</ul>}
                  </div>
                  <span className="shrink-0 text-right text-xs tnum text-muted">{total ? <><b className="text-ink">{kr(Math.round(total))}</b><br />eks. mva</> : null}</span>
                </button>
                {j.stage === 'controlled' && (
                  <button className="btn btn-primary self-start" onClick={() => actions.sendToTripletex(c.id)}><Icon name="send" />Send fakturagrunnlag til Tripletex</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PlanControls({ c, suggestion }: { c: Case; suggestion?: { techId: string; date: string } }) {
  const { tenant, actions } = useStore();
  const [techId, setTech] = useState(suggestion?.techId ?? tenant.technicians[1].id);
  const [date, setDate] = useState(suggestion?.date ?? dayStr(1));
  const [slot, setSlot] = useState<'formiddag' | 'ettermiddag'>('ettermiddag');
  const dates = [0, 1, 2, 3].map((o) => dayStr(o));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={`pt-${c.id}`}>Montør</label>
      <select id={`pt-${c.id}`} className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs" value={techId} onChange={(e) => setTech(e.target.value)}>
        {tenant.technicians.map((t) => <option key={t.id} value={t.id}>{t.firstName}</option>)}
      </select>
      <label className="sr-only" htmlFor={`pd-${c.id}`}>Dag</label>
      <select id={`pd-${c.id}`} className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs" value={date} onChange={(e) => setDate(e.target.value)}>
        {dates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
      </select>
      <label className="sr-only" htmlFor={`ps-${c.id}`}>Tidspunkt</label>
      <select id={`ps-${c.id}`} className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs" value={slot} onChange={(e) => setSlot(e.target.value as 'formiddag' | 'ettermiddag')}>
        <option value="formiddag">Formiddag</option><option value="ettermiddag">Ettermiddag</option>
      </select>
      <button className="btn btn-primary !px-2.5 !py-1 text-xs" onClick={() => actions.planJob(c.id, techId, date, slot)}>Planlegg</button>
    </div>
  );
}

function DayBoard({ openCase }: { openCase: (id: string) => void }) {
  const { state, tenant } = useStore();
  const [offset, setOffset] = useState(0);
  const day = dayStr(offset);
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Dagstavle</h2>
        <div className="flex rounded-lg border border-line p-0.5">
          {[0, 1].map((o) => <button key={o} onClick={() => setOffset(o)} className={cx('rounded-md px-2.5 py-1 text-xs font-semibold', offset === o ? 'bg-brand text-surface' : 'text-muted')}>{o === 0 ? 'I dag' : 'I morgen'}</button>)}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tenant.technicians.map((t) => {
          const jobs = state.cases.filter((c) => c.job?.technicianId === t.id && c.job.scheduledDate === day)
            .sort((a, b) => (a.job!.slot === 'formiddag' ? 0 : 1) - (b.job!.slot === 'formiddag' ? 0 : 1));
          return (
            <div key={t.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-sunk/70 p-2.5">
              <div className="flex items-center gap-2">
                <TechAvatar t={t} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.firstName}{t.isOwner && <span className="font-normal text-muted"> (deg)</span>}</span>
                <span className="text-xs text-faint tnum">{jobs.length} jobb{jobs.length === 1 ? '' : 'er'}</span>
              </div>
              {jobs.map((c) => (
                <button key={c.id} onClick={() => openCase(c.id)} className={cx('flex flex-col gap-1 rounded-lg border bg-surface p-2 text-left', c.job!.help ? 'border-bad/60' : 'border-line')}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{c.job!.slot}</span>
                    <JobStageBadge stage={c.job!.stage} short />
                  </div>
                  <span className="truncate text-[13px] font-semibold">{c.customer.address?.split(',')[0]}</span>
                  <span className="truncate text-xs text-muted">{c.customer.name} · {tenant.jobTypes[c.jobType].label}</span>
                  {c.job!.help && <span className="flex items-center gap-1 text-xs font-semibold text-bad"><Icon name="help" className="h-3.5 w-3.5" />Trenger hjelp</span>}
                </button>
              ))}
              {jobs.length === 0 && <p className="py-3 text-center text-xs text-faint">Ledig</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlanQueue({ openCase }: { openCase: (id: string) => void }) {
  const { state, tenant } = useStore();
  const queue = state.cases.filter((c) => c.job?.stage === 'to_plan').sort((a, b) => a.job!.acceptedAt.localeCompare(b.job!.acceptedAt));
  const scheduled = state.cases.filter((c) => c.job?.stage === 'scheduled' && c.job.scheduledDate && c.job.scheduledDate >= dayStr(0));
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-display text-base font-semibold">Ikke planlagt</h2>
      <p className="mb-3 text-xs text-muted">Småjobber samles med jobber i samme område, så de blir lønnsomme.</p>
      {queue.length === 0 ? <Empty text="Alt er planlagt." /> : (
        <ul className="flex flex-col gap-3">
          {queue.map((c) => {
            const j = c.job!;
            const near = j.smallJob ? scheduled.find((s) => s.job!.area === j.area) : undefined;
            const nt = near && tenant.technicians.find((t) => t.id === near.job!.technicianId);
            return (
              <li key={c.id} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
                <button onClick={() => openCase(c.id)} className="text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[13px]">{c.customer.name}</b>
                    {j.smallJob && <span className="rounded-full bg-sunk px-1.5 text-[10px] font-semibold text-muted">Småjobb{j.fixedPrice ? ` · ${kr(j.fixedPrice.amount)}` : ''}</span>}
                  </div>
                  <p className="text-xs text-muted">{c.title.split(' – ')[0]} · {j.area} · {j.plannedHours.toLocaleString('nb-NO')} t · akseptert {fmtRelative(j.acceptedAt)}</p>
                </button>
                {nt && near && (
                  <p className="flex gap-1.5 rounded-lg bg-brand-soft px-2 py-1.5 text-xs text-brand">
                    <Icon name="sparkle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>AIHenrik: {nt.firstName} er på {near.customer.address?.split(',')[0]} ({j.area}) {dayLabel(near.job!.scheduledDate).toLowerCase()}. Legg den til samme tur.</span>
                  </p>
                )}
                <PlanControls c={c} suggestion={nt && near ? { techId: nt.id, date: near.job!.scheduledDate! } : undefined} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ProjectsView({ openCase }: { openCase: (id: string) => void }) {
  const { state, tenant } = useStore();
  const watch = useWatchpoints();
  const jobs = state.cases.filter((c) => c.job);
  const henrik = tenant.agents.find((a) => a.id === 'coordinator')!;
  const invoicedWeek = jobs.filter((c) => c.job!.stage === 'invoiced' && c.job!.invoice?.sentAt && Date.now() - new Date(c.job!.invoice.sentAt).getTime() < 7 * 864e5);
  const invoicedSum = invoicedWeek.reduce((s, c) => s + invoiceTotal(c.job!.invoice!.lines), 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Prosjekter</h1>
          <p className="text-[13px] text-muted">Oppdrag fra akseptert tilbud til fakturagrunnlag i Tripletex. Én sak per oppdrag.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn-soft px-3 py-1 text-xs font-semibold text-warn"><Icon name="plug" className="h-3.5 w-3.5" />Tripletex simulert</span>
      </div>

      <div className="scroll-x">
        <ol className="flex min-w-[640px] gap-1.5">
          {JOB_STAGE_ORDER.map((s, i) => {
            const n = jobs.filter((c) => c.job!.stage === s).length;
            return (
              <li key={s} className="flex flex-1 items-center gap-1.5">
                <div className={cx('flex flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2', JOB_STAGE_META[s].tone)}>
                  <span className="text-xs font-semibold">{JOB_STAGE_META[s].short}</span>
                  <span className="font-display text-lg font-semibold tnum">{n}</span>
                </div>
                {i < JOB_STAGE_ORDER.length - 1 && <Icon name="arrow" className="h-3.5 w-3.5 shrink-0 text-faint" />}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <ControlQueue openCase={openCase} />
          <DayBoard openCase={openCase} />
        </div>
        <aside className="flex min-w-0 flex-col gap-5">
          <section className="card p-4">
            <h2 className="mb-2 flex items-center gap-2 font-display text-base font-semibold"><Portrait p={henrik.portrait} size={26} aiBadge={false} />AIHenrik følger med</h2>
            {watch.length === 0 ? <p className="text-xs text-muted">Alt er i flyt.</p> : (
              <ul className="flex flex-col gap-1.5">
                {watch.map((w, i) => (
                  <li key={i}>
                    <button onClick={() => openCase(w.caseId)} className={cx('flex w-full gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-sunk', w.tone === 'danger' ? 'text-bad' : w.tone === 'warning' ? 'text-warn' : 'text-muted')}>
                      <Icon name={w.tone === 'danger' ? 'help' : 'clock'} className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="text-ink">{w.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <PlanQueue openCase={openCase} />
          <section className="card p-4">
            <p className="label">Sendt til Tripletex siste 7 dager</p>
            <p className="font-display text-2xl font-semibold tnum">{kr(Math.round(invoicedSum))} <span className="text-sm font-normal text-muted">eks. mva</span></p>
            <p className="text-xs text-muted">{invoicedWeek.length} oppdrag</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ─── Oppdragspanel i saksdetaljen ───────────────────────────────────────────

function CheckRow({ c, x }: { c: Case; x: ControlCheck }) {
  const { actions, tenant } = useStore();
  const j = c.job!;
  const t = tenant.technicians.find((y) => y.id === (j.report?.by ?? j.technicianId));
  const icon = x.status === 'ok' ? 'check' : x.status === 'warn' ? 'alert' : 'x';
  const tone = x.status === 'ok' ? 'bg-ok-soft text-ok' : x.status === 'warn' ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad';
  return (
    <li className="flex gap-3 py-2.5">
      <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', tone)}><Icon name={icon} className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{x.label}</p>
        <p className="text-xs text-muted">{x.detail}</p>
        {j.stage === 'reported' && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(x.fix === 'nudge_hours' || x.fix === 'nudge_docs' || x.fix === 'nudge_photos') && t && (
              <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => actions.nudge(c.id, x.fix as 'nudge_hours')}><Icon name="chat" className="h-3.5 w-3.5" />Purr {t.firstName}</button>
            )}
            {x.fix === 'mark_doc' && <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => actions.markDoc(c.id, 'nettselskap')}><Icon name="check" className="h-3.5 w-3.5" />Marker som meldt</button>}
            {x.fix === 'extra_work' && j.report!.extraWork.filter((e) => e.customerApproved === null).map((e) => (
              <span key={e.id} className="flex flex-wrap gap-1.5">
                {!e.clarificationSentAt && <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => actions.askCustomerExtra(c.id)}><Icon name="mail" className="h-3.5 w-3.5" />Be AINora spørre kunden</button>}
                <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => actions.decideExtra(c.id, e.id, true)}>Kunden har bekreftet</button>
                <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => actions.decideExtra(c.id, e.id, false)}>Ta ikke med</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function ChatLine({ m, techName }: { m: ChatMessage; techName: string }) {
  return (
    <li className={cx('flex gap-2', m.from === 'tech' && 'flex-row-reverse')}>
      <div className={cx('max-w-[85%] rounded-xl px-3 py-1.5 text-xs', m.from === 'tech' ? 'bg-brand-soft' : 'bg-sunk')}>
        <p className="mb-0.5 text-[10px] font-semibold text-faint">{m.from === 'tech' ? techName : 'Agentkontoret'} · {fmtTime(m.at)}</p>
        <p className="whitespace-pre-wrap">{m.text}</p>
        {m.photos && m.photos.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{m.photos.map((p) => <span key={p.id} className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[10px]"><Icon name={p.kind === 'pdf' ? 'file' : 'image'} className="h-3 w-3" />{p.filename}</span>)}</p>}
      </div>
    </li>
  );
}

export function JobPanel({ c }: { c: Case }) {
  const { state, tenant, actions } = useStore();
  const j = c.job!;
  const t = tenant.technicians.find((x) => x.id === j.technicianId);
  const sofie = tenant.agents.find((a) => a.id === 'control')!;
  const [comment, setComment] = useState('');
  const [returning, setReturning] = useState(false);
  const [ack, setAck] = useState(false);
  const v = verdict(j);
  const busy = state.busy.control?.caseId === c.id;
  const idx = JOB_STAGE_ORDER.indexOf(j.stage);
  const lines = j.invoice?.lines ?? [];
  const sum = invoiceTotal(lines);

  return (
    <div className="flex flex-col gap-4">
      <ol className="scroll-x flex gap-1 pb-1">
        {JOB_STAGE_ORDER.map((s, i) => (
          <li key={s} className={cx('flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', i < idx ? 'bg-ok-soft text-ok' : i === idx ? JOB_STAGE_META[s].tone + ' ring-1 ring-current' : 'bg-sunk text-faint')}>
            {i < idx && <Icon name="check" className="h-3 w-3" />}{JOB_STAGE_META[s].short}
          </li>
        ))}
      </ol>

      <div className="grid gap-2 rounded-xl bg-sunk/70 p-3 text-[13px] sm:grid-cols-4">
        <div className="flex items-center gap-2"><TechAvatar t={t} /><span><span className="block text-[11px] text-muted">Montør</span>{t?.firstName ?? 'Ikke tildelt'}</span></div>
        <div><span className="block text-[11px] text-muted">Når</span>{dayLabel(j.scheduledDate)}{j.slot && `, ${j.slot}`}</div>
        <div><span className="block text-[11px] text-muted">Tripletex-prosjekt</span><span className="font-mono">{j.tripletexProjectNo}</span></div>
        <div><span className="block text-[11px] text-muted">{j.fixedPrice ? 'Fastpris' : 'Planlagt'}</span>{j.fixedPrice ? kr(j.fixedPrice.amount) : `${j.plannedHours.toLocaleString('nb-NO')} t`}</div>
      </div>

      {j.help && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-bad/40 bg-bad-soft px-4 py-3">
          <Icon name="help" className="h-5 w-5 text-bad" />
          <p className="min-w-0 flex-1 text-[13px]"><b className="text-bad">{t?.firstName} trenger hjelp:</b> {j.help.text} <span className="text-xs text-muted">({fmtRelative(j.help.at)})</span></p>
          <button className="btn btn-ghost" onClick={() => actions.resolveHelp(c.id)}>Marker som løst</button>
        </div>
      )}

      {j.stage === 'to_plan' && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <p className="text-[13px] font-semibold">Planlegg oppdraget</p>
          <PlanControls c={c} />
          <p className="text-xs text-muted">Montøren får jobben i sin chat med adresse, kontaktinfo og beskrivelse.</p>
        </div>
      )}

      {j.report && (
        <section className="rounded-xl border border-line p-4">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Portrait p={sofie.portrait} size={38} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px]"><b>AISofie</b> {busy ? 'kontrollerer nå …' : j.checkedAt ? `kontrollerte ${fmtDateTime(j.checkedAt)}` : 'har ikke kontrollert ennå'}</p>
              <p className="text-xs text-muted">Regler: timer mot Tripletex, materiell mot tilbud, tillegg avklart, el-dokumentasjon.</p>
            </div>
            {busy ? <span className="h-2 w-2 rounded-full bg-violet pulse" /> : <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-bold', v.tone)}>{v.label}</span>}
          </div>
          {j.checks && <ul className={cx('divide-y divide-line', busy && 'opacity-50')}>{j.checks.map((x) => <CheckRow key={x.id} c={c} x={x} />)}</ul>}
          {j.stage === 'reported' && !busy && <button className="mt-1 text-xs font-semibold text-brand hover:underline" onClick={() => actions.runControl(c.id)}>Kjør kontroll på nytt</button>}
        </section>
      )}

      {j.report && (
        <section className="flex flex-col gap-3">
          <p className="label">Ferdigmelding fra {tenant.technicians.find((x) => x.id === j.report!.by)?.firstName} · {fmtDateTime(j.report.at)}</p>
          <blockquote className="rounded-xl border-l-4 border-brand bg-brand-soft px-4 py-2.5 text-[13px]">{j.report.note}</blockquote>
          <div className="flex flex-wrap gap-2">
            {j.report.photos.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs"><span className="flex h-7 w-7 items-center justify-center rounded bg-info-soft text-info"><Icon name="image" className="h-3.5 w-3.5" /></span>{p.filename}</span>)}
            {j.report.photos.length === 0 && <span className="text-xs text-bad">Ingen bilder</span>}
          </div>
          {j.report.materials.length > 0 && (
            <div className="scroll-x rounded-xl border border-line">
              <table className="w-full min-w-[460px] text-left text-xs">
                <thead className="text-muted"><tr className="border-b border-line"><th className="px-3 py-1.5 font-semibold">El-nr</th><th className="px-2 py-1.5 font-semibold">Materiell</th><th className="px-2 py-1.5 text-right font-semibold">Brukt</th><th className="px-3 py-1.5 text-right font-semibold">I tilbud</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {j.report.materials.map((m) => (
                    <tr key={m.elnr} className={cx(m.qty > m.plannedQty && 'bg-warn-soft/60')}>
                      <td className="px-3 py-1.5 font-mono text-faint">{m.elnr}</td><td className="px-2 py-1.5">{m.name.replace(/ \(eksempel\)/, '')}</td>
                      <td className="px-2 py-1.5 text-right tnum">{m.qty} {m.unit}</td><td className="px-3 py-1.5 text-right tnum text-muted">{m.plannedQty} {m.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {j.report.extraWork.length > 0 && (
            <ul className="flex flex-col gap-1 text-[13px]">
              {j.report.extraWork.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2"><b>Tillegg:</b> {e.description} ({e.hours.toLocaleString('nb-NO')} t)
                  <span className={cx('rounded-full px-2 text-[11px] font-semibold', e.customerApproved === true ? 'bg-ok-soft text-ok' : e.customerApproved === false ? 'bg-sunk text-muted' : 'bg-bad-soft text-bad')}>
                    {e.customerApproved === true ? 'Godkjent av kunden' : e.customerApproved === false ? 'Tas ikke med' : e.clarificationSentAt ? 'Spurt kunden, venter svar' : 'Ikke avklart'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {j.requiredDocs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {j.requiredDocs.map((d) => <span key={d} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', j.report!.docs[d] ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}><Icon name={j.report!.docs[d] ? 'check' : 'x'} className="h-3 w-3" />{DOC_LABEL[d]}</span>)}
            </div>
          )}
        </section>
      )}

      {lines.length > 0 && (
        <section className={cx('rounded-xl border-2 p-4', j.stage === 'invoiced' ? 'border-ok/40' : 'border-dashed border-accent/50 bg-accent-soft/30')}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">Fakturagrunnlag</p>
            {j.stage === 'invoiced'
              ? <span className="text-xs font-semibold text-ok">Ordre {j.invoice!.tripletexOrderNo} i Tripletex · {fmtDateTime(j.invoice!.sentAt!)} (simulert)</span>
              : <span className="text-xs font-bold uppercase tracking-wider text-accent-ink">Forslag fra AISofie · ikke sendt</span>}
          </div>
          <div className="scroll-x">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="text-muted"><tr className="border-b border-line"><th className="py-1.5 pr-2 font-semibold">Linje</th><th className="px-2 py-1.5 text-right font-semibold">Antall</th><th className="px-2 py-1.5 text-right font-semibold">Pris</th><th className="py-1.5 pl-2 text-right font-semibold">Sum</th></tr></thead>
              <tbody className="divide-y divide-line">
                {lines.map((l, i) => (
                  <tr key={i}><td className="py-1.5 pr-2"><span className="text-[13px]">{l.label}</span><span className="block text-[10px] text-faint">{l.source}</span></td><td className="px-2 py-1.5 text-right tnum">{l.qty.toLocaleString('nb-NO')} {l.unit}</td><td className="px-2 py-1.5 text-right tnum">{kr(l.unitPrice)}</td><td className="py-1.5 pl-2 text-right tnum">{kr(Math.round(l.qty * l.unitPrice))}</td></tr>
                ))}
              </tbody>
              <tfoot className="text-[13px] tnum">
                <tr className="border-t border-line"><td colSpan={3} className="pt-2 text-right text-muted">Sum eks. mva</td><td className="pt-2 text-right font-semibold">{kr(Math.round(sum))}</td></tr>
                <tr><td colSpan={3} className="text-right text-muted">Mva 25 %</td><td className="text-right">{kr(Math.round(sum * tenant.billing.vatRate))}</td></tr>
                <tr><td colSpan={3} className="text-right font-semibold">Totalt</td><td className="text-right font-display text-base font-semibold">{kr(Math.round(sum * (1 + tenant.billing.vatRate)))}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Priser fra timepris og prisfil i innstillingene (eksempeltall). Tripletex lager selve fakturaen.</p>
        </section>
      )}

      {j.stage === 'reported' && j.checks && !busy && (
        <div className="flex flex-col gap-2 rounded-xl bg-sunk/70 p-3">
          {v.warns > 0 && v.fails === 0 && (
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" id={`ack-${c.id}`} checked={ack} onChange={(e) => setAck(e.target.checked)} />Jeg har sett på avvikene og godtar fakturagrunnlaget</label>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-accent" disabled={v.fails > 0 || (v.warns > 0 && !ack) || state.role !== 'owner'} onClick={() => actions.approveControl(c.id)}><Icon name="check" />Godkjenn kontroll</button>
            <button className="btn btn-ghost" onClick={() => setReturning((r) => !r)}><Icon name="back" />Send tilbake til {t?.firstName}</button>
          </div>
          {v.fails > 0 && <p className="text-xs text-bad">Løs punktene markert rødt før du godkjenner.</p>}
          {returning && (
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`ret-${c.id}`}>Kommentar</label>
              <input id={`ret-${c.id}`} className="field flex-1" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Hva må gjøres?" />
              <button className="btn btn-danger" onClick={() => { actions.returnToTech(c.id, comment); setReturning(false); }}>Send tilbake</button>
            </div>
          )}
        </div>
      )}
      {j.stage === 'controlled' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sunk/70 p-3">
          <button className="btn btn-primary" disabled={busy || state.role !== 'owner'} onClick={() => actions.sendToTripletex(c.id)}><Icon name="send" />{busy ? 'Sender …' : 'Send fakturagrunnlag til Tripletex'}</button>
          <span className="text-xs text-muted">Lager en ordre på prosjekt {j.tripletexProjectNo}. Du fakturerer fra Tripletex.</span>
        </div>
      )}

      {j.thread.length > 0 && (
        <section>
          <p className="label mb-1.5">Montørens tråd</p>
          <ul className="flex flex-col gap-1.5">{j.thread.map((m) => <ChatLine key={m.id} m={m} techName={t?.firstName ?? 'Montør'} />)}</ul>
        </section>
      )}
    </div>
  );
}
