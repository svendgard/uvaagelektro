import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { AttachmentChip, MailBody } from './CaseDetail';
import { MailConnectionCard } from './MailConnection';
import { previewText } from '../lib/cleanMail';
import { useStore } from '../state/store';
import { AUTOMATION_LEVELS } from '../config/tenant';
import type { InboxItem, UserRole } from '../domain/types';
import { ActivityFeed } from './Dashboard';
import { CaseStatusBadge, Icon, Modal, Portrait } from './ui';
import { cx, fmtDateTime, fmtRelative, kr } from '../lib/util';
import * as demoData from '../data/demoState';
import { DEMO } from '../demo';
const SIMULATION_TEMPLATES = DEMO ? demoData.SIMULATION_TEMPLATES : [];

type InboxFilter = 'all' | 'case' | 'ignored' | 'internal';
const DECISION_META: Record<InboxItem['decision'], { label: string; tone: string }> = {
  case: { label: 'Sak', tone: 'bg-brand-soft text-brand' },
  ignored: { label: 'Sortert bort', tone: 'bg-sunk text-muted' },
  internal: { label: 'Intern', tone: 'bg-info-soft text-info' },
  self: { label: 'Fra deg selv', tone: 'bg-violet-soft text-violet' },
};

/** E-post som ikke er sak: hentes direkte fra Microsoft og vises her. Kan gjøres om til sak. */
function InboxMailDialog({ item, onClose, openCase }: { item: InboxItem | null; onClose: () => void; openCase: (id: string) => void }) {
  const { state, actions } = useStore();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setData(null); setError(null);
    if (!item || DEMO) return;
    let alive = true;
    api(`/api/inbox/${encodeURIComponent(item.id)}`).then((r) => { if (alive) setData(r); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Kunne ikke hente e-posten.'); });
    return () => { alive = false; };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const meta = DECISION_META[item.decision];
  const canAct = state.role === 'owner';
  return (
    <Modal open onClose={onClose} title={item.subject || '(uten emne)'} wide>
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cx('rounded-full px-2 py-0.5 font-bold', meta.tone)}>{meta.label}</span>
          {item.reason && item.decision !== 'case' && <span className="text-muted">{item.reason}</span>}
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
            <span className="break-anywhere min-w-0"><b className="text-[13px] text-ink">{item.from.name}</b> <span className="text-muted">&lt;{item.from.email}&gt;</span></span>
            <time className="text-faint" dateTime={item.receivedAt}>{fmtDateTime(item.receivedAt)}</time>
          </header>
          {DEMO ? <p className="text-[13px] text-muted">Innholdet hentes fra Microsoft når e-posten er koblet til.</p>
            : error ? <p className="text-[13px] text-bad">{error}</p>
            : !data ? <p className="text-[13px] text-muted">Henter e-posten …</p>
            : <>
                {data.to?.length > 0 && <p className="break-anywhere mb-1 text-xs text-muted">Til: {data.to.map((t: any) => t.email).join(', ')}{data.cc?.length ? ` · Kopi: ${data.cc.map((t: any) => t.email).join(', ')}` : ''}</p>}
                <MailBody body={data.body} />
                {data.attachments?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{data.attachments.map((a: any) => <AttachmentChip key={a.id} a={a} href={`/api/inbox/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(a.id)}`} />)}</div>}
              </>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.caseId
            ? <button className="btn btn-primary" onClick={() => { onClose(); openCase(item.caseId!); }}><Icon name="arrow" />Åpne sak {item.caseNumber}</button>
            : <button className="btn btn-accent" disabled={busy || !canAct || DEMO} onClick={async () => { setBusy(true); const id = await actions.makeCase(item.id); setBusy(false); if (id) { onClose(); openCase(id); } }}>
                <Icon name="plus" />{busy ? 'Oppretter sak …' : 'Gjør om til sak'}
              </button>}
          <button className="btn btn-ghost" onClick={onClose}>Lukk</button>
        </div>
        {!item.caseId && <p className="text-[11px] text-muted">Som sak får e-posten et svarforslag fra AIOliver, og den følges opp som andre saker. Ingenting sendes uten at du godkjenner.</p>}
      </div>
    </Modal>
  );
}

export function InboxView({ openCase }: { openCase: (id: string) => void }) {
  const { state, tenant } = useStore();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [open, setOpen] = useState<InboxItem | null>(null);
  const caseByThread = useMemo(() => new Map(state.cases.map((c) => [c.threadId, c])), [state.cases]);

  // Produksjon: listen fra serveren. Demo: bygges fra meldingene og det AIEmma sorterte bort.
  const items: InboxItem[] = useMemo(() => {
    if (!DEMO) return state.inbox;
    const fromCases: InboxItem[] = state.messages.filter((m) => m.direction === 'inbound').map((m) => {
      const c = caseByThread.get(m.threadId);
      return { id: m.id, decision: 'case', reason: '', caseId: c?.id, caseNumber: c?.number, from: m.from, subject: m.subject, receivedAt: m.sentAt, hasAttachments: m.attachments.length > 0 };
    });
    const ignored: InboxItem[] = state.ignored.map(({ message: m, reason }) => ({ id: m.id, decision: 'ignored', reason, from: m.from, subject: m.subject, receivedAt: m.sentAt, hasAttachments: false }));
    return [...fromCases, ...ignored].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }, [state.inbox, state.messages, state.ignored, caseByThread]);

  const counts = {
    all: items.length,
    case: items.filter((i) => i.decision === 'case').length,
    ignored: items.filter((i) => i.decision === 'ignored').length,
    internal: items.filter((i) => i.decision === 'internal' || i.decision === 'self').length,
  };
  const shown = items.filter((i) => filter === 'all' || i.decision === filter || (filter === 'internal' && i.decision === 'self'));
  const tabs: { id: InboxFilter; label: string }[] = [
    { id: 'all', label: 'Alle' }, { id: 'case', label: 'Saker' }, { id: 'ignored', label: 'Sortert bort' }, { id: 'internal', label: 'Interne' },
  ];
  const m = state.mail;
  const status = DEMO ? 'Simulert innboks' : !m ? '' : m.connected ? `Tilkoblet${m.last_sync_at ? ` · sjekket ${fmtRelative(m.last_sync_at)}` : ''}` : 'Ikke koblet til';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">Innboks</h1>
          <p className="break-anywhere text-[13px] text-muted">All e-post til {tenant.mail.mailbox}. Den vanlige e-posten i Outlook fungerer som før.</p>
        </div>
        {status && <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', !DEMO && m?.connected ? 'bg-ok-soft text-ok' : 'border border-warn/40 bg-warn-soft text-warn')}>
          <span className={cx('h-1.5 w-1.5 rounded-full', !DEMO && m?.connected ? 'bg-ok' : 'bg-warn')} />{status}
        </span>}
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Filter">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={filter === t.id} onClick={() => setFilter(t.id)}
            className={cx('flex min-w-0 flex-col items-center justify-center rounded-lg px-1 py-1.5 text-[12px] font-semibold leading-tight sm:flex-row sm:gap-1.5 sm:text-[13px]', filter === t.id ? 'bg-brand text-surface' : 'text-muted hover:text-ink')}>
            <span className="max-w-full truncate">{t.label}</span><span className="tnum text-[11px] opacity-70">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {shown.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-faint">{items.length ? 'Ingen e-poster i denne gruppen.' : 'Ingen e-post ennå. Nye e-poster dukker opp her innen et minutt.'}</p> : (
          <ul className="divide-y divide-line">
            {shown.map((i) => {
              const meta = DECISION_META[i.decision];
              return (
                <li key={i.id}>
                  <button onClick={() => (i.caseId && DEMO ? openCase(i.caseId) : setOpen(i))} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunk/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold">{i.from.name}</span>
                        <span className="shrink-0 text-[11px] text-faint">{fmtRelative(i.receivedAt)}</span>
                      </div>
                      <p className="truncate text-[13px] text-ink">{i.subject || '(uten emne)'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={cx('whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold leading-4', meta.tone)}>{i.decision === 'case' && i.caseNumber ? `Sak ${i.caseNumber}` : meta.label}</span>
                        {i.decision === 'ignored' && i.reason && <span className="truncate text-[11px] text-muted">{i.reason}</span>}
                        {i.hasAttachments && <Icon name="paperclip" className="h-3.5 w-3.5 text-faint" />}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <InboxMailDialog item={open} onClose={() => setOpen(null)} openCase={openCase} />
    </div>
  );
}

export function LogView({ openCase }: { openCase: (id: string) => void }) {
  const { state } = useStore();
  const [tab, setTab] = useState<'activity' | 'audit'>('activity');
  const roleTone = { owner: 'bg-brand-soft text-brand', agent: 'bg-violet-soft text-violet', system: 'bg-sunk text-muted' };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Logg</h1>
        <p className="text-[13px] text-muted">Aktivitet viser hva teamet har gjort. Revisjonsloggen registrerer hver handling som kan endre en sak eller sende e-post.</p>
      </div>
      <div className="flex gap-1.5">
        {(['activity', 'audit'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', tab === t ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted')}>{t === 'activity' ? 'Aktivitet' : 'Revisjonslogg'}</button>
        ))}
      </div>
      {tab === 'activity' ? <div className="card p-4"><ActivityFeed items={state.activities} onOpenCase={openCase} limit={200} /></div> : (
        <div className="card scroll-x">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-line text-xs text-muted"><tr><th className="px-4 py-2 font-semibold">Tid</th><th className="px-2 py-2 font-semibold">Aktør</th><th className="px-2 py-2 font-semibold">Handling</th><th className="px-2 py-2 font-semibold">Sak</th><th className="px-4 py-2 font-semibold">Detalj</th></tr></thead>
            <tbody className="divide-y divide-line">
              {[...state.audit].reverse().map((a) => {
                const c = state.cases.find((x) => x.id === a.caseId);
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted tnum">{fmtDateTime(a.at)}</td>
                    <td className="px-2 py-2"><span className={cx('rounded px-1.5 py-0.5 font-mono text-[11px]', roleTone[a.role])}>{a.actor}</span></td>
                    <td className="px-2 py-2 font-mono text-[11px]">{a.action}</td>
                    <td className="px-2 py-2">{c ? <button className="font-mono text-[11px] text-brand hover:underline" onClick={() => openCase(c.id)}>{c.number}</button> : <span className="text-faint">–</span>}</td>
                    <td className="px-4 py-2 text-muted">{a.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SettingsView({ isSuperadmin = false, canConnect = false }: { isSuperadmin?: boolean; canConnect?: boolean } = {}) {
  const { state, tenant, actions } = useStore();
  const roles: { id: UserRole; label: string; text: string }[] = [
    { id: 'owner', label: 'Eier (Espen)', text: 'Godkjenner, sender, sletter og endrer innstillinger.' },
    { id: 'staff', label: 'Ansatt', text: 'Ser og flytter saker, men kan ikke sende e-post.' },
    { id: 'viewer', label: 'Lesetilgang', text: 'Kan bare se.' },
  ];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-semibold">Innstillinger</h1>
      <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">Automatiseringsnivå</h2>
        <p className="mb-3 text-[13px] text-muted">Bestemmer hva agentene får gjøre uten godkjenning. Første versjon kjører kun nivå 1.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {AUTOMATION_LEVELS.map((l) => (
            <div key={l.level} className={cx('rounded-xl border p-4', l.level === tenant.automation.level ? 'border-brand bg-brand-soft' : 'border-line opacity-70')}>
              <div className="mb-1 flex items-center justify-between"><b>Nivå {l.level} · {l.name}</b>{l.level === tenant.automation.level ? <span className="rounded-full bg-brand px-2 text-[11px] font-bold text-surface">Aktiv</span> : <span className="rounded-full bg-sunk px-2 text-[11px] font-semibold text-muted">Senere</span>}</div>
              <p className="text-[13px] text-muted">{l.text}</p>
            </div>
          ))}
        </div>
      </section>

      {DEMO ? <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">E-posttilkobling</h2>
        <p className="mb-3 text-[13px] text-muted">Koblingen skjer med OAuth. Espen logger inn hos Microsoft og godkjenner tilgang. Dashboardet ser aldri passordet.</p>
        <div className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-[13px]">
          <Icon name="plug" className="h-5 w-5 text-warn" />
          <span><b>Status: simulert.</b> Ingen ekte e-post sendes eller mottas i denne prototypen. Konto som speiles: {tenant.mail.mailbox}.</span>
        </div>
      </section> : <MailConnectionCard isSuperadmin={isSuperadmin} canConnect={canConnect} />}

      {DEMO && <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">Roller og tilgang</h2>
        <p className="mb-3 text-[13px] text-muted">Bytt rolle for å se hvordan tilgangsstyringen virker i demoen.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {roles.map((r) => (
            <button key={r.id} onClick={() => actions.setRole(r.id)} className={cx('rounded-xl border p-3 text-left', state.role === r.id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-sunk')}>
              <b className="text-[13px]">{r.label}</b><p className="text-xs text-muted">{r.text}</p>
            </button>
          ))}
        </div>
      </section>}

      <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">Prismaler</h2>
        <p className="mb-3 text-[13px] text-muted">AIOliver bruker bare priser herfra. Finnes ingen mal, må Espen sette pris selv.{DEMO && ' Tallene under er eksempler.'}</p>
        {tenant.priceTemplates.length === 0 && <p className="rounded-lg bg-sunk px-3 py-2 text-[13px] text-muted">Ingen prismaler lagt inn ennå. Til da lager AIOliver bare svar uten priser.</p>}
        <ul className="divide-y divide-line text-[13px]">
          {tenant.priceTemplates.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span>{p.label}<span className="block text-xs text-faint">{p.note}</span></span><b className="tnum">{kr(p.amount)} <span className="font-normal text-muted">{p.unit}</span></b></li>
          ))}
        </ul>
      </section>

      {tenant.features.projects && <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">Prosjektkontroll og fakturagrunnlag</h2>
        <p className="mb-3 text-[13px] text-muted">AISofie bruker disse tallene når hun lager fakturagrunnlag. Alle tall er eksempler, og erstattes av Uvaag Elektros egne.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="label mb-1">Timepris og fastpriser</p>
            <ul className="divide-y divide-line text-[13px]">
              <li className="flex justify-between gap-2 py-1.5"><span>Timepris elektriker</span><b className="tnum">{kr(tenant.billing.hourlyRate)} eks. mva</b></li>
              {tenant.billing.fixedPackages.map((f) => <li key={f.id} className="flex justify-between gap-2 py-1.5"><span>{f.label}</span><b className="tnum">{kr(f.amount)}</b></li>)}
            </ul>
          </div>
          <div>
            <p className="label mb-1">Utdrag fra grossistens prisfil (EFONELFO)</p>
            <ul className="max-h-48 divide-y divide-line overflow-y-auto text-[13px]">
              {Object.entries(tenant.billing.materials).map(([k, m]) => <li key={k} className="flex justify-between gap-2 py-1.5"><span><span className="font-mono text-[11px] text-faint">{k}</span> {m.name.replace(/ \(eksempel\)/, '')}</span><b className="shrink-0 tnum">{kr(m.price)}/{m.unit}</b></li>)}
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Tripletex: simulert. Ved kobling opprettes ett prosjekt per oppdrag, timer leses tilbake, og godkjent fakturagrunnlag blir en ordre i Tripletex.</p>
      </section>}

      <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">Sikkerhetsregler</h2>
        <ul className="grid gap-2 text-[13px] text-muted sm:grid-cols-2">
          {[
            'Ingen e-post sendes uten godkjenning fra Espen (nivå 1).',
            'Innhold i e-post og vedlegg behandles som data, aldri som instrukser.',
            'Agentene finner aldri på priser, tekniske løsninger eller lovnader.',
            'Tekniske vurderinger, el-sikkerhet og bindende tilbud krever ansvarlig person.',
            'Hver sending har en idempotensnøkkel. Samme melding kan ikke sendes to ganger.',
            'En melding vises som sendt først når e-postleverandøren har bekreftet.',
            'Vedlegg skannes før de vises.',
            'Alle handlinger skrives til revisjonsloggen.',
          ].map((t) => <li key={t} className="flex gap-2"><Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{t}</li>)}
        </ul>
      </section>

      {DEMO && <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-semibold">Demoverktøy</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={actions.failNextSend}><Icon name="alert" />La neste sending feile</button>
          <button className="btn btn-ghost" onClick={actions.reset}><Icon name="refresh" />Tilbakestill demodata</button>
        </div>
      </section>}
    </div>
  );
}

export function SimulateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { actions, tenant } = useStore();
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(false);
  const t = SIMULATION_TEMPLATES[i];
  return (
    <Modal open={open} onClose={onClose} title="Simuler ny kundehenvendelse">
      <div className="flex flex-col gap-3 p-5">
        <p className="text-[13px] text-muted">Legger en fiktiv e-post i den simulerte innboksen til {tenant.mail.mailbox}. Du ser AIEmma, AIOliver og AIHenrik behandle den, til utkastet venter på deg.</p>
        <div className="flex flex-col gap-2">
          {SIMULATION_TEMPLATES.map((x, k) => (
            <label key={x.label} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3', i === k ? 'border-brand bg-brand-soft' : 'border-line')}>
              <input type="radio" name="sim" id={`sim-${k}`} checked={i === k} onChange={() => setI(k)} className="mt-1" />
              <span><b className="text-[13px]">{x.label}</b><span className="block text-xs text-muted">{x.from.name} · «{x.subject}»</span></span>
            </label>
          ))}
        </div>
        <div className="whitespace-pre-wrap rounded-lg bg-sunk p-3 text-xs text-muted">{t.body}</div>
        <div className="flex gap-2">
          <button className="btn btn-accent" disabled={running} onClick={async () => { setRunning(true); onClose(); const id = await actions.simulateInbound(i); setRunning(false); if (id) onCreated(id); }}><Icon name="mail" />Send inn e-posten</button>
          <button className="btn btn-ghost" onClick={onClose}>Avbryt</button>
        </div>
      </div>
    </Modal>
  );
}

export { fmtDateTime };
