import { useCallback, useEffect, useState } from 'react';
import { api, type SessionUser } from '../lib/api';
import { Icon } from './ui';
import { cx, fmtDateTime } from '../lib/util';

interface AdminUser { id: string; email: string; name: string; role: 'superadmin' | 'owner'; active: boolean; created_at: string; last_login_at: string | null; has_password: boolean; pending_invite: boolean; sessions: number; mfa_enabled: boolean }
interface Status { version: string; started_at: string; server_time: string; database: string; users: number; sessions: number; mfa: { required_roles: string[]; configured: boolean }; integrations: Record<string, string> }

const ROLE = { superadmin: 'Superadministrator', owner: 'Eier' };

function InviteBox({ invite, email, onClose }: { invite: { url: string; expiresAt: string }; email: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/50 bg-accent-soft/50 p-4">
      <p className="text-[13px]"><b>Engangslenke for {email}.</b> Send den til personen. Den gjelder til {fmtDateTime(invite.expiresAt)} og vises bare nå.</p>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="invite-url">Lenke</label>
        <input id="invite-url" className="field min-w-0 flex-1 font-mono text-xs" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary" onClick={async () => {
          try { await navigator.clipboard.writeText(invite.url); setCopied(true); }
          catch { (document.getElementById('invite-url') as HTMLInputElement)?.select(); }
        }}>{copied ? 'Kopiert' : 'Kopier'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Ferdig</button>
      </div>
    </div>
  );
}

