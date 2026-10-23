import { DEMO } from '../demo';
import type { AgentConfig, AutomationLevel, CaseStatus, DocKey, JobStage, JobType, Priority, Technician } from '../domain/types';

/**
 * Kundekonfigurasjon (tenant). Alt som skiller én håndverksbedrift fra en annen
 * ligger her: navn, eier, agentroller, oppdragstyper, prismaler, prosessregler og e-postkonto.
 * En ny kunde = en ny TenantConfig, ingen endring i UI-koden.
 */
export interface TenantConfig {
  id: string;
  company: { name: string; shortName: string; orgNr: string; email: string; phone: string; city: string; monogram: string };
  owner: { name: string; firstName: string; email: string; role: 'owner' };
  agents: AgentConfig[];
  jobTypes: Record<JobType, { label: string; short: string }>;
  automation: { level: AutomationLevel };
  mail: {
    provider: 'simulated' | 'microsoft_graph' | 'gmail';
    mailbox: string;
    /** Kundens Microsoft-miljø (Entra tenant-ID). Bare innlogging herfra godtas. */
    msTenantId?: string;
    /** Avsendere/emner som aldri skal bli saker. */
    ignoreRules: { fromContains?: string; subjectContains?: string }[];
    /** Sending fra Agentkontoret er på fra tilkoblingen. Alt krever fortsatt «Godkjenn» og «Send». Av = skyggemodus. */
    sendingOnConnect?: boolean;
  };
  /** Retningslinjer for tone og innhold i e-poster agentene skriver. Redigerbar per kunde. */
  writingBrief?: string;
  /** Godkjente prismaler. AIOliver kan bare bruke tall herfra. Eksempeltall, må erstattes av Espens egne. */
  priceTemplates: { id: string; jobType: JobType; label: string; amount: number; unit: string; note: string }[];
  rules: {
    responseTargetHours: number;
    followUpAfterDays: number;
    stalledAfterHours: number;
    /** Ord/tema som alltid krever rask menneskelig vurdering. */
    urgentKeywords: string[];
  };
  signature: string;
  /** Montørene. Espen er også montør. */
  technicians: Technician[];
  /** Prosjektkontroll og fakturagrunnlag. Alle tall er eksempler. */
  billing: {
    hourlyRate: number; // eks. mva
    vatRate: number;
    /** Utdrag fra grossistens prisfil (EFONELFO), med påslag. Eksempeldata. */
    materials: Record<string, { name: string; unit: string; price: number }>;
    /** Fastprispakker for småjobber. */
    fixedPackages: { id: string; label: string; amount: number; includesHours: number }[];
    /** Avvik i timer som tolereres før AISofie varsler. */
    hoursTolerance: number;
  };
  accounting: { provider: 'simulated' | 'tripletex'; company: string };
  /** Hvilke deler av løsningen som er i bruk. Fase 1: e-post og tilbud. */
  features: { projects: boolean };
  /** Agent-ID-er i Tech Haus' Agent Dashboard. Må være registrert på kilden AGENT_DASHBOARD_SOURCE. */
  monitoring: { mailSyncAgentId: string };
  /** Dokumentasjon som kreves per oppdragstype før kontroll. */
  docRequirements: Record<JobType, DocKey[]>;
}

/**
 * Skrivestil for e-post fra Uvaag Elektro. Endre her for å justere tone og innhold.
 * Brukes av AIOliver og AINora i alle utkast, og når Espen ber om «Skriv på nytt».
 */
