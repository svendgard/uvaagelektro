// Tester e-postflyten: tilkobling, synk, AI-sortering, utkast, skyggemodus, sending, svar fra Outlook, utløpt tilkobling.
// Microsoft og Anthropic er etterlignet med en falsk fetch. Ingen ekte e-post brukes.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrate, type Db } from '../server/db.ts';
import { createApp, bootstrapSuperadmin } from '../server/app.ts';
import { createMail } from '../server/mail.ts';
import { uvaagElektro } from '../src/config/tenant.ts';

const pg = await PGlite.create();
const db: Db = { query: (sql, params) => pg.query(sql, params as any[]) as any };
await migrate(db);
let clock = Date.parse('2026-10-23T10:00:00Z');
const APP = 'https://uvaagelektro.test';
const MS_TENANT = 'e5ffd32d-3bdd-4dd5-bcd3-8fd2ceb427b6';
const KEY = randomBytes(32).toString('base64');

// ── Falsk Microsoft + Anthropic ──────────────────────────────────────────────
const calls: { url: string; method: string; body?: string }[] = [];
let meMail = 'espen@uvaagelektro.no';
let tid = MS_TENANT;
let refreshFails = false;
let sendFails = false;
const inbox: any[] = [];
const sent: any[] = [];
const msg = (id: string, conv: string, from: string, name: string, subject: string, body: string, at: string, extra: any = {}) =>
  ({ id, conversationId: conv, subject, from: { emailAddress: { name, address: from } }, toRecipients: [{ emailAddress: { address: 'espen@uvaagelektro.no' } }], receivedDateTime: at, body: { contentType: 'text', content: body }, hasAttachments: false, isDraft: false, ...extra });
const idToken = () => `x.${Buffer.from(JSON.stringify({ tid, preferred_username: meMail })).toString('base64url')}.y`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch: typeof fetch = async (input: any, init: any = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  calls.push({ url, method, body: typeof init.body === 'string' ? init.body : undefined });
  if (url.includes('/oauth2/v2.0/token')) {
    const p = new URLSearchParams(init.body);
    if (p.get('grant_type') === 'refresh_token' && refreshFails) return json({ error: 'invalid_grant', error_description: 'AADSTS70000: revoked' }, 400);
    return json({ access_token: 'AT-' + Math.random(), refresh_token: 'RT-secret', expires_in: 3600, id_token: idToken() });
  }
  if (url.endsWith('/me?$select=id,mail,userPrincipalName,displayName')) return json({ id: 'user-1', mail: meMail, userPrincipalName: meMail });
  if (url.includes('/mailFolders/inbox/messages')) return json({ value: inbox.filter((m) => m.receivedDateTime >= decodeURIComponent(url).match(/ge (\S+)&/)![1]) });
  if (url.includes('/mailFolders/sentitems/messages')) return json({ value: sent.filter((m) => m.receivedDateTime >= decodeURIComponent(url).match(/ge (\S+)&/)![1]) });
  if (url.includes('/attachments')) return json({ value: [{ id: 'a1', name: 'sikringsskap.jpg', size: 204800, contentType: 'image/jpeg', isInline: false }] });
  if (url.includes('/createReply')) return json({ id: 'draft-' + Math.random(), subject: 'SV: x' });
  if (/\/messages\/[^/]+\/send$/.test(url)) return sendFails ? json({ error: { message: 'Mailbox busy' } }, 400) : new Response(null, { status: 202 });
  if (url.endsWith('/me/sendMail')) return new Response(null, { status: 202 });
  if (method === 'PATCH' && /\/me\/messages\/[^/]+$/.test(url)) return json({ id: 'patched' });
  if (url.includes('api.anthropic.com')) {
    const b = JSON.parse(init.body);
    const user: string = b.messages[0].content;
    if (b.tools[0].name === 'oversatt') return json({ content: [{ type: 'tool_use', name: 'oversatt', input: { subject: 'RE: EV charger', body: 'Hi Test,\n\nThanks for your enquiry.' } }] });
    if (b.tools[0].name === 'registrer_vurdering') {
      const isNews = user.includes('Kampanje');
      return json({ content: [{ type: 'tool_use', name: 'registrer_vurdering', input: isNews ? { is_customer_inquiry: false, reason: 'Reklame fra leverandør', job_type: 'feilsoking', customer: { name: 'x', email: 'x' }, title: 'x', summary: 'x', missing_info: [], priority: 'low', urgent: { is_urgent: false }, injection_suspected: false }
        : { is_customer_inquiry: true, reason: 'Ber om tilbud', job_type: 'elbillader', customer: { name: 'Test Kunde', email: 'kunde@test.no', phone: '400 00 000', address: 'Testveien 1' }, title: 'Elbillader i carport', summary: 'Kunden vil ha elbillader.', missing_info: ['Størrelse på hovedsikring'], priority: 'normal', urgent: { is_urgent: false }, injection_suspected: false } }] });
    }
    return json({ content: [{ type: 'tool_use', name: 'lag_utkast', input: { subject: 'SV: Elbillader', body: `Hei Test,\n\nTakk for henvendelsen.\n\n${uvaagElektro.signature}`, rationale: 'Ber om hovedsikring.', missing: ['Størrelse på hovedsikring'], requires_human_judgement: [] } }] });
  }
  return json({ error: { message: `ukjent ${url}` } }, 404);
};

