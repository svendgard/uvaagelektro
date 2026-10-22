import type { Activity, AgentId, Attachment, AgentStatus, AuditAction, AuditEntry, Case, ChatMessage, CompletionReport, DocKey, DraftKind, ExtraWork, Job } from '../domain/types';
import type { TenantConfig } from '../config/tenant';
import { accounting } from '../adapters/accounting/SimulatedTripletex';
import { buildInvoice, runChecks } from '../adapters/ai/ProjectControl';
import { id, sleep } from '../lib/util';
import type { AppState } from './store';

/**
 * Handlinger for utførelse og prosjektkontroll (AISofie).
 * Montørens handlinger (start, hjelp, ferdig, bilder) kommer i produksjon fra Slack-/Teams-boten
 * som webhook-hendelser; her kalles de direkte fra den simulerte montørvisningen.
 */
export interface JobCtx {
  tenant: TenantConfig;
  ref: { current: AppState };
  update: (fn: (s: AppState) => AppState) => void;
  log: (actor: Activity['actor'], text: string, caseId?: string, tone?: Activity['tone']) => void;
  audit: (action: AuditAction, detail: string, caseId?: string, actor?: string, role?: AuditEntry['role']) => void;
  toast: (text: string, tone?: 'success' | 'danger' | 'neutral') => void;
  setBusy: (agent: AgentId, b: { status: AgentStatus; text: string; caseId?: string } | null) => void;
  produceDraft: (caseId: string, opts?: { kind?: DraftKind }) => Promise<void>;
}

export interface CompleteInput {
  note: string;
  photoCount: number;
  materials: { elnr: string; qty: number }[];
  extraWork: { description: string; hours: number }[];
  hoursReported: number;
  loggedInTripletex: boolean;
  docs: Partial<Record<DocKey, boolean>>;
}

