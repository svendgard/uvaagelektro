import type { Case, EmailMessage, JobType, Priority } from '../../domain/types';
import type { TenantConfig } from '../../config/tenant';
import type { AgentEngine, DraftInput, TriageResult } from './AgentEngine';

/**
 * Regelbasert stand-in for AI-modellen. Gir forutsigbare, realistiske resultater i demoen.
 * Byttes mot en LLM-implementasjon uten endringer i UI.
 */

const JOB_KEYWORDS: [JobType, RegExp][] = [
  ['naering', /\b(as|asa|org\.?\s?nr|borettslag|sameie|butikk|kontor(lokale)?|lager|næring|restaurant)\b/i],
  ['elbillader', /elbil|lader|ladeboks|easee|zaptec/i],
  ['sikringsskap', /sikringsskap|sikringsboks|skrusikring|automatsikring|el-?tavle|overspenningsvern/i],
  ['feilsoking', /jordfeil|slår ut|går ut|feil(søk)?|brannlukt|svidd|flimr|strømløs|uten strøm|gnister|varm(e)? (kontakt|bryter)/i],
  ['smarthus', /smarthus|smart ?hjem|knx|futurehome|homey|styring|varmestyring/i],
  ['belysning', /belysning|downlight|spotter|lys(punkt|kilde)?|led-?list|lampe/i],
  ['oppussing', /oppussing|renover|nytt bad|bad(e)?rom|kjøkken/i],
  ['stikkontakter', /stikkontakt|kontakt(er)?|uttak|usb/i],
];

const MISSING_RULES: Record<JobType, { label: string; present: (t: string, imgs: number) => boolean }[]> = {
  elbillader: [
    { label: 'Størrelse på hovedsikring (ampere)', present: (t) => /\b\d{2,3}\s?(a|amp)\b/i.test(t) },
    { label: 'Avstand fra sikringsskap til parkeringsplass', present: (t) => /\b\d+\s?(m|meter)\b/i.test(t) },
    { label: 'Bilde av sikringsskapet', present: (_t, i) => i > 0 },
  ],
  sikringsskap: [
    { label: 'Bilde av dagens sikringsskap', present: (_t, i) => i > 0 },
    { label: 'Omtrentlig alder på anlegget', present: (t) => /(19|20)\d\d|år gammel|fra \d/i.test(t) },
    { label: 'Ønsket tidspunkt for arbeidet', present: (t) => /uke|måned|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember|snart|før jul/i.test(t) },
  ],
  stikkontakter: [
    { label: 'Antall stikkontakter', present: (t) => /\b(\d+|to|tre|fire|fem|seks)\s+(nye\s+)?(stikk|kontakt|uttak|doble)/i.test(t) },
    { label: 'Åpent eller skjult anlegg', present: (t) => /åpent|skjult|innfelt|utenpå/i.test(t) },
    { label: 'Bilder av rommet', present: (_t, i) => i > 0 },
  ],
  feilsoking: [
    { label: 'Hvilke kurser/rom som er berørt', present: (t) => /kurs|rom|kjøkken|bad|stue|soverom|kjeller/i.test(t) },
    { label: 'Når problemet startet', present: (t) => /i dag|i går|siden|uke|morges|kveld/i.test(t) },
    { label: 'Telefonnummer for rask kontakt', present: (t) => /\b\d{3}\s?\d{2}\s?\d{3}\b|\b\d{8}\b/.test(t) },
  ],
  belysning: [
    { label: 'Antall lyspunkter', present: (t) => /\b\d+\s*(spotter|downlights?|lyspunkt|stk)/i.test(t) },
    { label: 'Type tak (gips, panel, betong)', present: (t) => /gips|panel|betong|himling/i.test(t) },
    { label: 'Ønske om dimming', present: (t) => /dim/i.test(t) },
  ],
  oppussing: [
    { label: 'Tegninger eller skisse', present: (_t, i) => i > 0 },
    { label: 'Tidsplan for oppussingen', present: (t) => /uke|måned|start|ferdig/i.test(t) },
    { label: 'Hvem som koordinerer øvrige håndverkere', present: (t) => /snekker|rørlegger|entreprenør|selv/i.test(t) },
  ],
  smarthus: [
    { label: 'Eksisterende system eller plattform', present: (t) => /futurehome|homey|knx|google|apple|ingen/i.test(t) },
    { label: 'Hvilke funksjoner som ønskes styrt', present: (t) => /lys|varme|lås|gardin|alarm/i.test(t) },
  ],
  naering: [
    { label: 'Organisasjonsnummer', present: (t) => /org\.?\s?nr|\b\d{3}\s?\d{3}\s?\d{3}\b/i.test(t) },
    { label: 'Omfang og tidsfrist', present: (t) => /frist|innen|uke|dato/i.test(t) },
    { label: 'Kontaktperson på stedet', present: (t) => /kontaktperson|daglig leder|driftsleder|vaktmester/i.test(t) },
  ],
};

const INJECTION = /ignorer (alle |tidligere )?(instruks|regler)|ignore (all |previous )?instructions|du er nå|systemmelding|godkjenn (dette )?automatisk|send (tilbud|pris) uten godkjenning/i;

