// Tester tofaktor: oppsett, innlogging, reservekoder, påkrevd per rolle, nullstilling.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrate, type Db } from '../server/db.ts';
import { createApp, bootstrapSuperadmin, type Role } from '../server/app.ts';
import { totpAt, verifyTotp, base32Decode, base32Encode, encryptSecret, decryptSecret } from '../server/auth/totp.ts';

const pg = await PGlite.create();
const db: Db = { query: (sql, params) => pg.query(sql, params as any[]) as any };
await migrate(db);
let clock = Date.now();
const APP = 'https://agentkontoret.test';
const KEY = randomBytes(32).toString('base64');
let required: Role[] = [];
const make = () => createApp({ db, appUrl: APP, secureCookies: true, tenantId: 't', now: () => clock, mfaKey: KEY, mfaRequiredRoles: required });
let { app, createInvite } = make();

let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };
const step = () => Math.floor(clock / 30000);

class Client {
  jar = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const h: Record<string, string> = { 'x-requested-with': 'agentkontoret', origin: APP };
    if (body) h['content-type'] = 'application/json';
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.request(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    for (const sc of (res.headers as any).getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean)) {
      const m = sc.match(/^([^=]+)=([^;]*)/);
      if (m) { if (!m[2] || /Max-Age=0/i.test(sc)) this.jar.delete(m[1]); else this.jar.set(m[1], m[2]); }
    }
    let json: any = null; try { json = await res.json(); } catch { /* */ }
    return { status: res.status, json };
  }
}

// TOTP mot RFC 6238-testvektor (SHA-1, 8 siffer gir 94287082 ved T=59; 6 siffer = 287082)
assert.equal(totpAt(base32Encode(Buffer.from('12345678901234567890')), 1), '287082');
assert.equal(base32Decode(base32Encode(Buffer.from('hei på deg'))).toString(), 'hei på deg');
const enc = encryptSecret('JBSWY3DPEHPK3PXP', KEY);
assert.notEqual(enc, 'JBSWY3DPEHPK3PXP'); assert.equal(decryptSecret(enc, KEY), 'JBSWY3DPEHPK3PXP');
assert.equal(verifyTotp('JBSWY3DPEHPK3PXP', totpAt('JBSWY3DPEHPK3PXP', 100), 100 * 30000 + 5, 100), null);
ok('TOTP stemmer med RFC 6238, kryptering virker, gjenbrukt kode avvises');

// Opprett superadmin og eier
const logs: string[] = [];
await bootstrapSuperadmin(db, 'sa@x.no', 't', createInvite, (l) => logs.push(l));
const sa = new Client();
await sa.req('POST', '/api/auth/accept-invite', { token: new URL(JSON.parse(logs[0]).url).searchParams.get('token'), password: 'Superhemmelig passord 1' });
const inv = await sa.req('POST', '/api/admin/users', { email: 'espen@x.no', role: 'owner' });
const espen = new Client();
await espen.req('POST', '/api/auth/accept-invite', { token: new URL(inv.json.invite.url).searchParams.get('token'), password: 'Elektrikerens lange passord 2' });
assert.equal((await espen.req('GET', '/api/auth/me')).json.user.mfa_enabled, false);
ok('Uten krav: innlogging med bare passord, tofaktor av');

