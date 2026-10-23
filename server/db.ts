import pg from 'pg';

/** Minimalt databasegrensesnitt. Produksjon: pg Pool. Tester: PGlite. */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function pgDb(connectionString: string): Db & { end(): Promise<void> } {
  // Render sin interne adresse (dpg-xxx-a) går i privat nett og bruker ikke TLS.
  // Ekstern adresse (…render.com) krever TLS.
  const external = /\.render\.com[:/]/.test(connectionString);
  const pool = new pg.Pool({ connectionString, max: 5, ssl: external ? { rejectUnauthorized: true } : undefined });
  pool.on('error', (e) => console.error(JSON.stringify({ level: 'error', component: 'db', msg: 'Postgres-feil', error: String(e) })));
  return { query: (sql, params) => pool.query(sql, params as any[]) as any, end: () => pool.end() };
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('superadmin','owner')),
  tenant_id text NOT NULL,
  password_hash text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  user_id uuid,
  success boolean NOT NULL,
  reason text NOT NULL DEFAULT '',
  ip text
);
CREATE INDEX IF NOT EXISTS login_events_email_at ON login_events(email, at DESC);
CREATE INDEX IF NOT EXISTS login_events_ip_at ON login_events(ip, at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_email text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL DEFAULT ''
);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step bigint;
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0
);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS mail_connections (
  tenant_id text PRIMARY KEY,
  mailbox text NOT NULL,
  ms_tenant_id text NOT NULL,
  ms_user_id text NOT NULL,
  refresh_token_enc text,
  access_token_enc text,
  access_expires_at timestamptz,
  status text NOT NULL DEFAULT 'connected',
  last_error text,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  inbox_watermark timestamptz,
  sent_watermark timestamptz,
  last_sync_at timestamptz,
  sending_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_sync_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  persisted_at timestamptz,
  fetched integer NOT NULL DEFAULT 0,
  new_cases integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX IF NOT EXISTS mail_sync_runs_latest ON mail_sync_runs(tenant_id, persisted_at DESC);
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  number text NOT NULL,
  conversation_id text,
  title text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  job_type text NOT NULL,
  customer jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  missing_info jsonb NOT NULL DEFAULT '[]',
  flagged jsonb,
  assigned_agent text NOT NULL DEFAULT 'intake',
  unread boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cases_number ON cases(tenant_id, number);
CREATE INDEX IF NOT EXISTS cases_conversation ON cases(tenant_id, conversation_id);
CREATE TABLE IF NOT EXISTS mail_messages (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  graph_id text,
  conversation_id text,
  direction text NOT NULL,
  from_addr jsonb NOT NULL,
  to_addrs jsonb NOT NULL DEFAULT '[]',
  cc_addrs jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  delivery_state text,
  drafted_by text,
  approved_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_graph ON mail_messages(tenant_id, graph_id) WHERE graph_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_messages_case ON mail_messages(case_id, sent_at);
CREATE TABLE IF NOT EXISTS triage_log (
  tenant_id text NOT NULL,
  graph_id text NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL DEFAULT '',
  sender_domain text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, graph_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  author text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  missing jsonb NOT NULL DEFAULT '[]',
  judgement jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending',
  reply_to_graph_id text,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  error text
);
CREATE INDEX IF NOT EXISTS drafts_case ON drafts(case_id, created_at);
CREATE TABLE IF NOT EXISTS activities (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  case_id uuid REFERENCES cases(id) ON DELETE SET NULL,
  text text NOT NULL,
  tone text
);
CREATE INDEX IF NOT EXISTS activities_tenant_at ON activities(tenant_id, at DESC);
`,
  },
  {
    // Godkjenning og sending i to steg: forslag → godkjent (Send-kø) → sendt. Agentens original tas vare på.
    version: 4,
    sql: `
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS original_subject text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS original_body text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS edited_by text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS recipient text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'no';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS sending_at timestamptz;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS sent_by text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS feedback text;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS rewritten boolean NOT NULL DEFAULT false
`,
  },
];

export async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    for (const stmt of m.sql.split(';').map((x) => x.trim()).filter(Boolean)) await db.query(stmt);
    await db.query('INSERT INTO schema_migrations(version) VALUES ($1)', [m.version]);
  }
}
