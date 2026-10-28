import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Case, CaseStatus, Draft, Priority } from '../domain/types';
import { Icon, Portrait } from './ui';
import { cx, fmtRelative } from '../lib/util';

/**
 * Saker som én liste, gruppert etter hvem som har ballen. Laget for mobil først: ingen sideveis scrolling.
 * Statusene i databasen er uendret; dette er bare grupperingen i visningen.
 */
type Group = 'mine' | 'customer' | 'closed' | 'all';

const MINE: CaseStatus[] = ['new', 'ai_processing', 'awaiting_approval', 'ready_for_quote'];
const CUSTOMER: CaseStatus[] = ['awaiting_customer', 'quote_sent', 'follow_up'];
const CLOSED: CaseStatus[] = ['won', 'lost'];

const groupOf = (c: Case): Exclude<Group, 'all'> => (CLOSED.includes(c.status) ? 'closed' : CUSTOMER.includes(c.status) ? 'customer' : 'mine');

/** Gamle filter-ID-er (fra nøkkeltallene på forsiden) peker til riktig gruppe. */
const ALIAS: Record<string, Group> = {
  open: 'mine', awaiting_approval: 'mine', ready_for_quote: 'mine', new: 'mine', today: 'all',
  awaiting_customer: 'customer', follow_up: 'customer', closed: 'closed',
};
export const resolveGroup = (f: string): Group => (['mine', 'customer', 'closed', 'all'].includes(f) ? f as Group : ALIAS[f] ?? 'mine');

