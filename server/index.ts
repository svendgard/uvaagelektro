import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { pgDb, migrate } from './db';
import { createApp, bootstrapSuperadmin } from './app';

const env = process.env;
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, component: 'server', msg, ...extra }));

if (!env.DATABASE_URL) { log('error', 'DATABASE_URL mangler'); process.exit(1); }
const appUrl = env.APP_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const production = env.NODE_ENV === 'production';
const tenantId = env.TENANT_ID || 'uvaag-elektro';

const db = pgDb(env.DATABASE_URL);
await migrate(db);
const { app, createInvite } = createApp({
  db, appUrl, tenantId, secureCookies: production || appUrl.startsWith('https://'), version: env.RENDER_GIT_COMMIT?.slice(0, 7),
});
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