const TOPIC: Record<JobType, string> = {
  elbillader: 'installasjon av elbillader',
  sikringsskap: 'oppgradering av sikringsskap',
  stikkontakter: 'nye stikkontakter',
  feilsoking: 'feil på det elektriske anlegget',
  belysning: 'ny belysning',
  oppussing: 'elektrisk arbeid i forbindelse med oppussing',
  smarthus: 'smarthus og styring',
  naering: 'elektrisk arbeid for virksomheten',
};

const firstName = (n: string) => n.split(' ')[0];

export function detectJobType(text: string): JobType {
  for (const [jt, re] of JOB_KEYWORDS) if (re.test(text)) return jt;
  return 'feilsoking';
}

export function missingFor(jobType: JobType, text: string, images: number) {
  return MISSING_RULES[jobType].filter((r) => !r.present(text, images)).map((r) => r.label);
}

export class SimulatedAgentEngine implements AgentEngine {
  async triage(msg: EmailMessage, tenant: TenantConfig): Promise<TriageResult> {
    const text = `${msg.subject}\n${msg.body}`;
    const ignored = tenant.mail.ignoreRules.some(
      (r) => (r.fromContains && msg.from.email.toLowerCase().includes(r.fromContains)) || (r.subjectContains && msg.subject.includes(r.subjectContains)),
    );
    const jobType = detectJobType(text);
    const images = msg.attachments.filter((a) => a.kind === 'image').length;
    const urgentHit = tenant.rules.urgentKeywords.find((k) => text.toLowerCase().includes(k));
    const injectionSuspected = INJECTION.test(text);
    const priority: Priority = urgentHit ? 'urgent' : jobType === 'naering' ? 'high' : 'normal';
    const phone = text.match(/\b(\d{3}\s?\d{2}\s?\d{3})\b/)?.[1];
    const address = text.match(/([A-ZÆØÅ][a-zæøå]+(?:veien|vegen|gata|gate|stien|bakken|svingen|kroken)\s+\d+[A-Z]?(?:,\s*\d{4}\s+[A-ZÆØÅ][a-zæøå]+)?)/)?.[1];
    return {
      isCustomerInquiry: !ignored,
      reason: ignored ? 'Avsender matcher regel for nyhetsbrev/automatisk e-post.' : 'Avsender ber om elektrikerarbeid.',
      jobType,
      customer: { name: msg.from.name, email: msg.from.email, phone, address, type: jobType === 'naering' ? 'naering' : 'privat' },
      title: `${tenant.jobTypes[jobType].label} – ${msg.from.name}`,
      summary: `${firstName(msg.from.name)} ønsker hjelp med ${TOPIC[jobType]}.${address ? ` Adresse: ${address}.` : ''}${images ? ` Har sendt ${images} bilde${images > 1 ? 'r' : ''}.` : ''}`,
      missingInfo: missingFor(jobType, text, images),
      priority,
      flag: urgentHit ? { reason: `Kunden nevner «${urgentHit}». Mulig sikkerhetsrisiko – ring kunden.` } : injectionSuspected ? { reason: 'E-posten inneholder tekst som prøver å styre agentene. Behandlet som vanlig tekst.' } : undefined,
      injectionSuspected,
    };
  }