export const CONTACT_BRIEF_UVAAG = `Tone: vennlig, rett på sak og jordnær, slik en erfaren elektriker skriver. «Hei Kari,» som åpning. Du-form. Ingen utropstegn i hver setning, ingen emojier, ingen salgsfraser.
Lengde: kort. Vanligvis 3–8 linjer før signaturen. Ett tema per avsnitt. Spørsmål til kunden som punktliste når det er flere.
Innhold: svar på det kunden faktisk spør om. Bruk bare opplysninger som står i e-posttråden eller i godkjente prismaler. Dikt aldri opp navn, telefonnummer, adresser, datoer, priser eller tekniske løsninger. Nevn aldri interne systemer (Agentkontoret, AI, agenter, CRM, database, saksnummer).
Avslutning: én konkret neste handling (f.eks. «Send gjerne et bilde av sikringsskapet, så gir vi deg en pris.»). Deretter signaturen nøyaktig som oppgitt.

Riktig tone:
«Hei Kari,

Takk for henvendelsen. Vi monterer gjerne elbillader i carporten.

For å gi deg en pris trenger vi:
• Bilde av sikringsskapet
• Omtrentlig avstand fra skapet til carporten

Med vennlig hilsen
Espen Uvaag
Uvaag Elektro AS»

Feil tone (for lang, for selgende, lover ting):
«Hei og tusen takk for din fantastiske henvendelse!!! Vi i Uvaag Elektro er Norges beste … Vi kan komme allerede i morgen og prisen blir ca. 15 000 kr …»`;

