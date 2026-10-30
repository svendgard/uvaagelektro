import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Attachment, CaseStatus, Draft, EmailMessage, Priority } from '../domain/types';
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from '../config/tenant';
import { Icon, Modal, Portrait } from './ui';
import { ActorAvatar } from './Dashboard';
import { DEMO } from '../demo';
import { JobPanel, JobStageBadge } from './Projects';
import { cx, fmtDateTime, kr } from '../lib/util';
import { cleanMail, linkify } from '../lib/cleanMail';

/** Ren e-posttekst: bannere, plassholdere og sitert historikk ryddes bort. Lenker vises kort og klikkbart. */
export function MailBody({ body }: { body: string }) {
  const { text, quoted } = useMemo(() => cleanMail(body), [body]);
  const [showQuoted, setShowQuoted] = useState(false);
  const render = (t: string) => linkify(t).map((p, i) => 'href' in p
    ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand" title={p.href}>{p.label}</a>
    : <span key={i}>{p.t}</span>);
  return (
    <div className="text-[13px] leading-relaxed">
      <div className="whitespace-pre-wrap">{text ? render(text) : <span className="text-faint">(Ingen tekst)</span>}</div>
      {quoted && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowQuoted((v) => !v)} className="rounded-full bg-sunk px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-ink">
            {showQuoted ? 'Skjul tidligere e-poster' : '··· Vis tidligere e-poster'}
          </button>
          {showQuoted && <div className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 text-xs text-muted">{render(quoted)}</div>}
        </div>
      )}
    </div>
  );
}