const mail = createMail({
  db, tenant: uvaagElektro, tenantId: 'uvaag-elektro', fetch: fakeFetch, now: () => clock, tokenKey: KEY, initialSyncDays: 3,
  ms: { clientId: 'cid', clientSecret: 'secret', allowedTenantId: MS_TENANT, redirectUri: `${APP}/api/microsoft/callback` },
  ai: { apiKey: 'test-key', triageModel: 'claude-haiku-5-5', draftModel: 'claude-sonnet-5-5', fetch: fakeFetch },
  log: () => {},
});
const { app, createInvite } = createApp({ db, appUrl: APP, secureCookies: true, tenantId: 'uvaag-elektro', now: () => clock, extensions: [mail.routes] });

let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };
class Client {
  jar = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const h: Record<string, string> = { 'x-requested-with': 'agentkontoret', origin: APP };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.request(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const sc of (res.headers as any).getSetCookie?.() ?? []) { const m = sc.match(/^([^=]+)=([^;]*)/); if (m) { if (!m[2] || /Max-Age=0/i.test(sc)) this.jar.delete(m[1]); else this.jar.set(m[1], m[2]); } }
    let j: any = null; try { j = await res.clone().json(); } catch { /* */ }
    return { status: res.status, json: j, location: res.headers.get('location') };
  }
}

// Brukere
const logs: string[] = [];
await bootstrapSuperadmin(db, 'sa@techhaus.no', 'uvaag-elektro', createInvite, (l) => logs.push(l));
const sa = new Client();
await sa.req('POST', '/api/auth/accept-invite', { token: new URL(JSON.parse(logs[0]).url).searchParams.get('token'), password: 'Superhemmelig passord 1' });
const inv = await sa.req('POST', '/api/admin/users', { email: 'espen@uvaagelektro.no', role: 'owner', name: 'Espen Uvaag' });
const espen = new Client();
await espen.req('POST', '/api/auth/accept-invite', { token: new URL(inv.json.invite.url).searchParams.get('token'), password: 'Elektrikerens lange passord 2' });

// 1. Status før tilkobling
const st0 = (await espen.req('GET', '/api/mail/status')).json;
assert.equal(st0.connected, false); assert.equal(st0.configured, true);
assert.equal((await new Client().req('GET', '/api/state')).status, 401);
ok('Status og data krever innlogging. Ikke koblet til ennå.');