const uvaagElektroBase: TenantConfig = {
  id: 'uvaag-elektro',
  company: {
    name: 'Uvaag Elektro AS',
    shortName: 'Uvaag Elektro',
    orgNr: '',
    email: 'espen@uvaagelektro.no',
    phone: '',
    city: 'Kristiansand',
    monogram: 'UE',
  },
  owner: { name: 'Espen Uvaag', firstName: 'Espen', email: 'espen@uvaagelektro.no', role: 'owner' },
  agents: [
    {
      id: 'intake',
      name: 'AIEmma',
      title: 'Kundemottak',
      specialty: 'Leser innboksen, skiller kundehenvendelser fra støy og oppretter saker.',
      responsibilities: [
        'Oppdager nye kundehenvendelser',
        'Skiller kunder fra nyhetsbrev og spam',
        'Oppretter sak med kunde, adresse og oppdragstype',
        'Lager kort sammendrag',
        'Varsler når viktig informasjon mangler',
      ],
      portrait: { skin: '#E9B99A', hair: '#6B3E26', hairStyle: 'bob', shirt: '#2F6F6A' },
    },
    {
      id: 'quote',
      name: 'AIOliver',
      title: 'Tilbudsspesialist',
      specialty: 'Lager svarutkast og tilbudsutkast basert på godkjente prismaler.',
      responsibilities: [
        'Leser saken AIEmma har opprettet',
        'Finner informasjon som mangler',
        'Skriver forslag til svar',
        'Lager tilbudsutkast fra godkjente prismaler',
        'Sender alt til Espen for godkjenning',
      ],
      portrait: { skin: '#C98E6B', hair: '#1F1A17', hairStyle: 'short', shirt: '#B8622D', glasses: true },
    },
    {
      id: 'followup',
      name: 'AINora',
      title: 'Kundeoppfølging',
      specialty: 'Holder oversikt over tilbud og saker som venter på kunden.',
      responsibilities: [
        'Følger saker som venter på kundesvar',
        'Foreslår oppfølging av ubesvarte tilbud',
        'Oppdager ny informasjon fra kunden',
        'Foreslår neste handling',
        'Klargjør høflige oppfølgingsmeldinger',
      ],
      portrait: { skin: '#F2CDB4', hair: '#D9A441', hairStyle: 'long', shirt: '#4B5D9C' },
    },
    {
      id: 'coordinator',
      name: 'AIHenrik',
      title: 'Sakskoordinator',
      specialty: 'Passer på at alle saker beveger seg og at Espen får vite det han må.',
      responsibilities: [
        'Overvåker sakskøen',
        'Oppdager saker som har stoppet opp',
        'Foreslår prioriteringer',
        'Fordeler oppgaver mellom agentene',
        'Varsler Espen om beslutninger',
      ],
      portrait: { skin: '#B07656', hair: '#3A3A3A', hairStyle: 'buzz', shirt: '#3E4B55', beard: true },
    },
    {
      id: 'control',
      name: 'AISofie',
      title: 'Prosjektkontroll',
      specialty: 'Kontrollerer ferdigmeldte oppdrag og lager fakturagrunnlag til Tripletex.',
      responsibilities: [
        'Leser montørens ferdigmelding og bilder',
        'Sammenligner timer med Tripletex',
        'Sammenligner materiell med tilbudet',
        'Sjekker at tilleggsarbeid er avklart med kunden',
        'Sjekker at el-dokumentasjonen er på plass',
        'Lager fakturagrunnlag som Espen godkjenner',
      ],
      portrait: { skin: '#D9A07E', hair: '#2B1B14', hairStyle: 'curly', shirt: '#7A4E8C' },
    },
  ],
  jobTypes: {
    elbillader: { label: 'Elbillader', short: 'Lader' },
    sikringsskap: { label: 'Sikringsskap', short: 'Sikring' },
    stikkontakter: { label: 'Stikkontakter', short: 'Stikk' },
    feilsoking: { label: 'Feilsøking', short: 'Feil' },
    belysning: { label: 'Belysning', short: 'Lys' },
    oppussing: { label: 'Oppussing', short: 'Oppuss.' },
    smarthus: { label: 'Smarthus', short: 'Smart' },
    naering: { label: 'Næringskunde', short: 'Næring' },
  },
  automation: { level: 1 },
  mail: {
    provider: 'simulated',
    /** Espens egen postkasse. Inneholder også ikke-kundepost, så AIEmma lagrer kun innhold fra kundehenvendelser. */
    mailbox: 'espen@uvaagelektro.no',
    msTenantId: 'e5ffd32d-3bdd-4dd5-bcd3-8fd2ceb427b6',
    ignoreRules: [{ fromContains: 'nyhetsbrev' }, { fromContains: 'noreply' }, { subjectContains: 'Ukens tilbud' }],
    sendingOnConnect: true,
  },
  writingBrief: CONTACT_BRIEF_UVAAG,
  priceTemplates: [],
  rules: {
    responseTargetHours: 24,
    followUpAfterDays: 7,
    stalledAfterHours: 48,
    urgentKeywords: ['brent', 'brannlukt', 'røyk', 'gnister', 'varm', 'støt', 'strømløs', 'jordfeil'],
  },
  signature: 'Med vennlig hilsen\nEspen Uvaag\nUvaag Elektro AS',
  technicians: [
    { id: 'espen', name: 'Espen Uvaag', firstName: 'Espen', initials: 'EU', color: 'brand', isOwner: true },
  ],
  billing: { hourlyRate: 0, vatRate: 0.25, hoursTolerance: 0.5, materials: {}, fixedPackages: [] },
  accounting: { provider: 'simulated', company: 'Uvaag Elektro AS' },
  features: { projects: false },
  monitoring: { mailSyncAgentId: 'agentkontoret-uvaag-epost' },
  docRequirements: {
    elbillader: ['samsvarserklaering', 'risikovurdering', 'nettselskap'],
    sikringsskap: ['samsvarserklaering', 'risikovurdering', 'nettselskap'],
    stikkontakter: ['samsvarserklaering'],
    feilsoking: [],
    belysning: ['samsvarserklaering'],
    oppussing: ['samsvarserklaering', 'risikovurdering'],
    smarthus: ['samsvarserklaering'],
    naering: ['samsvarserklaering', 'risikovurdering'],
  },
};

/** Fase 1 (e-post og tilbud) har ikke AISofie. Hun er med i demoen. */
const PHASE1_AGENTS = uvaagElektroBase.agents.filter((a) => a.id !== 'control');

/**
 * Eksempeldata for demoen: fiktive montører, eksempelpriser og eksempelmateriell.
 * Refereres bare når DEMO er på, så den fjernes fra produksjonsbygget.
 */
