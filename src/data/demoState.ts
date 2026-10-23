import { buildSeed } from './seed';
import { buildJobSeed } from './jobsSeed';
import { accounting } from '../adapters/accounting/SimulatedTripletex';
export { SIMULATION_TEMPLATES } from './seed';

/** Slår sammen eksempeldata for e-post og oppdrag. Brukes bare i demomodus. */
export function buildDemoState() {
  const s = buildSeed();
  const js = buildJobSeed();
  accounting.hours = new Map(Object.entries(js.tripletexHours));
  const existing = new Set(s.cases.map((c) => c.id));
  const cases = s.cases.map((c) => {
    const j = js.cases.find((x) => x.id === c.id);
    return j ? { ...c, job: j.job, assignedAgent: 'control' as const } : c;
  });
  const added = js.cases.filter((c) => !existing.has(c.id));
  const addedThreads = new Set(added.map((c) => c.threadId));
  return {
    ...s,
    cases: [...cases, ...added],
    messages: [...s.messages, ...js.messages.filter((m) => addedThreads.has(m.threadId))],
    activities: [...s.activities, ...js.activities],
    audit: [...s.audit, ...js.audit],
    techChat: js.techChat,
  };
}
