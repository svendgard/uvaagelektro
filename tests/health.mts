// Tester helserapportering mot en lokal etterligning av Agent Dashboard-API-et.
// Payloads valideres med dashboardets egen schema (kopi i tests/fixtures).
import http from 'node:http';
import assert from 'node:assert/strict';
import { reportSchema } from './fixtures/dashboardSchema.ts';
import { HealthReporter, buildReport, healthReporterFromEnv } from '../server/health/healthReporter.ts';

const KEY = 'k'.repeat(40);
const received: { body: string; json: any }[] = [];
let configBody: any = { schema_version: 1, config_version: 1, source: 'agentkontoret', agents: [{ agent_id: 'agentkontoret-uvaag-epost', reporting_enabled: true, report_interval_seconds: 1800 }] };
let configStatus = 200;
let reportStatuses: number[] = [];
const seen = new Map<string, string>();

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end('{}'); return; }
  if (req.method === 'GET' && req.url === '/api/v1/config') {
    res.writeHead(configStatus, { 'content-type': 'application/json' }).end(JSON.stringify(configBody)); return;
  }
  if (req.method === 'POST' && req.url === '/api/v1/health-reports') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const json = JSON.parse(b);
      received.push({ body: b, json });
      const forced = reportStatuses.shift();
      if (forced) { res.writeHead(forced).end('{"error":"forced"}'); return; }
      const v = reportSchema.safeParse(json);
      if (!v.success) { res.writeHead(400).end(JSON.stringify(v.error.issues)); return; }
      if (json.source !== 'agentkontoret') { res.writeHead(403).end('{}'); return; }
      const prev = seen.get(json.report_id);
      if (prev && prev !== b) { res.writeHead(409).end('{}'); return; }
      seen.set(json.report_id, b);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ report_id: json.report_id, accepted_at: new Date().toISOString(), duplicate: !!prev }));
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const logs: string[] = [];
const logger = { info: (m: string) => logs.push(`I ${m}`), warn: (m: string) => logs.push(`W ${m}`), error: (m: string) => logs.push(`E ${m}`) };

