import type { InvoiceLine } from '../../domain/types';

/**
 * Grensesnitt mot regnskapssystem. Første implementasjon: Tripletex (REST API v2,
 * consumer token + employee token, sesjonstoken per kall).
 *
 * Ansvarsdeling: Agentkontoret eier arbeidsflyten, regnskapssystemet eier pengene.
 *  - ensureProject: oppretter prosjekt per oppdrag (samme nummer som saken), slik at
 *    montørene fører timer på riktig sted i Tripletex-appen.
 *  - getHours: leser førte timer tilbake (timesheet entries på prosjektet).
 *  - createOrder: lager ordre/fakturagrunnlag. Aldri ferdig faktura på nivå 1;
 *    Espen fakturerer fra Tripletex.
 * Alle skrivekall er idempotente på idempotencyKey.
 */
export interface AccountingProvider {
  readonly kind: 'simulated' | 'tripletex';
  readonly isLive: boolean;
  ensureProject(input: { projectNo: string; name: string; customerName: string }): Promise<{ projectId: string }>;
  getHours(projectNo: string): Promise<number | null>;
  createOrder(input: { idempotencyKey: string; projectNo: string; customerName: string; lines: InvoiceLine[] }): Promise<{ ok: true; orderNo: string } | { ok: false; error: string }>;
}
