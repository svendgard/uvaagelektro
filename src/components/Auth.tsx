import { useEffect, useState } from 'react';
import { api, type SessionUser } from '../lib/api';
import { uvaagElektro as T } from '../config/tenant';
import { Icon } from './ui';

function Shell({ children, title, lead }: { children: React.ReactNode; title: string; lead?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center py-10" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
      <div className="card w-full max-w-[400px] p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-brand font-display text-sm font-bold text-surface">
            {T.company.monogram}
            <Icon name="bolt" className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-accent p-0.5 text-white" />
          </span>
          <div className="leading-tight">
            <p className="font-display text-[15px] font-semibold">{T.company.shortName}</p>
            <p className="text-[11px] text-muted">Agentkontoret</p>
          </div>
        </div>
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        {lead && <p className="mt-1 text-[13px] text-muted">{lead}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Logg inn">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { const r = await api<{ user: SessionUser }>('/api/auth/login', { body: { email, password } }); onLogin(r.user); }
        catch (x) { setError((x as Error).message); }
        finally { setBusy(false); }
      }}>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="login-email">E-post
          <input id="login-email" className="field text-[14px] font-normal text-ink" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="login-password">Passord
          <input id="login-password" className="field text-[14px] font-normal text-ink" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary justify-center !py-2.5" disabled={busy}>{busy ? 'Logger inn …' : 'Logg inn'}</button>
        <p className="text-xs text-muted">Glemt passordet? Kontakt Tech Haus, så får du en ny lenke.</p>
      </form>
    </Shell>
  );
}

export function InvitePage({ token, onDone }: { token: string; onDone: (u: SessionUser) => void }) {
  const [info, setInfo] = useState<{ email: string; name: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ email: string; name: string }>(`/api/auth/invite?token=${encodeURIComponent(token)}`)
      .then((r) => { setInfo(r); setName(r.name); })
      .catch((e) => setLoadError((e as Error).message));
  }, [token]);
  if (loadError) return <Shell title="Lenken virker ikke" lead={loadError}><a className="btn btn-ghost" href="/">Gå til innlogging</a></Shell>;
  if (!info) return <Shell title="Laster …"><span /></Shell>;
  return (
    <Shell title="Velg passord" lead={`Du lager passord for ${info.email}. Lenken kan bare brukes én gang.`}>
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        if (pw !== pw2) { setError('Passordene er ikke like.'); return; }
        setBusy(true);
        try {
          const r = await api<{ user: SessionUser }>('/api/auth/accept-invite', { body: { token, password: pw, name } });
          window.history.replaceState(null, '', '/');
          onDone(r.user);
        } catch (x) { setError((x as Error).message); }
        finally { setBusy(false); }
      }}>
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="inv-name">Navn
          <input id="inv-name" className="field text-[14px] font-normal text-ink" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="inv-pw">Nytt passord (minst 12 tegn)
          <input id="inv-pw" className="field text-[14px] font-normal text-ink" type="password" autoComplete="new-password" minLength={12} required value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="inv-pw2">Gjenta passord
          <input id="inv-pw2" className="field text-[14px] font-normal text-ink" type="password" autoComplete="new-password" minLength={12} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        <p className="text-xs text-muted">Tips: en setning du husker, for eksempel tre–fire ord og et tall.</p>
        {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary justify-center !py-2.5" disabled={busy}>{busy ? 'Lagrer …' : 'Lagre og logg inn'}</button>
      </form>
    </Shell>
  );
}

/** Henter innlogget bruker og viser innlogging eller invitasjon ved behov. */
export function AuthGate({ children }: { children: (u: SessionUser, logout: () => Promise<void>) => React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const inviteToken = window.location.pathname === '/invitasjon' ? new URLSearchParams(window.location.search).get('token') : null;
  useEffect(() => {
    if (inviteToken) { setUser(null); return; }
    api<{ user: SessionUser }>('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, [inviteToken]);
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { setUser(null); } };
  if (user === undefined) return <div className="p-8 text-center text-[13px] text-muted">Laster …</div>;
  if (!user && inviteToken) return <InvitePage token={inviteToken} onDone={setUser} />;
  if (!user) return <LoginPage onLogin={setUser} />;
  return <>{children(user, logout)}</>;
}
