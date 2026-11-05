import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Case, Draft, Priority } from '../domain/types';
import { CATEGORY_ORDER, categoryMeta, categoryOf, type Category } from '../config/categories';
import { Icon, Portrait } from './ui';
import { cx, fmtRelative } from '../lib/util';

/**
 * Saker som én liste per kategori. Samme fem kategorier som på forsiden og i saken.
 * Laget for mobil først: ingen sideveis scrolling.
 */
type Group = Category | 'all';

/** Eldre filter-ID-er (lenker og nøkkeltall) peker til riktig kategori. */
const ALIAS: Record<string, Group> = {
  mine: 'owner', open: 'owner', awaiting_approval: 'owner', ready_for_quote: 'owner', new: 'owner', follow_up: 'owner', today: 'all',
  awaiting_customer: 'customer', quote_sent: 'quote', in_progress: 'working', closed: 'closed',
};
export const resolveGroup = (f: string): Group => ((['owner', 'working', 'customer', 'quote', 'closed', 'all'] as string[]).includes(f) ? f as Group : ALIAS[f] ?? 'owner');

const prioRank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function Pill({ tone, children }: { tone: 'bad' | 'info' | 'ok' | 'warn' | 'muted' | 'violet'; children: React.ReactNode }) {
  const t = { bad: 'bg-bad text-surface', info: 'bg-info text-surface', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', muted: 'bg-sunk text-muted', violet: 'bg-violet-soft text-violet' }[tone];
  return <span className={cx('whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold leading-4', t)}>{children}</span>;
}

export function CaseRow({ c, draft, onOpen }: { c: Case; draft?: Draft; onOpen: () => void }) {
  const { state, tenant } = useStore();
  const cat = categoryOf(c.status);
  const busy = Object.values(state.busy).find((b) => b?.caseId === c.id);
  const ag = tenant.agents.find((a) => a.id === c.assignedAgent);
  // Hva som er neste steg, i klartekst.
  const next = busy ? `${ag?.name ?? 'Agenten'} jobber …`
    : draft?.state === 'approved' || draft?.state === 'sending' ? 'Godkjent – klar til å sende'
    : draft?.state === 'pending' ? (draft.kind === 'quote' ? 'Tilbudsutkast klart' : 'Svarforslag klart')
    : c.status === 'ready_for_quote' ? 'Klar for tilbud – sett pris'
    : cat === 'customer' ? (c.nextAction?.startsWith('Du står på kopi') ? 'Du står på kopi – venter på andre' : 'Svar sendt')
    : cat === 'quote' ? 'Tilbud sendt'
    : cat === 'working' ? 'Under arbeid'
    : cat === 'closed' ? (c.status === 'won' ? 'Vunnet' : 'Avsluttet')
    : c.nextAction;
  return (
    <li>
      <button onClick={onOpen} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunk/60', c.flagged && 'border-l-4 border-l-bad pl-3')}>
        {ag ? <Portrait p={ag.portrait} size={34} aiBadge={false} /> : <span className="h-[34px] w-[34px] shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate font-semibold">{c.customer.name}</span>
            {c.flagged && <Pill tone="bad">Haster</Pill>}
            {c.unreadCustomerReply && <Pill tone="info">Nytt svar</Pill>}
            {busy && <Pill tone="violet">AI jobber</Pill>}
          </div>
          <p className="truncate text-xs text-muted">{tenant.jobTypes[c.jobType].label}{c.customer.address ? ` · ${c.customer.address}` : ''}</p>
          <p className={cx('mt-0.5 truncate text-xs font-semibold', cat === 'owner' ? 'text-accent-ink' : 'text-muted')}>{next}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <span className="text-[11px] text-faint">{fmtRelative(c.updatedAt)}</span>
          <Icon name="arrow" className="h-3.5 w-3.5 text-faint" />
        </div>
      </button>
    </li>
  );
}

/** Kort per kategori: urgente først, deretter lengst ventet (aktive) eller nyest (avsluttet). */
export function useCasesIn(group: Group, q = '') {
  const { state, tenant } = useStore();
  const openDraft = useMemo(() => {
    const m = new Map<string, Draft>();
    for (const d of state.drafts) if (['pending', 'approved', 'sending', 'send_failed'].includes(d.state)) m.set(d.caseId, d);
    return m;
  }, [state.drafts]);
  const cases = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.cases
      .filter((c) => ql ? true : group === 'all' || categoryOf(c.status) === group) // søk går på tvers av kategoriene
      .filter((c) => !ql || `${c.number} ${c.title} ${c.customer.name} ${c.customer.email} ${c.customer.address ?? ''} ${tenant.jobTypes[c.jobType].label}`.toLowerCase().includes(ql))
      .sort((a, b) => (Number(!!b.flagged) - Number(!!a.flagged)) || prioRank[a.priority] - prioRank[b.priority]
        || (group === 'closed' || group === 'all' ? b.updatedAt.localeCompare(a.updatedAt) : a.updatedAt.localeCompare(b.updatedAt)));
  }, [state.cases, group, q, tenant]);
  return { cases, openDraft };
}

export function CasesView({ openCase, filter, setFilter }: { openCase: (id: string) => void; filter: string; setFilter: (f: string) => void }) {
  const { state, tenant } = useStore();
  const [q, setQ] = useState('');
  const group = resolveGroup(filter);
  const { cases, openDraft } = useCasesIn(group, q);
  const first = tenant.owner.firstName;

  const counts = useMemo(() => {
    const n: Record<Group, number> = { owner: 0, working: 0, customer: 0, quote: 0, closed: 0, all: state.cases.length };
    for (const c of state.cases) n[categoryOf(c.status)]++;
    return n;
  }, [state.cases]);

  const tabs: { id: Group; label: string }[] = [
    ...CATEGORY_ORDER.map((id) => ({ id, label: categoryMeta(id, first).short })),
    { id: 'all', label: 'Alle' },
  ];
  const empty = q ? 'Ingen saker matcher søket.'
    : group === 'owner' ? 'Ingenting venter på deg nå. Agentene sier fra når noe nytt er klart.'
    : group === 'working' ? 'Ingen saker under arbeid. Flytt en sak hit fra saken.'
    : group === 'customer' ? 'Ingen saker venter på svar fra kunder.'
    : group === 'quote' ? 'Ingen sendte tilbud.'
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

      <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface p-1 sm:grid-cols-6" role="tablist" aria-label="Kategorier">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={group === t.id} onClick={() => setFilter(t.id)}
            className={cx('flex min-w-0 flex-col items-center justify-center rounded-lg px-1 py-1.5 text-center text-[12px] font-semibold leading-tight',
              group === t.id ? 'bg-brand text-surface' : 'text-muted hover:text-ink')}>
            <span className="max-w-full truncate">{t.label}</span>
            <span className={cx('tnum text-[11px]', group === t.id ? 'opacity-80' : t.id === 'owner' && counts.owner ? 'font-bold text-accent' : 'opacity-70')}>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {cases.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-faint">{empty}</p> : (
          <ul className="divide-y divide-line">
            {cases.map((c) => <CaseRow key={c.id} c={c} draft={openDraft.get(c.id)} onOpen={() => openCase(c.id)} />)}
          </ul>
        )}
      </div>
      {q && <p className="text-xs text-faint">Søket gjelder alle kategorier.</p>}
    </div>
  );
}