// 2. Tilkobling: feil konto avvises
const c1 = (await espen.req('POST', '/api/mail/connect')).json.url as string;
const u1 = new URL(c1);
assert.equal(u1.origin + u1.pathname, `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`);
assert.equal(u1.searchParams.get('code_challenge_method'), 'S256');
assert.match(u1.searchParams.get('scope')!, /Mail\.ReadWrite/);
meMail = 'privat@uvaagelektro.no';
const r1 = await espen.req('GET', `/api/microsoft/callback?code=abc&state=${u1.searchParams.get('state')}`);
assert.equal(r1.location, '/?microsoft=feil-konto');
ok('Innlogging med feil Microsoft-konto avvises');

// 3. Feil organisasjon avvises, gjenbrukt state avvises
meMail = 'espen@uvaagelektro.no'; tid = '11111111-1111-1111-1111-111111111111';
const u2 = new URL((await espen.req('POST', '/api/mail/connect')).json.url);
assert.equal((await espen.req('GET', `/api/microsoft/callback?code=abc&state=${u2.searchParams.get('state')}`)).location, '/?microsoft=feil-organisasjon');
assert.equal((await espen.req('GET', `/api/microsoft/callback?code=abc&state=${u2.searchParams.get('state')}`)).location, '/?microsoft=ugyldig');
tid = MS_TENANT;
ok('Feil organisasjon og gjenbrukt innloggingsforsøk avvises');

// 4. Riktig konto kobles til. Token lagres kryptert.
inbox.push(
  msg('m1', 'conv-1', 'kunde@test.no', 'Test Kunde', 'Elbillader', 'Hei, vi vil ha elbillader i carporten. Testveien 1. Tlf 400 00 000', '2026-10-22T08:00:00Z', { hasAttachments: true }),
  msg('m2', 'conv-2', 'salg@grossist.no', 'Grossist', 'Kampanje på kabel', 'Kampanje denne uken!', '2026-10-22T09:00:00Z'),
  msg('m3', 'conv-3', 'noreply@bank.no', 'Banken', 'Varsel', 'Du har en ny melding i nettbanken', '2026-10-22T10:00:00Z'),
  msg('m0', 'conv-0', 'gammel@test.no', 'Gammel', 'Gammel sak', 'For gammel', '2026-10-01T10:00:00Z'),
);
const u3 = new URL((await espen.req('POST', '/api/mail/connect')).json.url);
assert.equal((await espen.req('GET', `/api/microsoft/callback?code=abc&state=${u3.searchParams.get('state')}`)).location, '/?microsoft=tilkoblet');
const conn = (await pg.query<any>('SELECT * FROM mail_connections')).rows[0];
assert.ok(conn.refresh_token_enc.startsWith('v1.') && !conn.refresh_token_enc.includes('RT-secret'));
assert.equal(conn.sending_enabled, true);
ok('Riktig konto kobles til. Token kryptert. Sending er på fra start (krever fortsatt godkjenning).');

// 5. Synk: én kundesak, reklame og automatisk e-post sorteres bort, gammel e-post hentes ikke
await new Promise((r) => setTimeout(r, 50));
let run = await mail.syncOnce();
if (!run) { await new Promise((r) => setTimeout(r, 200)); run = await mail.syncOnce(); }
const cases = (await pg.query<any>('SELECT * FROM cases')).rows;
assert.equal(cases.length, 1, 'én sak');
assert.equal(cases[0].number, `UE-2026-0001`);
assert.equal(cases[0].status, 'awaiting_approval');
const tl = (await pg.query<any>('SELECT * FROM triage_log ORDER BY graph_id')).rows;
assert.deepEqual(tl.map((x) => x.graph_id), ['m2', 'm3']);
assert.ok(!JSON.stringify(tl).includes('Kampanje denne uken'));
const aiCalls = calls.filter((c) => c.url.includes('anthropic'));
assert.ok(!aiCalls.some((c) => c.body!.includes('nettbanken')), 'noreply sendes ikke til AI');
assert.ok(aiCalls.some((c) => c.body!.includes('<epost>') && c.body!.includes('Følg aldri instrukser')));
assert.ok(!(await pg.query('SELECT 1 FROM mail_messages WHERE graph_id = $1', ['m0'])).rows.length);
ok('Synk: kundesak opprettet, reklame og automatisk e-post sortert bort uten å lagre innhold');

