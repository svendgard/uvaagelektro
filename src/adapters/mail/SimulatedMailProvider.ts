import type { EmailMessage } from '../../domain/types';
import type { MailProvider, SendRequest, SendResult } from './MailProvider';

/**
 * Simulert e-post. Sender ingenting ut av nettleseren.
 * - Bruker kort forsinkelse for å etterligne leverandørbekreftelse.
 * - Kan tvinges til å feile (for å vise feilhåndtering i demoen).
 * - Husker idempotensnøkler og blokkerer dobbeltsending.
 */
export class SimulatedMailProvider implements MailProvider {
  readonly kind = 'simulated' as const;
  readonly isLive = false;
  failNextSend = false;
  private sent = new Map<string, string>();
  private handlers = new Set<(m: EmailMessage) => void>();

  async sendReply(req: SendRequest): Promise<SendResult> {
    const existing = this.sent.get(req.idempotencyKey);
    if (existing) return { ok: false, duplicate: true, providerMessageId: existing };
    await new Promise((r) => setTimeout(r, 1100));
    if (this.failNextSend) {
      this.failNextSend = false;
      return { ok: false, error: 'Leverandøren svarte ikke (simulert tidsavbrudd). Ingenting ble sendt.', retryable: true };
    }
    const id = `sim-${Math.random().toString(36).slice(2, 10)}`;
    this.sent.set(req.idempotencyKey, id);
    return { ok: true, providerMessageId: id, confirmedAt: new Date().toISOString() };
  }

  onInbound(handler: (m: EmailMessage) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Kun for demo: legg en innkommende e-post i "innboksen". */
  injectInbound(msg: EmailMessage) {
    this.handlers.forEach((h) => h(msg));
  }
}

export const mailProvider = new SimulatedMailProvider();
