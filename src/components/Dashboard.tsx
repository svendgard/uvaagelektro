import React, { useMemo } from 'react';
import { useStore, type AgentView } from '../state/store';
import type { Activity, ActivityActor, AgentId } from '../domain/types';
import { AgentStatusPill, CaseStatusBadge, Empty, Icon, Modal, Portrait, PriorityMark } from './ui';
import { cx, fmtDateTime, fmtRelative, fmtTime } from '../lib/util';
import { ControlQueue } from './Projects';

export interface Nav { openCase: (id: string) => void; openAgent: (id: AgentId) => void; go: (v: string) => void }

function startOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function useKpis() {
  const { state } = useStore();
  return useMemo(() => {
    const today = new Date().toDateString();
    const pendingCases = new Set([...state.drafts.filter((d) => d.state === 'pending').map((d) => d.caseId), ...state.cases.filter((c) => c.job && (c.job.stage === 'reported' || c.job.stage === 'controlled')).map((c) => c.id)]);
    const wk = startOfWeek();
    return [
      { key: 'new', label: 'Nye henvendelser i dag', value: state.cases.filter((c) => new Date(c.createdAt).toDateString() === today).length, tone: 'text-info', filter: 'today' },
      { key: 'approval', label: 'Venter på Espen', value: pendingCases.size, tone: 'text-accent', filter: 'awaiting_approval', emphasis: true },
      { key: 'customer', label: 'Venter på kunden', value: state.cases.filter((c) => c.status === 'awaiting_customer' || c.status === 'quote_sent').length, tone: 'text-muted', filter: 'awaiting_customer' },
      { key: 'quotes', label: 'Tilbud under arbeid', value: state.cases.filter((c) => c.status === 'ready_for_quote').length + state.drafts.filter((d) => d.state === 'pending' && d.kind === 'quote').length, tone: 'text-brand', filter: 'ready_for_quote' },
      { key: 'follow', label: 'Trenger oppfølging', value: state.cases.filter((c) => c.status === 'follow_up' || c.unreadCustomerReply || c.flagged).length, tone: 'text-warn', filter: 'follow_up' },
      { key: 'closed', label: 'Avsluttet denne uken', value: state.cases.filter((c) => (c.status === 'won' || c.status === 'lost') && new Date(c.updatedAt).getTime() >= wk).length, tone: 'text-ok', filter: 'closed' },
    ];
  }, [state.cases, state.drafts]);
}

function KpiRow({ onPick }: { onPick: (f: string) => void }) {
  const kpis = useKpis();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
        <button key={k.key} onClick={() => onPick(k.filter)}
          className={cx('card flex flex-col items-start gap-1 px-4 py-3 text-left transition hover:border-faint', k.emphasis && k.value > 0 && 'border-accent/50 bg-accent-soft')}>
          <span className={cx('font-display text-3xl font-semibold tnum leading-none', k.tone)}>{k.value}</span>
          <span className="text-xs font-medium leading-tight text-muted">{k.label}</span>
        </button>
      ))}
    </div>
  );
}

function AgentCard({ view, onOpen }: { view: AgentView; onOpen: () => void }) {
  const { tenant, state } = useStore();
  const cfg = tenant.agents.find((a) => a.id === view.id)!;
  const kase = view.caseId ? state.cases.find((c) => c.id === view.caseId) : undefined;
  const pending = state.drafts.filter((d) => d.state === 'pending' && d.author === view.id).length;
  const active = state.cases.filter((c) => c.assignedAgent === view.id && c.status !== 'won' && c.status !== 'lost').length;
  return (
    <button onClick={onOpen} className={cx('card group flex flex-col gap-3 p-4 text-left transition hover:border-faint', view.status === 'working' && 'border-violet/40')}>
      <div className="flex items-start gap-3">
        <Portrait p={cfg.portrait} size={60} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-display text-lg font-semibold leading-tight">{cfg.name}</h3>
            <span className="text-xs font-semibold text-muted">{cfg.title}</span>
          </div>
          <div className="mt-1"><AgentStatusPill status={view.status} owner={tenant.owner.firstName} /></div>
        </div>
      </div>
      <p className="min-h-[2.5rem] text-[13px] leading-snug text-ink">{view.text}</p>
      {kase && <span className="truncate text-xs font-medium text-muted">Sak: <span className="font-mono">{kase.number}</span> · {kase.customer.name}</span>}
      <div className="mt-auto flex items-center gap-4 border-t border-line pt-2.5 text-xs text-muted tnum">
        <span><b className="text-ink">{state.completed[view.id]}</b> utført i dag</span>
        <span><b className="text-ink">{active}</b> aktive saker</span>
        {pending > 0 && <span className="text-accent-ink"><b>{pending}</b> til godkjenning</span>}
        <Icon name="arrow" className="ml-auto h-4 w-4 opacity-0 transition group-hover:opacity-100" />
      </div>
    </button>
  );
}

