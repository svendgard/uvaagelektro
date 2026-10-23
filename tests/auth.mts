// Tester innlogging, roller og brukeradministrasjon mot en Postgres i minnet (PGlite).
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate, type Db } from '../server/db.ts';
import { createApp, bootstrapSuperadmin } from '../server/app.ts';

const pg = await PGlite.create();
const db: Db = { query: (sql, params) => pg.query(sql, params as any[]) as any };
await migrate(db);
await migrate(db); // idempotent
let clock = Date.now();
const APP = 'https://agentkontoret.test';
const { app, createInvite } = createApp({ db, appUrl: APP, secureCookies: true, tenantId: 'uvaag-elektro', now: () => clock });

let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'content-type': 'application/json', 'x-requested-with': 'agentkontoret', origin: APP, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (method === 'GET') { delete h['content-type']; }
    const res = await app.request(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) {
      const m = sc.match(/(__Host-ak_session)=([^;]*)/);
      if (m) this.cookie = m[2] && !/Max-Age=0/i.test(sc) ? `${m[1]}=${m[2]}` : '';
    }
    let json: any = null; try { json = await res.json(); } catch { /* tom */ }
    return { status: res.status, json, headers: res.headers, setCookie: sc };
  }
}
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

// Bootstrap
const logged: string[] = [];
await bootstrapSuperadmin(db, 'Jorgen@Example.no', 'uvaag-elektro', createInvite, (l) => logged.push(l));
await bootstrapSuperadmin(db, 'jorgen@example.no', 'uvaag-elektro', createInvite, (l) => logged.push(l));
assert.equal(logged.length, 1);
const bootUrl = JSON.parse(logged[0]).url as string;
assert.ok(bootUrl.startsWith(`${APP}/invitasjon?token=`));
ok('Superadmin opprettes ved første oppstart, lenken logges én gang');

// Uinnlogget
const anon = new Client();
assert.equal((await anon.req('GET', '/api/auth/me')).status, 401);
assert.equal((await anon.req('GET', '/api/admin/users')).status, 401);
ok('Uinnlogget får 401 på data og admin');

// CSRF
assert.equal((await anon.req('POST', '/api/auth/login', { email: 'x', password: 'y' }, { 'x-requested-with': '' })).status, 403);
assert.equal((await anon.req('POST', '/api/auth/login', { email: 'x', password: 'y' }, { origin: 'https://evil.example' })).status, 403);
ok('Endrende kall uten riktig header eller med fremmed Origin avvises');

// Invitasjon: svakt passord, så ok
const sa = new Client();
assert.equal((await sa.req('GET', `/api/auth/invite?token=${tokenOf(bootUrl)}`)).json.email, 'jorgen@example.no');
assert.equal((await sa.req('POST', '/api/auth/accept-invite', { token: tokenOf(bootUrl), password: 'kort' })).status, 400);
assert.equal((await sa.req('POST', '/api/auth/accept-invite', { token: tokenOf(bootUrl), password: 'jorgen-er-flink-123' })).status, 400);
const acc = await sa.req('POST', '/api/auth/accept-invite', { token: tokenOf(bootUrl), password: 'Lang og trygg setning 42', name: 'Jørgen' });
assert.equal(acc.status, 200);
assert.match(acc.setCookie!, /HttpOnly/i); assert.match(acc.setCookie!, /Secure/i); assert.match(acc.setCookie!, /SameSite=Strict/i);
assert.equal((await sa.req('GET', '/api/auth/me')).json.user.role, 'superadmin');
assert.equal((await new Client().req('POST', '/api/auth/accept-invite', { token: tokenOf(bootUrl), password: 'Lang og trygg setning 43' })).status, 404);
ok('Engangslenke: passordkrav, sikker cookie, kan ikke brukes to ganger');

// Superadmin oppretter Espen
const created = await sa.req('POST', '/api/admin/users', { email: 'espen@uvaagelektro.no', name: 'Espen Uvaag', role: 'owner' });
assert.equal(created.status, 200);
assert.equal((await sa.req('POST', '/api/admin/users', { email: 'ESPEN@uvaagelektro.no' })).status, 409);
const espen = new Client();
assert.equal((await espen.req('POST', '/api/auth/accept-invite', { token: tokenOf(created.json.invite.url), password: 'Strømmen går i kabelen 7' })).status, 200);
assert.equal((await espen.req('GET', '/api/auth/me')).json.user.role, 'owner');
assert.equal((await espen.req('GET', '/api/admin/users')).status, 403);
ok('Superadmin oppretter eier. Eier har ikke admintilgang.');

// Utlogging og innlogging
await espen.req('POST', '/api/auth/logout');
assert.equal((await espen.req('GET', '/api/auth/me')).status, 401);
assert.equal((await espen.req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: 'feil passord her' })).status, 401);
assert.equal((await espen.req('POST', '/api/auth/login', { email: 'Espen@UvaagElektro.no', password: 'Strømmen går i kabelen 7' })).status, 200);
assert.equal((await espen.req('GET', '/api/auth/me')).status, 200);
ok('Utlogging sletter sesjonen. Innlogging virker, uavhengig av store bokstaver i e-post.');

