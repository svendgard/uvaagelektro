import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Case, CaseStatus, Priority } from '../domain/types';
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from '../config/tenant';
import { CaseStatusBadge, Icon, Portrait, PriorityMark } from './ui';
import { cx, fmtRelative, kr } from '../lib/util';

const FILTERS: { id: string; label: string; test: (c: Case) => boolean }[] = [
  { id: 'all', label: 'Alle', test: () => true },
  { id: 'open', label: 'Åpne', test: (c) => c.status !== 'won' && c.status !== 'lost' },
  { id: 'awaiting_approval', label: 'Venter på Espen', test: (c) => c.status === 'awaiting_approval' },
  { id: 'awaiting_customer', label: 'Venter på kunde', test: (c) => c.status === 'awaiting_customer' || c.status === 'quote_sent' },
  { id: 'ready_for_quote', label: 'Klar for tilbud', test: (c) => c.status === 'ready_for_quote' },
  { id: 'follow_up', label: 'Trenger oppfølging', test: (c) => c.status === 'follow_up' || !!c.unreadCustomerReply || !!c.flagged },
  { id: 'today', label: 'Nye i dag', test: (c) => new Date(c.createdAt).toDateString() === new Date().toDateString() },
  { id: 'closed', label: 'Avsluttet', test: (c) => c.status === 'won' || c.status === 'lost' },
];

const prioRank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function CaseCard({ c, onOpen, draggable }: { c: Case; onOpen: () => void; draggable?: boolean }) {
  const { tenant, actions } = useStore();
  const ag = tenant.agents.find((a) => a.id === c.assignedAgent)!;
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/case', c.id)}
      className={cx('card cursor-grab p-3 active:cursor-grabbing', c.flagged && 'border-bad/50')}
    >
      <button onClick={onOpen} className="block w-full text-left">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-faint">{c.number}</span>
          <div className="flex items-center gap-1">
            {c.unreadCustomerReply && <span className="rounded-full bg-info px-1.5 text-[10px] font-bold text-surface">Nytt svar</span>}
            {c.flagged && <Icon name="flag" className="h-3.5 w-3.5 text-bad" />}
          </div>
        </div>
        <p className="text-[13px] font-semibold leading-snug">{c.customer.name}</p>
        <p className="mb-2 line-clamp-2 text-xs text-muted">{tenant.jobTypes[c.jobType].label} · {c.description}</p>
      </button>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><Portrait p={ag.portrait} size={20} aiBadge={false} /><span className="text-[11px] text-muted">{ag.name}</span></span>
        <PriorityMark p={c.priority} />
      </div>
      <label className="sr-only" htmlFor={`mv-${c.id}`}>Flytt sak</label>
      <select id={`mv-${c.id}`} value={c.status} onChange={(e) => actions.moveCase(c.id, e.target.value as CaseStatus)}
        className="mt-2 w-full rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] text-muted">
        {STATUS_ORDER.map((s) => <option key={s} value={s}>Flytt til: {STATUS_META[s].label}</option>)}
      </select>
    </div>
  );
}