export function AdminView({ me }: { me: SessionUser }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<{ at: string; email: string; success: boolean; reason: string; ip: string }[]>([]);
  const [audit, setAudit] = useState<{ at: string; actor_email: string; action: string; detail: string }[]>([]);
  const [tab, setTab] = useState<'logins' | 'audit'>('logins');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<{ url: string; expiresAt: string; email: string } | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'owner' as 'owner' | 'superadmin' });
  const [confirmReset, setConfirmReset] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, s, e, a] = await Promise.all([
        api<{ users: AdminUser[] }>('/api/admin/users'), api<Status>('/api/admin/status'),
        api<{ events: typeof events }>('/api/admin/login-events'), api<{ entries: typeof audit }>('/api/admin/audit'),
      ]);
      setUsers(u.users); setStatus(s); setEvents(e.events); setAudit(a.entries);
    } catch (x) { setError((x as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => { setError(''); try { await fn(); await load(); } catch (x) { setError((x as Error).message); } };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold">Administrasjon</h1>
        <p className="text-[13px] text-muted">Bare synlig for superadministrator. Brukere, innlogginger og driftsstatus.</p>
      </div>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}

      {status && (
        <section className="card grid gap-3 p-4 sm:grid-cols-4">
          <div><p className="label">Database</p><p className={cx('font-semibold', status.database === 'ok' ? 'text-ok' : 'text-bad')}>{status.database === 'ok' ? 'OK' : 'Feil'}</p></div>
          <div><p className="label">Versjon</p><p className="font-mono text-[13px]">{status.version}</p><p className="text-[11px] text-faint">Startet {fmtDateTime(status.started_at)}</p></div>
          <div><p className="label">Aktive brukere / sesjoner</p><p className="font-semibold tnum">{status.users} / {status.sessions}</p></div>
          <div><p className="label">Integrasjoner</p>
            <ul className="text-[12px] text-muted">
              <li>Microsoft 365: {status.integrations.microsoft365}</li>
              <li>AI: {status.integrations.ai}</li>
              <li>Helserapportering: {status.integrations.health_reporting}</li>
              <li>Tofaktor påkrevd for: {status.mfa.required_roles.length ? status.mfa.required_roles.map((r) => (r === 'owner' ? 'eier' : 'superadmin')).join(', ') : 'ingen (valgfritt)'}{!status.mfa.configured && ' · nøkkel mangler'}</li>
            </ul>
          </div>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-display text-base font-semibold">Brukere</h2>
        <div className="scroll-x">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-line text-xs text-muted"><tr><th className="py-2 pr-2 font-semibold">Bruker</th><th className="px-2 py-2 font-semibold">Rolle</th><th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2 font-semibold">Tofaktor</th><th className="px-2 py-2 font-semibold">Sist innlogget</th><th className="py-2 pl-2 text-right font-semibold">Handlinger</th></tr></thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-2"><b>{u.name || '–'}</b><div className="text-xs text-muted">{u.email}{u.id === me.id && ' (deg)'}</div></td>
                  <td className="px-2 py-2">{ROLE[u.role]}</td>
                  <td className="px-2 py-2">
                    {!u.active ? <span className="rounded-full bg-sunk px-2 py-0.5 text-xs font-semibold text-muted">Deaktivert</span>
                      : !u.has_password ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">{u.pending_invite ? 'Venter på passord' : 'Lenke utløpt'}</span>
                      : <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">Aktiv</span>}
                  </td>
                  <td className="px-2 py-2 text-xs">{u.mfa_enabled ? <span className="font-semibold text-ok">På</span> : <span className="text-muted">Av</span>}</td>
                  <td className="px-2 py-2 text-xs text-muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Aldri'}</td>
                  <td className="py-2 pl-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {confirmReset === u.id ? (
                        <>
                          <span className="self-center text-xs">Nullstille passord og logge ut?</span>
                          <button className="btn btn-danger !px-2 !py-1 text-xs" onClick={() => run(async () => { const r = await api<{ invite: { url: string; expiresAt: string } }>(`/api/admin/users/${u.id}/invite`, { method: 'POST' }); setInvite({ ...r.invite, email: u.email }); setConfirmReset(null); })}>Ja</button>
                          <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => setConfirmReset(null)}>Avbryt</button>
                        </>
                      ) : (
                        <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => setConfirmReset(u.id)}>Ny lenke</button>
                      )}
                      {u.mfa_enabled && u.id !== me.id && (
                        <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => run(async () => { await api(`/api/admin/users/${u.id}/mfa-reset`, { method: 'POST' }); })}>Nullstill tofaktor</button>
                      )}
                      {u.id !== me.id && (
                        <button className={cx('btn !px-2 !py-1 text-xs', u.active ? 'btn-danger' : 'btn-ghost')} onClick={() => run(async () => { await api(`/api/admin/users/${u.id}/active`, { body: { active: !u.active } }); })}>
                          {u.active ? 'Deaktiver' : 'Aktiver'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invite && <div className="mt-3"><InviteBox invite={invite} email={invite.email} onClose={() => setInvite(null)} /></div>}
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api<{ invite: { url: string; expiresAt: string } }>('/api/admin/users', { body: form });
            setInvite({ ...r.invite, email: form.email });
            setForm({ email: '', name: '', role: 'owner' });
          });
        }}>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-semibold text-muted" htmlFor="nu-email">E-post
            <input id="nu-email" className="field font-normal text-ink" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs font-semibold text-muted" htmlFor="nu-name">Navn
            <input id="nu-name" className="field font-normal text-ink" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="nu-role">Rolle
            <select id="nu-role" className="field font-normal text-ink" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'owner' })}>
              <option value="owner">Eier</option><option value="superadmin">Superadministrator</option>
            </select>
          </label>
          <button className="btn btn-primary"><Icon name="user" />Opprett og lag lenke</button>
        </form>
      </section>

      <section className="card p-4">
        <div className="mb-2 flex gap-1.5">
          {(['logins', 'audit'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', tab === t ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted')}>{t === 'logins' ? 'Innlogginger' : 'Revisjonslogg'}</button>
          ))}
        </div>
        <div className="scroll-x">
          {tab === 'logins' ? (
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {events.map((e, i) => (
                  <tr key={i}><td className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted tnum">{fmtDateTime(e.at)}</td><td className="px-2 py-1.5">{e.email}</td>
                    <td className="px-2 py-1.5">{e.success ? <span className="text-ok">OK</span> : <span className="text-bad">Avvist{e.reason ? ` (${e.reason})` : ''}</span>}</td><td className="py-1.5 pl-2 font-mono text-[11px] text-faint">{e.ip}</td></tr>
                ))}
                {events.length === 0 && <tr><td className="py-4 text-center text-faint">Ingen innlogginger ennå.</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {audit.map((e, i) => (
                  <tr key={i}><td className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted tnum">{fmtDateTime(e.at)}</td><td className="px-2 py-1.5">{e.actor_email}</td><td className="px-2 py-1.5 font-mono text-[11px]">{e.action}</td><td className="py-1.5 pl-2 text-muted">{e.detail}</td></tr>
                ))}
                {audit.length === 0 && <tr><td className="py-4 text-center text-faint">Ingen hendelser ennå.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
