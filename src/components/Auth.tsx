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

function CodeStep({ onLogin, onRestart }: { onLogin: (u: SessionUser) => void; onRestart: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Tofaktor" lead="Skriv koden fra autentiseringsappen. Har du mistet telefonen, bruk en reservekode.">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { const r = await api<{ user: SessionUser }>('/api/auth/mfa/verify', { body: { code } }); onLogin(r.user); }
        catch (x) { setError((x as Error).message); }
        finally { setBusy(false); }
      }}>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="mfa-code">Kode
          <input id="mfa-code" className="field text-center font-mono text-xl tracking-[0.3em] text-ink" inputMode="text" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}
        <button className="btn btn-primary justify-center !py-2.5" disabled={busy}>{busy ? 'Sjekker …' : 'Logg inn'}</button>
        <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={onRestart}>Start på nytt</button>
      </form>
    </Shell>
  );
}

export function LoginPage({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  if (needCode) return <CodeStep onLogin={onLogin} onRestart={() => { setNeedCode(false); setPassword(''); }} />;
  return (
    <Shell title="Logg inn">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try {
          const r = await api<{ user?: SessionUser; mfa_required?: boolean }>('/api/auth/login', { body: { email, password } });
          if (r.mfa_required) setNeedCode(true); else if (r.user) onLogin(r.user);
        }
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

/** Oppsett av tofaktor: QR-kode, bekreft med kode, vis reservekoder én gang. */
export function MfaSetup({ onDone, onCancel, forced }: { onDone: () => void; onCancel?: () => void; forced?: boolean }) {
  const [data, setData] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api<{ secret: string; qr: string }>('/api/auth/mfa/setup', { method: 'POST' }).then(setData).catch((e) => setError((e as Error).message)); }, []);
  if (codes) return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]"><b>Tofaktor er på.</b> Ta vare på reservekodene, for eksempel i en passordhåndterer. Hver kode kan brukes én gang hvis du mister telefonen. De vises bare nå.</p>
      <pre className="grid grid-cols-2 gap-1 rounded-lg bg-sunk p-3 font-mono text-[13px]">{codes.join('\n')}</pre>
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); } catch { /* velg manuelt */ } }}>{copied ? 'Kopiert' : 'Kopier kodene'}</button>
        <button className="btn btn-primary" onClick={onDone}>Jeg har lagret kodene</button>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {forced && <p className="text-[13px]">Kontoen din krever tofaktor. Sett det opp for å fortsette.</p>}
      <ol className="list-decimal pl-5 text-[13px] text-muted">
        <li>Åpne en autentiseringsapp, for eksempel Microsoft Authenticator eller Google Authenticator.</li>
        <li>Skann QR-koden, eller skriv inn nøkkelen.</li>
        <li>Skriv inn koden appen viser.</li>
      </ol>
      {data ? (
        <div className="flex flex-wrap items-center gap-4">
          <img src={data.qr} alt="QR-kode for autentiseringsapp" width={180} height={180} className="rounded-lg border border-line bg-white p-1" />
          <div className="min-w-0 text-xs text-muted">Nøkkel:<br /><code className="break-all font-mono text-[12px] text-ink">{data.secret.replace(/(.{4})/g, '$1 ').trim()}</code></div>
        </div>
      ) : !error && <p className="text-[13px] text-muted">Lager QR-kode …</p>}
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api<{ recovery_codes: string[] }>('/api/auth/mfa/enable', { body: { code } }); setCodes(r.recovery_codes); }
        catch (x) { setError((x as Error).message); }
      }}>
        <label className="sr-only" htmlFor="mfa-enable-code">Kode fra appen</label>
        <input id="mfa-enable-code" className="field w-40 text-center font-mono text-lg tracking-[0.25em]" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn btn-primary" disabled={!data}>Slå på tofaktor</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Avbryt</button>}
      </form>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}
    </div>
  );
}

/** Egen konto: tofaktor av/på. Vises under Innstillinger. */
export function AccountSecurity({ me, onChanged }: { me: SessionUser; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'setup' | 'disable'>('view');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="card p-5">
      <h2 className="mb-1 font-display text-base font-semibold">Min konto</h2>
      <p className="mb-3 text-[13px] text-muted">{me.name || me.email} · {me.email}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className={me.mfa_enabled ? 'rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok' : 'rounded-full bg-sunk px-2 py-0.5 text-xs font-semibold text-muted'}>
          Tofaktor: {me.mfa_enabled ? 'på' : 'av'}{me.mfa_required && ' (påkrevd)'}
        </span>
        {mode === 'view' && !me.mfa_enabled && <button className="btn btn-ghost" onClick={() => setMode('setup')}><Icon name="shield" />Slå på tofaktor</button>}
        {mode === 'view' && me.mfa_enabled && !me.mfa_required && <button className="btn btn-ghost" onClick={() => setMode('disable')}>Slå av tofaktor</button>}
      </div>
      {mode === 'setup' && <div className="mt-4"><MfaSetup onDone={() => { setMode('view'); onChanged(); }} onCancel={() => setMode('view')} /></div>}
      {mode === 'disable' && (
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault(); setError('');
          try { await api('/api/auth/mfa/disable', { body: { code } }); setMode('view'); onChanged(); }
          catch (x) { setError((x as Error).message); }
        }}>
          <label className="sr-only" htmlFor="mfa-disable-code">Kode fra appen</label>
          <input id="mfa-disable-code" className="field w-40 text-center font-mono" inputMode="numeric" placeholder="Kode fra appen" required value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-danger">Slå av</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>Avbryt</button>
          {error && <p className="w-full text-[13px] text-bad">{error}</p>}
        </form>
      )}
    </section>
  );
}

/** Henter innlogget bruker og viser innlogging eller invitasjon ved behov. */
export function AuthGate({ children }: { children: (u: SessionUser, logout: () => Promise<void>, refresh: () => void) => React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const inviteToken = window.location.pathname === '/invitasjon' ? new URLSearchParams(window.location.search).get('token') : null;
  useEffect(() => {
    if (inviteToken) { setUser(null); return; }
    api<{ user: SessionUser }>('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, [inviteToken]);
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { setUser(null); } };
  const refresh = () => { api<{ user: SessionUser }>('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)); };
  if (user === undefined) return <div className="p-8 text-center text-[13px] text-muted">Laster …</div>;
  if (!user && inviteToken) return <InvitePage token={inviteToken} onDone={setUser} />;
  if (!user) return <LoginPage onLogin={setUser} />;
  if (user.mfa_setup_required) return (
    <Shell title="Sett opp tofaktor">
      <MfaSetup forced onDone={refresh} />
      <button className="mt-4 text-xs font-semibold text-brand hover:underline" onClick={() => void logout()}>Logg ut</button>
    </Shell>
  );
  return <>{children(user, logout, refresh)}</>;
}
