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
