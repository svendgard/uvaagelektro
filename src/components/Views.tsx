import { useMemo, useState } from 'react';
import { MailConnectionCard } from './MailConnection';
import { useStore } from '../state/store';
import { AUTOMATION_LEVELS } from '../config/tenant';
import type { UserRole } from '../domain/types';
import { ActivityFeed } from './Dashboard';
import { CaseStatusBadge, Icon, Modal, Portrait } from './ui';
import { cx, fmtDateTime, fmtRelative, kr } from '../lib/util';
import * as demoData from '../data/demoState';
import { DEMO } from '../demo';
const SIMULATION_TEMPLATES = DEMO ? demoData.SIMULATION_TEMPLATES : [];

export function InboxView({ openCase }: { openCase: (id: string) => void }) {
  const { state, tenant } = useStore();
  const [tab, setTab] = useState<'cases' | 'ignored'>('cases');
  const inbound = useMemo(() => state.messages.filter((m) => m.direction === 'inbound').sort((a, b) => b.sentAt.localeCompare(a.sentAt)), [state.messages]);
  const caseByThread = new Map(state.cases.map((c) => [c.threadId, c]));
  const emma = tenant.agents.find((a) => a.id === 'intake')!;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Innboks</h1>
          <p className="text-[13px] text-muted">Speiler {tenant.mail.mailbox}. Den vanlige e-postkontoen fungerer som før.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn-soft px-3 py-1 text-xs font-semibold text-warn"><Icon name="plug" className="h-3.5 w-3.5" />{DEMO ? 'Simulert innboks · ingen ekte e-postkonto tilkoblet' : 'Ikke koblet til ennå'}</span>
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => setTab('cases')} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', tab === 'cases' ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted')}>Kundehenvendelser <span className="tnum opacity-70">{inbound.filter((m) => caseByThread.has(m.threadId)).length}</span></button>
        <button onClick={() => setTab('ignored')} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', tab === 'ignored' ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted')}>Sortert bort av AIEmma <span className="tnum opacity-70">{state.ignored.length}</span></button>
      </div>
      {tab === 'cases' ? (
        <ul className="card divide-y divide-line">
          {inbound.filter((m) => caseByThread.has(m.threadId)).map((m) => {
            const c = caseByThread.get(m.threadId)!;
            return (
              <li key={m.id}>
                <button onClick={() => openCase(c.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-sunk/60 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-[13px]">{m.from.name}</b>
                      <span className="text-xs text-muted">{m.from.email}</span>
                      {m.attachments.length > 0 && <span className="inline-flex items-center gap-0.5 text-xs text-muted"><Icon name="paperclip" className="h-3.5 w-3.5" />{m.attachments.length}</span>}
                    </div>
                    <p className="truncate text-[13px]"><span className="font-semibold">{m.subject}</span> <span className="text-muted">· {m.body.replace(/\s+/g, ' ').slice(0, 110)}</span></p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[11px] text-faint">{c.number}</span>
                    <CaseStatusBadge status={c.status} short />
                    <span className="w-24 text-right text-xs text-muted">{fmtRelative(m.sentAt)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Portrait p={emma.portrait} size={28} aiBadge={false} />AIEmma har vurdert disse som ikke-kundehenvendelser. De blir liggende urørt i den vanlige innboksen.</p>
          <ul className="card divide-y divide-line">
            {state.ignored.map(({ message: m, reason }) => (
              <li key={m.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1"><b className="text-[13px]">{m.from.name}</b> <span className="text-xs text-muted">{m.from.email}</span><p className="truncate text-[13px] text-muted">{m.subject}</p></div>
                <span className="rounded-full bg-sunk px-2 py-0.5 text-xs font-semibold text-muted">{reason}</span>
                <span className="w-24 text-right text-xs text-muted">{fmtRelative(m.sentAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
