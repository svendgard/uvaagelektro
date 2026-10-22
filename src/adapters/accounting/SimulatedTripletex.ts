import type { InvoiceLine } from '../../domain/types';
import type { AccountingProvider } from './AccountingProvider';

/** Simulert Tripletex. Timer ligger i minnet og kan "føres" av demoen. Ingenting sendes ut. */
export class SimulatedTripletex implements AccountingProvider {
  readonly kind = 'simulated' as const;
  readonly isLive = false;
  hours = new Map<string, number>();
  private orders = new Map<string, string>();
  private next = 10231;

  async ensureProject({ projectNo }: { projectNo: string; name: string; customerName: string }) {
    if (!this.hours.has(projectNo)) this.hours.set(projectNo, 0);
    return { projectId: `sim-${projectNo}` };
  }
  async getHours(projectNo: string) {
    await new Promise((r) => setTimeout(r, 250));
    return this.hours.has(projectNo) ? this.hours.get(projectNo)! : null;
  }
  logHours(projectNo: string, h: number) {
    this.hours.set(projectNo, (this.hours.get(projectNo) ?? 0) + h);
  }
  async createOrder({ idempotencyKey }: { idempotencyKey: string; projectNo: string; customerName: string; lines: InvoiceLine[] }): Promise<{ ok: true; orderNo: string } | { ok: false; error: string }> {
    await new Promise((r) => setTimeout(r, 900));
    const existing = this.orders.get(idempotencyKey);
    if (existing) return { ok: true as const, orderNo: existing };
    const no = String(this.next++);
    this.orders.set(idempotencyKey, no);
    return { ok: true as const, orderNo: no };
  }
}

export const accounting = new SimulatedTripletex();
