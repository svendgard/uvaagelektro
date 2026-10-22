// Kopi av svendgard/agent-dashboard lib/schema.ts (commit 0271527), brukt kun i tester for å validere payload mot dashboardets egen kontrakt.
import { z } from 'zod';
import { DateTime } from 'luxon';
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/);
const timestamp = z.string().datetime({ offset: true });
export const scanSchema = z.object({ scan_run_id: z.string().min(1).max(160), started_at: timestamp, completed_at: timestamp, persisted_at: timestamp }).strict();
export const reportSchema = z.object({ schema_version: z.literal(1), report_id: z.string().uuid(), agent_id: slug, source: slug, reported_at: timestamp, last_delivered_scan: scanSchema.nullable() }).strict().superRefine((v, ctx) => {
  const s = v.last_delivered_scan;
  if (s && !(Date.parse(s.started_at) <= Date.parse(s.completed_at) && Date.parse(s.completed_at) <= Date.parse(s.persisted_at) && Date.parse(s.persisted_at) <= Date.parse(v.reported_at))) ctx.addIssue({ code: 'custom', message: 'Timestamps must satisfy started <= completed <= persisted <= reported' });
});
export type Report = z.infer<typeof reportSchema>;
export const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily'), timezone: z.string().refine(s => DateTime.now().setZone(s).isValid, 'Invalid timezone'), times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24).refine(a => new Set(a).size === a.length, 'Duplicate time'), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(a => new Set(a).size === a.length) }).strict(),
  z.object({ type: z.literal('interval'), interval_minutes: z.number().int().min(1).max(10080), anchor_at: timestamp }).strict()
]);
export type Schedule = z.infer<typeof scheduleSchema>;
export const agentSchema = z.object({ id: slug, name: z.string().trim().min(1).max(100), description: z.string().trim().max(2000).default(''), group_id: slug, source_id: slug, runtime_location: z.string().trim().max(160), reporting_enabled: z.boolean(), report_interval_seconds: z.number().int().min(60).max(3600), report_tolerance_seconds: z.number().int().min(60).max(86400), schedule: scheduleSchema, delivery_grace_minutes: z.number().int().min(0).max(1440), early_window_minutes: z.number().int().min(0).max(1440), maintenance_until: timestamp.nullable() }).strict();
export type AgentInput = z.infer<typeof agentSchema>;

