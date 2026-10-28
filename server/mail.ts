import { randomUUID } from 'node:crypto';
import type { Hono, Context } from 'hono';
import type { Db } from './db';
import type { Env, Helpers } from './app';
import type { TenantConfig } from '../src/config/tenant';
import { decryptSecret, encryptSecret } from './auth/totp';
import { newToken, sha256 } from './auth/crypto';
import { Graph, MsAuthError, addr, authorizeUrl, exchangeCode, idTokenClaims, pkce, refreshTokens, type Fetch, type GraphMessage, type MsConfig } from './microsoft';
import { cleanMail } from '../src/lib/cleanMail';
import { draftReply, translate, triage, LANGS, type AiConfig, type InMail, type Lang } from './ai';

/**
 * E-post for Agentkontoret: tilkobling til Microsoft 365, synkronisering, saker, utkast og sending.
 *
 * Flyt for utkast: agenten lager forslag (pending) → et menneske redigerer og trykker «Godkjenn» (approved, Send-kø)
 * → et menneske trykker «Send» og bekrefter (sending → sent). Agenten sender aldri noe selv.
 * Sending kan slås av for hele kunden (skyggemodus, mail_connections.sending_enabled). Standard styres av tenant.mail.sendingOnConnect.
 */

export interface MailDeps {
  db: Db;
  tenant: TenantConfig;
  tenantId: string;
  ms?: MsConfig;
  tokenKey?: string;
  ai: AiConfig;
  fetch?: Fetch;
  now?: () => number;
  initialSyncDays?: number;
  maxPerRun?: number;
  onDelivered?: () => void;
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

interface Conn {
  tenant_id: string; mailbox: string; ms_tenant_id: string; ms_user_id: string; refresh_token_enc: string | null; access_token_enc: string | null;
  access_expires_at: Date | null; status: string; last_error: string | null; connected_at: Date; inbox_watermark: Date | null; sent_watermark: Date | null;
  last_sync_at: Date | null; sending_enabled: boolean;
}

const defaultLog: MailDeps['log'] = (level, msg, extra = {}) => console.log(JSON.stringify({ level, component: 'mail', msg, ...extra }));

export function createMail(d: MailDeps) {
  const { db, tenant, tenantId } = d;
  const now = d.now ?? Date.now;
  const log = (d.log ?? defaultLog)!;
  const f = d.fetch ?? fetch;
  let syncing = false;
  let backfilled = false;

  const activity = (actor: string, text: string, caseId?: string | null, tone?: string) =>
    db.query('INSERT INTO activities(tenant_id, at, actor, case_id, text, tone) VALUES ($1,$2,$3,$4,$5,$6)', [tenantId, new Date(now()), actor, caseId ?? null, text, tone ?? null]);

  const getConn = async () => (await db.query<Conn>('SELECT * FROM mail_connections WHERE tenant_id = $1', [tenantId])).rows[0];

  /** Gir et gyldig access token, fornyer ved behov. Feil som krever ny innlogging lagres på tilkoblingen. */
  async function accessToken(): Promise<string> {
    if (!d.ms || !d.tokenKey) throw new Error('Microsoft er ikke konfigurert på serveren');
    const c = await getConn();
    if (!c?.refresh_token_enc) throw new Error('Ingen e-posttilkobling');
    if (c.access_token_enc && c.access_expires_at && new Date(c.access_expires_at).getTime() > now() + 5 * 60e3) return decryptSecret(c.access_token_enc, d.tokenKey);
    try {
      const t = await refreshTokens(d.ms, decryptSecret(c.refresh_token_enc, d.tokenKey), f);
      await db.query(`UPDATE mail_connections SET access_token_enc = $2, access_expires_at = $3, refresh_token_enc = COALESCE($4, refresh_token_enc) WHERE tenant_id = $1`,
        [tenantId, encryptSecret(t.access_token, d.tokenKey), new Date(now() + t.expires_in * 1000), t.refresh_token ? encryptSecret(t.refresh_token, d.tokenKey) : null]);
      return t.access_token;
    } catch (e) {
      if (e instanceof MsAuthError && e.reconnectNeeded) {
        await db.query(`UPDATE mail_connections SET status = 'reconnect_required', last_error = $2, access_token_enc = NULL WHERE tenant_id = $1`, [tenantId, 'Microsoft-tilkoblingen må fornyes. Koble til på nytt.']);
        await activity('system', 'Microsoft-tilkoblingen har utløpt og må fornyes.', null, 'danger');
      }
      throw e;
    }
  }
  const graph = () => new Graph(accessToken, f);
  const sendOnConnect = tenant.mail.sendingOnConnect !== false;

  async function nextNumber(): Promise<string> {
    const year = new Date(now()).getFullYear();
    const n = Number((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM cases WHERE tenant_id = $1', [tenantId])).rows[0].n) + 1;
    return `${tenant.company.monogram}-${year}-${String(n).padStart(4, '0')}`;
  }

  async function threadFor(caseId: string) {
    return (await db.query<{ direction: 'inbound' | 'outbound'; from_addr: any; sent_at: Date; subject: string; body: string }>(
      'SELECT direction, from_addr, sent_at, subject, body FROM mail_messages WHERE case_id = $1 ORDER BY sent_at', [caseId])).rows
      .map((m) => ({ direction: m.direction, from: `${m.from_addr.name} <${m.from_addr.email}>`, at: new Date(m.sent_at).toISOString(), subject: m.subject, body: cleanMail(m.body).text || m.body }));
  }

  /** AIOliver lager et utkast og legger saken til godkjenning. */
  async function createDraft(caseId: string, opts: { kind?: 'reply' | 'info_request' | 'follow_up' | 'quote'; feedback?: string; previous?: { subject: string; body: string } } = {}) {
    const c = (await db.query<any>('SELECT * FROM cases WHERE id = $1 AND tenant_id = $2', [caseId, tenantId])).rows[0];
    if (!c) throw new Error('Fant ikke saken');
    const missing: string[] = c.missing_info ?? [];
    const kind = opts.kind ?? (missing.length ? 'info_request' : 'reply');
    const out = await draftReply(d.ai, tenant, { kind, customerName: c.customer.name, summary: c.summary, missing, urgent: c.priority === 'urgent', thread: await threadFor(caseId), feedback: opts.feedback, previous: opts.previous });
    const prev = (await db.query<{ v: number }>('SELECT COALESCE(max(version),0)::int AS v FROM drafts WHERE case_id = $1', [caseId])).rows[0].v;
    await db.query(`UPDATE drafts SET state = 'superseded' WHERE case_id = $1 AND state IN ('pending','approved','send_failed')`, [caseId]);
    const lastIn = (await db.query<{ graph_id: string }>(`SELECT graph_id FROM mail_messages WHERE case_id = $1 AND direction = 'inbound' AND graph_id IS NOT NULL ORDER BY sent_at DESC LIMIT 1`, [caseId])).rows[0];
    const author = kind === 'follow_up' ? 'followup' : 'quote';
    const judgement = [...out.requires_human_judgement];
    if (c.flagged?.reason) judgement.unshift(`Saken er flagget: ${c.flagged.reason}`);
    if (out.engine === 'regler') judgement.push('AI er ikke koblet til ennå. Utkastet er laget med enkle regler.');
    const draftId = randomUUID();
    await db.query(`INSERT INTO drafts(id, tenant_id, case_id, kind, author, subject, body, rationale, missing, judgement, version, state, reply_to_graph_id, created_at, language, feedback)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$15)`,
      [draftId, tenantId, caseId, kind, author, out.subject, out.body, out.rationale, JSON.stringify(out.missing), JSON.stringify(judgement), prev + 1, lastIn?.graph_id ?? null, new Date(now()), out.language, opts.feedback ?? null]);
    await db.query(`UPDATE cases SET status = 'awaiting_approval', assigned_agent = $2, next_action = $3, updated_at = $4 WHERE id = $1`,
      [caseId, author, `Les og godkjenn utkastet fra ${author === 'followup' ? 'AINora' : 'AIOliver'}.`, new Date(now())]);
    await activity(author, `${author === 'followup' ? 'AINora' : 'AIOliver'} ${opts.previous ? 'skrev utkastet på nytt' : `laget ${kind === 'info_request' ? 'et svarutkast med spørsmål' : kind === 'follow_up' ? 'en oppfølging' : 'et svarutkast'}`} (v${prev + 1}).`, caseId);
    return draftId;
  }

  /** Bilder limt inn i teksten (typisk fra iPhone) gir ikke hasAttachments=true hos Microsoft. */
  const hasInlineImages = (body: string) => /\[(cid:[^\]]+|[^\]\n]{1,80}\.(jpe?g|png|gif|heic|heif|webp))\]/i.test(body);

  async function attachmentsFor(m: GraphMessage): Promise<{ id: string; filename: string; mimeType: string; sizeKb: number; scan: string; kind: string }[]> {
    if (!m.hasAttachments && !hasInlineImages(m.body?.content ?? '')) return [];
    try {
      return (await graph().attachments(m.id)).map((a) => ({
        id: a.id, filename: a.name, mimeType: a.contentType, sizeKb: Math.round(a.size / 1024), scan: 'pending',
        kind: a.contentType.startsWith('image/') ? 'image' : a.contentType === 'application/pdf' ? 'pdf' : 'other',
      }));
    } catch { return []; }
  }

  async function insertMessage(caseId: string, m: GraphMessage, direction: 'inbound' | 'outbound', atts: unknown[], draftedBy: string | null = null) {
    await db.query(`INSERT INTO mail_messages(id, tenant_id, case_id, graph_id, conversation_id, direction, from_addr, to_addrs, cc_addrs, subject, body, sent_at, attachments, delivery_state, drafted_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
      [randomUUID(), tenantId, caseId, m.id, m.conversationId, direction, JSON.stringify(addr(m.from)), JSON.stringify((m.toRecipients ?? []).map(addr)),
        JSON.stringify((m.ccRecipients ?? []).map(addr)), (m.subject ?? '').slice(0, 300), (m.body?.content ?? '').slice(0, 20000),
        new Date(m.receivedDateTime), JSON.stringify(atts), direction === 'outbound' ? 'confirmed' : null, draftedBy]);
  }

  async function seen(graphId: string) {
    const r = await db.query('SELECT 1 FROM mail_messages WHERE tenant_id = $1 AND graph_id = $2 UNION ALL SELECT 1 FROM triage_log WHERE tenant_id = $1 AND graph_id = $2', [tenantId, graphId]);
    return r.rows.length > 0;
  }

  /** Én synkroniseringsrunde. Returnerer null hvis den ikke kjørte. */
  async function syncOnce(): Promise<{ runId: string; fetched: number; newCases: number; error?: string } | null> {
    if (syncing) return null;
    const conn = await getConn();
    if (!conn || conn.status !== 'connected' || !d.ms || !d.tokenKey) return null;
    syncing = true;
    const runId = randomUUID();
    const started = new Date(now());
    await db.query('INSERT INTO mail_sync_runs(id, tenant_id, started_at) VALUES ($1,$2,$3)', [runId, tenantId, started]);
    let fetched = 0, newCases = 0, processed = 0;
    let error: string | undefined;
    const mailbox = conn.mailbox.toLowerCase();
    try {
      const g = graph();
      // Engangs: hent innlimte bilder for e-poster som ble synkronisert før dette ble støttet.
      if (!backfilled) {
        backfilled = true;
        const old = (await db.query<{ id: string; graph_id: string; body: string }>(`SELECT id, graph_id, body FROM mail_messages
          WHERE tenant_id = $1 AND direction = 'inbound' AND graph_id IS NOT NULL AND attachments = '[]'::jsonb AND sent_at > $2 LIMIT 50`,
          [tenantId, new Date(now() - 30 * 864e5)])).rows.filter((r) => hasInlineImages(r.body));
        for (const r of old) {
          const atts = await attachmentsFor({ id: r.graph_id, hasAttachments: true } as GraphMessage);
          if (atts.length) await db.query('UPDATE mail_messages SET attachments = $2 WHERE id = $1', [r.id, JSON.stringify(atts)]);
        }
        if (old.length) log('info', 'Hentet innlimte bilder for eldre e-poster', { messages: old.length });
      }
      // ── Innboks ──
      const inboxSince = conn.inbox_watermark ? new Date(conn.inbox_watermark) : new Date(new Date(conn.connected_at).getTime() - (d.initialSyncDays ?? 3) * 864e5);
      let watermark = inboxSince;
      const inbox = (await g.messagesSince('inbox', inboxSince)).filter((m) => !m.isDraft);
      fetched += inbox.length;
      for (const m of inbox) {
        if (processed >= (d.maxPerRun ?? 25)) break;
        if (await seen(m.id)) { watermark = new Date(Math.max(watermark.getTime(), Date.parse(m.receivedDateTime))); continue; }
        const from = addr(m.from);
        if (from.email === mailbox) { watermark = new Date(Math.max(watermark.getTime(), Date.parse(m.receivedDateTime))); continue; }
        processed++;
        const existing = (await db.query<{ id: string; status: string }>('SELECT id, status FROM cases WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at DESC LIMIT 1', [tenantId, m.conversationId])).rows[0];
        if (existing) {
          await insertMessage(existing.id, m, 'inbound', await attachmentsFor(m));
          await db.query(`UPDATE cases SET unread = true, updated_at = $2 WHERE id = $1`, [existing.id, new Date(now())]);
          await activity('customer', `${from.name || from.email} svarte i saken.`, existing.id);
          if (!['won', 'lost'].includes(existing.status)) await createDraft(existing.id);
        } else {
          const atts = await attachmentsFor(m);
          const mail: InMail = { fromName: from.name, fromEmail: from.email, subject: m.subject ?? '', body: cleanMail(m.body?.content ?? '').text || (m.body?.content ?? ''), receivedAt: m.receivedDateTime, attachments: atts.map((a) => a.filename) };
          const t = await triage(d.ai, tenant, mail);
          if (!t.is_customer_inquiry) {
            await db.query('INSERT INTO triage_log(tenant_id, graph_id, decision, reason, sender_domain, at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
              [tenantId, m.id, 'ignored', t.reason.slice(0, 200), from.email.split('@')[1] ?? '', new Date(now())]);
          } else {
            const id = randomUUID();
            const flagged = t.urgent.is_urgent ? { reason: t.urgent.reason || 'Mulig sikkerhetsrisiko. Ring kunden.' }
              : t.injection_suspected ? { reason: 'E-posten inneholder tekst som prøver å styre agentene. Behandlet som vanlig tekst.' } : null;
            await db.query(`INSERT INTO cases(id, tenant_id, number, conversation_id, title, status, priority, job_type, customer, description, summary, next_action, missing_info, flagged, assigned_agent, unread, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,'ai_processing',$6,$7,$8,$9,$10,$11,$12,$13,'intake',true,$14,$14)`,
              [id, tenantId, await nextNumber(), m.conversationId, `${t.title} – ${t.customer.name}`.slice(0, 160), t.urgent.is_urgent ? 'urgent' : t.priority, t.job_type,
                JSON.stringify({ name: t.customer.name, email: t.customer.email, phone: t.customer.phone, address: t.customer.address, company: t.customer.company, orgNr: t.customer.org_nr, type: t.customer.company ? 'naering' : 'privat' }),
                (m.subject ?? '').slice(0, 300), t.summary, 'AIOliver lager svarutkast.', JSON.stringify(t.missing_info), flagged ? JSON.stringify(flagged) : null, new Date(now())]);
            await insertMessage(id, m, 'inbound', atts);
            newCases++;
            await activity('intake', `AIEmma registrerte ny henvendelse fra ${t.customer.name}${t.engine === 'regler' ? ' (enkle regler)' : ''}.`, id);
            if (flagged) await activity('coordinator', `AIHenrik: ${flagged.reason}`, id, 'danger');
            await createDraft(id);
          }
        }
        watermark = new Date(Math.max(watermark.getTime(), Date.parse(m.receivedDateTime)));
      }
      // ── Sendte: svar Espen har sendt fra Outlook (eller fra oss) knyttes til saken ──
      const sentSince = conn.sent_watermark ? new Date(conn.sent_watermark) : inboxSince;
      let sentWatermark = sentSince;
      const sent = await g.messagesSince('sentitems', sentSince);
      fetched += sent.length;
      for (const m of sent) {
        sentWatermark = new Date(Math.max(sentWatermark.getTime(), Date.parse(m.receivedDateTime)));
        if (await seen(m.id)) continue;
        const c = (await db.query<{ id: string; status: string }>('SELECT id, status FROM cases WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at DESC LIMIT 1', [tenantId, m.conversationId])).rows[0];
        if (!c) continue;
        // Sendt fra Agentkontoret: knytt Graph-ID til meldingen vi allerede har lagret.
        const ours = (await db.query<{ id: string }>(`SELECT id FROM mail_messages WHERE case_id = $1 AND direction = 'outbound' AND graph_id IS NULL AND sent_at > $2 ORDER BY sent_at LIMIT 1`,
          [c.id, new Date(Date.parse(m.receivedDateTime) - 15 * 60e3)])).rows[0];
        if (ours) { await db.query('UPDATE mail_messages SET graph_id = $2 WHERE id = $1', [ours.id, m.id]); continue; }
        await insertMessage(c.id, m, 'outbound', [], 'owner');
        const superseded = await db.query(`UPDATE drafts SET state = 'superseded' WHERE case_id = $1 AND state IN ('pending','approved','send_failed') AND sending_at IS NULL RETURNING 1`, [c.id]);
        if (['new', 'ai_processing', 'awaiting_approval'].includes(c.status)) {
          await db.query(`UPDATE cases SET status = 'awaiting_customer', assigned_agent = 'followup', next_action = 'Venter på svar fra kunden.', updated_at = $2 WHERE id = $1`, [c.id, new Date(now())]);
        }
        await activity('owner', `${tenant.owner.firstName} svarte kunden fra Outlook${superseded.rows.length ? '. Utkastet er lagt bort.' : '.'}`, c.id);
      }
      await db.query('UPDATE mail_connections SET inbox_watermark = $2, sent_watermark = $3, last_sync_at = $4, last_error = NULL WHERE tenant_id = $1', [tenantId, watermark, sentWatermark, new Date(now())]);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log('error', 'Synkronisering feilet', { error });
      await db.query('UPDATE mail_connections SET last_error = $2 WHERE tenant_id = $1', [tenantId, error.slice(0, 300)]);
    } finally {
      syncing = false;
    }
    const done = new Date(now());
    if (error) {
      await db.query('UPDATE mail_sync_runs SET error = $2, fetched = $3, new_cases = $4 WHERE id = $1', [runId, error.slice(0, 300), fetched, newCases]);
    } else {
      await db.query('UPDATE mail_sync_runs SET completed_at = $2, persisted_at = $2, fetched = $3, new_cases = $4 WHERE id = $1', [runId, done, fetched, newCases]);
      try { d.onDelivered?.(); } catch { /* aldri stopp synk */ }
    }
    return { runId, fetched, newCases, error };
  }

  async function latestDeliveredRun() {
    const r = (await db.query<{ id: string; started_at: Date; completed_at: Date; persisted_at: Date }>(
      'SELECT id, started_at, completed_at, persisted_at FROM mail_sync_runs WHERE tenant_id = $1 AND persisted_at IS NOT NULL ORDER BY persisted_at DESC LIMIT 1', [tenantId])).rows[0];
    return r ? { scan_run_id: `mail-sync-${r.id}`, started_at: r.started_at, completed_at: r.completed_at, persisted_at: r.persisted_at } : null;
  }

  type Who = { id: string; email: string };
  type Result = { ok: true; id?: string } | { ok: false; status: 400 | 404 | 409 | 502; error: string };
  const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);
  const caseLabel = async (caseId: string) => (await db.query<any>('SELECT * FROM cases WHERE id = $1', [caseId])).rows[0];

  /** «Godkjenn»: lagrer versjonen som står i feltene. Agentens original tas vare på. Bare ett av to samtidige klikk vinner. */
  async function approveDraft(draftId: string, who: Who, edited: { subject?: unknown; body?: unknown; language?: unknown } = {}): Promise<Result> {
    const subject = clean(edited.subject, 300)?.trim();
    const body = clean(edited.body, 20000);
    const language = typeof edited.language === 'string' && edited.language in LANGS ? edited.language : null;
    const r = (await db.query<any>(`UPDATE drafts SET state = 'approved', decided_by = $3, decided_at = $4,
        original_subject = subject, original_body = body,
        subject = COALESCE($5, subject), body = COALESCE($6, body), language = COALESCE($7, language),
        edited_by = CASE WHEN COALESCE($5, subject) <> subject OR COALESCE($6, body) <> body THEN $3 ELSE NULL END,
        error = NULL
      WHERE id = $1 AND tenant_id = $2 AND state = 'pending' RETURNING *`, [draftId, tenantId, who.email, new Date(now()), subject ?? null, body ?? null, language])).rows[0];
    if (!r) return { ok: false, status: 409, error: 'Utkastet er allerede godkjent, avvist eller erstattet.' };
    await db.query(`UPDATE cases SET next_action = 'Godkjent. Trykk «Send» for å sende til kunden.', updated_at = $2 WHERE id = $1`, [r.case_id, new Date(now())]);
    await activity('owner', `${tenant.owner.firstName} godkjente utkast v${r.version}${r.edited_by ? ' (redigert)' : ''}. Klart for sending.`, r.case_id, 'success');
    return { ok: true };
  }

  /** Redigerer et godkjent, ikke-sendt utkast (tekst og mottaker). */
  async function updateApproved(draftId: string, who: Who, b: { subject?: unknown; body?: unknown; email?: unknown; language?: unknown }): Promise<Result> {
    const email = clean(b.email, 200)?.trim().toLowerCase();
    if (email && !EMAIL.test(email)) return { ok: false, status: 400, error: 'Ugyldig e-postadresse.' };
    const language = typeof b.language === 'string' && b.language in LANGS ? b.language : null;
    const r = (await db.query<any>(`UPDATE drafts SET subject = COALESCE($3, subject), body = COALESCE($4, body), recipient = COALESCE($5, recipient), language = COALESCE($7, language),
        edited_by = CASE WHEN COALESCE($3, subject) <> subject OR COALESCE($4, body) <> body OR ($5 IS NOT NULL AND $5 IS DISTINCT FROM recipient) THEN $6 ELSE edited_by END
      WHERE id = $1 AND tenant_id = $2 AND state = 'approved' AND sending_at IS NULL RETURNING *`,
      [draftId, tenantId, clean(b.subject, 300)?.trim() ?? null, clean(b.body, 20000) ?? null, email ?? null, who.email, language])).rows[0];
    if (!r) return { ok: false, status: 409, error: 'Utkastet er allerede sendt eller finnes ikke i Send-køen.' };
    await activity('owner', `${tenant.owner.firstName} redigerte godkjent utkast v${r.version} før sending.`, r.case_id);
    return { ok: true };
  }

  /** «Send» (etter bekreftelse). Reserverer utkastet atomisk, så det aldri kan sendes to ganger. */
  async function sendDraft(draftId: string, who: Who): Promise<Result> {
    const conn = await getConn();
    if (!conn || conn.status !== 'connected') return { ok: false, status: 409, error: 'E-post er ikke koblet til.' };
    if (!conn.sending_enabled) return { ok: false, status: 409, error: 'Sending er slått av. Kopier teksten og send fra Outlook.' };
    const claimed = (await db.query<any>(`UPDATE drafts SET state = 'sending', sending_at = $3 WHERE id = $1 AND tenant_id = $2 AND state = 'approved' AND sending_at IS NULL RETURNING *`,
      [draftId, tenantId, new Date(now())])).rows[0];
    if (!claimed) {
      const cur = (await db.query<any>('SELECT state FROM drafts WHERE id = $1 AND tenant_id = $2', [draftId, tenantId])).rows[0];
      return { ok: false, status: cur ? 409 : 404, error: !cur ? 'Fant ikke utkastet.' : cur.state === 'pending' ? 'Utkastet må godkjennes før det kan sendes.' : cur.state === 'sent' || cur.state === 'sending' ? 'Utkastet er allerede sendt.' : 'Utkastet kan ikke sendes.' };
    }
    const c = await caseLabel(claimed.case_id);
    const to = (claimed.recipient || c.customer.email || '').toLowerCase();
    if (!EMAIL.test(to)) {
      await db.query(`UPDATE drafts SET state = 'approved', sending_at = NULL, error = $2 WHERE id = $1`, [draftId, 'Mangler gyldig mottaker']);
      return { ok: false, status: 400, error: 'Mangler gyldig e-postadresse til mottakeren.' };
    }
    let messageId: string | null = null;
    try {
      if (claimed.reply_to_graph_id) messageId = (await graph().reply(claimed.reply_to_graph_id, claimed.body, claimed.subject, to)).draftId;
      else await graph().sendNew(to, claimed.subject, claimed.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Reservasjonen fjernes, så utkastet kan sendes på nytt. Ingenting ble sendt.
      await db.query(`UPDATE drafts SET state = 'approved', sending_at = NULL, error = $2 WHERE id = $1`, [draftId, msg.slice(0, 300)]);
      await activity('system', 'Sending feilet. Ingenting ble sendt.', claimed.case_id, 'danger');
      return { ok: false, status: 502, error: `Sending feilet: ${msg}` };
    }
    const at = new Date(now());
    await db.query(`UPDATE drafts SET state = 'sent', sent_at = $2, sent_by = $3, sent_to = $4, message_id = $5, error = NULL WHERE id = $1`, [draftId, at, who.email, to, messageId]);
    await db.query(`INSERT INTO mail_messages(id, tenant_id, case_id, graph_id, conversation_id, direction, from_addr, to_addrs, subject, body, sent_at, delivery_state, drafted_by, approved_by)
      VALUES ($1,$2,$3,NULL,$4,'outbound',$5,$6,$7,$8,$9,'confirmed',$10,$11)`,
      [randomUUID(), tenantId, c.id, c.conversation_id, JSON.stringify({ name: tenant.owner.name, email: conn.mailbox }), JSON.stringify([{ name: c.customer.name, email: to }]),
        claimed.subject, claimed.body, at, claimed.author, claimed.decided_by ?? who.email]);
    await db.query(`UPDATE cases SET status = $2, assigned_agent = 'followup', next_action = 'Venter på svar fra kunden.', updated_at = $3 WHERE id = $1`,
      [c.id, claimed.kind === 'quote' ? 'quote_sent' : 'awaiting_customer', at]);
    await activity('owner', `${tenant.owner.firstName} sendte e-post til ${to} (bekreftet av Microsoft).`, c.id, 'success');
    return { ok: true };
  }

  /** «Avvis»: fjerner utkastet uten å sende noe. */
  async function rejectDraft(draftId: string, who: Who, reason?: string): Promise<Result> {
    const r = (await db.query<any>(`UPDATE drafts SET state = 'rejected', decided_by = $3, decided_at = $4 WHERE id = $1 AND tenant_id = $2 AND state IN ('pending','approved') AND sending_at IS NULL RETURNING case_id, version`,
      [draftId, tenantId, who.email, new Date(now())])).rows[0];
    if (!r) return { ok: false, status: 409, error: 'Utkastet er allerede sendt eller lagt bort.' };
    await db.query(`UPDATE cases SET next_action = 'Utkast avvist. Skriv selv eller be om nytt forslag.', updated_at = $2 WHERE id = $1`, [r.case_id, new Date(now())]);
    await activity('owner', `${tenant.owner.firstName} avviste utkast v${r.version}${reason ? `: ${reason.slice(0, 200)}` : ''}.`, r.case_id, 'warning');
    return { ok: true };
  }

  /** «Skriv på nytt»: gammelt utkast merkes, nytt lages med forrige utkast og beskjeden som kontekst. */
  async function rewriteDraft(draftId: string, feedback?: string): Promise<Result> {
    const r = (await db.query<any>(`UPDATE drafts SET state = 'superseded', rewritten = true WHERE id = $1 AND tenant_id = $2 AND state IN ('pending','approved') AND sending_at IS NULL RETURNING *`,
      [draftId, tenantId])).rows[0];
    if (!r) return { ok: false, status: 409, error: 'Utkastet kan ikke skrives på nytt (allerede sendt eller lagt bort).' };
    try {
      const id = await createDraft(r.case_id, { kind: r.kind === 'reply' || r.kind === 'info_request' || r.kind === 'follow_up' || r.kind === 'quote' ? r.kind : undefined, feedback: feedback?.slice(0, 500) || undefined, previous: { subject: r.subject, body: r.body } });
      return { ok: true, id };
    } catch (e) {
      // Ingenting skal gå tapt hvis AI feiler: det gamle utkastet legges tilbake.
      await db.query(`UPDATE drafts SET state = $2, rewritten = false WHERE id = $1`, [draftId, r.state]);
      return { ok: false, status: 502, error: `Kunne ikke lage nytt forslag: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── Mapping til frontendens typer ──────────────────────────────────────────
  async function state() {
    const cases = (await db.query<any>('SELECT * FROM cases WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 300', [tenantId])).rows;
    const ids = cases.map((c) => c.id);
    const msgs = ids.length ? (await db.query<any>('SELECT * FROM mail_messages WHERE case_id = ANY($1::uuid[]) ORDER BY sent_at', [ids])).rows : [];
    const drafts = ids.length ? (await db.query<any>('SELECT * FROM drafts WHERE case_id = ANY($1::uuid[]) ORDER BY created_at', [ids])).rows : [];
    const acts = (await db.query<any>('SELECT * FROM activities WHERE tenant_id = $1 ORDER BY at DESC LIMIT 400', [tenantId])).rows;
    const ignored = (await db.query<any>(`SELECT graph_id, reason, sender_domain, at FROM triage_log WHERE tenant_id = $1 AND decision = 'ignored' ORDER BY at DESC LIMIT 30`, [tenantId])).rows;
    const iso = (v: any) => new Date(v).toISOString();
    return {
      cases: cases.map((c) => ({
        id: c.id, number: c.number, title: c.title, status: c.status, priority: c.priority, flagged: c.flagged ?? undefined, jobType: c.job_type,
        customer: c.customer, description: c.description, summary: c.summary, nextAction: c.next_action, missingInfo: c.missing_info ?? [],
        assignedAgent: c.assigned_agent, threadId: c.id, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), unreadCustomerReply: c.unread,
        events: acts.filter((a) => a.case_id === c.id).reverse().map((a) => ({ id: String(a.id), at: iso(a.at), actor: a.actor, kind: 'info', text: a.text })),
      })),
      messages: msgs.map((m) => ({
        id: m.id, threadId: m.case_id, direction: m.direction, from: m.from_addr, to: m.to_addrs, cc: m.cc_addrs, subject: m.subject, body: m.body,
        sentAt: iso(m.sent_at), attachments: m.attachments ?? [], deliveryState: m.delivery_state ?? undefined, draftedBy: m.drafted_by ?? undefined, approvedBy: m.approved_by ?? undefined,
      })),
      drafts: drafts.map((x) => ({
        id: x.id, caseId: x.case_id, kind: x.kind, author: x.author, subject: x.subject, body: x.body, rationale: x.rationale, missing: x.missing ?? [],
        requiresHumanJudgement: x.judgement ?? [], createdAt: iso(x.created_at), version: x.version, state: x.state, idempotencyKey: x.id,
        language: x.language, recipient: x.recipient ?? cases.find((c) => c.id === x.case_id)?.customer?.email ?? '',
        original: x.original_subject != null ? { subject: x.original_subject, body: x.original_body } : undefined,
        editedBy: x.edited_by ?? undefined, decidedBy: x.decided_by ?? undefined, decidedAt: x.decided_at ? iso(x.decided_at) : undefined,
        sentAt: x.sent_at ? iso(x.sent_at) : undefined, sentBy: x.sent_by ?? undefined, sentTo: x.sent_to ?? undefined,
        error: x.error ?? undefined, rewritten: !!x.rewritten, feedback: x.feedback ?? undefined,
      })),
      activities: acts.slice(0, 120).map((a) => ({ id: String(a.id), at: iso(a.at), actor: a.actor, caseId: a.case_id ?? undefined, text: a.text, tone: a.tone ?? undefined })),
      ignored: ignored.map((i) => ({ message: { id: i.graph_id, threadId: '', direction: 'inbound', from: { name: i.sender_domain, email: i.sender_domain }, to: [], subject: '(innhold lagres ikke)', body: '', sentAt: iso(i.at), attachments: [] }, reason: i.reason })),
    };
  }

  async function status() {
    const c = await getConn();
    const last = (await db.query<any>('SELECT started_at, persisted_at, error, fetched, new_cases FROM mail_sync_runs WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1', [tenantId])).rows[0];
    return {
      configured: !!(d.ms && d.tokenKey),
      ai_configured: !!d.ai.apiKey,
      mailbox: tenant.mail.mailbox,
      connected: !!c && c.status === 'connected',
      status: c?.status ?? 'not_connected',
      last_error: c?.last_error ?? null,
      last_sync_at: c?.last_sync_at ? new Date(c.last_sync_at).toISOString() : null,
      connected_at: c?.connected_at ? new Date(c.connected_at).toISOString() : null,
      sending_enabled: !!c?.sending_enabled,
      last_run: last ? { started_at: new Date(last.started_at).toISOString(), ok: !last.error, error: last.error, fetched: last.fetched, new_cases: last.new_cases } : null,
    };
  }

  // ── Ruter ────────────────────────────────────────────────────────────────
  function routes(app: Hono<Env>, h: Helpers) {
    const user = (c: Context<Env>) => c.get('user');
    const ownerOnly = (c: Context<Env>) => user(c).role !== 'owner';
    const caseOf = async (id: string) => (await db.query<any>('SELECT * FROM cases WHERE id = $1 AND tenant_id = $2', [id, tenantId])).rows[0];

    app.use('/api/mail/*', h.requireUser);
    app.use('/api/state', h.requireUser);
    app.use('/api/drafts/*', h.requireUser);
    app.use('/api/cases/*', h.requireUser);
    app.use('/api/messages/*', h.requireUser);

    // Vedlegg hentes direkte fra Microsoft ved visning (lagres ikke hos oss).
    // Bare bilder vises i nettleseren; alt annet lastes ned. Ingen aktivt innhold (HTML/SVG) kjøres på vårt domene.
    const SAFE_INLINE = /^image\/(jpeg|png|gif|webp|heic|heif)$/i;
    app.get('/api/messages/:id/attachments/:attId', async (c) => {
      const m = (await db.query<any>('SELECT graph_id, attachments FROM mail_messages WHERE id = $1 AND tenant_id = $2', [c.req.param('id'), tenantId])).rows[0];
      const a = m?.graph_id ? (m.attachments ?? []).find((x: any) => x.id === c.req.param('attId')) : null;
      if (!a) return h.err(c, 404, 'Fant ikke vedlegget.');
      if (a.sizeKb > 30 * 1024) return h.err(c, 409, 'Vedlegget er for stort til å vises her. Åpne det i Outlook.');
      try {
        const { bytes } = await graph().attachmentBytes(m.graph_id, a.id);
        const type = String(a.mimeType || 'application/octet-stream').toLowerCase();
        const inline = SAFE_INLINE.test(type) || type === 'application/pdf';
        const name = String(a.filename || 'vedlegg').replace(/["\\\r\n]/g, '_');
        return new Response(bytes, { headers: {
          'Content-Type': inline ? type : 'application/octet-stream',
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          'Cache-Control': 'private, max-age=3600',
        } });
      } catch (e) {
        log('warn', 'Kunne ikke hente vedlegg', { error: String(e) });
        return h.err(c, 502, 'Kunne ikke hente vedlegget fra Microsoft. Prøv igjen.');
      }
    });

    app.get('/api/state', async (c) => c.json(await state()));
    app.get('/api/mail/status', async (c) => c.json(await status()));

    app.post('/api/mail/connect', async (c) => {
      if (!d.ms || !d.tokenKey) return h.err(c, 409, 'Microsoft-tilkobling er ikke konfigurert på serveren ennå.');
      const state = newToken();
      const { verifier, challenge } = pkce();
      await db.query('INSERT INTO oauth_states(state_hash, user_id, code_verifier, expires_at) VALUES ($1,$2,$3,$4)', [sha256(state), user(c).id, encryptSecret(verifier, d.tokenKey), new Date(now() + 10 * 60e3)]);
      return c.json({ url: authorizeUrl(d.ms, state, challenge, tenant.mail.mailbox) });
    });

    app.get('/api/microsoft/callback', h.requireUser, async (c) => {
      const back = (q: string) => c.redirect(`/?microsoft=${q}`);
      const err = c.req.query('error');
      if (err) return back(err === 'access_denied' ? 'avbrutt' : 'feil');
      const state = c.req.query('state') ?? '';
      const code = c.req.query('code') ?? '';
      const st = (await db.query<any>('DELETE FROM oauth_states WHERE state_hash = $1 RETURNING *', [sha256(state)])).rows[0];
      if (!st || st.user_id !== user(c).id || new Date(st.expires_at).getTime() < now() || !d.ms || !d.tokenKey) return back('ugyldig');
      try {
        const t = await exchangeCode(d.ms, code, decryptSecret(st.code_verifier, d.tokenKey), f);
        const claims = idTokenClaims(t.id_token);
        if (claims.tid !== d.ms.allowedTenantId) return back('feil-organisasjon');
        const me = await new Graph(async () => t.access_token, f).me();
        const mail = (me.mail ?? me.userPrincipalName ?? '').toLowerCase();
        if (mail !== tenant.mail.mailbox.toLowerCase()) {
          await h.audit(user(c), 'mail.connect_rejected', `Feil konto: ${mail}`);
          return back('feil-konto');
        }
        if (!t.refresh_token) return back('feil');
        const prev = await getConn();
        const same = prev && prev.ms_user_id === me.id;
        await db.query(`INSERT INTO mail_connections(tenant_id, mailbox, ms_tenant_id, ms_user_id, refresh_token_enc, access_token_enc, access_expires_at, status, last_error, connected_by, connected_at, inbox_watermark, sent_watermark, sending_enabled)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'connected',NULL,$8,$9,NULL,NULL,$11)
          ON CONFLICT (tenant_id) DO UPDATE SET mailbox = EXCLUDED.mailbox, ms_tenant_id = EXCLUDED.ms_tenant_id, ms_user_id = EXCLUDED.ms_user_id,
            refresh_token_enc = EXCLUDED.refresh_token_enc, access_token_enc = EXCLUDED.access_token_enc, access_expires_at = EXCLUDED.access_expires_at,
            status = 'connected', last_error = NULL, connected_by = EXCLUDED.connected_by, sending_enabled = EXCLUDED.sending_enabled,
            connected_at = CASE WHEN $10 THEN mail_connections.connected_at ELSE EXCLUDED.connected_at END,
            inbox_watermark = CASE WHEN $10 THEN mail_connections.inbox_watermark ELSE NULL END,
            sent_watermark = CASE WHEN $10 THEN mail_connections.sent_watermark ELSE NULL END`,
          [tenantId, mail, claims.tid, me.id, encryptSecret(t.refresh_token, d.tokenKey), encryptSecret(t.access_token, d.tokenKey), new Date(now() + t.expires_in * 1000), user(c).id, new Date(now()), !!same, sendOnConnect]);
        await h.audit(user(c), 'mail.connected', `${mail} koblet til${sendOnConnect ? '' : ' (skyggemodus)'}`);
        await activity('system', sendOnConnect
          ? `E-post koblet til: ${mail}. Agentene lager forslag. Ingenting sendes før ${tenant.owner.firstName} har trykket «Godkjenn» og «Send».`
          : `E-post koblet til: ${mail}. Skyggemodus: ingenting sendes fra Agentkontoret.`, null, 'success');
        void syncOnce();
        return back('tilkoblet');
      } catch (e) {
        log('error', 'Tilkobling feilet', { error: String(e) });
        return back('feil');
      }
    });

    app.post('/api/mail/disconnect', async (c) => {
      await db.query(`UPDATE mail_connections SET status = 'disconnected', refresh_token_enc = NULL, access_token_enc = NULL, sending_enabled = false WHERE tenant_id = $1`, [tenantId]);
      await h.audit(user(c), 'mail.disconnected', 'E-posttilkobling fjernet');
      await activity('system', 'E-posttilkoblingen er fjernet.', null, 'warning');
      return c.json({ ok: true });
    });

    app.post('/api/mail/settings', h.requireSuperadmin, async (c) => {
      const enabled = (await h.body(c)).sending_enabled === true;
      const r = await db.query(`UPDATE mail_connections SET sending_enabled = $2 WHERE tenant_id = $1 AND status = 'connected' RETURNING 1`, [tenantId, enabled]);
      if (!r.rows.length) return h.err(c, 409, 'E-post er ikke koblet til.');
      await h.audit(user(c), 'mail.sending_changed', enabled ? 'Sending slått PÅ' : 'Sending slått av (skyggemodus)');
      await activity('system', enabled ? 'Sending fra Agentkontoret er slått på. Alt krever fortsatt godkjenning.' : 'Skyggemodus: sending er slått av.', null, enabled ? 'success' : 'warning');
      return c.json({ ok: true });
    });

    app.post('/api/mail/sync-now', h.requireSuperadmin, async (c) => c.json((await syncOnce()) ?? { skipped: true }));

    const reply = (c: Context<Env>, r: Result) => (r.ok ? c.json({ ok: true, ...(r.id ? { id: r.id } : {}) }) : c.json({ error: r.error }, r.status));

    // Godkjenn (med eventuelt redigert tekst). To samtidige godkjenninger gir 200 og 409.
    app.post('/api/drafts/:id/approve', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan godkjenne utkast.');
      const b = await h.body(c);
      const r = await approveDraft(c.req.param('id'), user(c), b);
      if (r.ok) await h.audit(user(c), 'draft.approved', c.req.param('id'));
      return reply(c, r);
    });

    // Rediger godkjent, ikke-sendt utkast (tekst og mottaker).
    app.put('/api/drafts/:id/text', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan redigere utkast.');
      return reply(c, await updateApproved(c.req.param('id'), user(c), await h.body(c)));
    });

    // Send godkjent utkast. Bekreftelsen skjer i appen (to klikk).
    app.post('/api/drafts/:id/send', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan sende e-post til kunder.');
      const r = await sendDraft(c.req.param('id'), user(c));
      if (r.ok) await h.audit(user(c), 'email.sent', c.req.param('id'));
      return reply(c, r);
    });

    app.post('/api/drafts/:id/reject', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan avvise utkast.');
      const reason = String((await h.body(c)).reason ?? '');
      return reply(c, await rejectDraft(c.req.param('id'), user(c), reason || undefined));
    });

    // Skriv på nytt med AI. Feil fra AI gir 502, aldri 401.
    const rewrite = async (c: Context<Env>) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan be om nye utkast.');
      const fb = String((await h.body(c)).feedback ?? '');
      return reply(c, await rewriteDraft(c.req.param('id'), fb || undefined));
    };
    app.post('/api/drafts/:id/rewrite', rewrite);
    app.post('/api/drafts/:id/regenerate', rewrite);

