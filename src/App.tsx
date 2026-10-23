import { useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import type { AgentId } from './domain/types';
import { AgentDrawer, Dashboard, type Nav } from './components/Dashboard';
import { CasesView } from './components/Cases';
import { CaseDetail } from './components/CaseDetail';
import { InboxView, LogView, SettingsView, SimulateDialog } from './components/Views';
import { Icon } from './components/ui';
import { ProjectsView } from './components/Projects';
import { TechView } from './components/TechView';
import { cx } from './lib/util';
import { DEMO } from './demo';
import { AuthGate } from './components/Auth';
import { AdminView } from './components/Admin';
import type { SessionUser } from './lib/api';

type View = 'office' | 'cases' | 'projects' | 'tech' | 'inbox' | 'log' | 'settings' | 'admin';

function Shell({ me, logout }: { me?: SessionUser; logout?: () => Promise<void> }) {
  const { state, tenant } = useStore();
  const [view, setView] = useState<View>('office');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<AgentId | null>(null);
  const [filter, setFilter] = useState('open');
  const [sim, setSim] = useState(false);
  const nav: Nav = { openCase: setCaseId, openAgent: setAgentId, go: (v) => setView(v as View) };
  const pending = state.drafts.filter((d) => d.state === 'pending').length;
  const unread = state.cases.filter((c) => c.unreadCustomerReply).length;
  const toControl = state.cases.filter((c) => c.job && (c.job.stage === 'reported' || c.job.help)).length;
  const allTabs: ({ id: View; label: string; icon: string; badge?: number } | false)[] = [
    { id: 'office', label: 'Agentkontoret', icon: 'office', badge: pending },
    { id: 'cases', label: 'Saker', icon: 'cases' },
    tenant.features.projects && { id: 'projects', label: 'Prosjekter', icon: 'wrench', badge: toControl },
    tenant.features.projects && { id: 'tech', label: 'Montørvisning', icon: 'chat' },
    { id: 'inbox', label: 'Innboks', icon: 'inbox', badge: unread },
    { id: 'log', label: 'Logg', icon: 'log' },
    { id: 'settings', label: 'Innstillinger', icon: 'settings' },
    me?.role === 'superadmin' && { id: 'admin', label: 'Admin', icon: 'shield' },
  ];
  const tabs = allTabs.filter((t): t is { id: View; label: string; icon: string; badge?: number } => !!t);
  const userName = me ? (me.name || me.email) : tenant.owner.name;
  const roleText = me ? (me.role === 'superadmin' ? 'Superadministrator' : 'Eier') : 'Demo';

  return (
    <div className="min-h-full">
      <header className="sticky z-30 border-b border-line bg-surface/95 backdrop-blur" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 py-2.5" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-display text-sm font-bold text-surface">
              {tenant.company.monogram}
              <Icon name="bolt" className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-accent p-0.5 text-white" />
            </span>
            <div className="leading-tight">
              <p className="font-display text-[15px] font-semibold">{tenant.company.shortName}</p>
              <p className="text-[11px] text-muted">Agentkontoret</p>
            </div>
          </div>
          <nav className="scroll-x mx-auto hidden min-w-0 gap-0.5 lg:flex" aria-label="Hovedmeny">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setView(t.id)} aria-current={view === t.id ? 'page' : undefined}
                className={cx('relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold', view === t.id ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink')}>
                <Icon name={t.icon} />{t.label}
                {!!t.badge && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-white tnum">{t.badge}</span>}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
            {DEMO && <button className="btn btn-accent" onClick={() => setSim(true)}><Icon name="mail" /><span className="hidden sm:inline">Simuler henvendelse</span><span className="sm:hidden">Simuler</span></button>}
            <span className="hidden items-center gap-2 xl:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-surface">{userName[0]?.toUpperCase()}</span>
              <span className="text-xs leading-tight"><b>{userName}</b><br /><span className="text-muted">{roleText}</span></span>
            </span>
            {logout && <button className="btn btn-ghost !px-2.5" onClick={() => void logout()} title="Logg ut"><Icon name="back" /><span className="hidden sm:inline">Logg ut</span></button>}
          </div>
        </div>
        <nav className="scroll-x flex gap-1 border-t border-line pb-2 pt-1.5 lg:hidden" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }} aria-label="Hovedmeny mobil">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setView(t.id)} className={cx('flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold', view === t.id ? 'bg-brand-soft text-brand' : 'text-muted')}>
              <Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}
              {!!t.badge && <span className="rounded-full bg-accent px-1 text-[10px] font-bold text-white">{t.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-warn/30 bg-warn-soft py-1 text-center text-[11px] font-semibold text-warn" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
          {DEMO ? 'Prototype med fiktive data. E-post sendes og mottas kun i simulering.' : 'E-post er ikke koblet til ennå. Saker vises her når Microsoft 365 er tilkoblet.'}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] py-5" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
        {view === 'office' && <Dashboard nav={nav} onFilter={(f) => { setFilter(f); setView('cases'); }} />}
        {view === 'cases' && <CasesView openCase={setCaseId} filter={filter} setFilter={setFilter} />}
        {view === 'projects' && <ProjectsView openCase={setCaseId} />}
        {view === 'tech' && <TechView />}
        {view === 'inbox' && <InboxView openCase={setCaseId} />}
        {view === 'log' && <LogView openCase={setCaseId} />}
        {view === 'settings' && <SettingsView />}
        {view === 'admin' && me?.role === 'superadmin' && <AdminView me={me} />}
      </main>

      <CaseDetail caseId={caseId} onClose={() => setCaseId(null)} />
      <AgentDrawer id={agentId} onClose={() => setAgentId(null)} nav={nav} />
      {DEMO && <SimulateDialog open={sim} onClose={() => setSim(false)} onCreated={(id) => setCaseId(id)} />}

      <div className="pointer-events-none fixed bottom-0 right-0 z-50 flex flex-col items-end gap-2 p-4" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }} aria-live="polite">
        {state.toasts.map((t) => (
          <div key={t.id} className={cx('slide-in pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-lg', t.tone === 'success' ? 'bg-ok text-surface' : t.tone === 'danger' ? 'bg-bad text-surface' : 'bg-ink text-surface')}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  if (DEMO) return <StoreProvider><Shell /></StoreProvider>;
  return (
    <AuthGate>
      {(me, logout) => (
        // Superadministrator kan se alt, men bare eieren kan godkjenne og sende til kunder.
        <StoreProvider key={me.id} role={me.role === 'owner' ? 'owner' : 'viewer'}>
          <Shell me={me} logout={logout} />
        </StoreProvider>
      )}
    </AuthGate>
  );
}
