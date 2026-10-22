import type { EmailMessage } from '../../domain/types';

/**
 * Grensesnitt mot e-postleverandør. UI og saksmotor snakker bare med dette.
 *
 * Implementasjoner:
 *  - SimulatedMailProvider  (denne prototypen, ingen ekte e-post)
 *  - GraphMailProvider      (Microsoft 365 via Microsoft Graph, OAuth 2.0 delegated/app-only)
 *  - GmailMailProvider      (Google Workspace via Gmail API, OAuth 2.0)
 *
 * Krav til ekte implementasjoner:
 *  - Tokens lagres kryptert på server (aldri i nettleseren), med refresh-token-rotasjon.
 *  - Innkommende e-post hentes via webhook/abonnement (Graph change notifications / Gmail watch + Pub/Sub)
 *    og en periodisk delta-synk som sikkerhetsnett.
 *  - Svar sendes som svar i samme tråd (Graph: /messages/{id}/reply, Gmail: threadId + In-Reply-To/References).
 *  - sendReply er idempotent på idempotencyKey: samme nøkkel sendes aldri to ganger.
 *  - En melding regnes som sendt først når leverandøren har bekreftet (providerMessageId).
 */
export interface SendRequest {
  idempotencyKey: string;
  threadId: string;
  inReplyToMessageId?: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  subject: string;
  body: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string; confirmedAt: string }
  | { ok: false; error: string; retryable: boolean }
  | { ok: false; duplicate: true; providerMessageId: string };

export interface MailProvider {
  readonly kind: 'simulated' | 'microsoft_graph' | 'gmail';
  readonly isLive: boolean;
  sendReply(req: SendRequest): Promise<SendResult>;
  /** Kalles når nye meldinger kommer inn. Returnerer avmeldingsfunksjon. */
  onInbound(handler: (msg: EmailMessage) => void): () => void;
}