let latest: any = null;
const make = (extra: any = {}) => new HealthReporter({
  baseUrl: base + '/', apiKey: KEY, source: 'agentkontoret', logger, backoffMs: () => 10,
  agents: [{ agentId: 'agentkontoret-uvaag-epost', latestDeliveredScan: async () => latest }], ...extra,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const ok = (name: string) => { pass++; console.log(`  ✓ ${name}`); };

// 1. Oppstart uten historikk: config hentes, rapport med last_delivered_scan=null
{
  const r = make(); await r.start(); await wait(100); r.stop();
  assert.equal(received.length, 1);
  assert.equal(received[0].json.last_delivered_scan, null);
  assert.ok(reportSchema.safeParse(received[0].json).success);
  ok('Oppstart: henter konfigurasjon og sender rapport med null-skann');
}

// 2. Etter leveranse: rapporten inneholder siste kjøring og er gyldig
{
  received.length = 0;
  const now = Date.now();
  latest = { scan_run_id: 'mail-sync-a1', started_at: new Date(now - 4000), completed_at: new Date(now - 2000), persisted_at: new Date(now - 1000) };
  const r = make(); await r.refreshConfig(); r.notifyDelivered('agentkontoret-uvaag-epost'); await wait(100); r.stop();
  assert.equal(received.length, 1);
  assert.equal(received[0].json.last_delivered_scan.scan_run_id, 'mail-sync-a1');
  assert.ok(reportSchema.safeParse(received[0].json).success);
  ok('Etter leveranse: siste lagrede kjøring rapporteres');
}

// 3. Klokkeforskjell: persisted før completed, og persisted i fremtiden (under 60 s)
{
  const now = Date.now();
  const rep = buildReport({ agentId: 'a-b', source: 'agentkontoret', now, scan: { scan_run_id: 'x', started_at: new Date(now - 3000), completed_at: new Date(now - 1000), persisted_at: new Date(now - 2000) } });
  const s = rep.last_delivered_scan!;
  assert.ok(Date.parse(s.started_at) <= Date.parse(s.completed_at) && Date.parse(s.completed_at) <= Date.parse(s.persisted_at) && Date.parse(s.persisted_at) <= Date.parse(rep.reported_at));
  const rep2 = buildReport({ agentId: 'a-b', source: 'agentkontoret', now, scan: { scan_run_id: 'y', started_at: new Date(now), completed_at: new Date(now + 5000), persisted_at: new Date(now + 6000) } });
  assert.ok(Date.parse(rep2.reported_at) >= Date.parse(rep2.last_delivered_scan!.persisted_at));
  assert.ok(reportSchema.safeParse(rep2).success);
  assert.notEqual(rep.report_id, rep2.report_id);
  ok('Tidsrekkefølgen holder også ved klokkeforskjell, og hver rapport får ny UUID');
}

// 4. Retry ved 503: identisk payload og samme report_id
{
  received.length = 0; reportStatuses = [503, 503];
  const r = make(); await r.refreshConfig(); const out = await r.reportNow('agentkontoret-uvaag-epost'); r.stop();
  assert.equal(out, 'accepted');
  assert.equal(received.length, 3);
  assert.ok(received.every((x) => x.body === received[0].body));
  ok('503 gjentas med identisk payload og samme report_id');
}

// 5. 401/400/409 gjentas ikke
{
  received.length = 0; reportStatuses = [409];
  const r = make(); await r.refreshConfig(); const out = await r.reportNow('agentkontoret-uvaag-epost'); r.stop();
  assert.equal(out, 'failed'); assert.equal(received.length, 1);
  assert.ok(logs.some((l) => l.startsWith('E Dashboardet avviste')));
  ok('409 gjentas ikke, men logges som feil');
}

// 6. Gir opp etter maks forsøk
{
  received.length = 0; reportStatuses = [503, 503, 503, 503, 503];
  const r = make(); await r.refreshConfig(); const out = await r.reportNow('agentkontoret-uvaag-epost'); r.stop();
  assert.equal(out, 'failed'); assert.equal(received.length, 4); reportStatuses = [];
  ok('Begrenset retry: gir opp etter 4 forsøk');
}

// 7. reporting_enabled=false stopper rapportering
{
  received.length = 0;
  configBody.agents[0].reporting_enabled = false;
  const r = make(); await r.refreshConfig(); r.notifyDelivered('agentkontoret-uvaag-epost'); const out = await r.reportNow('agentkontoret-uvaag-epost'); r.stop();
  assert.equal(out, 'skipped'); assert.equal(received.length, 0);
  configBody.agents[0].reporting_enabled = true;
  ok('reporting_enabled=false respekteres');
}

// 8. Konfigurasjonsfeil: forrige gyldige konfigurasjon beholdes
{
  received.length = 0;
  const r = make(); await r.refreshConfig(); configStatus = 503; await r.refreshConfig();
  const out = await r.reportNow('agentkontoret-uvaag-epost'); r.stop(); configStatus = 200;
  assert.equal(out, 'accepted');
  ok('Ved feil i konfigurasjon brukes siste gyldige');
}

// 9. Dashboardet nede: ingenting kaster
{
  const r = new HealthReporter({ baseUrl: 'http://127.0.0.1:1', apiKey: KEY, source: 'agentkontoret', logger, backoffMs: () => 5, requestTimeoutMs: 500,
    agents: [{ agentId: 'agentkontoret-uvaag-epost', latestDeliveredScan: async () => { throw new Error('db nede'); } }] });
  await r.start(); r.notifyDelivered('agentkontoret-uvaag-epost'); await wait(200); r.stop();
  ok('Dashboard og database nede: ingen unntak lekker ut');
}

// 10. Mange triggere samtidig gir ikke overlapp
{
  received.length = 0; reportStatuses = [503];
  const r = make({ backoffMs: () => 80 }); await r.refreshConfig();
  for (let i = 0; i < 5; i++) r.notifyDelivered('agentkontoret-uvaag-epost');
  await wait(400); r.stop();
  const ids = new Set(received.map((x) => x.json.report_id));
  assert.equal(ids.size, 2, `forventet 2 rapporter, fikk ${ids.size}`);
  ok('Fem triggere under en rapport gir én oppfølgingsrapport, ikke overlapp');
}

// 11. Miljøvariabler
{
  assert.equal(healthReporterFromEnv([], { MONITORING_ENABLED: 'false', AGENT_DASHBOARD_URL: 'x', AGENT_DASHBOARD_API_KEY: 'y', AGENT_DASHBOARD_SOURCE: 'z' }, logger), null);
  assert.equal(healthReporterFromEnv([], {}, logger), null);
  assert.ok(healthReporterFromEnv([], { AGENT_DASHBOARD_URL: 'x', AGENT_DASHBOARD_API_KEY: 'y', AGENT_DASHBOARD_SOURCE: 'z' }, logger));
  ok('MONITORING_ENABLED=false og manglende variabler slår av rapportering uten feil');
}

// 12. Ingen persondata i payload
{
  const keys = new Set<string>();
  const walk = (o: any) => { for (const [k, v] of Object.entries(o ?? {})) { keys.add(k); if (v && typeof v === 'object') walk(v); } };
  walk(buildReport({ agentId: 'a-b', source: 's-s', now: Date.now(), scan: { scan_run_id: 'r', started_at: new Date(), completed_at: new Date(), persisted_at: new Date() } }));
  assert.deepEqual([...keys].sort(), ['agent_id', 'completed_at', 'last_delivered_scan', 'persisted_at', 'reported_at', 'report_id', 'scan_run_id', 'schema_version', 'source', 'started_at'].sort());
  ok('Payload inneholder bare felt fra kontrakten');
}

server.close();
console.log(`\n${pass} av 12 tester bestått`);
process.exit(0);