export function CasesView({ openCase, filter, setFilter }: { openCase: (id: string) => void; filter: string; setFilter: (f: string) => void }) {
  const { state, tenant, actions } = useStore();
  const [mode, setMode] = useState<'kanban' | 'list'>(() => { try { return (localStorage.getItem('ak-mode') as 'kanban' | 'list') || 'kanban'; } catch { return 'kanban'; } });
  const [q, setQ] = useState('');
  const [over, setOver] = useState<CaseStatus | null>(null);
  const setM = (m: 'kanban' | 'list') => { setMode(m); try { localStorage.setItem('ak-mode', m); } catch { /* ignore */ } };
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
  const cases = useMemo(() => state.cases
    .filter(f.test)
    .filter((c) => !q || `${c.number} ${c.title} ${c.customer.name} ${c.customer.address ?? ''} ${tenant.jobTypes[c.jobType].label}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (Number(!!b.flagged) - Number(!!a.flagged)) || prioRank[a.priority] - prioRank[b.priority] || b.updatedAt.localeCompare(a.updatedAt)), [state.cases, f, q, tenant]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Saker</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-faint" />
            <input id="case-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk kunde, adresse, sak" className="field w-52 pl-8 sm:w-64" />
          </div>
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Visning">
            {(['kanban', 'list'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setM(m)} className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold', mode === m ? 'bg-brand text-surface' : 'text-muted')}>
                <Icon name={m === 'kanban' ? 'kanban' : 'list'} className="h-3.5 w-3.5" />{m === 'kanban' ? 'Tavle' : 'Liste'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
        {FILTERS.map((x) => {
          const n = state.cases.filter(x.test).length;
          return (
            <button key={x.id} onClick={() => setFilter(x.id)} className={cx('whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold', filter === x.id ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted hover:text-ink')}>
              {x.label} <span className="tnum opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {mode === 'kanban' ? (
        <div className="scroll-x -mx-1 px-1 pb-3">
          <div className="flex gap-3" style={{ width: 'max-content' }}>
            {STATUS_ORDER.map((s) => {
              const col = cases.filter((c) => c.status === s);
              return (
                <div key={s}
                  onDragOver={(e) => { e.preventDefault(); setOver(s); }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => { const id = e.dataTransfer.getData('text/case'); setOver(null); if (id) actions.moveCase(id, s); }}
                  className={cx('flex w-[250px] shrink-0 flex-col gap-2 rounded-xl bg-sunk/70 p-2 transition', over === s && 'ring-2 ring-brand')}>
                  <div className="flex items-center justify-between px-1 pt-1">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-ink"><span className={cx('h-2 w-2 rounded-full', STATUS_META[s].dot)} />{STATUS_META[s].label}</span>
                    <span className="text-xs font-semibold text-faint tnum">{col.length}</span>
                  </div>
                  {col.map((c) => <CaseCard key={c.id} c={c} onOpen={() => openCase(c.id)} draggable />)}
                  {col.length === 0 && <p className="px-1 py-4 text-center text-[11px] text-faint">Dra saker hit</p>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card scroll-x">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Sak</th>
                <th className="px-2 py-2.5 font-semibold">Kunde</th>
                <th className="px-2 py-2.5 font-semibold">Oppdrag</th>
                <th className="px-2 py-2.5 font-semibold">Status</th>
                <th className="px-2 py-2.5 font-semibold">Prioritet</th>
                <th className="px-2 py-2.5 font-semibold">Agent</th>
                <th className="px-2 py-2.5 text-right font-semibold">Est. verdi</th>
                <th className="px-4 py-2.5 text-right font-semibold">Oppdatert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cases.map((c) => {
                const ag = tenant.agents.find((a) => a.id === c.assignedAgent)!;
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-sunk/60" onClick={() => openCase(c.id)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted"><span className="flex items-center gap-1.5">{c.flagged && <Icon name="flag" className="h-3.5 w-3.5 text-bad" />}{c.number}</span></td>
                    <td className="px-2 py-2.5"><span className="font-semibold">{c.customer.name}</span>{c.unreadCustomerReply && <span className="ml-1.5 rounded-full bg-info px-1.5 text-[10px] font-bold text-surface">Nytt svar</span>}<div className="text-xs text-muted">{c.customer.address ?? c.customer.email}</div></td>
                    <td className="px-2 py-2.5">{tenant.jobTypes[c.jobType].label}</td>
                    <td className="px-2 py-2.5"><CaseStatusBadge status={c.status} short /></td>
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <label className="sr-only" htmlFor={`pr-${c.id}`}>Prioritet</label>
                      <select id={`pr-${c.id}`} value={c.priority} onChange={(e) => actions.setPriority(c.id, e.target.value as Priority)} className={cx('rounded-md border border-transparent bg-transparent py-0.5 text-xs font-semibold hover:border-line', PRIORITY_META[c.priority].tone)}>
                        {(Object.keys(PRIORITY_META) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2.5"><span className="flex items-center gap-1.5"><Portrait p={ag.portrait} size={20} aiBadge={false} />{ag.name}</span></td>
                    <td className="px-2 py-2.5 text-right tnum text-muted">{c.estimatedValue ? kr(c.estimatedValue) : '–'}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted">{fmtRelative(c.updatedAt)}</td>
                  </tr>
                );
              })}
              {cases.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-faint">Ingen saker matcher.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
