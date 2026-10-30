import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { InboxItem, Activity, ActivityActor, AgentId, AgentStatus, AuditAction, AuditEntry, Case, CaseStatus, ChatMessage, Draft, DraftKind, EmailMessage, Priority, UserRole } from '../domain/types';
import { createJobActions } from './jobs';
import { uvaagElektro, type TenantConfig } from '../config/tenant';
import * as demoData from '../data/demoState';
import { DEMO } from '../demo';
import { mailProvider } from '../adapters/mail/SimulatedMailProvider';
import { agentEngine, missingFor } from '../adapters/ai/SimulatedAgentEngine';
import { id, sleep } from '../lib/util';
import { api } from '../lib/api';

/**
 * Lokal demotilstand. I produksjon erstattes denne av et API (database + bakgrunnsjobber),
 * mens komponentene beholder samme handlinger (approveAndSend, regenerate, moveCase …).
 */

interface Busy { status: AgentStatus; text: string; caseId?: string }

export interface AppState {
  cases: Case[];
  messages: EmailMessage[];
  drafts: Draft[];
  activities: Activity[];
  audit: AuditEntry[];
  ignored: { message: EmailMessage; reason: string }[];
  /** All innkommende e-post (produksjon). I demo bygges listen fra meldingene. */
  inbox: InboxItem[];
  busy: Partial<Record<AgentId, Busy>>;
  completed: Record<AgentId, number>;
  sending: Record<string, boolean>;
  toasts: { id: string; text: string; tone: 'success' | 'danger' | 'neutral' }[];
  role: UserRole;
  /** Montørenes chat med boten (utenfor jobbtrådene). */
  techChat: Record<string, ChatMessage[]>;
  /** Status for e-posttilkoblingen (kun produksjon). */
  mail: MailStatus | null;
  /** Første lasting fra serveren er ferdig. */
  loaded: boolean;
}

export interface MailStatus {
  configured: boolean; ai_configured: boolean; mailbox: string; connected: boolean;
  status: 'not_connected' | 'connected' | 'reconnect_required' | string;
  last_error: string | null; last_sync_at: string | null; connected_at: string | null; sending_enabled: boolean;
  last_run: { started_at: string; ok: boolean; error: string | null; fetched: number; new_cases: number } | null;
}

function initial(role: UserRole = 'owner'): AppState {
  const base = { busy: {}, sending: {}, toasts: [], role, mail: null, loaded: DEMO, inbox: [] as InboxItem[] };
  if (DEMO) return { ...demoData.buildDemoState(), ...base, completed: { intake: 6, quote: 4, followup: 3, coordinator: 9, control: 5 } };
  return {
    ...base, cases: [], messages: [], drafts: [], activities: [], audit: [], ignored: [], techChat: {},
    completed: { intake: 0, quote: 0, followup: 0, coordinator: 0, control: 0 },
  };
}

const SIMULATION_TEMPLATES = DEMO ? demoData.SIMULATION_TEMPLATES : [];

export interface AgentView { id: AgentId; status: AgentStatus; text: string; caseId?: string }