const prioRank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function Pill({ tone, children }: { tone: 'bad' | 'info' | 'ok' | 'warn' | 'muted' | 'violet'; children: React.ReactNode }) {
  const t = { bad: 'bg-bad text-surface', info: 'bg-info text-surface', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', muted: 'bg-sunk text-muted', violet: 'bg-violet-soft text-violet' }[tone];
  return <span className={cx('whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold leading-4', t)}>{children}</span>;
}

function CaseRow({ c, draft, needsFollowUp, onOpen }: { c: Case; draft?: Draft; needsFollowUp: boolean; onOpen: () => void }) {
  const { state, tenant } = useStore();
  const g = groupOf(c);
  const busy = Object.values(state.busy).find((b) => b?.caseId === c.id);
  const ag = tenant.agents.find((a) => a.id === c.assignedAgent);
  // Hva som er neste steg, i klartekst.
  const next = busy ? `${ag?.name ?? 'Agenten'} jobber …`
    : draft?.state === 'approved' || draft?.state === 'sending' ? 'Godkjent – klar til å sende'
    : draft?.state === 'pending' ? (draft.kind === 'quote' ? 'Tilbudsutkast klart' : 'Svarforslag klart')
    : c.status === 'ready_for_quote' ? 'Klar for tilbud – sett pris'
    : g === 'customer' ? (c.status === 'quote_sent' ? 'Tilbud sendt' : 'Svar sendt')
    : g === 'closed' ? (c.status === 'won' ? 'Vunnet' : 'Tapt')
    : c.nextAction;
  return (
    <li>
      <button onClick={onOpen} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunk/60', c.flagged && 'border-l-4 border-l-bad pl-3')}>
        {ag ? <Portrait p={ag.portrait} size={34} aiBadge={false} /> : <span className="h-[34px] w-[34px] shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate font-semibold">{c.customer.name}</span>
            {c.flagged && <Pill tone="bad">Haster</Pill>}
            {needsFollowUp && <Pill tone="bad">Følg opp</Pill>}
            {c.unreadCustomerReply && <Pill tone="info">Nytt svar</Pill>}
            {busy && <Pill tone="violet">AI jobber</Pill>}
          </div>
          <p className="truncate text-xs text-muted">{tenant.jobTypes[c.jobType].label}{c.customer.address ? ` · ${c.customer.address}` : ''}</p>
          <p className={cx('mt-0.5 truncate text-xs font-semibold', g === 'mine' ? 'text-accent-ink' : 'text-muted')}>{next}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <span className="text-[11px] text-faint">{fmtRelative(c.updatedAt)}</span>
          <Icon name="arrow" className="h-3.5 w-3.5 text-faint" />
        </div>
      </button>
    </li>
  );
}

export function CasesView({ openCase, filter, setFilter }: { openCase: (id: string) => void; filter: string; setFilter: (f: string) => void }) {
  const { state, tenant } = useStore();
  const [q, setQ] = useState('');
  const group = resolveGroup(filter);
  const followDays = tenant.rules.followUpAfterDays;

  const openDraft = useMemo(() => {
    const m = new Map<string, Draft>();
    for (const d of state.drafts) if (['pending', 'approved', 'sending', 'send_failed'].includes(d.state)) m.set(d.caseId, d);
    return m;
  }, [state.drafts]);

  /** Kunden har ikke svart innen fristen (eller saken er satt til oppfølging). */
  const needsFollowUp = (c: Case) => c.status === 'follow_up'
    || ((c.status === 'awaiting_customer' || c.status === 'quote_sent') && Date.now() - new Date(c.updatedAt).getTime() > followDays * 864e5);

  const counts = useMemo(() => ({
    mine: state.cases.filter((c) => groupOf(c) === 'mine').length,
    customer: state.cases.filter((c) => groupOf(c) === 'customer').length,
    closed: state.cases.filter((c) => groupOf(c) === 'closed').length,
    all: state.cases.length,
  }), [state.cases]);

  const cases = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.cases
      .filter((c) => ql ? true : group === 'all' || groupOf(c) === group) // søk går på tvers av gruppene
      .filter((c) => !ql || `${c.number} ${c.title} ${c.customer.name} ${c.customer.email} ${c.customer.address ?? ''} ${tenant.jobTypes[c.jobType].label}`.toLowerCase().includes(ql))
      .sort((a, b) => {
        const urgent = (Number(!!b.flagged) - Number(!!a.flagged)) || prioRank[a.priority] - prioRank[b.priority];
        if (urgent) return urgent;
        if (group === 'customer') return (Number(needsFollowUp(b)) - Number(needsFollowUp(a))) || a.updatedAt.localeCompare(b.updatedAt);
        if (group === 'mine') return a.updatedAt.localeCompare(b.updatedAt); // lengst ventet først
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [state.cases, group, q, tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: Group; label: string; short: string }[] = [
    { id: 'mine', label: 'Til deg', short: 'Til deg' },
    { id: 'customer', label: 'Venter på kunden', short: 'Hos kunden' },
    { id: 'closed', label: 'Avsluttet', short: 'Avsluttet' },
    { id: 'all', label: 'Alle', short: 'Alle' },
  ];
  const empty = q ? 'Ingen saker matcher søket.'
    : group === 'mine' ? 'Ingenting venter på deg nå. Agentene sier fra når noe nytt er klart.'
    : group === 'customer' ? 'Ingen saker venter på svar fra kunder.'
    : group === 'closed' ? 'Ingen avsluttede saker ennå.' : 'Ingen saker ennå.';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Saker</h1>
        <div className="relative w-full sm:w-64">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-faint" />
          <label className="sr-only" htmlFor="case-search">Søk</label>
          <input id="case-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk kunde, adresse, sak" className="field" style={{ paddingLeft: 32 }} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Grupper">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={group === t.id} onClick={() => setFilter(t.id)}
            className={cx('flex min-w-0 flex-col items-center justify-center rounded-lg px-1 py-1.5 text-center text-[12px] font-semibold leading-tight sm:flex-row sm:gap-1.5 sm:text-[13px]',
              group === t.id ? 'bg-brand text-surface' : 'text-muted hover:text-ink')}>
            <span className="truncate max-w-full"><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></span>
            <span className={cx('tnum text-[11px]', group === t.id ? 'opacity-80' : t.id === 'mine' && counts.mine ? 'font-bold text-accent' : 'opacity-70')}>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {cases.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-faint">{empty}</p> : (
          <ul className="divide-y divide-line">
            {cases.map((c) => <CaseRow key={c.id} c={c} draft={openDraft.get(c.id)} needsFollowUp={needsFollowUp(c)} onOpen={() => openCase(c.id)} />)}
          </ul>
        )}
      </div>
      {q && <p className="text-xs text-faint">Søket gjelder alle grupper.</p>}
    </div>
  );
}
