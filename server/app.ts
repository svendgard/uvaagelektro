import { Hono, type Context, type Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import QRCode from 'qrcode';
import { hashPassword, newToken, passwordProblem, sha256, verifyPassword } from './auth/crypto';
import { decryptSecret, encryptSecret, newRecoveryCodes, newTotpSecret, normalizeRecovery, otpauthUri, verifyTotp } from './auth/totp';

/**
 * Innlogging, sesjoner og brukeradministrasjon for Agentkontoret.
 *
 * Roller:
 *   owner       Kundens eier (Espen). Bruker Agentkontoret.
 *   superadmin  Tech Haus. Overvåker drift og administrerer brukere. Kan fjernes senere.
 *
 * Sikkerhet:
 *   - Passord: scrypt (N=2^15). Minst 12 tegn.
 *   - Sesjon: tilfeldig token i httpOnly + Secure + SameSite=Strict-cookie. Bare SHA-256 lagres.
 *     Utløper etter 7 dager, eller 24 timer uten aktivitet.
 *   - CSRF: alle endrende kall krever headeren X-Requested-With og riktig Origin.
 *   - Brute force: 5 feil per e-post eller 30 per IP-adresse på 15 minutter gir midlertidig sperre.
 *   - Brukere opprettes med engangslenke (72 t). Ingen passord sendes eller lagres i klartekst.
 *   - Tofaktor (TOTP + reservekoder) er bygget inn. Hvem som må bruke det styres av mfaRequiredRoles
 *     (MFA_REQUIRED_ROLES i Render). Alle kan slå det på frivillig.
 */

export type Role = 'superadmin' | 'owner';
export interface User { id: string; email: string; name: string; role: Role; tenant_id: string; active: boolean }

export interface AppOptions {
  db: Db;
  appUrl: string;
  secureCookies: boolean;
  tenantId: string;
  now?: () => number;
  version?: string;
  /** Roller som må ha tofaktor. Tom liste = valgfritt for alle. */
  mfaRequiredRoles?: Role[];
  /** 32 byte base64. Uten nøkkel kan tofaktor ikke settes opp. */
  mfaKey?: string;
  issuer?: string;
}

const SESSION_TTL_MS = 7 * 24 * 3600e3;
const IDLE_TTL_MS = 24 * 3600e3;
const INVITE_TTL_MS = 72 * 3600e3;
const LOCK_WINDOW_MIN = 15;
const MAX_FAILS_EMAIL = 5;
const MAX_FAILS_IP = 30;
const MFA_CHALLENGE_TTL_MS = 5 * 60e3;
const MFA_MAX_ATTEMPTS = 5;

type Env = { Variables: { user: User & { mfa_enabled: boolean }; sessionHash: string; mfaSetupRequired: boolean } };

export function createApp(o: AppOptions) {
  const { db } = o;
  const now = o.now ?? Date.now;
  const cookieName = o.secureCookies ? '__Host-ak_session' : 'ak_session';
  const mfaCookie = o.secureCookies ? '__Host-ak_mfa' : 'ak_mfa';
  const mfaRequired = (role: Role) => (o.mfaRequiredRoles ?? []).includes(role);
  const app = new Hono<Env>();
  const startedAt = now();

  const ip = (c: Context) => (c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'ukjent').slice(0, 64);
  const err = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429, message: string) => c.json({ error: message }, status);
  const audit = (actor: { id?: string; email: string }, action: string, detail = '') =>
    db.query('INSERT INTO audit_log(at, actor_user_id, actor_email, action, detail) VALUES ($5,$1,$2,$3,$4)', [actor.id ?? null, actor.email, action, detail, new Date(now())]);

  // ── Sikkerhetsheadere på alle svar ──────────────────────────────────────────
  app.use('*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ].join('; '));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (o.secureCookies) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  });

  // ── CSRF-vern på alle endrende kall ─────────────────────────────────────────
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (c.req.header('x-requested-with') !== 'agentkontoret') return err(c, 403, 'Ugyldig forespørsel.');
      const origin = c.req.header('origin');
      if (origin && origin !== new URL(o.appUrl).origin) return err(c, 403, 'Ugyldig opprinnelse.');
    }
    await next();
  });

  // ── Sesjon ───────────────────────────────────────────────────────────────────
  async function loadSession(c: Context<Env>): Promise<boolean> {
    const token = getCookie(c, cookieName);
    if (!token) return false;
    const h = sha256(token);
    const row = (await db.query<User & { expires_at: Date; last_seen_at: Date; mfa_enabled: boolean }>(
      `SELECT u.id, u.email, u.name, u.role, u.tenant_id, u.active, u.mfa_enabled, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [h])).rows[0];
    const t = now();
    if (!row || !row.active || new Date(row.expires_at).getTime() < t || new Date(row.last_seen_at).getTime() < t - IDLE_TTL_MS) {
      if (row) await db.query('DELETE FROM sessions WHERE token_hash = $1', [h]);
      deleteCookie(c, cookieName, { path: '/', secure: o.secureCookies });
      return false;
    }
    if (new Date(row.last_seen_at).getTime() < t - 5 * 60e3) await db.query('UPDATE sessions SET last_seen_at = $2 WHERE token_hash = $1', [h, new Date(t)]);
    c.set('user', { id: row.id, email: row.email, name: row.name, role: row.role, tenant_id: row.tenant_id, active: row.active, mfa_enabled: row.mfa_enabled });
    c.set('sessionHash', h);
    // Krav om tofaktor sjekkes ved hvert kall, så en endring i Render virker umiddelbart.
    c.set('mfaSetupRequired', mfaRequired(row.role) && !row.mfa_enabled);
    return true;
  }

  async function startSession(c: Context, userId: string) {
    const token = newToken();
    const t = now();
    await db.query('INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES ($1,$2,$3,$4,$3,$5,$6)',
      [sha256(token), userId, new Date(t), new Date(t + SESSION_TTL_MS), ip(c), (c.req.header('user-agent') ?? '').slice(0, 200)]);
    await db.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [userId, new Date(t)]);
    setCookie(c, cookieName, token, { path: '/', httpOnly: true, secure: o.secureCookies, sameSite: 'Strict', maxAge: SESSION_TTL_MS / 1000 });
  }

  const requireUser = async (c: Context<Env>, next: Next) => {
    if (!(await loadSession(c))) return err(c, 401, 'Du må logge inn.');
    // Mangler påkrevd tofaktor: bare oppsett, /me og utlogging er tillatt.
    if (c.get('mfaSetupRequired') && !/^\/api\/auth\/(me|logout|mfa\/)/.test(c.req.path)) return err(c, 403, 'Du må sette opp tofaktor først.');
    await next();
  };
  const requireSuperadmin = async (c: Context<Env>, next: Next) => {
    if (c.get('user').role !== 'superadmin') return err(c, 403, 'Krever superadministrator.');
    await next();
  };

  async function createInvite(userId: string): Promise<{ url: string; expiresAt: string }> {
    const token = newToken();
    const exp = new Date(now() + INVITE_TTL_MS);
    await db.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await db.query('INSERT INTO invites(token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, exp]);
    return { url: `${o.appUrl.replace(/\/$/, '')}/invitasjon?token=${token}`, expiresAt: exp.toISOString() };
  }

  const publicUser = (u: User & { mfa_enabled?: boolean }) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, tenant_id: u.tenant_id,
    mfa_enabled: !!u.mfa_enabled, mfa_required: mfaRequired(u.role), mfa_setup_required: mfaRequired(u.role) && !u.mfa_enabled,
  });
  const normEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
  const body = async (c: Context) => { try { return (await c.req.json()) as Record<string, unknown>; } catch { return {}; } };

  // ── Offentlige endepunkter ──────────────────────────────────────────────────
  app.get('/api/health', async (c) => {
    try { await db.query('SELECT 1'); return c.json({ ok: true }); }
    catch { return c.json({ ok: false }, 503); }
  });

  app.post('/api/auth/login', async (c) => {
    const b = await body(c);
    const email = normEmail(b.email);
    const password = typeof b.password === 'string' ? b.password : '';
    const from = ip(c);
    const since = new Date(now() - LOCK_WINDOW_MIN * 60e3);
    const [byEmail, byIp] = await Promise.all([
      db.query<{ n: string }>('SELECT count(*)::text AS n FROM login_events WHERE email = $1 AND success = false AND at > $2', [email, since]),
      db.query<{ n: string }>('SELECT count(*)::text AS n FROM login_events WHERE ip = $1 AND success = false AND at > $2', [from, since]),
    ]);
    if (Number(byEmail.rows[0].n) >= MAX_FAILS_EMAIL || Number(byIp.rows[0].n) >= MAX_FAILS_IP) {
      await db.query('INSERT INTO login_events(at, email, success, reason, ip) VALUES ($4,$1,false,$2,$3)', [email, 'sperret', from, new Date(now())]);
      return err(c, 429, `For mange mislykkede forsøk. Prøv igjen om ${LOCK_WINDOW_MIN} minutter.`);
    }
    const u = (await db.query<User & { password_hash: string | null }>('SELECT * FROM users WHERE email = $1', [email])).rows[0];
    const ok = await verifyPassword(password, u?.password_hash ?? null);
    if (!u || !ok || !u.active) {
      await db.query('INSERT INTO login_events(at, email, user_id, success, reason, ip) VALUES ($5,$1,$2,false,$3,$4)',
        [email, u?.id ?? null, !u ? 'ukjent bruker' : !ok ? 'feil passord' : 'deaktivert', from, new Date(now())]);
      return err(c, 401, 'Feil e-post eller passord.');
    }
    if ((u as any).mfa_enabled) {
      const token = newToken();
      await db.query('DELETE FROM mfa_challenges WHERE user_id = $1', [u.id]);
      await db.query('INSERT INTO mfa_challenges(token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), u.id, new Date(now() + MFA_CHALLENGE_TTL_MS)]);
      setCookie(c, mfaCookie, token, { path: '/', httpOnly: true, secure: o.secureCookies, sameSite: 'Strict', maxAge: MFA_CHALLENGE_TTL_MS / 1000 });
      return c.json({ mfa_required: true });
    }
    await db.query('INSERT INTO login_events(at, email, user_id, success, reason, ip) VALUES ($5,$1,$2,true,$3,$4)', [email, u.id, '', from, new Date(now())]);
    await startSession(c, u.id);
    return c.json({ user: publicUser(u) });
  });

  // ── Tofaktor: steg 2 i innlogging ──────────────────────────────────────────
  app.post('/api/auth/mfa/verify', async (c) => {
    const token = getCookie(c, mfaCookie);
    const code = String((await body(c)).code ?? '');
    if (!token) return err(c, 401, 'Innloggingen er utløpt. Start på nytt.');
    const ch = (await db.query<{ user_id: string; expires_at: Date; attempts: number }>('SELECT * FROM mfa_challenges WHERE token_hash = $1', [sha256(token)])).rows[0];
    if (!ch || new Date(ch.expires_at).getTime() < now() || ch.attempts >= MFA_MAX_ATTEMPTS) {
      if (ch) await db.query('DELETE FROM mfa_challenges WHERE token_hash = $1', [sha256(token)]);
      deleteCookie(c, mfaCookie, { path: '/', secure: o.secureCookies });
      return err(c, 401, 'Innloggingen er utløpt eller sperret. Start på nytt.');
    }
    const u = (await db.query<User & { mfa_secret_enc: string; mfa_last_step: string | null; mfa_enabled: boolean }>('SELECT * FROM users WHERE id = $1', [ch.user_id])).rows[0];
    let ok = false; let method = 'kode';
    if (u?.active && u.mfa_secret_enc && o.mfaKey) {
      const step = verifyTotp(decryptSecret(u.mfa_secret_enc, o.mfaKey), code, now(), u.mfa_last_step === null ? null : Number(u.mfa_last_step));
      if (step !== null) { ok = true; await db.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [u.id, step]); }
      else if (normalizeRecovery(code).length === 8) {
        const r = await db.query('UPDATE mfa_recovery_codes SET used_at = $3 WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING 1', [u.id, sha256(normalizeRecovery(code)), new Date(now())]);
        if (r.rows.length) { ok = true; method = 'reservekode'; }
      }
    }
    if (!ok) {
      await db.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = $1', [sha256(token)]);
      await db.query('INSERT INTO login_events(at, email, user_id, success, reason, ip) VALUES ($4,$1,$2,false,$3,$5)', [u?.email ?? '', ch.user_id, 'feil tofaktorkode', new Date(now()), ip(c)]);
      return err(c, 401, 'Feil kode. Prøv igjen.');
    }
    await db.query('DELETE FROM mfa_challenges WHERE user_id = $1', [u.id]);
    deleteCookie(c, mfaCookie, { path: '/', secure: o.secureCookies });
    await db.query('INSERT INTO login_events(at, email, user_id, success, reason, ip) VALUES ($4,$1,$2,true,$3,$5)', [u.email, u.id, method === 'reservekode' ? 'med reservekode' : '', new Date(now()), ip(c)]);
    if (method === 'reservekode') await audit(u, 'mfa.recovery_code_used', 'Innlogging med reservekode');
    await startSession(c, u.id);
    return c.json({ user: publicUser(u) });
  });

  app.get('/api/auth/invite', async (c) => {
    const token = c.req.query('token') ?? '';
    const row = (await db.query<{ email: string; name: string }>(
      `SELECT u.email, u.name FROM invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > $2 AND u.active`, [sha256(token), new Date(now())])).rows[0];
    if (!row) return err(c, 404, 'Lenken er ugyldig eller utløpt. Be om en ny.');
    return c.json(row);
  });

  app.post('/api/auth/accept-invite', async (c) => {
    const b = await body(c);
    const token = typeof b.token === 'string' ? b.token : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const row = (await db.query<User>(
      `SELECT u.* FROM invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > $2 AND u.active`, [sha256(token), new Date(now())])).rows[0];
    if (!row) return err(c, 404, 'Lenken er ugyldig eller utløpt. Be om en ny.');
    const problem = passwordProblem(password, row.email);
    if (problem) return err(c, 400, problem);
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 100) : row.name;
    await db.query('UPDATE users SET password_hash = $2, name = $3 WHERE id = $1', [row.id, await hashPassword(password), name]);
    await db.query('UPDATE invites SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL', [row.id, new Date(now())]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
    await audit(row, 'user.password_set', 'Passord satt via invitasjonslenke');
    await startSession(c, row.id);
    return c.json({ user: publicUser({ ...row, name }) });
  });

  // ── Innlogget ───────────────────────────────────────────────────────────────
  app.use('/api/auth/me', requireUser);
  app.get('/api/auth/me', (c) => c.json({ user: publicUser(c.get('user')) }));

  // ── Tofaktor: oppsett for innlogget bruker ─────────────────────────────────
  app.use('/api/auth/mfa/setup', requireUser);
  app.use('/api/auth/mfa/enable', requireUser);
  app.use('/api/auth/mfa/disable', requireUser);

  app.post('/api/auth/mfa/setup', async (c) => {
    const u = c.get('user');
    if (!o.mfaKey) return err(c, 409, 'Tofaktor er ikke konfigurert på serveren (MFA_ENCRYPTION_KEY mangler).');
    if (u.mfa_enabled) return err(c, 409, 'Tofaktor er allerede på.');
    const secret = newTotpSecret();
    await db.query('UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1', [u.id, encryptSecret(secret, o.mfaKey)]);
    const uri = otpauthUri(secret, u.email, o.issuer ?? 'Agentkontoret');
    return c.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  });

  app.post('/api/auth/mfa/enable', async (c) => {
    const u = c.get('user');
    if (!o.mfaKey) return err(c, 409, 'Tofaktor er ikke konfigurert på serveren.');
    const row = (await db.query<{ mfa_pending_secret_enc: string | null }>('SELECT mfa_pending_secret_enc FROM users WHERE id = $1', [u.id])).rows[0];
    if (!row?.mfa_pending_secret_enc) return err(c, 400, 'Start oppsettet på nytt.');
    const step = verifyTotp(decryptSecret(row.mfa_pending_secret_enc, o.mfaKey), String((await body(c)).code ?? ''), now(), null);
    if (step === null) return err(c, 400, 'Feil kode. Sjekk at klokken på telefonen er riktig, og prøv igjen.');
    const codes = newRecoveryCodes();
    await db.query('UPDATE users SET mfa_enabled = true, mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_last_step = $2 WHERE id = $1', [u.id, step]);
    await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [u.id]);
    for (const code of codes) await db.query('INSERT INTO mfa_recovery_codes(user_id, code_hash) VALUES ($1,$2)', [u.id, sha256(normalizeRecovery(code))]);
    // Andre sesjoner logges ut. Denne beholdes.
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, c.get('sessionHash')]);
    await audit(u, 'mfa.enabled', 'Tofaktor slått på');
    return c.json({ recovery_codes: codes });
  });

  app.post('/api/auth/mfa/disable', async (c) => {
    const u = c.get('user');
    if (mfaRequired(u.role)) return err(c, 403, 'Tofaktor er påkrevd for din rolle.');
    if (!u.mfa_enabled || !o.mfaKey) return err(c, 400, 'Tofaktor er ikke på.');
    const row = (await db.query<{ mfa_secret_enc: string; mfa_last_step: string | null }>('SELECT mfa_secret_enc, mfa_last_step FROM users WHERE id = $1', [u.id])).rows[0];
    const step = verifyTotp(decryptSecret(row.mfa_secret_enc, o.mfaKey), String((await body(c)).code ?? ''), now(), row.mfa_last_step === null ? null : Number(row.mfa_last_step));
    if (step === null) return err(c, 400, 'Feil kode.');
    await db.query('UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = NULL WHERE id = $1', [u.id]);
    await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [u.id]);
    await audit(u, 'mfa.disabled', 'Tofaktor slått av av brukeren');
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', async (c) => {
    if (await loadSession(c)) await db.query('DELETE FROM sessions WHERE token_hash = $1', [c.get('sessionHash')]);
    deleteCookie(c, cookieName, { path: '/', secure: o.secureCookies });
    return c.json({ ok: true });
  });

  // ── Superadministrator ──────────────────────────────────────────────────────
  app.use('/api/admin/*', requireUser, requireSuperadmin);

  app.get('/api/admin/users', async (c) => {
    const rows = (await db.query(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at, u.last_login_at,
              (u.password_hash IS NOT NULL) AS has_password, u.mfa_enabled,
              EXISTS (SELECT 1 FROM invites i WHERE i.user_id = u.id AND i.used_at IS NULL AND i.expires_at > now()) AS pending_invite,
              (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
       FROM users u ORDER BY u.role DESC, u.created_at`)).rows;
    return c.json({ users: rows });
  });

  app.post('/api/admin/users', async (c) => {
    const actor = c.get('user');
    const b = await body(c);
    const email = normEmail(b.email);
    const role = b.role === 'superadmin' ? 'superadmin' : 'owner';
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(c, 400, 'Ugyldig e-postadresse.');
    const exists = (await db.query('SELECT 1 FROM users WHERE email = $1', [email])).rows.length;
    if (exists) return err(c, 409, 'Brukeren finnes allerede.');
    const id = randomUUID();
    await db.query('INSERT INTO users(id, email, name, role, tenant_id) VALUES ($1,$2,$3,$4,$5)', [id, email, name, role, o.tenantId]);
    const invite = await createInvite(id);
    await audit(actor, 'user.created', `${email} (${role})`);
    return c.json({ id, invite });
  });

  app.post('/api/admin/users/:id/invite', async (c) => {
    const actor = c.get('user');
    const id = c.req.param('id');
    const u = (await db.query<User>('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!u) return err(c, 404, 'Fant ikke brukeren.');
    await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await db.query('UPDATE users SET password_hash = NULL, mfa_enabled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_last_step = NULL WHERE id = $1', [id]);
    await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [id]);
    const invite = await createInvite(id);
    await audit(actor, 'user.invite_reset', `${u.email}: ny lenke, passord, tofaktor og sesjoner nullstilt`);
    return c.json({ invite });
  });

  app.post('/api/admin/users/:id/active', async (c) => {
    const actor = c.get('user');
    const id = c.req.param('id');
    const active = (await body(c)).active === true;
    if (id === actor.id && !active) return err(c, 400, 'Du kan ikke deaktivere deg selv.');
    const u = (await db.query<User>('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!u) return err(c, 404, 'Fant ikke brukeren.');
    await db.query('UPDATE users SET active = $2 WHERE id = $1', [id, active]);
    if (!active) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(actor, active ? 'user.activated' : 'user.deactivated', u.email);
    return c.json({ ok: true });
  });

  app.post('/api/admin/users/:id/mfa-reset', async (c) => {
    const actor = c.get('user');
    const id = c.req.param('id');
    const u = (await db.query<User>('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!u) return err(c, 404, 'Fant ikke brukeren.');
    await db.query('UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_last_step = NULL WHERE id = $1', [id]);
    await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(actor, 'mfa.reset', `${u.email}: tofaktor nullstilt av superadministrator`);
    return c.json({ ok: true });
  });

  app.get('/api/admin/login-events', async (c) => {
    const rows = (await db.query('SELECT at, email, success, reason, ip FROM login_events ORDER BY at DESC LIMIT 100')).rows;
    return c.json({ events: rows });
  });

  app.get('/api/admin/audit', async (c) => {
    const rows = (await db.query('SELECT at, actor_email, action, detail FROM audit_log ORDER BY at DESC LIMIT 100')).rows;
    return c.json({ entries: rows });
  });

  app.get('/api/admin/status', async (c) => {
    let dbOk = true;
    try { await db.query('SELECT 1'); } catch { dbOk = false; }
    const counts = (await db.query<{ users: number; sessions: number }>(
      'SELECT (SELECT count(*)::int FROM users WHERE active) AS users, (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions')).rows[0];
    return c.json({
      version: o.version ?? 'lokal', started_at: new Date(startedAt).toISOString(), server_time: new Date(now()).toISOString(),
      database: dbOk ? 'ok' : 'feil', ...counts,
      mfa: { required_roles: o.mfaRequiredRoles ?? [], configured: !!o.mfaKey },
      integrations: { microsoft365: 'ikke koblet til', ai: 'ikke koblet til', health_reporting: process.env.AGENT_DASHBOARD_URL ? 'konfigurert' : 'ikke konfigurert' },
    });
  });

  app.all('/api/*', (c) => err(c, 404, 'Ukjent endepunkt.'));

  return { app, createInvite };
}

/**
 * Oppretter superadministrator ved første oppstart. Engangslenken skrives til loggen.
 * Gjør ingenting hvis brukeren allerede har passord eller har en gyldig lenke.
 */
export async function bootstrapSuperadmin(db: Db, email: string | undefined, tenantId: string,
  createInvite: (userId: string) => Promise<{ url: string; expiresAt: string }>, log = console.log): Promise<void> {
  if (!email) return;
  const e = email.trim().toLowerCase();
  let u = (await db.query<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE email = $1', [e])).rows[0];
  if (u?.password_hash) return;
  if (!u) {
    const id = randomUUID();
    await db.query("INSERT INTO users(id, email, name, role, tenant_id) VALUES ($1,$2,'','superadmin',$3)", [id, e, tenantId]);
    u = { id, password_hash: null };
  }
  const pending = (await db.query('SELECT 1 FROM invites WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()', [u.id])).rows.length;
  if (pending) return;
  const inv = await createInvite(u.id);
  log(JSON.stringify({ level: 'info', component: 'bootstrap', msg: 'Engangslenke for superadministrator', email: e, url: inv.url, expires_at: inv.expiresAt }));
}