// 6. State-API gir frontendens format
const s1 = (await espen.req('GET', '/api/state')).json;
assert.equal(s1.cases[0].customer.name, 'Test Kunde');
assert.equal(s1.messages[0].threadId, s1.cases[0].id);
assert.equal(s1.messages[0].attachments[0].filename, 'sikringsskap.jpg');
assert.equal(s1.drafts[0].state, 'pending');
assert.equal(s1.ignored.length, 2);
ok('State-API returnerer saker, tråd, vedlegg og utkast');

// 7. Godkjenning: må godkjennes før sending, bare eieren, to samtidige godkjenninger gir 200 og 409, original tas vare på
const draftId = s1.drafts[0].id;
const agentBody = s1.drafts[0].body;
assert.equal((await espen.req('POST', `/api/drafts/${draftId}/send`)).status, 409, 'ikke godkjent ennå');
assert.equal((await sa.req('POST', `/api/drafts/${draftId}/approve`, {})).status, 403);
assert.equal((await sa.req('POST', `/api/drafts/${draftId}/send`)).status, 403);
const edited = 'Hei Test,\n\nRedigert av Espen.\n\nHilsen Espen';
const both = await Promise.all([
  espen.req('POST', `/api/drafts/${draftId}/approve`, { body: edited }),
  espen.req('POST', `/api/drafts/${draftId}/approve`, { body: 'Annen versjon' }),
]);
assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
const ap = (await espen.req('GET', '/api/state')).json.drafts.find((d: any) => d.id === draftId);
assert.equal(ap.state, 'approved');
assert.equal(ap.original.body, agentBody, 'agentens original tas vare på');
assert.equal(ap.editedBy, 'espen@uvaagelektro.no');
assert.equal(ap.decidedBy, 'espen@uvaagelektro.no');
assert.ok(!calls.some((c) => c.url.includes('createReply')), 'godkjenning sender ingenting');
ok('Godkjenn: kreves før sending, bare eieren, dobbel godkjenning gir 200/409, original og redigerer lagres');

// 8. Send-kø: redigering til sending, skyggemodus stopper, redigert tekst og mottaker brukes, aldri dobbelt, ingen endring etter sending
assert.equal((await espen.req('PUT', `/api/drafts/${draftId}/text`, { email: 'ikke-en-epost' })).status, 400);
assert.equal((await espen.req('PUT', `/api/drafts/${draftId}/text`, { body: edited + '\nPS: Ring gjerne.', email: 'kunde2@test.no' })).status, 200);
assert.equal((await espen.req('POST', '/api/mail/settings', { sending_enabled: false })).status, 403);
assert.equal((await sa.req('POST', '/api/mail/settings', { sending_enabled: false })).status, 200);
assert.equal((await espen.req('POST', `/api/drafts/${draftId}/send`)).status, 409, 'skyggemodus');
assert.equal((await sa.req('POST', '/api/mail/settings', { sending_enabled: true })).status, 200);
const sendTwice = await Promise.all([espen.req('POST', `/api/drafts/${draftId}/send`), espen.req('POST', `/api/drafts/${draftId}/send`)]);
assert.deepEqual(sendTwice.map((r) => r.status).sort(), [200, 409]);
assert.equal((await espen.req('POST', `/api/drafts/${draftId}/send`)).status, 409);
const replies = calls.filter((c) => c.url.includes('/messages/m1/createReply'));
assert.equal(replies.length, 1);
assert.match(replies[0].body!, /Redigert av Espen\.[\s\S]*PS: Ring gjerne/);
assert.ok(calls.some((c) => c.method === 'PATCH' && c.body!.includes('kunde2@test.no')), 'ny mottaker settes');
assert.equal((await espen.req('PUT', `/api/drafts/${draftId}/text`, { body: 'for sent' })).status, 409);
assert.equal((await espen.req('POST', `/api/drafts/${draftId}/reject`, {})).status, 409);
const s2 = (await espen.req('GET', '/api/state')).json;
assert.equal(s2.cases[0].status, 'awaiting_customer');
assert.equal(s2.messages.filter((m: any) => m.direction === 'outbound').length, 1);
const sentDraft = s2.drafts.find((d: any) => d.id === draftId);
assert.equal(sentDraft.state, 'sent'); assert.equal(sentDraft.sentTo, 'kunde2@test.no'); assert.equal(sentDraft.sentBy, 'espen@uvaagelektro.no');
ok('Send: redigert tekst og mottaker brukes, skyggemodus stopper, aldri dobbeltsending, ingen endring etter sending');

