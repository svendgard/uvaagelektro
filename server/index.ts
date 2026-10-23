import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { pgDb, migrate } from './db';
import { createApp, bootstrapSuperadmin } from './app';
import { createMail } from './mail';
import { uvaagElektro } from '../src/config/tenant';
import { healthReporterFromEnv } from './health/healthReporter';

const env = process.env;
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, component: 'server', msg, ...extra }));

if (!env.DATABASE_URL) { log('error', 'DATABASE_URL mangler'); process.exit(1); }
const appUrl = env.APP_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const production = env.NODE_ENV === 'production';
const tenantId = env.TENANT_ID || 'uvaag-elektro';

const db = pgDb(env.DATABASE_URL);
await migrate(db);
const mfaRequiredRoles = (env.MFA_REQUIRED_ROLES ?? '').split(',').map((r) => r.trim()).filter((r): r is 'superadmin' | 'owner' => r === 'superadmin' || r === 'owner');
if (mfaRequiredRoles.length && !env.MFA_ENCRYPTION_KEY) { log('error', 'MFA_REQUIRED_ROLES er satt, men MFA_ENCRYPTION_KEY mangler'); process.exit(1); }
const tenant = uvaagElektro;
const msReady = !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
let health: ReturnType<typeof healthReporterFromEnv> = null;
const mail = createMail({
  db, tenant, tenantId,
  ms: msReady ? {
    clientId: env.MICROSOFT_CLIENT_ID!, clientSecret: env.MICROSOFT_CLIENT_SECRET!,
    allowedTenantId: env.MICROSOFT_ALLOWED_TENANT_ID || tenant.mail.msTenantId || 'organizations',
    redirectUri: `${appUrl.replace(/\/$/, '')}/api/microsoft/callback`,
  } : undefined,
  tokenKey: env.TOKEN_ENCRYPTION_KEY,
  ai: { apiKey: env.ANTHROPIC_API_KEY, triageModel: env.ANTHROPIC_TRIAGE_MODEL || 'claude-haiku-5-5', draftModel: env.ANTHROPIC_DRAFT_MODEL || 'claude-sonnet-5-5' },
  initialSyncDays: Number(env.INITIAL_SYNC_DAYS || 3),
  onDelivered: () => health?.notifyDelivered(tenant.monitoring.mailSyncAgentId),
});
const { app, createInvite } = createApp({
  db, appUrl, tenantId, secureCookies: production || appUrl.startsWith('https://'), version: env.RENDER_GIT_COMMIT?.slice(0, 7),
  mfaRequiredRoles, mfaKey: env.MFA_ENCRYPTION_KEY, issuer: 'Agentkontoret Uvaag Elektro',
  extensions: [mail.routes],
  integrations: async () => {
    const st = await mail.status();
    return {
      microsoft365: !st.configured ? 'ikke konfigurert' : st.connected ? `tilkoblet (${st.mailbox}${st.sending_enabled ? ', sending på' : ', skyggemodus'})` : st.status === 'reconnect_required' ? 'må kobles til på nytt' : 'ikke koblet til',
      ai: env.ANTHROPIC_API_KEY ? 'konfigurert' : 'ikke konfigurert (enkle regler brukes)',
      health_reporting: env.AGENT_DASHBOARD_URL ? 'konfigurert' : 'ikke konfigurert',
    };
  },
});
if (!msReady) log('warn', 'Microsoft-tilkobling er ikke konfigurert (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY)');
if (!env.ANTHROPIC_API_KEY) log('warn', 'ANTHROPIC_API_KEY mangler. Agentene bruker enkle regler.');

// Bakgrunnsjobb: synkroniser e-post hvert minutt. Én instans (Render starter), lås i minnet.
health = healthReporterFromEnv([{ agentId: tenant.monitoring.mailSyncAgentId, latestDeliveredScan: () => mail.latestDeliveredRun() }]);
void health?.start();
const tick = () => { mail.syncOnce().catch((e) => log('error', 'Synk-feil', { error: String(e) })); };
setInterval(tick, 60_000).unref?.();
setTimeout(tick, 5_000);
await bootstrapSuperadmin(db, env.BOOTSTRAP_SUPERADMIN_EMAIL, tenantId, createInvite);

// Frontend. Selve koden er offentlig, men inneholder ingen data. All data krever innlogging via /api.
const dist = './dist';
app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
app.use('/assets/*', serveStatic({ root: dist }));
app.use('/favicon.svg', serveStatic({ root: dist }));
const indexHtml = existsSync(`${dist}/index.html`) ? readFileSync(`${dist}/index.html`, 'utf8') : '<p>Bygg mangler. Kjør npm run build.</p>';
app.get('*', (c) => { c.header('Cache-Control', 'no-cache'); return c.html(indexHtml); });

const port = Number(env.PORT || 3000);
serve({ fetch: app.fetch, port }, () => log('info', 'Agentkontoret kjører', { port, app_url: appUrl, production }));