export function createJobActions(ctx: JobCtx) {
  const { tenant, ref, update, log, audit, toast, setBusy } = ctx;
  const nowIso = () => new Date().toISOString();
  const getCase = (cid: string) => ref.current.cases.find((c) => c.id === cid)!;
  const tech = (tid?: string) => tenant.technicians.find((t) => t.id === tid);

  const patchJob = (caseId: string, fn: (j: Job) => Job, event?: { actor: Case['events'][number]['actor']; text: string; kind?: string }) =>
    update((s) => ({
      ...s,
      cases: s.cases.map((c) => c.id !== caseId || !c.job ? c : {
        ...c, job: fn(c.job), updatedAt: nowIso(),
        events: event ? [...c.events, { id: id('ev'), at: nowIso(), actor: event.actor, kind: event.kind ?? 'job', text: event.text }] : c.events,
      }),
    }));

  const chat = (caseId: string, msg: Omit<ChatMessage, 'id' | 'at'>) =>
    patchJob(caseId, (j) => ({ ...j, thread: [...j.thread, { ...msg, id: id('chat'), at: nowIso() }] }));

  const techChat = (techId: string, msg: Omit<ChatMessage, 'id' | 'at'>) =>
    update((s) => ({ ...s, techChat: { ...s.techChat, [techId]: [...(s.techChat[techId] ?? []), { ...msg, id: id('chat'), at: nowIso() }] } }));

  const photo = (name: string): Attachment => ({ id: id('att'), filename: name, mimeType: 'image/jpeg', sizeKb: 1500, scan: 'clean' as const, kind: 'image' as const });

  /** AISofie kjører kontrollen og bygger fakturagrunnlag. */
  const runControl = async (caseId: string, opts: { quiet?: boolean } = {}) => {
    const c = getCase(caseId);
    if (!c?.job?.report) return;
    const who = tech(c.job.report.by)?.firstName ?? 'montøren';
    if (!opts.quiet) setBusy('control', { status: 'working', text: `AISofie kontrollerer ferdigmeldingen fra ${who} (${c.customer.address ?? c.customer.name}).`, caseId });
    await sleep(opts.quiet ? 300 : 1800);
    const hours = await accounting.getHours(c.job.tripletexProjectNo);
    const fresh = getCase(caseId).job!;
    const checks = runChecks(c, fresh, tenant, hours);
    const lines = buildInvoice(fresh, tenant, hours);
    patchJob(caseId, (j) => ({ ...j, checks, checkedAt: nowIso(), invoice: { ...j.invoice, lines }, acknowledgedWarnings: false }), { actor: 'control', text: `AISofie kontrollerte: ${checks.filter((x) => x.status !== 'ok').length || 'ingen'} avvik`, kind: 'control' });
    audit('job.control_run', `Kontroll kjørt: ${checks.map((x) => `${x.id}=${x.status}`).join(', ')}`, caseId, 'agent:control', 'agent');
    const fails = checks.filter((x) => x.status === 'fail').length;
    const warns = checks.filter((x) => x.status === 'warn').length;
    if (!fails && !warns) log('control', `AISofie: ${c.number} er komplett og klar for din kontroll.`, caseId, 'success');
    else log('control', `AISofie fant ${fails + warns} avvik på ${c.number} (${fails} må løses).`, caseId, fails ? 'warning' : 'neutral');
    if (!opts.quiet) setBusy('control', null);
  };

  const planJob = async (caseId: string, techId: string, date: string, slot: 'formiddag' | 'ettermiddag') => {
    const c = getCase(caseId);
    const t = tech(techId)!;
    await accounting.ensureProject({ projectNo: c.job!.tripletexProjectNo, name: c.title, customerName: c.customer.name });
    patchJob(caseId, (j) => ({ ...j, stage: 'scheduled', technicianId: techId, scheduledDate: date, slot }), { actor: 'owner', text: `Planlagt på ${t.firstName} ${date} (${slot})` });
    chat(caseId, { from: 'bot', text: `${c.customer.address ?? ''} · ${c.customer.name}${c.customer.phone ? ` · ${c.customer.phone}` : ''}\n${c.description}` });
    audit('job.planned', `Planlagt på ${t.name}, ${date} ${slot}`, caseId);
    log('coordinator', `AIHenrik la ${c.number} inn hos ${t.firstName} ${date} og sendte jobben til montørvisningen.`, caseId);
  };

  const techStart = (caseId: string) => {
    const c = getCase(caseId);
    patchJob(caseId, (j) => ({ ...j, stage: 'in_progress', startedAt: nowIso() }), { actor: 'system', text: `${tech(c.job!.technicianId)?.firstName} startet jobben` });
    chat(caseId, { from: 'tech', text: 'Startet.' });
    audit('job.started', 'Montør startet jobben', caseId, `tech:${c.job!.technicianId}`, 'system');
    log('system', `${tech(c.job!.technicianId)?.firstName} startet hos ${c.customer.name}.`, caseId);
  };

  const techHelp = (caseId: string, text: string) => {
    const c = getCase(caseId);
    const t = tech(c.job!.technicianId)!;
    patchJob(caseId, (j) => ({ ...j, help: { text, at: nowIso() } }), { actor: 'system', text: `${t.firstName} trenger hjelp: ${text}` });
    chat(caseId, { from: 'tech', text });
    chat(caseId, { from: 'bot', text: `Varslet ${tenant.owner.firstName}. Han ser det på dashboardet.` });
    audit('job.help_requested', text, caseId, `tech:${t.id}`, 'system');
    log('coordinator', `AIHenrik: ${t.firstName} trenger hjelp hos ${c.customer.name}.`, caseId, 'danger');
    toast(`${t.firstName} trenger hjelp (${c.customer.address}).`, 'danger');
  };

  const resolveHelp = (caseId: string) => {
    patchJob(caseId, (j) => ({ ...j, help: undefined }), { actor: 'owner', text: 'Espen markerte hjelpebehovet som løst' });
    chat(caseId, { from: 'bot', text: `${tenant.owner.firstName} har markert at dette er løst.` });
  };

  const techComplete = async (caseId: string, input: CompleteInput) => {
    const c = getCase(caseId);
    const j = c.job!;
    const t = tech(j.technicianId)!;
    if (input.loggedInTripletex) accounting.logHours(j.tripletexProjectNo, input.hoursReported);
    const photos = Array.from({ length: input.photoCount }, (_, i) => photo(`${c.customer.address?.split(',')[0].replace(/\s+/g, '_').toLowerCase() ?? 'jobb'}_${i + 1}.jpg`));
    const planned = new Map(j.plannedMaterials.map((m) => [m.elnr, m.qty]));
    const report: CompletionReport = {
      at: nowIso(), by: t.id, note: input.note, photos, hoursReported: input.hoursReported, docs: input.docs,
      materials: input.materials.filter((m) => m.qty > 0).map((m) => {
        const p = tenant.billing.materials[m.elnr];
        return { elnr: m.elnr, name: p?.name ?? m.elnr, unit: p?.unit ?? 'stk', qty: m.qty, plannedQty: planned.get(m.elnr) ?? 0 };
      }),
      extraWork: input.extraWork.filter((e) => e.description.trim()).map((e): ExtraWork => ({ id: id('x'), description: e.description, hours: e.hours, customerApproved: null })),
    };
    patchJob(caseId, (x) => ({ ...x, stage: 'reported', report, help: undefined }), { actor: 'system', text: `${t.firstName} ferdigmeldte jobben` });
    chat(caseId, { from: 'tech', text: input.note || 'Ferdig.', photos });
    chat(caseId, { from: 'bot', text: 'Takk! Ferdigmelding mottatt. AISofie kontrollerer.' });
    audit('job.reported', `Ferdigmeldt av ${t.name}: ${input.hoursReported} t, ${photos.length} bilder`, caseId, `tech:${t.id}`, 'system');
    log('system', `${t.firstName} ferdigmeldte jobben hos ${c.customer.name}.`, caseId);
    await sleep(500);
    await runControl(caseId);
  };

  /** AISofie purrer montøren i chat. I demoen svarer montøren automatisk etter noen sekunder. */
  const nudge = async (caseId: string, kind: 'nudge_hours' | 'nudge_docs' | 'nudge_photos') => {
    const c = getCase(caseId);
    const j = c.job!;
    const t = tech(j.report?.by ?? j.technicianId)!;
    const ask = {
      nudge_hours: `Hei ${t.firstName}! Timene på ${j.tripletexProjectNo} i Tripletex stemmer ikke med ferdigmeldingen (${j.report!.hoursReported} t). Kan du føre eller rette dem?`,
      nudge_docs: `Hei ${t.firstName}! Mangler ${j.requiredDocs.filter((d) => !j.report!.docs[d] && d !== 'nettselskap').join(' og ').replace('samsvarserklaering', 'samsvarserklæring')} for ${c.customer.address}. Kan du laste opp i denne tråden?`,
      nudge_photos: `Hei ${t.firstName}! Ingen bilder fra ${c.customer.address}. Kan du legge inn et par i denne tråden?`,
    }[kind];
    chat(caseId, { from: 'bot', text: ask });
    log('control', `AISofie sendte påminnelse til ${t.firstName}.`, caseId);
    toast(`Påminnelse sendt til ${t.firstName} i montørvisningen.`, 'neutral');
    await sleep(3500);
    if (kind === 'nudge_hours') {
      const have = (await accounting.getHours(j.tripletexProjectNo)) ?? 0;
      accounting.logHours(j.tripletexProjectNo, j.report!.hoursReported - have);
      chat(caseId, { from: 'tech', text: `Rettet i Tripletex, ${j.report!.hoursReported} t. (simulert svar)` });
    } else if (kind === 'nudge_docs') {
      patchJob(caseId, (x) => ({ ...x, report: { ...x.report!, docs: { ...x.report!.docs, samsvarserklaering: true, risikovurdering: true } } }), { actor: 'system', text: `${t.firstName} lastet opp dokumentasjon` });
      chat(caseId, { from: 'tech', text: 'Lastet opp samsvarserklæring. (simulert svar)', photos: [{ id: id('att'), filename: 'samsvarserklaering.pdf', mimeType: 'application/pdf', sizeKb: 180, scan: 'clean', kind: 'pdf' }] });
    } else {
      const ph = [photo('etter_1.jpg'), photo('etter_2.jpg')];
      patchJob(caseId, (x) => ({ ...x, report: { ...x.report!, photos: [...x.report!.photos, ...ph] } }));
      chat(caseId, { from: 'tech', text: 'Her er bildene. (simulert svar)', photos: ph });
    }
    log('system', `${t.firstName} svarte på påminnelsen.`, caseId);
    await runControl(caseId);
  };

  const markDoc = async (caseId: string, key: DocKey) => {
    patchJob(caseId, (x) => ({ ...x, report: { ...x.report!, docs: { ...x.report!.docs, [key]: true } } }), { actor: 'owner', text: 'Espen registrerte dokumentasjon' });
    audit('job.doc_marked', `Registrert: ${key}`, caseId);
    await runControl(caseId, { quiet: true });
  };

  const decideExtra = async (caseId: string, extraId: string, approved: boolean) => {
    patchJob(caseId, (x) => ({ ...x, report: { ...x.report!, extraWork: x.report!.extraWork.map((e) => e.id === extraId ? { ...e, customerApproved: approved } : e) } }), { actor: 'owner', text: approved ? 'Tilleggsarbeid bekreftet av kunden' : 'Tilleggsarbeid tas ikke med' });
    audit('job.extra_confirmed', `${approved ? 'Godkjent' : 'Avslått'} tillegg ${extraId}`, caseId);
    await runControl(caseId, { quiet: true });
  };

  const askCustomerExtra = (caseId: string) => ctx.produceDraft(caseId, { kind: 'extra_work' });

  const acknowledgeWarnings = (caseId: string) => patchJob(caseId, (x) => ({ ...x, acknowledgedWarnings: true }));

  const approveControl = (caseId: string) => {
    const c = getCase(caseId);
    if (ref.current.role !== 'owner') { toast('Bare eier kan godkjenne kontroll.', 'danger'); return; }
    if (c.job?.checks?.some((x) => x.status === 'fail')) { toast('Løs punktene markert rødt først.', 'danger'); return; }
    patchJob(caseId, (x) => ({ ...x, stage: 'controlled', controlledAt: nowIso() }), { actor: 'owner', text: 'Espen godkjente kontrollen' });
    audit('job.controlled', 'Kontroll godkjent', caseId);
    log('owner', `${tenant.owner.firstName} godkjente kontrollen av ${c.number}.`, caseId, 'success');
  };

  const returnToTech = (caseId: string, comment: string) => {
    const c = getCase(caseId);
    const t = tech(c.job!.technicianId)!;
    patchJob(caseId, (x) => ({ ...x, stage: 'in_progress' }), { actor: 'owner', text: `Sendt tilbake til ${t.firstName}` });
    chat(caseId, { from: 'bot', text: `${tenant.owner.firstName} har sendt jobben tilbake: «${comment || 'Se over og ferdigmeld på nytt.'}»` });
    audit('job.returned', comment, caseId);
    log('owner', `${tenant.owner.firstName} sendte ${c.number} tilbake til ${t.firstName}.`, caseId, 'warning');
  };

  const sendToTripletex = async (caseId: string) => {
    const c = getCase(caseId);
    const j = c.job!;
    if (ref.current.role !== 'owner') { toast('Bare eier kan sende til Tripletex.', 'danger'); return; }
    setBusy('control', { status: 'working', text: `AISofie lager ordre i Tripletex for ${c.customer.name} (simulert).`, caseId });
    const res = await accounting.createOrder({ idempotencyKey: `${caseId}:order:v1`, projectNo: j.tripletexProjectNo, customerName: c.customer.name, lines: j.invoice!.lines });
    setBusy('control', null);
    if (!res.ok) { toast(res.error, 'danger'); return; }
    patchJob(caseId, (x) => ({ ...x, stage: 'invoiced', invoice: { ...x.invoice!, tripletexOrderNo: res.orderNo, sentAt: nowIso() } }), { actor: 'control', text: `Ordre ${res.orderNo} opprettet i Tripletex (simulert)` });
    audit('accounting.order_created', `Ordre ${res.orderNo} på prosjekt ${j.tripletexProjectNo} (simulert)`, caseId, 'agent:control', 'agent');
    log('control', `AISofie la fakturagrunnlaget for ${c.number} i Tripletex som ordre ${res.orderNo} (simulert).`, caseId, 'success');
    toast(`Ordre ${res.orderNo} klar i Tripletex. Fakturer derfra (simulert).`, 'success');
  };

  /** Montøren poster et bilde utenfor en jobbtråd. Agenten sorterer, eller spør hvis usikker. */
  const postLoosePhoto = async (techId: string) => {
    const today = new Date();
    const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const mine = ref.current.cases.filter((c) => c.job?.technicianId === techId && c.job.scheduledDate === ds && ['scheduled', 'in_progress', 'reported'].includes(c.job.stage));
    const ph = photo('bilde_fra_montor.jpg');
    techChat(techId, { from: 'tech', text: '', photos: [ph] });
    await sleep(1000);
    if (mine.length === 1) {
      attach(techId, mine[0].id, ph);
      techChat(techId, { from: 'bot', text: `Lagt på ${mine[0].customer.address} (${mine[0].number}). Det er din eneste jobb i dag.` });
    } else if (mine.length === 0) {
      techChat(techId, { from: 'bot', text: 'Fant ingen jobb på deg i dag. Bildet ligger her til Espen sorterer det.' });
    } else {
      const active = mine.filter((c) => c.job!.stage === 'in_progress');
      if (active.length === 1) {
        attach(techId, active[0].id, ph);
        techChat(techId, { from: 'bot', text: `Lagt på ${active[0].customer.address}, jobben du har startet. Feil? Si fra i tråden.` });
      } else {
        techChat(techId, { from: 'bot', text: 'Hvilken jobb gjelder bildet?', photos: [ph], choices: mine.map((c) => ({ caseId: c.id, label: c.customer.address?.split(',')[0] ?? c.customer.name })) });
      }
    }
  };

  const attach = (techId: string, caseId: string, ph: Attachment) => {
    const c = getCase(caseId);
    chat(caseId, { from: 'tech', text: 'Bilde sortert inn fra chat.', photos: [ph] });
    if (c.job?.report) patchJob(caseId, (x) => ({ ...x, report: { ...x.report!, photos: [...x.report!.photos, ph] } }));
    log('coordinator', `AIHenrik sorterte et bilde fra ${tech(techId)?.firstName} til ${c.customer.address}.`, caseId);
  };

  const chooseLoosePhoto = (techId: string, msgId: string, caseId: string) => {
    const msg = ref.current.techChat[techId]?.find((m) => m.id === msgId);
    if (!msg || msg.resolved) return;
    update((s) => ({ ...s, techChat: { ...s.techChat, [techId]: s.techChat[techId].map((m) => m.id === msgId ? { ...m, resolved: true } : m) } }));
    attach(techId, caseId, msg.photos![0]);
    const c = getCase(caseId);
    techChat(techId, { from: 'bot', text: `Takk, lagt på ${c.customer.address}.` });
  };

  return { planJob, techStart, techHelp, resolveHelp, techComplete, runControl, nudge, markDoc, decideExtra, askCustomerExtra, acknowledgeWarnings, approveControl, returnToTech, sendToTripletex, postLoosePhoto, chooseLoosePhoto };
}