// Brute force-sperre
clock += 16 * 60e3; // tidligere feil er utenfor vinduet
const att = new Client();
for (let i = 0; i < 5; i++) assert.equal((await att.req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: `gjett ${i}` })).status, 401);
assert.equal((await att.req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: 'Strømmen går i kabelen 7' })).status, 429);
clock += 16 * 60e3;
assert.equal((await att.req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: 'Strømmen går i kabelen 7' })).status, 200);
ok('5 feil gir sperre i 15 minutter, også for riktig passord');

// Ukjent bruker og riktig bruker gir samme feilmelding
const u1 = await new Client().req('POST', '/api/auth/login', { email: 'finnes.ikke@x.no', password: 'noe passord her' });
const u2 = await new Client().req('POST', '/api/auth/login', { email: 'jorgen@example.no', password: 'noe passord her' });
assert.equal(u1.json.error, u2.json.error);
ok('Feilmeldingen avslører ikke om kontoen finnes');

// Deaktivering
const users = (await sa.req('GET', '/api/admin/users')).json.users;
const espenId = users.find((u: any) => u.email === 'espen@uvaagelektro.no').id;
const saId = users.find((u: any) => u.role === 'superadmin').id;
assert.equal((await sa.req('POST', `/api/admin/users/${saId}/active`, { active: false })).status, 400);
await sa.req('POST', `/api/admin/users/${espenId}/active`, { active: false });
assert.equal((await espen.req('GET', '/api/auth/me')).status, 401);
assert.equal((await new Client().req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: 'Strømmen går i kabelen 7' })).status, 401);
await sa.req('POST', `/api/admin/users/${espenId}/active`, { active: true });
ok('Deaktivering logger ut og stenger. Superadmin kan ikke deaktivere seg selv.');

// Ny lenke nullstiller passord og sesjoner
const espen2 = new Client();
await espen2.req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: 'Strømmen går i kabelen 7' });
const reset = await sa.req('POST', `/api/admin/users/${espenId}/invite`);
assert.equal((await espen2.req('GET', '/api/auth/me')).status, 401);
assert.equal((await new Client().req('POST', '/api/auth/login', { email: 'espen@uvaagelektro.no', password: 'Strømmen går i kabelen 7' })).status, 401);
assert.equal((await espen2.req('POST', '/api/auth/accept-invite', { token: tokenOf(reset.json.invite.url), password: 'Nytt og langt passord 99' })).status, 200);
ok('Ny lenke nullstiller passord og logger ut alle sesjoner');

// Utløp
clock += 25 * 3600e3;
assert.equal((await espen2.req('GET', '/api/auth/me')).status, 401);
const inv = await sa.req('POST', '/api/admin/users', { email: 'ny@uvaagelektro.no' });
assert.equal(inv.status, 401); // superadmin også utløpt etter 24 t uten aktivitet
ok('Sesjon utløper etter 24 timer uten aktivitet');

// Lenke utløper etter 72 t
const sa2 = new Client();
await sa2.req('POST', '/api/auth/login', { email: 'jorgen@example.no', password: 'Lang og trygg setning 42' });
const inv2 = await sa2.req('POST', '/api/admin/users', { email: 'ny@uvaagelektro.no' });
clock += 73 * 3600e3;
assert.equal((await new Client().req('POST', '/api/auth/accept-invite', { token: tokenOf(inv2.json.invite.url), password: 'Gyldig langt passord 1' })).status, 404);
ok('Engangslenke utløper etter 72 timer');

// Sikkerhetsheadere, revisjonslogg og helse
const h = (await new Client().req('GET', '/api/health')).headers;
assert.match(h.get('content-security-policy')!, /frame-ancestors 'none'/);
assert.equal(h.get('x-robots-tag'), 'noindex, nofollow');
assert.ok(h.get('strict-transport-security'));
await sa2.req('POST', '/api/auth/login', { email: 'jorgen@example.no', password: 'Lang og trygg setning 42' });
const audit = (await sa2.req('GET', '/api/admin/audit')).json.entries.map((e: any) => e.action);
assert.ok(audit.includes('user.created') && audit.includes('user.deactivated') && audit.includes('user.invite_reset'));
const events = (await sa2.req('GET', '/api/admin/login-events')).json.events;
assert.ok(events.some((e: any) => e.reason === 'sperret'));
const pw = (await pg.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'jorgen@example.no'")).rows[0].password_hash;
assert.ok(pw.startsWith('scrypt$') && !pw.includes('Lang og trygg'));
const tok = (await pg.query<{ token_hash: string }>('SELECT token_hash FROM sessions LIMIT 1')).rows[0].token_hash;
assert.match(tok, /^[0-9a-f]{64}$/);
ok('Sikkerhetsheadere, revisjonslogg, innloggingslogg. Passord og tokens lagres bare som hash.');

console.log(`\n${pass} av 13 tester bestått`);
process.exit(0);