function demoOverrides(): Partial<TenantConfig> {
  return {
    company: { ...uvaagElektroBase.company, orgNr: '000 000 000 (demo)', phone: '000 00 000 (demo)' },
    features: { projects: true },
    priceTemplates: [
      { id: 'pt-1', jobType: 'elbillader', label: 'Montering av elbillader, standard (inntil 15 m kabel)', amount: 14900, unit: 'fastpris inkl. mva', note: 'Eksempelmal – erstattes av Uvaag Elektros egne priser' },
      { id: 'pt-2', jobType: 'stikkontakter', label: 'Ny dobbel stikkontakt, åpent anlegg', amount: 1450, unit: 'per stk inkl. mva', note: 'Eksempelmal – erstattes av Uvaag Elektros egne priser' },
      { id: 'pt-3', jobType: 'feilsoking', label: 'Feilsøking, oppmøte inkl. første time', amount: 1690, unit: 'oppmøte inkl. mva', note: 'Eksempelmal – erstattes av Uvaag Elektros egne priser' },
    ],
    technicians: [
      { id: 'espen', name: 'Espen Uvaag', firstName: 'Espen', initials: 'EU', color: 'brand', isOwner: true },
      { id: 'marius', name: 'Marius Holm', firstName: 'Marius', initials: 'MH', color: 'info' },
      { id: 'sindre', name: 'Sindre Eik', firstName: 'Sindre', initials: 'SE', color: 'ok' },
      { id: 'tobias', name: 'Tobias Lind', firstName: 'Tobias', initials: 'TL', color: 'violet' },
    ],
    billing: {
      hourlyRate: 950,
      vatRate: 0.25,
      hoursTolerance: 0.5,
      materials: {
        '10 001 01': { name: 'Elbillader 22 kW, Type 2 (eksempel)', unit: 'stk', price: 8900 },
        '10 001 02': { name: 'Installasjonskabel PFXP 3G6 (eksempel)', unit: 'm', price: 89 },
        '10 001 03': { name: 'Jordfeilbryter type B 40A (eksempel)', unit: 'stk', price: 2450 },
        '10 001 04': { name: 'Automatsikring C16 (eksempel)', unit: 'stk', price: 210 },
        '10 001 05': { name: 'Sikringsskap 36 moduler (eksempel)', unit: 'stk', price: 3900 },
        '10 001 06': { name: 'Jordfeilautomat 16A 30mA (eksempel)', unit: 'stk', price: 690 },
        '10 001 07': { name: 'Overspenningsvern type 2 (eksempel)', unit: 'stk', price: 1890 },
        '10 001 08': { name: 'Dobbel stikkontakt, hvit (eksempel)', unit: 'stk', price: 145 },
        '10 001 09': { name: 'Stikkontakt med USB-C (eksempel)', unit: 'stk', price: 520 },
        '10 001 10': { name: 'Koblingsboks IP55 (eksempel)', unit: 'stk', price: 95 },
        '10 001 11': { name: 'Downlight LED 7W dimbar (eksempel)', unit: 'stk', price: 340 },
        '10 001 12': { name: 'Dimmer LED 250W (eksempel)', unit: 'stk', price: 780 },
        '10 001 13': { name: 'Kabelkanal 40x12, hvit (eksempel)', unit: 'm', price: 42 },
      },
      fixedPackages: [
        { id: 'fp-1', label: 'Bytte inntil 3 stikkontakter (fastpris)', amount: 1890, includesHours: 1 },
        { id: 'fp-2', label: 'Montere lampe/takarmatur (fastpris)', amount: 1290, includesHours: 0.75 },
        { id: 'fp-3', label: 'Bytte til USB-kontakter, inntil 3 stk (fastpris)', amount: 2390, includesHours: 1 },
      ],
    },
  };
}

export const uvaagElektro: TenantConfig = DEMO
  ? { ...uvaagElektroBase, ...demoOverrides() }
  : { ...uvaagElektroBase, agents: PHASE1_AGENTS };