// Superadmin slår på tofaktor frivillig
const setup = await sa.req('POST', '/api/auth/mfa/setup');
assert.ok(setup.json.qr.startsWith('data:image/png;base64,'));
assert.match(setup.json.uri, /^otpauth:\/\/totp\//);
const secret = setup.json.secret as string;
assert.equal((await sa.req('POST', '/api/auth/mfa/enable', { code: '000000' })).status, 400);
const en = await sa.req('POST', '/api/auth/mfa/enable', { code: totpAt(secret, step()) });
assert.equal(en.status, 200); assert.equal(en.json.recovery_codes.length, 10);
const stored = (await pg.query<any>("SELECT mfa_secret_enc FROM users WHERE email='sa@x.no'")).rows[0].mfa_secret_enc;
assert.ok(stored.startsWith('v1.') && !stored.includes(secret));
ok('Oppsett: QR-kode, bekreftelse med kode, 10 reservekoder, hemmelighet lagret kryptert');

// Innlogging med tofaktor
const sa2 = new Client();
const l1 = await sa2.req('POST', '/api/auth/login', { email: 'sa@x.no', password: 'Superhemmelig passord 1' });
assert.equal(l1.json.mfa_required, true);
assert.equal((await sa2.req('GET', '/api/auth/me')).status, 401);
assert.equal((await sa2.req('POST', '/api/auth/mfa/verify', { code: '123456' })).status, 401);
clock += 31000;
const v = await sa2.req('POST', '/api/auth/mfa/verify', { code: totpAt(secret, step()) });
assert.equal(v.status, 200);
assert.equal((await sa2.req('GET', '/api/auth/me')).json.user.role, 'superadmin');
ok('Passord alene gir ikke tilgang. Riktig kode gir sesjon.');

// Samme kode kan ikke brukes igjen
const sa3 = new Client();
await sa3.req('POST', '/api/auth/login', { email: 'sa@x.no', password: 'Superhemmelig passord 1' });
assert.equal((await sa3.req('POST', '/api/auth/mfa/verify', { code: totpAt(secret, step()) })).status, 401);
ok('En brukt kode kan ikke brukes på nytt');

// Reservekode, én gang
const rc = en.json.recovery_codes[0] as string;
assert.equal((await sa3.req('POST', '/api/auth/mfa/verify', { code: rc.toUpperCase() })).status, 200);
const sa4 = new Client();
await sa4.req('POST', '/api/auth/login', { email: 'sa@x.no', password: 'Superhemmelig passord 1' });
assert.equal((await sa4.req('POST', '/api/auth/mfa/verify', { code: rc })).status, 401);
ok('Reservekode virker én gang');

// Sperre etter 5 feil koder
clock += 16 * 60e3;
const sa5 = new Client();
await sa5.req('POST', '/api/auth/login', { email: 'sa@x.no', password: 'Superhemmelig passord 1' });
for (let i = 0; i < 5; i++) await sa5.req('POST', '/api/auth/mfa/verify', { code: '000001' });
clock += 31000;
assert.equal((await sa5.req('POST', '/api/auth/mfa/verify', { code: totpAt(secret, step()) })).status, 401);
ok('Fem feil koder sperrer innloggingsforsøket');

// Påkrevd for eier: Espen må sette opp før han får gjøre noe annet
clock += 16 * 60e3;
required = ['owner'];
({ app } = make());
const e2 = new Client();
await e2.req('POST', '/api/auth/login', { email: 'espen@x.no', password: 'Elektrikerens lange passord 2' });
const me = (await e2.req('GET', '/api/auth/me')).json.user;
assert.equal(me.mfa_setup_required, true);
const s2 = await e2.req('POST', '/api/auth/mfa/setup');
clock += 31000;
assert.equal((await e2.req('POST', '/api/auth/mfa/enable', { code: totpAt(s2.json.secret, step()) })).status, 200);
assert.equal((await e2.req('GET', '/api/auth/me')).json.user.mfa_setup_required, false);
assert.equal((await e2.req('POST', '/api/auth/mfa/disable', { code: '000000' })).status, 403);
ok('Med krav for rollen må tofaktor settes opp, og kan ikke slås av');

// Superadmin nullstiller Espens tofaktor (mistet telefon)
clock += 16 * 60e3;
const sa6 = new Client();
await sa6.req('POST', '/api/auth/login', { email: 'sa@x.no', password: 'Superhemmelig passord 1' });
clock += 31000;
await sa6.req('POST', '/api/auth/mfa/verify', { code: totpAt(secret, step()) });
const users = (await sa6.req('GET', '/api/admin/users')).json.users;
const eid = users.find((u: any) => u.email === 'espen@x.no').id;
assert.equal(users.find((u: any) => u.email === 'espen@x.no').mfa_enabled, true);
assert.equal((await sa6.req('POST', `/api/admin/users/${eid}/mfa-reset`)).status, 200);
assert.equal((await e2.req('GET', '/api/auth/me')).status, 401);
const audit = (await sa6.req('GET', '/api/admin/audit')).json.entries.map((x: any) => x.action);
assert.ok(audit.includes('mfa.enabled') && audit.includes('mfa.reset') && audit.includes('mfa.recovery_code_used'));
ok('Superadmin kan nullstille tofaktor. Alt logges i revisjonsloggen.');

console.log(`\n${pass} av 9 tester bestått`);
process.exit(0);