// 9. Neste synk: vår sendte melding i Sendte elementer dupliseres ikke. Kunden svarer → nytt utkast.
sent.push(msg('s1', 'conv-1', 'espen@uvaagelektro.no', 'Espen', 'SV: Elbillader', 'Hei Test, Redigert av Espen.', '2026-10-23T10:00:30Z'));
inbox.push(msg('m4', 'conv-1', 'kunde@test.no', 'Test Kunde', 'SV: Elbillader', 'Vi har 63A hovedsikring.', '2026-10-23T10:30:00Z'));
clock = Date.parse('2026-10-23T10:31:00Z');
await mail.syncOnce();
const s3 = (await espen.req('GET', '/api/state')).json;
assert.equal(s3.messages.filter((m: any) => m.direction === 'outbound').length, 1, 'ingen duplikat');
assert.equal(s3.messages.filter((m: any) => m.direction === 'inbound').length, 2);
assert.equal(s3.cases[0].status, 'awaiting_approval');
assert.equal(s3.cases[0].unreadCustomerReply, true);
assert.equal(s3.drafts.filter((d: any) => d.state === 'pending')[0].version, 2);
ok('Kundesvar havner i samme sak med nytt utkast. Egen sendt e-post dupliseres ikke.');

// 10. Espen svarer fra Outlook i stedet: utkastet legges bort
sent.push(msg('s2', 'conv-1', 'espen@uvaagelektro.no', 'Espen', 'SV: Elbillader', 'Takk, vi kommer tirsdag.', '2026-10-23T10:40:00Z'));
clock = Date.parse('2026-10-23T10:41:00Z');
await mail.syncOnce();
const s4 = (await espen.req('GET', '/api/state')).json;
assert.equal(s4.drafts.filter((d: any) => d.state === 'pending').length, 0);
assert.equal(s4.cases[0].status, 'awaiting_customer');
assert.ok(s4.activities.some((a: any) => a.text.includes('fra Outlook')));
ok('Svar sendt fra Outlook knyttes til saken, og utkastet legges bort');

// 10b. Ny sak: oversettelse lagres ikke, «skriv på nytt» lager nytt utkast med kontekst, sendefeil frigjør reservasjonen, egen melding
inbox.push(msg('m5', 'conv-5', 'ny@test.no', 'Ny Kunde', 'Lys i stua', 'Hei, vi trenger nye spotter i stua.', '2026-10-23T10:45:00Z'));
clock = Date.parse('2026-10-23T10:46:00Z');
await mail.syncOnce();
let st5 = (await espen.req('GET', '/api/state')).json;
const d5 = st5.drafts.find((d: any) => d.state === 'pending' && d.caseId !== s1.cases[0].id);
assert.ok(d5, 'nytt utkast');
const tr = await espen.req('POST', `/api/drafts/${d5.id}/translate`, { language: 'en', subject: d5.subject, body: 'Hei Test,\n\nTakk for henvendelsen. (egen endring)' });
assert.equal(tr.status, 200); assert.equal(tr.json.language, 'en'); assert.match(tr.json.body, /Thanks/);
assert.equal((await espen.req('POST', `/api/drafts/${d5.id}/translate`, { language: 'xx', subject: '', body: '' })).status, 400);
const after = (await pg.query<any>('SELECT body, language, state FROM drafts WHERE id = $1', [d5.id])).rows[0];
assert.equal(after.body, d5.body); assert.equal(after.state, 'pending');
ok('Oversettelse returnerer tekst og lagrer ingenting');