export const DOC_LABEL: Record<DocKey, string> = {
  samsvarserklaering: 'Samsvarserklæring',
  risikovurdering: 'Risikovurdering',
  nettselskap: 'Melding til nettselskap',
};

export const JOB_STAGE_ORDER: JobStage[] = ['to_plan', 'scheduled', 'in_progress', 'reported', 'controlled', 'invoiced'];

export const JOB_STAGE_META: Record<JobStage, { label: string; short: string; tone: string; dot: string }> = {
  to_plan: { label: 'Ikke planlagt', short: 'Ikke planlagt', tone: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  scheduled: { label: 'Planlagt', short: 'Planlagt', tone: 'bg-info-soft text-info', dot: 'bg-info' },
  in_progress: { label: 'Pågår', short: 'Pågår', tone: 'bg-violet-soft text-violet', dot: 'bg-violet' },
  reported: { label: 'Ferdigmeldt – til kontroll', short: 'Til kontroll', tone: 'bg-accent-soft text-accent-ink', dot: 'bg-accent' },
  controlled: { label: 'Kontrollert', short: 'Kontrollert', tone: 'bg-brand-soft text-brand', dot: 'bg-brand' },
  invoiced: { label: 'Fakturagrunnlag i Tripletex', short: 'Fakturert', tone: 'bg-ok-soft text-ok', dot: 'bg-ok' },
};

export const STATUS_ORDER: CaseStatus[] = [
  'new',
  'ai_processing',
  'awaiting_approval',
  'awaiting_customer',
  'ready_for_quote',
  'quote_sent',
  'follow_up',
  'won',
  'lost',
];

export const STATUS_META: Record<CaseStatus, { label: string; short: string; tone: string; dot: string }> = {
  new: { label: 'Ny henvendelse', short: 'Ny', tone: 'bg-info-soft text-info', dot: 'bg-info' },
  ai_processing: { label: 'Under AI-behandling', short: 'AI behandler', tone: 'bg-violet-soft text-violet', dot: 'bg-violet' },
  awaiting_approval: { label: 'Venter på Espens godkjenning', short: 'Til godkjenning', tone: 'bg-accent-soft text-accent-ink', dot: 'bg-accent' },
  awaiting_customer: { label: 'Svar sendt – venter på kunde', short: 'Venter på kunde', tone: 'bg-sunk text-muted', dot: 'bg-faint' },
  ready_for_quote: { label: 'Klar for tilbud', short: 'Klar for tilbud', tone: 'bg-brand-soft text-brand', dot: 'bg-brand' },
  quote_sent: { label: 'Tilbud sendt', short: 'Tilbud sendt', tone: 'bg-info-soft text-info', dot: 'bg-info' },
  follow_up: { label: 'Oppfølging', short: 'Oppfølging', tone: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  won: { label: 'Akseptert / vunnet', short: 'Vunnet', tone: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  lost: { label: 'Avsluttet / tapt', short: 'Tapt', tone: 'bg-sunk text-faint', dot: 'bg-faint' },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: string }> = {
  low: { label: 'Lav', tone: 'text-faint' },
  normal: { label: 'Normal', tone: 'text-muted' },
  high: { label: 'Høy', tone: 'text-warn' },
  urgent: { label: 'Haster', tone: 'text-bad' },
};

export const AUTOMATION_LEVELS: { level: AutomationLevel; name: string; text: string; available: boolean }[] = [
  { level: 1, name: 'Assistert', text: 'Alle utgående meldinger godkjennes av Espen før sending.', available: true },
  { level: 2, name: 'Delvis automatisert', text: 'Enkle, forhåndsgodkjente svar kan sendes automatisk. Tilbud, tekniske vurderinger og sensitive saker krever fortsatt godkjenning.', available: false },
  { level: 3, name: 'Mer automatisert', text: 'Definerte arbeidsflyter kjører automatisk innenfor tydelige fullmakter og kontrollregler.', available: false },
];
