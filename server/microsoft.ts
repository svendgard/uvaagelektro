import { createHash, randomBytes } from 'node:crypto';

/**
 * Microsoft 365: innlogging (OAuth 2.0 med PKCE, delegert tilgang) og Microsoft Graph.
 * Tilgangen gjelder bare brukeren som logger inn (Espen). Ingen passord lagres.
 */

export const GRAPH_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface MsConfig { clientId: string; clientSecret: string; allowedTenantId: string; redirectUri: string }
export type Fetch = typeof fetch;

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(cfg: MsConfig, state: string, challenge: string, loginHint?: string) {
  const u = new URL(`https://login.microsoftonline.com/${cfg.allowedTenantId}/oauth2/v2.0/authorize`);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', GRAPH_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

export interface TokenSet { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }

export class MsAuthError extends Error { constructor(message: string, public code: string, public reconnectNeeded: boolean) { super(message); } }

async function tokenRequest(cfg: MsConfig, params: Record<string, string>, f: Fetch): Promise<TokenSet> {
  const res = await f(`https://login.microsoftonline.com/${cfg.allowedTenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: GRAPH_SCOPES.join(' '), ...params }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const code = String(json.error ?? res.status);
    // invalid_grant = token tilbakekalt, passord endret, samtykke fjernet o.l. Krever ny tilkobling.
    throw new MsAuthError(json.error_description?.split('\r\n')[0] ?? `Microsoft svarte ${res.status}`, code, code === 'invalid_grant' || code === 'interaction_required');
  }
  return json as TokenSet;
}

export const exchangeCode = (cfg: MsConfig, code: string, verifier: string, f: Fetch = fetch) =>
  tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: verifier }, f);

export const refreshTokens = (cfg: MsConfig, refreshToken: string, f: Fetch = fetch) =>
  tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, f);

/** Leser claims fra id_token. Tokenet kommer direkte fra Microsofts token-endepunkt over TLS. */
export function idTokenClaims(idToken: string | undefined): Record<string, any> {
  if (!idToken) return {};
  try { return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

// ── Graph ────────────────────────────────────────────────────────────────────

export interface GraphAddress { emailAddress: { name?: string; address?: string } }
export interface GraphMessage {
  id: string;
  conversationId: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  body?: { contentType: string; content: string };
}

export class GraphError extends Error { constructor(public status: number, message: string) { super(message); } }

export class Graph {
  constructor(private token: () => Promise<string>, private f: Fetch = fetch) {}

  private async call<T>(method: string, pathOrUrl: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    for (let attempt = 1; ; attempt++) {
      const res = await this.f(url, {
        method,
        headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json', ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Math.min(30, Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as any;
        throw new GraphError(res.status, j?.error?.message ?? `Graph svarte ${res.status}`);
      }
      if (res.status === 202 || res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  }

  me() { return this.call<{ id: string; mail?: string; userPrincipalName: string; displayName?: string }>('GET', '/me?$select=id,mail,userPrincipalName,displayName'); }

  /** Meldinger i en mappe mottatt etter et tidspunkt, eldste først. */
  async messagesSince(folder: 'inbox' | 'sentitems', since: Date, maxPages = 5): Promise<GraphMessage[]> {
    const select = 'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft,body';
    let url: string | undefined = `/me/mailFolders/${folder}/messages?$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime asc&$top=50&$select=${select}`;
    const out: GraphMessage[] = [];
    for (let page = 0; url && page < maxPages; page++) {
      const r: { value: GraphMessage[]; '@odata.nextLink'?: string } = await this.call('GET', url, undefined, { Prefer: 'outlook.body-content-type="text"' });
      out.push(...r.value);
      url = r['@odata.nextLink'];
    }
    return out;
  }

  async attachments(messageId: string) {
    const r = await this.call<{ value: { id: string; name: string; size: number; contentType: string; isInline: boolean }[] }>(
      'GET', `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,size,contentType,isInline`);
    return r.value.filter((a) => !a.isInline);
  }

  /** Svar i samme tråd. Lager først et utkast i Outlook, så sendes det. */
  async reply(messageId: string, text: string, subject?: string): Promise<{ draftId: string }> {
    const draft = await this.call<{ id: string; subject?: string }>('POST', `/me/messages/${encodeURIComponent(messageId)}/createReply`, { comment: text });
    if (subject && subject !== draft.subject) await this.call('PATCH', `/me/messages/${encodeURIComponent(draft.id)}`, { subject });
    await this.call('POST', `/me/messages/${encodeURIComponent(draft.id)}/send`);
    return { draftId: draft.id };
  }
}

export const addr = (a?: GraphAddress) => ({ name: a?.emailAddress?.name ?? a?.emailAddress?.address ?? '', email: (a?.emailAddress?.address ?? '').toLowerCase() });