  async draft({ kase, thread, tenant, kind, variant = 0, ownerFeedback }: DraftInput) {
    await new Promise((r) => setTimeout(r, 900));
    const fn = firstName(kase.customer.name);
    const lastInbound = [...thread].reverse().find((m) => m.direction === 'inbound');
    const k = kind ?? (kase.status === 'ready_for_quote' ? 'quote' : kase.status === 'follow_up' || kase.status === 'quote_sent' ? 'follow_up' : kase.missingInfo.length ? 'info_request' : 'reply');
    const sig = tenant.signature;
    const subject = lastInbound ? (lastInbound.subject.startsWith('SV:') ? lastInbound.subject : `SV: ${lastInbound.subject}`) : `SV: ${kase.title}`;
    const humanJudgement: string[] = [];
    if (kase.flagged) humanJudgement.push(`Saken er flagget: ${kase.flagged.reason}`);

    if (k === 'extra_work') {
      const open = kase.job?.report?.extraWork.filter((e) => e.customerApproved === null) ?? [];
      const rate = tenant.billing.hourlyRate;
      const list = open.map((e) => `• ${e.description}: ${e.hours.toLocaleString('nb-NO')} t à kr ${rate} eks. mva`).join('\n');
      return {
        caseId: kase.id, kind: k, author: 'followup' as const, subject: `Tilleggsarbeid – ${kase.customer.address ?? kase.title}`,
        body: `Hei ${fn},\n\nTakk for at vi fikk gjøre jobben. Mens montøren var hos deg ble det også gjort følgende, som ikke var med i tilbudet:\n\n${list}\n\nKan du bekrefte at dette er i orden, så tar vi det med på fakturaen? Svar gjerne bare «ok» på denne e-posten.\n\n${sig}`,
        rationale: 'Montøren har meldt tilleggsarbeid som ikke er avklart med kunden. Skriftlig bekreftelse før fakturering unngår uenighet.',
        missing: [], requiresHumanJudgement: ['Bekreft at timetallet og timeprisen er riktig før sending.'],
      };
    }

    if (k === 'follow_up') {
      const body = variant % 2 === 0
        ? `Hei ${fn},\n\nJeg ville bare høre om du har fått sett på tilbudet vi sendte om ${TOPIC[kase.jobType]}.\n\nSi gjerne fra om noe er uklart, eller om du ønsker å justere omfanget. Vi har kapasitet til å starte i løpet av de neste ukene.\n\n${sig}`
        : `Hei ${fn},\n\nEn kort påminnelse om tilbudet på ${TOPIC[kase.jobType]}. Gi beskjed om du vil gå videre, eller om du har spørsmål.\n\n${sig}`;
      return {
        caseId: kase.id, kind: k, author: 'followup' as const, subject, body,
        rationale: `Kunden har ikke svart på ${tenant.rules.followUpAfterDays} dager etter at tilbudet ble sendt. En høflig påminnelse øker sjansen for svar.`,
        missing: [], requiresHumanJudgement: [...humanJudgement, 'Bekreft at kapasitetsangivelsen stemmer.'],
      };
    }

    if (k === 'quote') {
      const templates = tenant.priceTemplates.filter((p) => p.jobType === kase.jobType);
      const priceLines = templates.map((t) => ({ label: t.label, amount: t.amount, source: `Prismal ${t.id} (${t.note})` }));
      if (!templates.length) humanJudgement.push('Ingen godkjent prismal for denne oppdragstypen. Espen må sette pris.');
      humanJudgement.push('Bekreft teknisk løsning og omfang før tilbudet sendes.');
      const priceText = templates.length
        ? templates.map((t) => `• ${t.label}: kr ${t.amount.toLocaleString('nb-NO')} (${t.unit})`).join('\n')
        : '• [PRIS SETTES AV ESPEN]';
      return {
        caseId: kase.id, kind: k, author: 'quote' as const, subject: `Tilbud: ${tenant.jobTypes[kase.jobType].label} – ${kase.customer.address ?? kase.customer.name}`,
        body: `Hei ${fn},\n\nTakk for informasjonen. Her er vårt tilbud på ${TOPIC[kase.jobType]}:\n\n${priceText}\n\nTilbudet forutsetter at forholdene på stedet er som beskrevet. Eventuelt tilleggsarbeid avtales før det utføres. Tilbudet gjelder i 30 dager.\n\n${sig}`,
        rationale: 'Saken har nok informasjon til et tilbud. Prisene er hentet fra godkjente prismaler, ikke beregnet av agenten.',
        missing: [], requiresHumanJudgement: humanJudgement, priceLines,
      };
    }

    const missing = kase.missingInfo;
    const questions = missing.length ? `\n\nFor å kunne gi deg et riktig tilbud trenger vi litt mer informasjon:\n${missing.map((m) => `• ${m}`).join('\n')}` : '';
    const urgent = kase.priority === 'urgent'
      ? `\n\nUt fra det du beskriver vil vi gjerne snakke med deg så raskt som mulig. Vi ringer deg i dag.`
      : '';
    const openers = [
      `Takk for at du tok kontakt med ${tenant.company.shortName} om ${TOPIC[kase.jobType]}.`,
      `Takk for henvendelsen. Vi hjelper gjerne til med ${TOPIC[kase.jobType]}.`,
      `Så bra at du tok kontakt. ${TOPIC[kase.jobType][0].toUpperCase()}${TOPIC[kase.jobType].slice(1)} er noe vi gjør ofte.`,
    ];
    const close = missing.length ? '\n\nSend gjerne bilder som svar på denne e-posten.' : '\n\nVi kommer tilbake til deg med et forslag til tidspunkt for befaring.';
    if (kase.priority === 'urgent') humanJudgement.push('Vurder om kunden bør få sikkerhetsråd på telefon. Agenten gir ikke tekniske råd skriftlig.');
    if (ownerFeedback) humanJudgement.push(`Nytt forslag laget etter innspill: «${ownerFeedback}»`);
    return {
      caseId: kase.id, kind: k, author: 'quote' as const, subject,
      body: `Hei ${fn},\n\n${openers[variant % openers.length]}${urgent}${questions}${close}\n\n${sig}`,
      rationale: missing.length
        ? `Henvendelsen mangler ${missing.length} opplysning${missing.length > 1 ? 'er' : ''} som trengs for et tilbud. Svaret ber om dette uten å love pris eller løsning.`
        : 'Henvendelsen er komplett nok til å foreslå befaring. Svaret lover ingen pris.',
      missing, requiresHumanJudgement: humanJudgement,
    };
  }
}

export const agentEngine = new SimulatedAgentEngine();

export function caseNeedsFollowUp(c: Case, now: Date, days: number) {
  return (c.status === 'quote_sent' || c.status === 'awaiting_customer') && now.getTime() - new Date(c.updatedAt).getTime() > days * 864e5;
}