const before = calls.length;
const rw = await espen.req('POST', `/api/drafts/${d5.id}/rewrite`, { feedback: 'kortere, og nevn befaring' });
assert.equal(rw.status, 200); assert.ok(rw.json.id && rw.json.id !== d5.id);
const rwCall = calls.slice(before).find((c) => c.url.includes('anthropic'))!;
assert.match(rwCall.body!, /forrige_utkast/); assert.match(rwCall.body!, /kortere, og nevn befaring/);
st5 = (await espen.req('GET', '/api/state')).json;
const old5 = st5.drafts.find((d: any) => d.id === d5.id);
assert.equal(old5.state, 'superseded'); assert.equal(old5.rewritten, true);
const new5 = st5.drafts.find((d: any) => d.id === rw.json.id);
assert.equal(new5.state, 'pending'); assert.equal(new5.version, d5.version + 1); assert.equal(new5.feedback, 'kortere, og nevn befaring');
assert.equal((await espen.req('POST', `/api/drafts/${d5.id}/approve`, {})).status, 409, 'gammelt utkast kan ikke godkjennes');
ok('Skriv på nytt: gammelt merkes, nytt utkast med forrige tekst og beskjed som kontekst');

assert.equal((await espen.req('POST', `/api/drafts/${new5.id}/approve`, {})).status, 200);
sendFails = true;
const failed = await espen.req('POST', `/api/drafts/${new5.id}/send`);
assert.equal(failed.status, 502);
const fr = (await pg.query<any>('SELECT state, sending_at, error FROM drafts WHERE id = $1', [new5.id])).rows[0];
assert.equal(fr.state, 'approved'); assert.equal(fr.sending_at, null); assert.match(fr.error, /Mailbox busy/);
sendFails = false;
assert.equal((await espen.req('POST', `/api/drafts/${new5.id}/send`)).status, 200);
ok('Sendefeil: reservasjonen fjernes, ingenting registreres som sendt, nytt forsøk virker');

const man = await espen.req('POST', `/api/cases/${new5.caseId}/manual`, { subject: 'SV: Lys i stua', body: 'Hei,\n\nVi kommer onsdag.\n\nEspen' });
assert.equal(man.status, 200);
const manDraft = (await espen.req('GET', '/api/state')).json.drafts.find((d: any) => d.id === man.json.id);
assert.equal(manDraft.state, 'approved'); assert.equal(manDraft.author, 'owner');
assert.equal((await espen.req('POST', `/api/drafts/${man.json.id}/send`)).status, 200);
const acts = (await espen.req('GET', '/api/state')).json.activities.map((a: any) => a.text).join('\n');
for (const w of ['godkjente', 'redigerte', 'skrev utkastet på nytt', 'sendte e-post', 'Sending feilet', 'skrev en melding selv']) assert.ok(acts.includes(w), `logget: ${w}`);
ok('Egen melding går via Send-køen. Alt logges: godkjent, redigert, skrevet på nytt, sendt, feilet.');

// 11. Synkroniseringsrunder registreres for helserapportering
const lastRun = await mail.latestDeliveredRun();
assert.ok(lastRun && lastRun.scan_run_id.startsWith('mail-sync-') && lastRun.persisted_at);
ok('Fullførte og lagrede synk-runder er tilgjengelige for helserapportering');

// 12. Utløpt tilkobling: status settes, synk stopper, ingen krasj
clock += 2 * 3600e3; refreshFails = true;
await mail.syncOnce();
const st = (await espen.req('GET', '/api/mail/status')).json;
assert.equal(st.status, 'reconnect_required'); assert.equal(st.connected, false);
assert.equal(await mail.syncOnce(), null);
ok('Utløpt Microsoft-tilkobling oppdages og vises. Synk stopper uten å krasje.');

console.log(`\n${pass} av 16 tester bestått`);
process.exit(0);
