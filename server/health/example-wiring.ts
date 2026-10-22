/**
 * Eksempel på hvordan helserapporteringen kobles inn i bakgrunnsarbeideren (Render worker).
 * Ikke i bruk i prototypen, som kjører uten server.
 */
import { healthReporterFromEnv } from './healthReporter';
import { uvaagElektro } from '../../src/config/tenant';

// Pseudo-grensesnitt mot databasen i produksjon.
declare const db: {
  latestCommittedMailSync(tenantId: string): Promise<{ id: string; started_at: Date; completed_at: Date; persisted_at: Date } | null>;
};

const tenants = [uvaagElektro];

export const health = healthReporterFromEnv(
  tenants.map((t) => ({
    agentId: t.monitoring.mailSyncAgentId,
    latestDeliveredScan: async () => {
      const run = await db.latestCommittedMailSync(t.id);
      return run && { scan_run_id: `mail-sync-${run.id}`, started_at: run.started_at, completed_at: run.completed_at, persisted_at: run.persisted_at };
    },
  })),
);

void health?.start();

// I synkroniseringsjobben, ETTER at transaksjonen er committet:
//   await db.commit();
//   health?.notifyDelivered(tenant.monitoring.mailSyncAgentId);