function ApprovalQueue({ nav }: { nav: Nav }) {
  const { state, tenant } = useStore();
  const pending = state.drafts.filter((d) => d.state === 'pending' || d.state === 'send_failed');
  const kinds = { reply: 'Svar', info_request: 'Spørsmål til kunde', quote: 'Tilbud', follow_up: 'Oppfølging', extra_work: 'Tilleggsarbeid' } as const;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Til godkjenning</h2>
        <span className="text-xs text-muted">Ingen e-post sendes uten at {tenant.owner.firstName} godkjenner</span>
      </div>
      {pending.length === 0 ? <Empty text="Alt er godkjent. Agentene sier fra når noe nytt er klart." /> : (
        <ul className="flex flex-col divide-y divide-line">
          {pending.map((d) => {
            const c = state.cases.find((x) => x.id === d.caseId);
            if (!c) return null;
            const ag = tenant.agents.find((a) => a.id === d.author);
            return (
              <li key={d.id}>
                <button onClick={() => nav.openCase(c.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-sunk/60 rounded-lg px-1">
                  {ag ? <Portrait p={ag.portrait} size={34} aiBadge={false} /> : <span className="h-[34px] w-[34px]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate font-semibold">{c.customer.name}</span>
                      <span className="text-xs text-muted">{kinds[d.kind]} fra {ag?.name ?? 'Espen'}</span>
                      {c.flagged && <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-1.5 text-[11px] font-bold text-bad"><Icon name="flag" className="h-3 w-3" />Haster</span>}
                      {d.state === 'send_failed' && <span className="rounded-full bg-bad-soft px-1.5 text-[11px] font-bold text-bad">Sending feilet</span>}
                    </div>
                    <p className="truncate text-xs text-muted">{c.title} · {fmtRelative(d.createdAt)}</p>
                  </div>
                  <span className="btn btn-accent hidden sm:inline-flex">Les og godkjenn</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ActorAvatar({ actor, size = 26 }: { actor: ActivityActor; size?: number }) {
  const { tenant } = useStore();
  const ag = tenant.agents.find((a) => a.id === actor);
  if (ag) return <Portrait p={ag.portrait} size={size} aiBadge={false} />;
  const map = { owner: { t: tenant.owner.firstName[0], c: 'bg-brand text-surface' }, customer: { t: '', c: 'bg-info-soft text-info' }, system: { t: '', c: 'bg-sunk text-muted' } } as const;
  const m = map[actor as 'owner' | 'customer' | 'system'];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold', m.c)} style={{ width: size, height: size }}>
      {m.t || <Icon name={actor === 'customer' ? 'mail' : 'bolt'} className="h-3.5 w-3.5" />}
    </span>
  );
}

export function ActivityFeed({ items, onOpenCase, limit = 40, compact }: { items: Activity[]; onOpenCase?: (id: string) => void; limit?: number; compact?: boolean }) {
  const list = [...items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  const tone = { neutral: '', success: 'text-ok', warning: 'text-warn', danger: 'text-bad' } as const;
  return (
    <ol className="flex flex-col">
      {list.map((a, i) => (
        <li key={a.id} className={cx('flex gap-2.5 py-2', i === 0 && 'slide-in', !compact && 'border-b border-line last:border-0')}>
          <span className="w-10 shrink-0 pt-1 text-right font-mono text-[11px] text-faint tnum">{fmtTime(a.at)}</span>
          <ActorAvatar actor={a.actor} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className={cx('text-[13px] leading-snug', a.tone && tone[a.tone])}>{a.text}</p>
            {a.caseId && onOpenCase && (
              <button onClick={() => onOpenCase(a.caseId!)} className="text-[11px] font-semibold text-brand hover:underline">Åpne sak</button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Dashboard({ nav, onFilter }: { nav: Nav; onFilter: (f: string) => void }) {
  const { agents, state, tenant } = useStore();
  const flagged = [
    ...state.cases.filter((c) => c.flagged && c.status !== 'won' && c.status !== 'lost').map((c) => ({ c, reason: c.flagged!.reason })),
    ...state.cases.filter((c) => c.job?.help).map((c) => ({ c, reason: `${tenant.technicians.find((t) => t.id === c.job!.technicianId)?.firstName} trenger hjelp: ${c.job!.help!.text}` })),
  ];
  const greeting = new Date().getHours() < 10 ? 'God morgen' : new Date().getHours() < 17 ? 'Hei' : 'God kveld';
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="label">{new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">{greeting}, {tenant.owner.firstName}. Teamet ditt er i gang.</h1>
        </div>
      </div>

      <KpiRow onPick={onFilter} />

      {flagged.length > 0 && (
        <div className="flex flex-col gap-2">
          {flagged.map(({ c, reason }) => (
            <button key={c.id} onClick={() => nav.openCase(c.id)} className="flex items-center gap-3 rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 text-left text-bad">
              <Icon name="flag" className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 text-sm"><b>{c.number} · {c.customer.name}:</b> <span className="text-ink">{reason}</span></span>
              <span className="hidden text-xs font-bold sm:inline">Åpne</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-display text-base font-semibold">Agentkontoret</h2>
              <span className="text-xs text-muted">{['Ingen', 'Én', 'To', 'Tre', 'Fire', 'Fem'][agents.length] ?? agents.length} digitale medarbeidere · klikk for detaljer</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
              {agents.map((a) => <AgentCard key={a.id} view={a} onOpen={() => nav.openAgent(a.id)} />)}
            </div>
          </section>
          <ApprovalQueue nav={nav} />
          {tenant.features.projects && <ControlQueue openCase={nav.openCase} />}
        </div>
        <aside className="card flex max-h-[44rem] min-w-0 flex-col p-4 lg:sticky lg:top-20">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Aktivitet</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-ok pulse" />Live</span>
          </div>
          <div className="-mx-1 overflow-y-auto px-1"><ActivityFeed items={state.activities} onOpenCase={nav.openCase} limit={30} /></div>
        </aside>
      </div>
    </div>
  );
}

export function AgentDrawer({ id, onClose, nav }: { id: AgentId | null; onClose: () => void; nav: Nav }) {
  const { tenant, agents, state } = useStore();
  if (!id) return null;
  const cfg = tenant.agents.find((a) => a.id === id)!;
  const view = agents.find((a) => a.id === id)!;
  const cases = state.cases.filter((c) => c.assignedAgent === id || c.events.some((e) => e.actor === id));
  const inProgress = cases.filter((c) => c.assignedAgent === id && !['won', 'lost', 'awaiting_approval'].includes(c.status));
  const awaiting = state.drafts.filter((d) => d.author === id && d.state === 'pending');
  const results = state.drafts.filter((d) => d.author === id && (d.state === 'sent' || d.state === 'approved')).slice(-5).reverse();
  const acts = state.activities.filter((a) => a.actor === id);
  const Row = ({ cid, extra }: { cid: string; extra?: React.ReactNode }) => {
    const c = state.cases.find((x) => x.id === cid);
    if (!c) return null;
    return (
      <button onClick={() => { onClose(); nav.openCase(c.id); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sunk">
        <span className="font-mono text-[11px] text-faint">{c.number.slice(-4)}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
        {extra ?? <CaseStatusBadge status={c.status} short />}
      </button>
    );
  };
  return (
    <Modal open onClose={onClose} title={`${cfg.name} · ${cfg.title}`} wide>
      <div className="grid gap-5 p-5 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Portrait p={cfg.portrait} size={84} />
            <div>
              <p className="font-display text-xl font-semibold">{cfg.name}</p>
              <p className="text-sm text-muted">{cfg.title}</p>
              <div className="mt-1"><AgentStatusPill status={view.status} owner={tenant.owner.firstName} /></div>
            </div>
          </div>
          <p className="rounded-lg bg-sunk px-3 py-2 text-[13px]">{view.text}</p>
          <div>
            <p className="label mb-1.5">Ansvar</p>
            <ul className="flex flex-col gap-1 text-[13px] text-muted">{cfg.responsibilities.map((r) => <li key={r} className="flex gap-2"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />{r}</li>)}</ul>
          </div>
          <p className="flex gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted"><Icon name="sparkle" className="h-4 w-4 shrink-0" />{cfg.name} er en digital AI-agent, ikke en ansatt. {cfg.name} kan ikke sende e-post selv.</p>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="label mb-1">Pågår ({inProgress.length})</p>
            {inProgress.length ? inProgress.map((c) => <Row key={c.id} cid={c.id} />) : <p className="px-2 text-xs text-faint">Ingenting pågår.</p>}
            <p className="label mb-1 mt-4">Venter på godkjenning ({awaiting.length})</p>
            {awaiting.length ? awaiting.map((d) => <Row key={d.id} cid={d.caseId} extra={<span className="text-[11px] text-accent-ink">v{d.version}</span>} />) : <p className="px-2 text-xs text-faint">Ingen utkast venter.</p>}
            <p className="label mb-1 mt-4">Siste resultater</p>
            {results.length ? results.map((d) => <Row key={d.id} cid={d.caseId} extra={<span className="text-[11px] text-ok">{d.state === 'sent' ? 'Sendt' : 'Godkjent'}</span>} />) : <p className="px-2 text-xs text-faint">Ingen godkjente utkast ennå i denne økten.</p>}
          </div>
          <div className="min-w-0">
            <p className="label mb-1">Aktivitetslogg</p>
            {acts.length ? <ActivityFeed items={acts} limit={20} compact /> : <p className="text-xs text-faint">Ingen aktivitet ennå.</p>}
            <p className="mt-3 text-[11px] text-faint">Sist oppdatert {fmtDateTime(new Date().toISOString())}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { PriorityMark };