export function useStoreValue(tenant: TenantConfig, role: UserRole = 'owner') {
  const [state, setState] = useState<AppState>(() => initial(role));
  const ref = useRef(state);
    const update = useCallback((fn: (s: AppState) => AppState) => { const next = fn(ref.current); ref.current = next; setState(next); }, []);
  const owner = tenant.owner;

  const log = useCallback((actor: ActivityActor, text: string, caseId?: string, tone?: Activity['tone']) =>
    update((s) => ({ ...s, activities: [...s.activities, { id: id('a'), at: new Date().toISOString(), actor, text, caseId, tone }] })), [update]);

  const audit = useCallback((action: AuditAction, detail: string, caseId?: string, actor = owner.email, role: AuditEntry['role'] = 'owner') =>
    update((s) => ({ ...s, audit: [...s.audit, { id: id('au'), at: new Date().toISOString(), actor, role, action, caseId, detail }] })), [update, owner.email]);

  const toast = useCallback((text: string, tone: 'success' | 'danger' | 'neutral' = 'neutral') => {
    const t = { id: id('t'), text, tone };
    update((s) => ({ ...s, toasts: [...s.toasts, t] }));
    setTimeout(() => update((s) => ({ ...s, toasts: s.toasts.filter((x) => x.id !== t.id) })), 4200);
  }, [update]);

  const setBusy = useCallback((agent: AgentId, b: Busy | null) =>
    update((s) => ({ ...s, busy: { ...s.busy, [agent]: b ?? undefined }, completed: b ? s.completed : { ...s.completed, [agent]: s.completed[agent] + 1 } })), [update]);

  const patchCase = useCallback((caseId: string, patch: Partial<Case>, event?: { actor: Case['events'][number]['actor']; text: string; kind?: string }) =>
    update((s) => ({
      ...s,
      cases: s.cases.map((c) => c.id !== caseId ? c : {
        ...c, ...patch, updatedAt: new Date().toISOString(),
        events: event ? [...c.events, { id: id('ev'), at: new Date().toISOString(), actor: event.actor, kind: event.kind ?? 'info', text: event.text }] : c.events,
      }),
    })), [update]);

  const getCase = (cid: string) => ref.current.cases.find((c) => c.id === cid)!;
  const jobsRef = useRef<ReturnType<typeof createJobActions> | null>(null);
  const thread = (threadId: string) => ref.current.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  /** AIOliver/AINora lager et utkast og legger saken til godkjenning. */
  const produceDraft = useCallback(async (caseId: string, opts: { kind?: DraftKind; variant?: number; feedback?: string; prevVersion?: number } = {}) => {
    const kase = getCase(caseId);
    const author: AgentId = opts.kind === 'follow_up' || opts.kind === 'extra_work' || kase.status === 'follow_up' ? 'followup' : 'quote';
    const keepStatus = !!kase.job;
    const name = tenant.agents.find((a) => a.id === author)!.name;
    const what = opts.kind === 'extra_work' ? 'en avklaring av tilleggsarbeid' : opts.kind === 'quote' || kase.status === 'ready_for_quote' ? 'et tilbudsutkast' : opts.kind === 'follow_up' || kase.status === 'follow_up' ? 'en oppfølgingsmelding' : 'et svarutkast';
    setBusy(author, { status: 'working', text: `${name} utarbeider ${what} til ${kase.customer.name.split(' ')[0]} (${tenant.jobTypes[kase.jobType].label.toLowerCase()}).`, caseId });
    if (!keepStatus) patchCase(caseId, { status: 'ai_processing', assignedAgent: author });
    const d = await agentEngine.draft({ kase, thread: thread(kase.threadId), tenant, kind: opts.kind, variant: opts.variant, ownerFeedback: opts.feedback });
    const version = (opts.prevVersion ?? 0) + 1;
    const draftId = id('draft');
    const draft: Draft = { ...d, author, id: draftId, createdAt: new Date().toISOString(), state: 'pending', version, idempotencyKey: `${caseId}:${draftId}:v${version}` };
    update((s) => ({ ...s, drafts: [...s.drafts, draft] }));
    audit('draft.created', `${name} laget ${what} (v${version})`, caseId, `agent:${author}`, 'agent');
    patchCase(caseId, keepStatus ? {} : { status: 'awaiting_approval', assignedAgent: author, nextAction: `Les og godkjenn ${what} fra ${name}.` }, { actor: author, text: `${name} laget ${what} (v${version})`, kind: 'draft' });
    log(author, `${name} utarbeidet ${what}.`, caseId);
    setBusy(author, null);
    await sleep(500);
    log('coordinator', `AIHenrik sendte saken til ${owner.firstName} for godkjenning.`, caseId);
    patchCase(caseId, {}, { actor: 'coordinator', text: `Sendt til ${owner.firstName} for godkjenning`, kind: 'handoff' });
  }, [tenant, update, patchCase, log, audit, setBusy, owner.firstName]);

  /** Godkjenn og send. Kun mennesker kan kalle denne (nivå 1). */
  const approveAndSend = useCallback(async (draftId: string, edited?: { subject: string; body: string }) => {
    const s0 = ref.current;
    if (s0.role !== 'owner') { toast('Du har ikke tilgang til å sende e-post.', 'danger'); return; }
    if (s0.sending[draftId]) return; // dobbeltklikk-vern i UI
    const draft = s0.drafts.find((d) => d.id === draftId);
    if (!draft || (draft.state !== 'pending' && draft.state !== 'send_failed' && draft.state !== 'approved')) return;
    const kase = getCase(draft.caseId);
    const body = edited?.body ?? draft.body;
    const subject = edited?.subject ?? draft.subject;
    const wasEdited = !!edited && (edited.body !== draft.body || edited.subject !== draft.subject);
    if (wasEdited) audit('draft.edited', `Espen redigerte utkast v${draft.version} før sending`, kase.id);
    if (draft.state === 'pending') audit('draft.approved', `Godkjente ${wasEdited ? 'redigert ' : ''}utkast v${draft.version} fra ${draft.author}`, kase.id);
    const lastIn = [...thread(kase.threadId)].reverse().find((m) => m.direction === 'inbound');
    const msgId = draft.state === 'send_failed' ? s0.messages.find((m) => m.threadId === kase.threadId && m.deliveryState === 'failed')?.id ?? id('msg') : id('msg');
    const outgoing: EmailMessage = {
      id: msgId, threadId: kase.threadId, direction: 'outbound', from: { name: owner.name, email: tenant.mail.mailbox },
      to: [{ name: kase.customer.name, email: kase.customer.email }], subject, body, sentAt: new Date().toISOString(), attachments: [],
      deliveryState: 'sending', approvedBy: owner.email, draftedBy: draft.author,
    };
    update((s) => ({
      ...s, sending: { ...s.sending, [draftId]: true },
      drafts: s.drafts.map((d) => d.id === draftId ? { ...d, state: 'approved', subject, body } : d),
      messages: [...s.messages.filter((m) => m.id !== msgId), outgoing],
    }));
    audit('email.send_requested', `Sending startet (nøkkel ${draft.idempotencyKey})`, kase.id, 'system', 'system');
    log('owner', `${owner.firstName} godkjente ${draft.kind === 'quote' ? 'tilbudet' : 'svaret'}.`, kase.id);
    const res = await mailProvider.sendReply({ idempotencyKey: draft.idempotencyKey, threadId: kase.threadId, inReplyToMessageId: lastIn?.id, from: outgoing.from, to: outgoing.to, subject, body });
    if (res.ok) {
      update((s) => ({
        ...s, sending: { ...s.sending, [draftId]: false },
        drafts: s.drafts.map((d) => d.id === draftId ? { ...d, state: 'sent' } : d),
        messages: s.messages.map((m) => m.id === msgId ? { ...m, deliveryState: 'confirmed', providerMessageId: res.providerMessageId, sentAt: res.confirmedAt } : m),
      }));
      audit('email.send_confirmed', `Bekreftet av e-postleverandør (${res.providerMessageId}, simulert)`, kase.id, 'system', 'system');
      if (kase.job) {
        if (draft.kind === 'extra_work') update((s) => ({ ...s, cases: s.cases.map((c) => c.id !== kase.id || !c.job?.report ? c : { ...c, job: { ...c.job, report: { ...c.job.report, extraWork: c.job.report.extraWork.map((e) => e.customerApproved === null ? { ...e, clarificationSentAt: new Date().toISOString() } : e) } } }) }));
        patchCase(kase.id, {}, { actor: 'system', text: 'E-post bekreftet sendt (simulert)', kind: 'sent' });
        log('system', `E-post sendt til ${kase.customer.name} (simulert bekreftelse).`, kase.id, 'success');
        toast('Sendt. Bekreftet av e-postleverandør (simulert).', 'success');
        if (draft.kind === 'extra_work') void jobsRef.current?.runControl(kase.id, { quiet: true });
        return;
      }
      const next: CaseStatus = draft.kind === 'quote' ? 'quote_sent' : draft.kind === 'follow_up' ? 'quote_sent' : 'awaiting_customer';
      patchCase(kase.id, { status: next, assignedAgent: 'followup', nextAction: next === 'quote_sent' ? 'AINora følger opp hvis kunden ikke svarer.' : 'Venter på svar fra kunden.' }, { actor: 'system', text: 'E-post bekreftet sendt (simulert)', kind: 'sent' });
      log('system', `E-post sendt til ${kase.customer.name} (simulert bekreftelse).`, kase.id, 'success');
      toast('Sendt. Bekreftet av e-postleverandør (simulert).', 'success');
    } else if ('duplicate' in res) {
      audit('email.duplicate_blocked', 'Dobbeltsending stoppet: meldingen er allerede sendt', kase.id, 'system', 'system');
      update((s) => ({ ...s, sending: { ...s.sending, [draftId]: false } }));
      toast('Meldingen er allerede sendt. Ingen ny sending.', 'neutral');
    } else {
      update((s) => ({
        ...s, sending: { ...s.sending, [draftId]: false },
        drafts: s.drafts.map((d) => d.id === draftId ? { ...d, state: 'send_failed' } : d),
        messages: s.messages.map((m) => m.id === msgId ? { ...m, deliveryState: 'failed' } : m),
      }));
      audit('email.send_failed', res.error, kase.id, 'system', 'system');
      log('system', `Sending feilet for ${kase.number}. Ingenting ble sendt.`, kase.id, 'danger');
      toast('Sending feilet. Ingenting ble sendt. Prøv igjen.', 'danger');
    }
  }, [tenant, update, audit, log, patchCase, toast, owner]);

  const rejectDraft = useCallback((draftId: string, reason: string) => {
    const d = ref.current.drafts.find((x) => x.id === draftId)!;
    update((s) => ({ ...s, drafts: s.drafts.map((x) => x.id === draftId ? { ...x, state: 'rejected' } : x) }));
    audit('draft.rejected', `Avviste utkast v${d.version}${reason ? `: ${reason}` : ''}`, d.caseId);
    patchCase(d.caseId, { status: 'ai_processing', nextAction: 'Utkast avvist. Skriv manuelt eller be om nytt forslag.' }, { actor: 'owner', text: `Espen avviste utkast v${d.version}` });
    log('owner', `${owner.firstName} avviste et utkast.`, d.caseId, 'warning');
  }, [update, audit, patchCase, log, owner.firstName]);

  const regenerate = useCallback(async (draftId: string, feedback: string) => {
    const d = ref.current.drafts.find((x) => x.id === draftId)!;
    update((s) => ({ ...s, drafts: s.drafts.map((x) => x.id === draftId ? { ...x, state: 'superseded' } : x) }));
    audit('draft.regenerate_requested', `Ba om nytt forslag${feedback ? `: ${feedback}` : ''}`, d.caseId);
    log('owner', `${owner.firstName} ba om nytt forslag.`, d.caseId);
    await produceDraft(d.caseId, { kind: d.kind, variant: d.version, feedback, prevVersion: d.version });
  }, [update, audit, log, produceDraft, owner.firstName]);

  const requestDraft = useCallback((caseId: string, kind?: DraftKind) => {
    audit('draft.regenerate_requested', `Ba om ${kind === 'quote' ? 'tilbudsutkast' : kind === 'follow_up' ? 'oppfølging' : 'svarutkast'}`, caseId);
    return produceDraft(caseId, { kind });
  }, [produceDraft, audit]);

  /** Espen skriver selv. Går via samme sendekanal og logg. */
  const sendManual = useCallback(async (caseId: string, subject: string, body: string) => {
    const draftId = id('draft');
    const kase = getCase(caseId);
    const manual: Draft = { id: draftId, caseId, kind: 'reply', author: 'owner', subject, body, rationale: 'Skrevet manuelt av Espen.', missing: [], requiresHumanJudgement: [], createdAt: new Date().toISOString(), version: 1, state: 'pending', idempotencyKey: `${caseId}:${draftId}:manual` };
    update((s) => ({ ...s, drafts: [...s.drafts.map((d) => d.caseId === caseId && d.state === 'pending' ? { ...d, state: 'superseded' as const } : d), manual] }));
    audit('manual.message_sent', 'Manuell melding skrevet av Espen', kase.id);
    await approveAndSend(draftId);
  }, [update, audit, approveAndSend]);

  const moveCase = useCallback((caseId: string, status: CaseStatus) => {
    const c = getCase(caseId);
    if (c.status === status) return;
    audit('case.status_changed', `Flyttet manuelt fra «${c.status}» til «${status}»`, caseId);
    patchCase(caseId, { status }, { actor: 'owner', text: `Espen flyttet saken manuelt`, kind: 'status' });
    log('owner', `${owner.firstName} flyttet ${c.number} manuelt.`, caseId);
  }, [audit, patchCase, log, owner.firstName]);

  const setPriority = useCallback((caseId: string, priority: Priority) => {
    audit('case.priority_changed', `Prioritet satt til ${priority}`, caseId);
    patchCase(caseId, { priority }, { actor: 'owner', text: `Prioritet endret`, kind: 'priority' });
  }, [audit, patchCase]);

  const markRead = useCallback((caseId: string) => patchCase(caseId, { unreadCustomerReply: false }), [patchCase]);

  const resolveFlag = useCallback((caseId: string) => {
    audit('case.flagged', 'Flagg fjernet av Espen etter oppfølging', caseId);
    patchCase(caseId, { flagged: undefined }, { actor: 'owner', text: 'Espen markerte flagget som håndtert' });
    log('owner', `${owner.firstName} markerte et flagg som håndtert.`, caseId, 'success');
  }, [audit, patchCase, log, owner.firstName]);

  /** Hele flyten fra ny e-post til utkast hos Espen. */
  const simulateInbound = useCallback(async (tplIndex: number) => {
    if (!SIMULATION_TEMPLATES.length) return undefined;
    const tpl = SIMULATION_TEMPLATES[tplIndex % SIMULATION_TEMPLATES.length];
    const threadId = id('t');
    const msg: EmailMessage = {
      id: id('msg'), threadId, direction: 'inbound', from: tpl.from, to: [{ name: tenant.company.name, email: tenant.mail.mailbox }],
      subject: tpl.subject, body: tpl.body, sentAt: new Date().toISOString(),
      attachments: Array.from({ length: tpl.images }, (_, i) => ({ id: id('att'), filename: `bilde_${i + 1}.jpg`, mimeType: 'image/jpeg', sizeKb: 1500, scan: 'clean' as const, kind: 'image' as const })),
    };
    update((s) => ({ ...s, messages: [...s.messages, msg] }));
    audit('email.received', `Ny e-post fra ${tpl.from.email} (simulert)`, undefined, 'system', 'system');
    log('customer', `Ny e-post fra ${tpl.from.name}: «${tpl.subject}» (simulert).`);
    setBusy('intake', { status: 'working', text: `AIEmma leser ny e-post fra ${tpl.from.name.split(' ')[0]}.` });
    await sleep(1400);
    const tri = await agentEngine.triage(msg, tenant);
    const n = 154 + ref.current.cases.filter((c) => c.number > 'UE-2026-0153').length;
    const caseId = id('c');
    const now = new Date().toISOString();
    const kase: Case = {
      id: caseId, number: `UE-2026-${String(n).padStart(4, '0')}`, title: tri.title, status: 'new', priority: tri.priority, flagged: tri.flag,
      jobType: tri.jobType, customer: tri.customer, description: tpl.body.split('\n').filter(Boolean)[1] ?? tpl.subject, summary: tri.summary,
      nextAction: 'AIOliver lager svarutkast.', missingInfo: tri.missingInfo, assignedAgent: 'intake', threadId, createdAt: now, updatedAt: now,
      events: [{ id: id('ev'), at: now, actor: 'customer', kind: 'email', text: 'E-post mottatt' }, { id: id('ev'), at: now, actor: 'intake', kind: 'case', text: `Sak opprettet – ${tenant.jobTypes[tri.jobType].label.toLowerCase()}` }],
    };
    update((s) => ({ ...s, cases: [kase, ...s.cases] }));
    audit('case.created', `Sak ${kase.number} opprettet`, caseId, 'agent:intake', 'agent');
    log('intake', `AIEmma registrerte ny henvendelse om ${tenant.jobTypes[tri.jobType].label.toLowerCase()} (${kase.number}).`, caseId);
    if (tri.missingInfo.length) log('intake', `AIEmma: mangler ${tri.missingInfo.length} opplysning${tri.missingInfo.length > 1 ? 'er' : ''}.`, caseId, 'warning');
    if (tri.flag) {
      audit('case.flagged', tri.flag.reason, caseId, 'agent:intake', 'agent');
      log('coordinator', `AIHenrik varslet ${owner.firstName}: ${tri.flag.reason}`, caseId, 'danger');
      toast(`${kase.number} er flagget og krever rask oppfølging.`, 'danger');
    }
    setBusy('intake', null);
    await sleep(600);
    await produceDraft(caseId);
    toast(`Nytt utkast venter på godkjenning (${kase.number}).`, 'neutral');
    return caseId;
  }, [tenant, update, audit, log, setBusy, produceDraft, toast, owner.firstName]);

  /** Kunden svarer i samme tråd. */
  const simulateCustomerReply = useCallback(async (caseId: string) => {
    const kase = getCase(caseId);
    const fn = kase.customer.name.split(' ')[0];
    const extra: Record<string, string> = {
      elbillader: 'Vi har 63A hovedsikring og det er ca. 12 meter fra skapet til carporten. Bilde vedlagt.',
      sikringsskap: 'Telefon 401 22 334. Tirsdag eller onsdag passer best.',
      stikkontakter: 'Åpent anlegg er greit. Bilder vedlagt.',
      feilsoking: 'Det gjelder kursen til kjøkkenet. Startet i går kveld. Tlf 401 22 334.',
      belysning: '10 spotter i gipstak, ja takk til dimming.',
      oppussing: 'Skisse vedlagt. Rørlegger starter uke 2, snekker koordinerer.',
      smarthus: 'Vi har ingen plattform i dag. Ønsker styring av lys og varme.',
      naering: 'Org.nr 999 111 222. Frist er innen uke 46. Kontaktperson på stedet er driftsleder.',
    };
    const text = `Hei,\n\n${extra[kase.jobType]}\n\nHilsen ${fn}`;
    const msg: EmailMessage = {
      id: id('msg'), threadId: kase.threadId, direction: 'inbound', from: { name: kase.customer.name, email: kase.customer.email },
      to: [{ name: tenant.company.name, email: tenant.mail.mailbox }], subject: `SV: ${thread(kase.threadId).at(-1)?.subject.replace(/^SV:\s*/, '') ?? kase.title}`,
      body: text, sentAt: new Date().toISOString(),
      attachments: /vedlagt/.test(text) ? [{ id: id('att'), filename: 'kundebilde.jpg', mimeType: 'image/jpeg', sizeKb: 1700, scan: 'clean', kind: 'image' }] : [],
    };
    update((s) => ({ ...s, messages: [...s.messages, msg] }));
    audit('email.received', `Kundesvar i tråd ${kase.threadId} (simulert)`, caseId, 'system', 'system');
    patchCase(caseId, { unreadCustomerReply: true }, { actor: 'customer', text: `Kunden svarte${msg.attachments.length ? ' med bilde' : ''}`, kind: 'email' });
    log('customer', `${kase.customer.name} svarte${msg.attachments.length ? ' med bilde' : ''}.`, caseId);
    setBusy('followup', { status: 'working', text: `AINora leser nytt svar fra ${fn}.`, caseId });
    await sleep(1200);
    const all = thread(kase.threadId).filter((m) => m.direction === 'inbound');
    const missing = missingFor(kase.jobType, all.map((m) => `${m.subject}\n${m.body}`).join('\n'), all.flatMap((m) => m.attachments).filter((a) => a.kind === 'image').length);
    setBusy('followup', null);
    if (!missing.length && tenant.priceTemplates.some((p) => p.jobType === kase.jobType)) {
      patchCase(caseId, { missingInfo: [], status: 'ready_for_quote', nextAction: 'AIOliver lager tilbudsutkast.' }, { actor: 'followup', text: 'AINora: all informasjon er på plass', kind: 'detect' });
      log('followup', `AINora: all informasjon er på plass. Klar for tilbud.`, caseId, 'success');
      await sleep(500);
      await produceDraft(caseId, { kind: 'quote' });
    } else {
      patchCase(caseId, { missingInfo: missing }, { actor: 'followup', text: missing.length ? `AINora: fortsatt mangler ${missing.length}` : 'AINora: informasjonen er komplett', kind: 'detect' });
      log('followup', missing.length ? `AINora: fortsatt mangler ${missing.length} opplysning${missing.length > 1 ? 'er' : ''}.` : 'AINora: informasjonen er komplett. Foreslår befaring.', caseId);
      await sleep(500);
      await produceDraft(caseId, { kind: missing.length ? 'info_request' : 'reply' });
    }
  }, [tenant, update, audit, patchCase, log, setBusy, produceDraft]);

  const exportCase = useCallback((caseId: string) => {
    const s = ref.current;
    const c = getCase(caseId);
    audit('data.export', `Eksporterte kundedata for ${c.number}`, caseId);
    return JSON.stringify({ case: c, messages: s.messages.filter((m) => m.threadId === c.threadId), drafts: s.drafts.filter((d) => d.caseId === caseId), audit: s.audit.filter((a) => a.caseId === caseId) }, null, 2);
  }, [audit]);

  const deleteCaseData = useCallback((caseId: string) => {
    const c = getCase(caseId);
    update((s) => ({
      ...s,
      cases: s.cases.filter((x) => x.id !== caseId),
      messages: s.messages.filter((m) => m.threadId !== c.threadId),
      drafts: s.drafts.filter((d) => d.caseId !== caseId),
      activities: s.activities.map((a) => a.caseId === caseId ? { ...a, text: 'Hendelse knyttet til slettet sak.', caseId: undefined } : a),
    }));
    audit('data.delete', `Slettet kundedata for ${c.number} (auditlinjen beholdes uten personopplysninger)`, undefined);
    toast(`Kundedata for ${c.number} er slettet.`, 'neutral');
  }, [update, audit, toast]);

  const setRole = (role: UserRole) => update((s) => ({ ...s, role }));
  const failNextSend = () => { mailProvider.failNextSend = true; toast('Neste sending vil feile (for å vise feilhåndtering).', 'neutral'); };
  const reset = () => update((s) => initial(s.role));

  const jobs = createJobActions({ tenant, ref, update, log, audit, toast, setBusy, produceDraft });
  jobsRef.current = jobs;

  // Litt liv ved oppstart: agentene fullfører påbegynte saker mens Espen ser på.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || !DEMO) return;
    booted.current = true;
    (async () => {
      setBusy('intake', { status: 'working', text: 'AIEmma behandler en henvendelse fra Sørlandsbakeriet Demo AS (næringskunde).', caseId: 'c-148' });
      patchCase('c-148', { status: 'ai_processing' }, { actor: 'intake', text: 'AIEmma leste teknisk datablad', kind: 'processing' });
      await sleep(5000);
      log('intake', 'AIEmma: næringskunde, mangler organisasjonsnummer.', 'c-148', 'warning');
      setBusy('intake', null);
      await produceDraft('c-148');
      await sleep(4000);
      setBusy('intake', { status: 'working', text: 'AIEmma leser plantegningen fra Silje Tveit.', caseId: 'c-145' });
      await sleep(4000);
      setBusy('intake', null);
      patchCase('c-145', { missingInfo: [] }, { actor: 'intake', text: 'AIEmma: 12 spotter, gipshimling, dimming. Komplett.', kind: 'detect' });
      log('intake', 'AIEmma: plantegningen er lest. Informasjonen er komplett.', 'c-145', 'success');
      await produceDraft('c-145', { kind: 'reply' });
    })();
    (async () => {
      await sleep(2500);
      await jobsRef.current!.runControl('c-162');
      await sleep(16000);
      await jobsRef.current!.techComplete('c-150', {
        note: 'Overspenningsvern montert i skapet. Testet og merket.', photoCount: 2, hoursReported: 1.5, loggedInTripletex: true,
        materials: [{ elnr: '10 001 07', qty: 1 }], extraWork: [], docs: { samsvarserklaering: true },
      });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Godkjenning i to steg (demo-versjon; produksjon overstyrer under) ──────
  const approveDraft = useCallback(async (draftId: string, edited: { subject: string; body: string; language?: string }) => {
    const d = ref.current.drafts.find((x) => x.id === draftId);
    if (!d || d.state !== 'pending') return false;
    const changed = edited.subject !== d.subject || edited.body !== d.body;
    update((s) => ({ ...s, drafts: s.drafts.map((x) => x.id === draftId ? { ...x, state: 'approved', original: { subject: x.subject, body: x.body }, subject: edited.subject, body: edited.body, language: edited.language ?? x.language, editedBy: changed ? owner.email : undefined, decidedBy: owner.email, decidedAt: new Date().toISOString() } : x) }));
    audit('draft.approved', `Godkjente ${changed ? 'redigert ' : ''}utkast v${d.version}`, d.caseId);
    log('owner', `${owner.firstName} godkjente utkast v${d.version}. Klart for sending.`, d.caseId, 'success');
    return true;
  }, [update, audit, log, owner]);

  const saveApproved = useCallback(async (draftId: string, b: { subject: string; body: string; email: string; language?: string }) => {
    update((s) => ({ ...s, drafts: s.drafts.map((x) => x.id === draftId && x.state === 'approved' ? { ...x, subject: b.subject, body: b.body, recipient: b.email, language: b.language ?? x.language, editedBy: owner.email } : x) }));
    return true;
  }, [update, owner.email]);

  const sendApproved = useCallback(async (draftId: string) => { await approveAndSend(draftId); return true; }, [approveAndSend]);

  const translateDraft = useCallback(async (_draftId: string, _language: string, _subject: string, _body: string): Promise<{ subject: string; body: string } | null> => {
    toast('Oversettelse krever at AI er koblet til (ikke i demo).', 'neutral');
    return null;
  }, [toast]);

  // ── Produksjon: data og handlinger går mot serveren ───────────────────────
  const refresh = useCallback(async () => {
    if (DEMO) return;
    try {
      const [s, mail] = await Promise.all([api<any>('/api/state'), api<MailStatus>('/api/mail/status')]);
      update((st) => ({ ...st, cases: s.cases, messages: s.messages, drafts: s.drafts, activities: [...s.activities].reverse(), ignored: s.ignored, inbox: s.inbox ?? [], mail, loaded: true }));
    } catch { update((st) => ({ ...st, loaded: true })); }
  }, [update]);

  useEffect(() => {
    if (DEMO) return;
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);

  const call = useCallback(async (path: string, body?: unknown, okText?: string, method?: string) => {
    try { await api(path, { body: body ?? {}, method }); if (okText) toast(okText, 'success'); return true; }
    catch (e) { toast(e instanceof Error ? e.message : 'Noe gikk galt.', 'danger'); return false; }
    finally { await refresh(); }
  }, [refresh, toast]);

  const withAgent = useCallback(async (agent: AgentId, text: string, caseId: string, fn: () => Promise<unknown>) => {
    setBusy(agent, { status: 'working', text, caseId });
    try { await fn(); } finally { update((s) => ({ ...s, busy: { ...s.busy, [agent]: undefined } })); }
  }, [setBusy, update]);

  const remoteActions = DEMO ? null : {
    approveAndSend: async (draftId: string, edited?: { subject: string; body: string }) => {
      if (ref.current.sending[draftId]) return;
      update((s) => ({ ...s, sending: { ...s.sending, [draftId]: true } }));
      const ok = await call(`/api/drafts/${draftId}/send`, edited ?? {}, 'Sendt. Bekreftet av Microsoft.');
      update((s) => ({ ...s, sending: { ...s.sending, [draftId]: false } }));
      return ok;
    },
    rejectDraft: (draftId: string, reason: string) => { void call(`/api/drafts/${draftId}/reject`, { reason }); },
    approveDraft: (draftId: string, edited: { subject: string; body: string; language?: string }) =>
      call(`/api/drafts/${draftId}/approve`, edited, 'Godkjent. Ligger klar for sending.'),
    saveApproved: (draftId: string, b: { subject: string; body: string; email: string; language?: string }) =>
      call(`/api/drafts/${draftId}/text`, b, 'Endringene er lagret.', 'PUT'),
    sendApproved: async (draftId: string) => {
      if (ref.current.sending[draftId]) return false;
      update((s) => ({ ...s, sending: { ...s.sending, [draftId]: true } }));
      const ok = await call(`/api/drafts/${draftId}/send`, {}, 'Sendt. Bekreftet av Microsoft.');
      update((s) => ({ ...s, sending: { ...s.sending, [draftId]: false } }));
      return ok;
    },
    translateDraft: async (draftId: string, language: string, subject: string, body: string) => {
      try { return await api<{ subject: string; body: string }>(`/api/drafts/${draftId}/translate`, { body: { language, subject, body } }); }
      catch (e) { toast(e instanceof Error ? e.message : 'Oversettelsen feilet.', 'danger'); return null; }
    },
    regenerate: async (draftId: string, feedback: string) => {
      const d = ref.current.drafts.find((x) => x.id === draftId);
      await withAgent(d?.author === 'followup' ? 'followup' : 'quote', 'Skriver utkastet på nytt …', d?.caseId ?? '', () => call(`/api/drafts/${draftId}/rewrite`, { feedback }, 'Nytt forslag er klart.'));
    },
    requestDraft: (caseId: string, kind?: DraftKind) =>
      withAgent(kind === 'follow_up' ? 'followup' : 'quote', 'Lager utkast …', caseId, () => call(`/api/cases/${caseId}/draft`, { kind })),
    sendManual: async (caseId: string, subject: string, body: string) => {
      try {
        const r = await api<{ id: string }>(`/api/cases/${caseId}/manual`, { body: { subject, body } });
        await call(`/api/drafts/${r.id}/send`, {}, 'Sendt. Bekreftet av Microsoft.');
      } catch (e) { toast(e instanceof Error ? e.message : 'Noe gikk galt.', 'danger'); await refresh(); }
    },
    moveCase: (caseId: string, status: CaseStatus) => { patchCase(caseId, { status }); void call(`/api/cases/${caseId}`, { status }); },
    setPriority: (caseId: string, priority: Priority) => { patchCase(caseId, { priority }); void call(`/api/cases/${caseId}`, { priority }); },
    markRead: (caseId: string) => { patchCase(caseId, { unreadCustomerReply: false }); void call(`/api/cases/${caseId}`, { unread: false }); },
    resolveFlag: (caseId: string) => { patchCase(caseId, { flagged: undefined }); void call(`/api/cases/${caseId}`, { flagged: null }); },
    exportCase: (caseId: string) => {
      const s = ref.current;
      const c = getCase(caseId);
      void api(`/api/cases/${caseId}/export`).catch(() => {}); // logges i revisjonsloggen på serveren
      return JSON.stringify({ case: c, messages: s.messages.filter((m) => m.threadId === c.threadId), drafts: s.drafts.filter((d) => d.caseId === caseId) }, null, 2);
    },
    deleteCaseData: (caseId: string) => {
      const c = getCase(caseId);
      update((s) => ({ ...s, cases: s.cases.filter((x) => x.id !== caseId) }));
      void call(`/api/cases/${caseId}`, undefined, `Kundedata for ${c.number} er slettet.`, 'DELETE');
    },
    makeCase: async (graphId: string): Promise<string | null> => {
      try {
        const r = await api<{ caseId: string }>(`/api/inbox/${encodeURIComponent(graphId)}/case`, { body: {} });
        toast('Saken er opprettet. AIOliver lager et svarforslag.', 'success');
        await refresh();
        return r.caseId;
      } catch (e) { toast(e instanceof Error ? e.message : 'Kunne ikke opprette saken.', 'danger'); return null; }
    },
    // E-posttilkobling
    connectMail: async () => {
      try { const r = await api<{ url: string }>('/api/mail/connect', { body: {} }); window.location.assign(r.url); }
      catch (e) { toast(e instanceof Error ? e.message : 'Kunne ikke starte tilkoblingen.', 'danger'); }
    },
    disconnectMail: () => call('/api/mail/disconnect', {}, 'E-post er koblet fra.'),
    setSending: (enabled: boolean) => call('/api/mail/settings', { sending_enabled: enabled }, enabled ? 'Sending er slått på.' : 'Skyggemodus er slått på.'),
    syncNow: () => call('/api/mail/sync-now', {}, 'Synkronisert.'),
    refresh,
  };

  const agents: AgentView[] = useMemo(() => {
    const pending = state.drafts.filter((d) => d.state === 'pending');
    const followUps = state.cases.filter((c) => c.status === 'follow_up').length;
    const waitingCust = state.cases.filter((c) => c.status === 'awaiting_customer' || c.status === 'quote_sent').length;
    const failed = state.drafts.some((d) => d.state === 'send_failed');
    const derive = (a: AgentId): AgentView => {
      const b = state.busy[a];
      if (b) return { id: a, ...b };
      switch (a) {
        case 'intake': return { id: a, status: 'idle', text: `AIEmma overvåker ${tenant.mail.mailbox}. Ingen nye henvendelser akkurat nå.` };
        case 'quote': {
          const mine = pending.filter((d) => d.author === 'quote').length;
          return mine ? { id: a, status: 'waiting_owner', text: `AIOliver har ${mine} utkast som venter på ${owner.firstName}.` } : { id: a, status: 'idle', text: 'AIOliver er ledig.' };
        }
        case 'followup':
          if (followUps) return { id: a, status: 'needs_help', text: `AINora har funnet ${followUps} tilbud som bør følges opp.` };
          return { id: a, status: 'waiting_customer', text: `AINora venter på svar i ${waitingCust} saker.` };
        case 'control': {
          const reported = state.cases.filter((c) => c.job?.stage === 'reported' && c.job.checks);
          const withFails = reported.filter((c) => c.job!.checks!.some((x) => x.status === 'fail')).length;
          const ready = reported.length - withFails;
          const notSent = state.cases.filter((c) => c.job?.stage === 'controlled').length;
          if (withFails) return { id: a, status: 'needs_help', text: `AISofie har ${withFails} ferdigmeldt${withFails > 1 ? 'e' : ''} oppdrag med avvik${ready ? ` og ${ready} klar${ready > 1 ? 'e' : ''} for kontroll` : ''}.` };
          if (ready) return { id: a, status: 'waiting_owner', text: `AISofie har ${ready} oppdrag klar${ready > 1 ? 'e' : ''} for ${owner.firstName}s kontroll.` };
          if (notSent) return { id: a, status: 'waiting_owner', text: `AISofie venter på at ${notSent} kontrollert${notSent > 1 ? 'e' : ''} oppdrag sendes til Tripletex.` };
          return { id: a, status: 'idle', text: 'AISofie: alle ferdigmeldte oppdrag er kontrollert.' };
        }
        case 'coordinator': {
          const help = state.cases.filter((c) => c.job?.help);
          if (help.length) return { id: a, status: 'needs_help', text: `AIHenrik: ${help.map((c) => tenant.technicians.find((t) => t.id === c.job!.technicianId)?.firstName).join(', ')} trenger hjelp.` };
          if (failed) return { id: a, status: 'error', text: 'AIHenrik: en sending feilet og må prøves på nytt.' };
          return pending.length ? { id: a, status: 'waiting_owner', text: `AIHenrik venter på at ${owner.firstName} skal godkjenne ${pending.length} ${pending.length === 1 ? 'kundesvar' : 'kundesvar'}.` } : { id: a, status: 'idle', text: 'AIHenrik: alle saker er i flyt.' };
        }
      }
    };
    return tenant.agents.map((a) => derive(a.id));
  }, [state, tenant, owner.firstName]);

  return {
    state, tenant, agents,
    actions: {
      ...jobs, approveAndSend, approveDraft, saveApproved, sendApproved, translateDraft, rejectDraft, regenerate, requestDraft, sendManual, moveCase, setPriority, markRead, resolveFlag, simulateInbound, simulateCustomerReply, exportCase, deleteCaseData, setRole, failNextSend, reset, toast,
      makeCase: async (_graphId: string): Promise<string | null> => { toast('Ikke tilgjengelig i demo.', 'neutral'); return null; },
      connectMail: async () => {}, disconnectMail: async () => true, setSending: async (_: boolean) => true, syncNow: async () => true, refresh,
      ...remoteActions,
    },
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);
export function StoreProvider({ children, tenant = uvaagElektro, role = 'owner' }: { children: React.ReactNode; tenant?: TenantConfig; role?: UserRole }) {
  const v = useStoreValue(tenant, role);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useStore = () => useContext(Ctx)!;