export function AttachmentChip({ a, messageId, href: hrefOverride }: { a: Attachment; messageId?: string; href?: string }) {
  const href = DEMO ? undefined : hrefOverride ?? (messageId ? `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}` : undefined);
  const showThumb = !!href && a.kind === 'image' && /jpe?g|png|gif|webp/i.test(a.mimeType);
  const size = a.sizeKb >= 1024 ? `${(a.sizeKb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.sizeKb))} kB`;
  const inner = (
    <>
      {showThumb
        ? <img src={href} alt={a.filename} loading="lazy" className="h-14 w-14 shrink-0 rounded-md bg-sunk object-cover" />
        : <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', a.kind === 'image' ? 'bg-info-soft text-info' : 'bg-sunk text-muted')}><Icon name={a.kind === 'image' ? 'image' : 'file'} /></span>}
      <span className="min-w-0">
        <span className="block max-w-[160px] truncate font-semibold">{a.filename}</span>
        <span className="text-[11px] text-faint">{size}{DEMO ? ` · ${a.scan === 'clean' ? 'Skannet, ren' : a.scan === 'pending' ? 'Skannes …' : 'Blokkert'}` : ''}</span>
      </span>
    </>
  );
  const cls = 'inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs';
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className={cx(cls, 'hover:border-brand/40 hover:bg-brand-soft/40')}>{inner}</a> : <span className={cls}>{inner}</span>;
}

function Message({ m }: { m: EmailMessage }) {
  const { tenant } = useStore();
  const out = m.direction === 'outbound';
  const by = m.draftedBy && m.draftedBy !== 'owner' ? tenant.agents.find((a) => a.id === m.draftedBy)?.name : undefined;
  const ds = m.deliveryState;
  return (
    <article className={cx('flex flex-col gap-1', out ? 'items-end' : 'items-start')}>
      <div className={cx('w-full min-w-0 max-w-[640px] rounded-xl border px-4 py-3', out ? 'border-brand/25 bg-brand-soft' : 'border-line bg-surface')}>
        <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
          <span className="break-anywhere min-w-0"><b className="text-[13px] text-ink">{m.from.name}</b> <span className="text-muted">&lt;{m.from.email}&gt;</span></span>
          <time className="text-faint" dateTime={m.sentAt}>{fmtDateTime(m.sentAt)}</time>
        </header>
        <p className="break-anywhere mb-1 text-xs text-muted">Til: {m.to.map((t) => t.email).join(', ')} · <span className="font-semibold text-ink">{m.subject}</span></p>
        <MailBody body={m.body} />
        {m.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{m.attachments.map((a) => <AttachmentChip key={a.id} a={a} messageId={m.id} />)}</div>}
      </div>
      {out && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
          {by && <span className="text-muted">Utkast: {by} · godkjent av {tenant.owner.firstName}</span>}
          {!by && <span className="text-muted">Skrevet av {tenant.owner.firstName}</span>}
          {ds === 'confirmed' && <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 font-semibold text-ok"><Icon name="check" className="h-3 w-3" />{DEMO ? 'Bekreftet sendt (simulert)' : 'Sendt'}</span>}
          {ds === 'sending' && <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 font-semibold text-muted"><span className="h-1.5 w-1.5 rounded-full bg-faint pulse" />Sender · ikke bekreftet ennå</span>}
          {ds === 'failed' && <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 font-semibold text-bad"><Icon name="alert" className="h-3 w-3" />Ikke sendt · feilet</span>}
        </div>
      )}
    </article>
  );
}

/** Skyggemodus: agentene leser og foreslår, men ingenting sendes fra Agentkontoret. */
export const useShadowMode = () => { const { state } = useStore(); return !DEMO && !(state.mail?.connected && state.mail.sending_enabled); };

function CopyButton({ text, label = 'Kopier tekst' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn btn-accent" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* utilgjengelig */ } }}><Icon name={done ? 'check' : 'file'} />{done ? 'Kopiert' : label}</button>;
}

const LANG_BUTTONS = [['no', 'Norsk'], ['en', 'Engelsk'], ['sv', 'Svensk'], ['da', 'Dansk']] as const;

/** Ulagrede endringer i skjemaet tas vare på i nettleseren, så de overlever at siden oppdateres. */
function useDraftForm(d: Draft) {
  const key = `ak-utkast:${d.id}:${d.state === 'pending' ? 'forslag' : 'send'}`;
  const saved = { subject: d.subject, body: d.body, email: d.recipient ?? '', language: d.language ?? 'no' };
  const read = () => { try { const v = sessionStorage.getItem(key); return v ? { ...saved, ...JSON.parse(v) } : saved; } catch { return saved; } };
  const [form, setForm] = useState(read);
  useEffect(() => { setForm(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<typeof saved>) => setForm((f: typeof saved) => {
    const next = { ...f, ...patch };
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* utilgjengelig */ }
    return next;
  });
  const reset = () => { try { sessionStorage.removeItem(key); } catch { /* */ } setForm(saved); };
  const dirty = form.subject !== saved.subject || form.body !== saved.body || form.email !== saved.email;
  return { form, set, reset, dirty, clear: () => { try { sessionStorage.removeItem(key); } catch { /* */ } } };
}

function ApprovalPanel({ d }: { d: Draft }) {
  const { tenant, state, actions } = useStore();
  const ag = tenant.agents.find((a) => a.id === d.author);
  const { form, set, reset, dirty, clear } = useDraftForm(d);
  const [mode, setMode] = useState<'view' | 'reject' | 'regen' | 'confirm'>('view');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'save' | 'send' | 'translate' | 'rewrite'>(null);
  useEffect(() => { setMode('view'); setNote(''); }, [d.id, d.state]);
  const sending = !!state.sending[d.id] || d.state === 'sending';
  const canAct = state.role === 'owner';
  const shadow = useShadowMode();
  const kase = state.cases.find((c) => c.id === d.caseId)!;
  const inQueue = d.state === 'approved' || d.state === 'sending';
  const to = form.email || kase.customer.email;
  const kindLabel = { reply: 'svarutkast', info_request: 'svarutkast med spørsmål', quote: 'tilbudsutkast', follow_up: 'oppfølgingsmelding', extra_work: 'spørsmål om tilleggsarbeid' }[d.kind];
  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<unknown>) => { setBusy(what); try { return await fn(); } finally { setBusy(null); } };

  const approve = () => run('approve', async () => { if (await actions.approveDraft(d.id, { subject: form.subject, body: form.body, language: form.language })) clear(); });
  const save = () => run('save', async () => { if (await actions.saveApproved(d.id, { subject: form.subject, body: form.body, email: form.email, language: form.language })) clear(); });
  const send = () => run('send', async () => {
    if (dirty && !(await actions.saveApproved(d.id, { subject: form.subject, body: form.body, email: form.email, language: form.language }))) return;
    if (await actions.sendApproved(d.id)) clear();
    setMode('view');
  });
  const translateTo = (lang: string) => run('translate', async () => {
    const r = await actions.translateDraft(d.id, lang, form.subject, form.body);
    if (r) set({ subject: r.subject, body: r.body, language: lang });
  });
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(form.subject)}&body=${encodeURIComponent(form.body)}`;

  return (
    <section className={cx('rounded-xl border-2 p-4', d.error ? 'border-bad/60 bg-bad-soft/40' : inQueue ? 'border-ok/50 bg-ok-soft/40' : 'border-dashed border-accent/50 bg-accent-soft/40')} aria-label={inQueue ? 'Klar for sending' : 'Utkast til godkjenning'}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {ag && <Portrait p={ag.portrait} size={40} />}
        <div className="min-w-0 flex-1">
          <p className="text-[13px]"><b>{ag?.name ?? tenant.owner.firstName}</b> {d.author === 'owner' ? 'skrev en melding' : `har laget et ${kindLabel}`} <span className="text-muted">(v{d.version})</span></p>
          {inQueue
            ? <p className="text-xs font-bold uppercase tracking-wider text-ok">Godkjent{d.decidedAt ? ` ${fmtDateTime(d.decidedAt)}` : ''} · ikke sendt</p>
            : <p className="text-xs font-bold uppercase tracking-wider text-accent-ink">AI-forslag · ikke godkjent</p>}
        </div>
        {d.editedBy && inQueue && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">Redigert av {d.editedBy.split('@')[0]}</span>}
      </div>

      {d.error && <p className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad"><b>Sending feilet. Ingenting ble sendt.</b> {d.error}</p>}

      {!inQueue && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="label mb-0.5">Hvorfor dette svaret</p>
            <p className="text-[13px] text-ink">{d.rationale}</p>
            {d.feedback && <p className="mt-1 text-xs text-muted">Skrevet på nytt etter beskjed: «{d.feedback}»</p>}
          </div>
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="label mb-0.5">Mangler</p>
            {d.missing.length ? <ul className="text-[13px]">{d.missing.map((m) => <li key={m}>• {m}</li>)}</ul> : <p className="text-[13px] text-muted">Ingenting vesentlig.</p>}
          </div>
        </div>
      )}
      {!inQueue && d.requiresHumanJudgement.length > 0 && (
        <div className="mb-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2">
          <p className="label mb-0.5 !text-warn">Krever din vurdering</p>
          <ul className="text-[13px]">{d.requiresHumanJudgement.map((m) => <li key={m} className="flex gap-1.5"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />{m}</li>)}</ul>
        </div>
      )}
      {d.priceLines && d.priceLines.length > 0 && (
        <div className="mb-3 rounded-lg bg-surface px-3 py-2">
          <p className="label mb-1">Priser fra godkjente prismaler</p>
          {d.priceLines.map((p) => (
            <div key={p.label} className="flex flex-wrap justify-between gap-2 text-[13px]"><span>{p.label}</span><b className="tnum">{kr(p.amount)}</b><span className="w-full text-[11px] text-faint">Kilde: {p.source}</span></div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {inQueue && <>
          <label className="text-xs font-semibold text-muted" htmlFor={`to-${d.id}`}>Til</label>
          <input id={`to-${d.id}`} type="email" className="field" value={form.email} placeholder={kase.customer.email} onChange={(e) => set({ email: e.target.value })} disabled={sending || !canAct} />
        </>}
        <label className="text-xs font-semibold text-muted" htmlFor={`subj-${d.id}`}>Emne</label>
        <input id={`subj-${d.id}`} className="field" value={form.subject} onChange={(e) => set({ subject: e.target.value })} disabled={sending || !canAct} />
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="text-xs font-semibold text-muted" htmlFor={`body-${d.id}`}>Melding{!inQueue && <> til {kase.customer.name} &lt;{kase.customer.email}&gt;</>}</label>
          {canAct && !sending && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Språk">
              {LANG_BUTTONS.map(([id, label]) => (
                <button key={id} type="button" disabled={!!busy} onClick={() => void translateTo(id)}
                  className={cx('rounded-full border px-2 py-0.5 text-[11px] font-semibold', form.language === id ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted hover:text-ink')}>{busy === 'translate' && form.language !== id ? '…' : label}</button>
              ))}
            </div>
          )}
        </div>
        <textarea id={`body-${d.id}`} className="field min-h-[200px] font-sans leading-relaxed" value={form.body} onChange={(e) => set({ body: e.target.value })} disabled={sending || !canAct} />
        {dirty && !sending && (
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-accent-ink">
            {inQueue ? 'Ulagrede endringer.' : 'Endret – det er denne versjonen som godkjennes.'}
            <button className="underline" onClick={reset}>Tilbakestill</button>
          </p>
        )}
      </div>

      {mode === 'reject' && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface p-3">
          <label htmlFor={`rej-${d.id}`} className="text-xs font-semibold">Hvorfor avvises utkastet? (valgfritt, lagres i loggen)</label>
          <input id={`rej-${d.id}`} className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. kunden er allerede ringt" />
          <div className="flex gap-2"><button className="btn btn-danger" onClick={() => { clear(); actions.rejectDraft(d.id, note); }}>Avvis utkastet</button><button className="btn btn-ghost" onClick={() => setMode('view')}>Avbryt</button></div>
        </div>
      )}
      {mode === 'regen' && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface p-3">
          <label htmlFor={`regen-${d.id}`} className="text-xs font-semibold">Beskjed til {ag?.name ?? 'agenten'} (valgfritt)</label>
          <input id={`regen-${d.id}`} className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. kortere, og foreslå befaring torsdag" />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void run('rewrite', async () => { clear(); await actions.regenerate(d.id, note); })}><Icon name="refresh" />{busy === 'rewrite' ? 'Skriver …' : 'Skriv på nytt'}</button>
            <button className="btn btn-ghost" onClick={() => setMode('view')}>Avbryt</button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!inQueue && <>
          <button className="btn btn-accent" disabled={!!busy || !canAct} onClick={() => void approve()}><Icon name="check" />{busy === 'approve' ? 'Godkjenner …' : dirty ? 'Godkjenn redigert versjon' : 'Godkjenn'}</button>
          <button className="btn btn-ghost" disabled={!!busy || !canAct} onClick={() => { setMode('regen'); setNote(''); }}><Icon name="refresh" />Skriv på nytt</button>
          <button className="btn btn-danger" disabled={!!busy || !canAct} onClick={() => { setMode('reject'); setNote(''); }}><Icon name="x" />Avvis</button>
        </>}
        {inQueue && <>
          {!shadow && mode !== 'confirm' && (
            <button className="btn btn-accent" disabled={sending || !!busy || !canAct} onClick={() => setMode('confirm')}>
              {sending ? <><span className="h-2 w-2 rounded-full bg-white pulse" />Sender · venter på bekreftelse</> : <><Icon name="send" />{d.error ? 'Prøv å sende igjen' : 'Send'}</>}
            </button>
          )}
          {!shadow && mode === 'confirm' && <>
            <button className="btn btn-accent" disabled={!!busy} onClick={() => void send()}><Icon name="send" />{busy === 'send' ? 'Sender …' : `Bekreft: send til ${to}`}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => setMode('view')}>Avbryt</button>
          </>}
          {dirty && mode !== 'confirm' && !sending && <button className="btn btn-ghost" disabled={!!busy || !canAct} onClick={() => void save()}>{busy === 'save' ? 'Lagrer …' : 'Lagre endringer'}</button>}
          {mode !== 'confirm' && !sending && <>
            <a className="btn btn-ghost" href={mailto}><Icon name="mail" />Åpne i e-post</a>
            <CopyButton text={form.body} />
            <button className="btn btn-ghost" disabled={!!busy || !canAct} onClick={() => { setMode('regen'); setNote(''); }}><Icon name="refresh" />Skriv på nytt</button>
            <button className="btn btn-danger" disabled={!!busy || !canAct} onClick={() => { setMode('reject'); setNote(''); }}><Icon name="x" />Avvis</button>
          </>}
        </>}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {!canAct ? <>Din rolle kan lese, men ikke godkjenne eller sende.</>
          : !inQueue ? <>Ingenting sendes når du godkjenner. Godkjente utkast legges klare for sending, og du sender med et eget klikk.</>
          : shadow ? <>Sending fra Agentkontoret er slått av. Åpne i e-post eller kopier teksten, og send fra Outlook. Svaret ditt knyttes til saken automatisk.</>
          : <>Sendes fra {tenant.mail.mailbox} i samme e-posttråd. Meldingen vises som sendt først når Microsoft har bekreftet.</>}
      </p>
    </section>
  );
}

function Composer({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const { state, tenant, actions } = useStore();
  const c = state.cases.find((x) => x.id === caseId)!;
  const last = state.messages.filter((m) => m.threadId === c.threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt)).at(-1);
  const [subject, setSubject] = useState(last ? (last.subject.startsWith('SV:') ? last.subject : `SV: ${last.subject}`) : c.title);
  const [body, setBody] = useState(`Hei ${c.customer.name.split(' ')[0]},\n\n\n\n${tenant.signature}`);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const shadow = useShadowMode();
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold">Skriv melding selv</p>
      <label className="sr-only" htmlFor={`ms-${caseId}`}>Emne</label>
      <input id={`ms-${caseId}`} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <label className="sr-only" htmlFor={`mb-${caseId}`}>Melding</label>
      <textarea id={`mb-${caseId}`} className="field min-h-[160px]" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        {shadow ? <CopyButton text={body} /> : !confirm ? (
          <button className="btn btn-primary" disabled={busy || state.role !== 'owner' || !body.trim()} onClick={() => setConfirm(true)}>
            <Icon name="send" />Send
          </button>
        ) : (
          <button className="btn btn-accent" disabled={busy} onClick={async () => { setBusy(true); await actions.sendManual(caseId, subject, body); setBusy(false); onDone(); }}>
            <Icon name="send" />{busy ? 'Sender …' : `Bekreft: send til ${c.customer.email}`}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => (confirm ? setConfirm(false) : onDone())}>Avbryt</button>
      </div>
      {shadow && <p className="text-[11px] text-muted">Sending er av (skyggemodus). Kopier teksten og send fra Outlook.</p>}
    </section>
  );
}

export function CaseDetail({ caseId, onClose }: { caseId: string | null; onClose: () => void }) {
  const { state, tenant, actions } = useStore();
  const c = state.cases.find((x) => x.id === caseId);
  const [compose, setCompose] = useState(false);
  const [tab, setTab] = useState<'job' | 'mail'>('job');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  useEffect(() => { setTab('job'); setCompose(false); setConfirmDelete(false); setExported(null); if (caseId && c?.unreadCustomerReply) actions.markRead(caseId); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  const thread = useMemo(() => c ? state.messages.filter((m) => m.threadId === c.threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt)) : [], [c, state.messages]);
  if (!caseId) return null;
  if (!c) return <Modal open onClose={onClose} title="Sak"><p className="p-5 text-muted">Saken finnes ikke lenger.</p></Modal>;

  const draft = [...state.drafts].reverse().find((d) => d.caseId === c.id && (d.state === 'pending' || d.state === 'approved' || d.state === 'sending' || d.state === 'send_failed'));
  const busyAgent = (Object.entries(state.busy) as [string, { caseId?: string; text: string } | undefined][]).find(([, b]) => b?.caseId === c.id);
  const ag = tenant.agents.find((a) => a.id === c.assignedAgent)!;
  const canQuote = c.status === 'ready_for_quote';
  const canFollow = c.status === 'follow_up' || c.status === 'quote_sent';
  const waitingCustomer = c.status === 'awaiting_customer' || c.status === 'quote_sent' || c.status === 'follow_up';

  return (
    <Modal open onClose={onClose} title={`${c.number} · ${c.customer.name}`} wide>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="cd-status">Status</label>
          <select id="cd-status" value={c.status} onChange={(e) => actions.moveCase(c.id, e.target.value as CaseStatus)} className={cx('rounded-full border-0 px-3 py-1 text-xs font-bold', STATUS_META[c.status].tone)}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <label className="sr-only" htmlFor="cd-prio">Prioritet</label>
          <select id="cd-prio" value={c.priority} onChange={(e) => actions.setPriority(c.id, e.target.value as Priority)} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold">
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => <option key={p} value={p}>Prioritet: {PRIORITY_META[p].label}</option>)}
          </select>
          <span className="text-xs text-muted">{tenant.jobTypes[c.jobType].label} · opprettet {fmtDateTime(c.createdAt)}</span>
        </div>

        {c.flagged && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-bad/40 bg-bad-soft px-4 py-3">
            <Icon name="flag" className="h-5 w-5 text-bad" />
            <p className="min-w-0 flex-1 text-[13px]"><b className="text-bad">Krever rask oppfølging.</b> {c.flagged.reason}</p>
            {c.customer.phone && <span className="inline-flex items-center gap-1 rounded-lg bg-surface px-2 py-1 font-mono text-xs"><Icon name="phone" className="h-3.5 w-3.5" />{c.customer.phone}</span>}
            <button className="btn btn-ghost" onClick={() => actions.resolveFlag(c.id)}>Marker som håndtert</button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-3">
            {c.job && (
              <div className="flex items-center gap-1.5" role="tablist" aria-label="Visning">
                <button role="tab" aria-selected={tab === 'job'} onClick={() => setTab('job')} className={cx('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', tab === 'job' ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted')}><Icon name="wrench" className="h-3.5 w-3.5" />Oppdrag</button>
                <button role="tab" aria-selected={tab === 'mail'} onClick={() => setTab('mail')} className={cx('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', tab === 'mail' ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-muted')}><Icon name="mail" className="h-3.5 w-3.5" />E-post ({thread.length})</button>
                <span className="ml-auto"><JobStageBadge stage={c.job.stage} /></span>
              </div>
            )}
            {c.job && tab === 'job' && <JobPanel c={c} />}
            {c.job && tab === 'job' && draft && <ApprovalPanel d={draft} />}
            {(!c.job || tab === 'mail') && <>
            <p className="label">E-posttråd · {thread.length} meldinger</p>
            {thread.map((m) => <Message key={m.id} m={m} />)}

            {busyAgent && (
              <div className="flex items-center gap-3 rounded-xl border border-violet/30 bg-violet-soft px-4 py-3 text-[13px] text-violet">
                <span className="h-2 w-2 rounded-full bg-violet pulse" />{busyAgent[1]!.text}
              </div>
            )}
            {draft && <ApprovalPanel d={draft} />}

            {!draft && !busyAgent && !compose && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-line bg-sunk/60 p-3">
                {canQuote && <button className="btn btn-primary" onClick={() => actions.requestDraft(c.id, 'quote')}><Icon name="sparkle" />Be AIOliver lage tilbudsutkast</button>}
                {canFollow && <button className="btn btn-primary" onClick={() => actions.requestDraft(c.id, 'follow_up')}><Icon name="sparkle" />Be AINora lage oppfølging</button>}
                {(c.status === 'new' || c.status === 'ai_processing') && <button className="btn btn-primary" onClick={() => actions.requestDraft(c.id)}><Icon name="sparkle" />Be AIOliver lage svarutkast</button>}
                <button className="btn btn-ghost" onClick={() => setCompose(true)}><Icon name="pen" />Skriv selv</button>
                {DEMO && waitingCustomer && <button className="btn btn-ghost" onClick={() => actions.simulateCustomerReply(c.id)}><Icon name="mail" />Simuler kundesvar (demo)</button>}
              </div>
            )}
            {draft && !compose && <button className="self-start text-xs font-semibold text-brand hover:underline" onClick={() => setCompose(true)}>Skriv og send en melding manuelt i stedet</button>}
            {compose && <Composer caseId={c.id} onDone={() => setCompose(false)} />}
            </>}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <div className="rounded-xl bg-sunk/70 p-3">
              <p className="label mb-1 flex items-center gap-1"><Icon name="sparkle" className="h-3 w-3" />AI-sammendrag</p>
              <p className="text-[13px]">{c.summary}</p>
              <p className="label mb-1 mt-3">Forslag til neste handling</p>
              <p className="text-[13px] font-semibold">{c.nextAction}</p>
              {c.missingInfo.length > 0 && (<><p className="label mb-1 mt-3">Mangler</p><ul className="text-[13px] text-warn">{c.missingInfo.map((m) => <li key={m}>• {m}</li>)}</ul></>)}
            </div>
            <div>
              <p className="label mb-1.5">Kunde</p>
              <div className="flex flex-col gap-1 text-[13px]">
                <b>{c.customer.name}</b>
                {c.customer.company && <span>{c.customer.company}{c.customer.orgNr && ` · org.nr ${c.customer.orgNr}`}</span>}
                <span className="flex items-center gap-1.5 break-all text-muted"><Icon name="mail" className="h-3.5 w-3.5 shrink-0" />{c.customer.email}</span>
                {c.customer.phone && <span className="flex items-center gap-1.5 text-muted"><Icon name="phone" className="h-3.5 w-3.5" />{c.customer.phone}</span>}
                {c.customer.address && <span className="flex items-center gap-1.5 text-muted"><Icon name="pin" className="h-3.5 w-3.5" />{c.customer.address}</span>}
                <span className="text-xs text-faint">{c.customer.type === 'naering' ? 'Næringskunde' : 'Privatkunde'}</span>
              </div>
            </div>
            <div>
              <p className="label mb-1.5">Oppdrag</p>
              <p className="text-[13px]"><b>{tenant.jobTypes[c.jobType].label}.</b> {c.description}</p>
              {c.estimatedValue && <p className="mt-1 text-xs text-muted">Anslått verdi: {kr(c.estimatedValue)}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Portrait p={ag.portrait} size={32} />
              <p className="text-[13px]"><b>{ag.name}</b> jobber med saken<br /><span className="text-xs text-muted">{ag.title}</span></p>
            </div>
            <div>
              <p className="label mb-1.5">Tidslinje</p>
              <ol className="relative flex flex-col gap-2 border-l border-line pl-4">
                {[...c.events].reverse().map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[25px] top-0"><ActorAvatar actor={e.actor} size={18} /></span>
                    <p className="text-[12.5px] leading-snug">{e.text}</p>
                    <p className="text-[11px] text-faint">{fmtDateTime(e.at)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="border-t border-line pt-3">
              <p className="label mb-1.5">Personvern</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost" onClick={() => setExported(actions.exportCase(c.id))}><Icon name="download" />Eksporter</button>
                {!confirmDelete ? <button className="btn btn-danger" disabled={state.role !== 'owner'} onClick={() => setConfirmDelete(true)}><Icon name="trash" />Slett kundedata</button>
                  : <span className="flex flex-wrap items-center gap-2 text-xs">Slette sak, tråd og utkast? <button className="btn btn-danger" onClick={() => { actions.deleteCaseData(c.id); onClose(); }}>Ja, slett</button><button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Avbryt</button></span>}
              </div>
              {exported && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] text-muted">Eksport (JSON). I produksjon lastes dette ned som fil.</p>
                  <textarea readOnly className="field h-32 font-mono text-[10px]" value={exported} aria-label="Eksporterte data" />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