    // Oversett teksten som står i feltene. Lagrer ingenting.
    app.post('/api/drafts/:id/translate', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan oversette utkast.');
      const b = await h.body(c);
      const language = String(b.language ?? '') as Lang;
      if (!(language in LANGS)) return h.err(c, 400, 'Ukjent språk.');
      const dr = (await db.query('SELECT 1 FROM drafts WHERE id = $1 AND tenant_id = $2', [c.req.param('id'), tenantId])).rows[0];
      if (!dr) return h.err(c, 404, 'Fant ikke utkastet.');
      if (!d.ai.apiKey) return h.err(c, 409, 'Oversettelse krever at AI er koblet til.');
      try {
        return c.json(await translate(d.ai, tenant, { language, subject: String(b.subject ?? ''), body: String(b.body ?? '') }));
      } catch (e) {
        log('warn', 'Oversettelse feilet', { error: String(e) });
        return h.err(c, 502, 'Oversettelsen feilet. Prøv igjen.');
      }
    });

    app.post('/api/cases/:id/draft', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan be om utkast.');
      if (!(await caseOf(c.req.param('id')))) return h.err(c, 404, 'Fant ikke saken.');
      const kind = String((await h.body(c)).kind ?? '');
      try {
        const id = await createDraft(c.req.param('id'), { kind: (['reply', 'info_request', 'follow_up', 'quote'] as const).find((k) => k === kind) });
        return c.json({ ok: true, id });
      } catch (e) { return h.err(c, 502, `Kunne ikke lage utkast: ${e instanceof Error ? e.message : String(e)}`); }
    });

    // Eieren skriver selv: utkastet er godkjent av ham og legges i Send-køen. Sending krever eget klikk.
    app.post('/api/cases/:id/manual', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan skrive til kunder.');
      const kase = await caseOf(c.req.param('id'));
      if (!kase) return h.err(c, 404, 'Fant ikke saken.');
      const b = await h.body(c);
      const subject = String(b.subject ?? '').trim().slice(0, 300);
      const body = String(b.body ?? '').slice(0, 20000);
      if (!subject || !body.trim()) return h.err(c, 400, 'Emne og tekst må fylles ut.');
      const lastIn = (await db.query<{ graph_id: string }>(`SELECT graph_id FROM mail_messages WHERE case_id = $1 AND direction = 'inbound' AND graph_id IS NOT NULL ORDER BY sent_at DESC LIMIT 1`, [kase.id])).rows[0];
      await db.query(`UPDATE drafts SET state = 'superseded' WHERE case_id = $1 AND state IN ('pending','approved','send_failed') AND sending_at IS NULL`, [kase.id]);
      const id = randomUUID();
      const version = (await db.query<{ v: number }>('SELECT COALESCE(max(version),0)::int AS v FROM drafts WHERE case_id = $1', [kase.id])).rows[0].v + 1;
      await db.query(`INSERT INTO drafts(id, tenant_id, case_id, kind, author, subject, body, rationale, state, reply_to_graph_id, created_at, version, decided_by, decided_at)
        VALUES ($1,$2,$3,'reply','owner',$4,$5,'Skrevet av eieren','approved',$6,$7,$8,$9,$7)`,
        [id, tenantId, kase.id, subject, body, lastIn?.graph_id ?? null, new Date(now()), version, user(c).email]);
      await activity('owner', `${tenant.owner.firstName} skrev en melding selv. Klar for sending.`, kase.id);
      return c.json({ ok: true, id });
    });

    app.post('/api/cases/:id', async (c) => {
      if (ownerOnly(c)) return h.err(c, 403, 'Bare eieren kan endre saker.');
      const kase = await caseOf(c.req.param('id'));
      if (!kase) return h.err(c, 404, 'Fant ikke saken.');
      const b = await h.body(c);
      const statuses = ['new', 'ai_processing', 'awaiting_approval', 'awaiting_customer', 'ready_for_quote', 'quote_sent', 'follow_up', 'won', 'lost'];
      if (typeof b.status === 'string' && statuses.includes(b.status)) { await db.query('UPDATE cases SET status = $2 WHERE id = $1', [kase.id, b.status]); await activity('owner', `${tenant.owner.firstName} flyttet saken manuelt.`, kase.id); }
      if (typeof b.priority === 'string' && ['low', 'normal', 'high', 'urgent'].includes(b.priority)) await db.query('UPDATE cases SET priority = $2 WHERE id = $1', [kase.id, b.priority]);
      if (b.unread === false) await db.query('UPDATE cases SET unread = false WHERE id = $1', [kase.id]);
      if (b.flagged === null) { await db.query('UPDATE cases SET flagged = NULL WHERE id = $1', [kase.id]); await activity('owner', `${tenant.owner.firstName} markerte flagget som håndtert.`, kase.id, 'success'); }
      await db.query('UPDATE cases SET updated_at = $2 WHERE id = $1', [kase.id, new Date(now())]);
      return c.json({ ok: true });
    });

    app.get('/api/cases/:id/export', async (c) => {
      const kase = await caseOf(c.req.param('id'));
      if (!kase) return h.err(c, 404, 'Fant ikke saken.');
      const messages = (await db.query('SELECT direction, from_addr, to_addrs, subject, body, sent_at, attachments FROM mail_messages WHERE case_id = $1 ORDER BY sent_at', [kase.id])).rows;
      const drafts = (await db.query('SELECT kind, author, subject, body, state, created_at, sent_at FROM drafts WHERE case_id = $1 ORDER BY created_at', [kase.id])).rows;
      await h.audit(user(c), 'data.export', kase.number);
      return c.json({ case: kase, messages, drafts });
    });

    app.delete('/api/cases/:id', async (c) => {
      if (ownerOnly(c) && user(c).role !== 'superadmin') return h.err(c, 403, 'Ingen tilgang.');
      const kase = await caseOf(c.req.param('id'));
      if (!kase) return h.err(c, 404, 'Fant ikke saken.');
      await db.query('DELETE FROM cases WHERE id = $1', [kase.id]);
      await h.audit(user(c), 'data.delete', `Sak ${kase.number} med e-post og utkast slettet`);
      return c.json({ ok: true });
    });
  }

  return { routes, syncOnce, latestDeliveredRun, status, state, createDraft, approveDraft, updateApproved, sendDraft, rejectDraft, rewriteDraft, accessToken };
}
