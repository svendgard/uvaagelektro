import type { Activity, Attachment, AuditEntry, Case, ChatMessage, EmailMessage, Job, JobType, MaterialLine } from '../domain/types';
import { uvaagElektro as T } from '../config/tenant';
import { buildInvoice, runChecks } from '../adapters/ai/ProjectControl';

// Eksempeldata for utførelse og prosjektkontroll. Alle personer, adresser og El-numre er oppdiktet.

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600e3).toISOString();
let seq = 0;
const uid = (p: string) => `${p}-j${++seq}`;

export const dayStr = (offsetDays = 0) => {
  const d = new Date(now + offsetDays * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** I dag kl. hh:mm som ISO. */
const todayAt = (hh: number, mm = 0) => { const d = new Date(now); d.setHours(hh, mm, 0, 0); return d.getTime() > now ? ago(0.2) : d.toISOString(); };

const UE = { name: T.company.name, email: T.company.email };
const photo = (filename: string): Attachment => ({ id: uid('att'), filename, mimeType: 'image/jpeg', sizeKb: 1600, scan: 'clean', kind: 'image' });
const mat = (elnr: string, qty: number, plannedQty = qty): MaterialLine => {
  const p = T.billing.materials[elnr];
  return { elnr, name: p.name, unit: p.unit, qty, plannedQty };
};
const bot = (at: string, text: string, photos?: Attachment[]): ChatMessage => ({ id: uid('chat'), at, from: 'bot', text, photos });
const tech = (at: string, text: string, photos?: Attachment[]): ChatMessage => ({ id: uid('chat'), at, from: 'tech', text, photos });

interface Spec {
  id: string; number: string; name: string; email: string; phone?: string; address: string; area: string;
  jobType: JobType; title: string; description: string; acceptedHoursAgo: number; value: number;
  job: Omit<Job, 'thread' | 'acceptedAt' | 'tripletexProjectNo' | 'requiredDocs' | 'area'> & { thread?: ChatMessage[]; requiredDocs?: Job['requiredDocs'] };
  company?: string;
}

function make(s: Spec, messages: EmailMessage[]): Case {
  const th = `t-${s.id}`;
  const c = { name: s.name, email: s.email };
  const fn = s.name.split(' ')[0];
  const accepted = ago(s.acceptedHoursAgo);
  messages.push(
    { id: uid('msg'), threadId: th, direction: 'inbound', from: c, to: [UE], subject: s.title, body: `Hei,\n\n${s.description}\n\n${s.name}, ${s.address}`, sentAt: ago(s.acceptedHoursAgo + 96), attachments: [] },
    { id: uid('msg'), threadId: th, direction: 'outbound', from: { name: T.owner.name, email: T.company.email }, to: [c], subject: `Tilbud: ${s.title}`, body: `Hei ${fn},\n\nHer er tilbudet vi snakket om.\n\n${T.signature}`, sentAt: ago(s.acceptedHoursAgo + 48), attachments: [], deliveryState: 'confirmed', providerMessageId: uid('sim'), approvedBy: T.owner.email, draftedBy: 'quote' },
    { id: uid('msg'), threadId: th, direction: 'inbound', from: c, to: [UE], subject: `SV: Tilbud: ${s.title}`, body: `Hei,\n\nVi takker ja til tilbudet.\n\n${fn}`, sentAt: accepted, attachments: [] },
  );
  const job: Job = {
    ...s.job,
    area: s.area,
    acceptedAt: accepted,
    tripletexProjectNo: s.number.replace('UE-2026-', 'P-'),
    requiredDocs: s.job.requiredDocs ?? T.docRequirements[s.jobType],
    thread: s.job.thread ?? [],
  };
  return {
    id: s.id, number: s.number, title: `${s.title} – ${s.name}`, status: 'won', priority: 'normal', jobType: s.jobType,
    customer: { name: s.name, email: s.email, phone: s.phone, address: s.address, company: s.company, type: s.company ? 'naering' : 'privat' },
    description: s.description, summary: `Kunden aksepterte tilbudet ${new Date(accepted).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}.`,
    nextAction: '', missingInfo: [], assignedAgent: 'control', threadId: th, createdAt: ago(s.acceptedHoursAgo + 96), updatedAt: accepted,
    estimatedValue: s.value,
    events: [
      { id: uid('ev'), at: ago(s.acceptedHoursAgo + 96), actor: 'customer', kind: 'email', text: 'E-post mottatt' },
      { id: uid('ev'), at: ago(s.acceptedHoursAgo + 48), actor: 'system', kind: 'sent', text: 'Tilbud bekreftet sendt' },
      { id: uid('ev'), at: accepted, actor: 'customer', kind: 'email', text: 'Kunden aksepterte tilbudet' },
      { id: uid('ev'), at: accepted, actor: 'coordinator', kind: 'job', text: `Oppdrag opprettet. Prosjekt ${job.tripletexProjectNo} i Tripletex (simulert).` },
    ],
    job,
  };
}

export interface JobSeed {
  cases: Case[];
  messages: EmailMessage[];
  activities: Activity[];
  audit: AuditEntry[];
  tripletexHours: Record<string, number>;
  techChat: Record<string, ChatMessage[]>;
}

export function buildJobSeed(): JobSeed {
  seq = 0;
  const messages: EmailMessage[] = [];
  const today = dayStr(0);
  const tomorrow = dayStr(1);
  const yesterday = dayStr(-1);

  const specs: Spec[] = [
    // Ferdigmeldt med flere avvik
    {
      id: 'c-160', number: 'UE-2026-0160', name: 'Liv Andersen', email: 'liv.andersen@eksempel.no', phone: '467 20 118', address: 'Furubakken 3, 4621 Kristiansand', area: 'Vågsbygd',
      jobType: 'elbillader', title: 'Elbillader i garasje', description: 'Elbillader 22 kW på garasjeveggen, ca. 12 m fra sikringsskapet.', acceptedHoursAgo: 120, value: 19800,
      job: {
        stage: 'reported', technicianId: 'marius', scheduledDate: today, slot: 'formiddag', smallJob: false, plannedHours: 4,
        plannedMaterials: [mat('10 001 01', 1), mat('10 001 02', 12), mat('10 001 03', 1), mat('10 001 13', 6)],
        startedAt: todayAt(7, 45),
        report: {
          at: ago(0.7), by: 'marius', hoursReported: 4.5,
          note: 'Lader montert og testet. Måtte legge kabelen en annen vei, gikk med 18 meter. Kunden ville også ha flyttet utekontakten ved garasjen, gjorde det mens jeg var der.',
          photos: [photo('lader_montert.jpg'), photo('sikringsskap_ny_kurs.jpg'), photo('kabelføring_garasje.jpg')],
          materials: [mat('10 001 01', 1, 1), mat('10 001 02', 18, 12), mat('10 001 03', 1, 1), mat('10 001 13', 6, 6)],
          extraWork: [{ id: 'x-1', description: 'Flyttet utekontakt ved garasjen', hours: 0.75, customerApproved: null }],
          docs: { samsvarserklaering: true, risikovurdering: true },
        },
        thread: [],
      },
    },
    // Ferdigmeldt, mangler samsvarserklæring
    {
      id: 'c-161', number: 'UE-2026-0161', name: 'Geir Nilsen', email: 'geir.nilsen@eksempel.no', address: 'Lundsvingen 12, 4630 Kristiansand', area: 'Lund',
      jobType: 'sikringsskap', title: 'Nytt sikringsskap', description: 'Bytte fra skrusikringer til nytt skap med jordfeilautomater.', acceptedHoursAgo: 200, value: 31500,
      job: {
        stage: 'reported', technicianId: 'tobias', scheduledDate: today, slot: 'formiddag', smallJob: false, plannedHours: 6,
        plannedMaterials: [mat('10 001 05', 1), mat('10 001 06', 10), mat('10 001 07', 1)],
        startedAt: todayAt(7, 30),
        report: {
          at: ago(2), by: 'tobias', hoursReported: 6,
          note: 'Nytt skap montert, 10 kurser med jordfeilautomat og overspenningsvern. Alt målt og merket. Samsvarserklæring skriver jeg i kveld.',
          photos: [photo('skap_for.jpg'), photo('skap_etter.jpg'), photo('kursfortegnelse.jpg')],
          materials: [mat('10 001 05', 1, 1), mat('10 001 06', 10, 10), mat('10 001 07', 1, 1)],
          extraWork: [],
          docs: { risikovurdering: true, nettselskap: true },
        },
      },
    },
    // Småjobb, fastpris, ferdigmeldt av Espen selv. AISofie kontrollerer ved oppstart.
    {
      id: 'c-162', number: 'UE-2026-0162', name: 'Randi Olsen', email: 'randi.olsen@eksempel.no', address: 'Grimsmyra 8, 4616 Kristiansand', area: 'Grim',
      jobType: 'stikkontakter', title: 'Bytte tre stikkontakter', description: 'Tre gamle stikkontakter i stue og gang skal byttes.', acceptedHoursAgo: 70, value: 1890,
      job: {
        stage: 'reported', technicianId: 'espen', scheduledDate: today, slot: 'formiddag', smallJob: true, plannedHours: 1,
        fixedPrice: { label: T.billing.fixedPackages[0].label, amount: T.billing.fixedPackages[0].amount },
        plannedMaterials: [mat('10 001 08', 3)],
        startedAt: todayAt(8, 15),
        report: {
          at: ago(0.25), by: 'espen', hoursReported: 1,
          note: 'Tre kontakter byttet. Alt ok.',
          photos: [photo('kontakter_etter.jpg')],
          materials: [mat('10 001 08', 3, 3)], extraWork: [], docs: { samsvarserklaering: true },
        },
      },
    },
    // Pågår, montør trenger hjelp
    {
      id: 'c-164', number: 'UE-2026-0164', name: 'Nina Kvam', email: 'nina.kvam@eksempel.no', phone: '412 99 007', address: 'Hellemyrveien 41, 4628 Kristiansand', area: 'Hellemyr',
      jobType: 'belysning', title: 'Downlights på kjøkkenet', description: 'Åtte dimbare downlights i gipstak på kjøkkenet.', acceptedHoursAgo: 150, value: 9600,
      job: {
        stage: 'in_progress', technicianId: 'marius', scheduledDate: today, slot: 'ettermiddag', smallJob: false, plannedHours: 3.5,
        plannedMaterials: [mat('10 001 11', 8), mat('10 001 12', 1), mat('10 001 02', 10)],
        startedAt: ago(0.6), help: { text: 'Skapet er fullt, finner ikke ledig plass til ny kurs. Kan du ringe meg?', at: ago(0.4) },
      },
    },
    // Pågår, blir ferdigmeldt under demoen
    {
      id: 'c-150', number: 'UE-2026-0150', name: 'Eirik Solheim', email: 'eirik.solheim@eksempel.no', address: 'Solsvingen 2, 4632 Kristiansand', area: 'Lund',
      jobType: 'sikringsskap', title: 'Overspenningsvern', description: 'Montering av overspenningsvern i eksisterende skap.', acceptedHoursAgo: 40, value: 6900,
      job: {
        stage: 'in_progress', technicianId: 'sindre', scheduledDate: today, slot: 'formiddag', smallJob: false, plannedHours: 1.5,
        plannedMaterials: [mat('10 001 07', 1)], startedAt: ago(1.1), requiredDocs: ['samsvarserklaering'],
      },
    },
    // Planlagt i dag
    {
      id: 'c-165', number: 'UE-2026-0165', name: 'Vibeke Lunde', email: 'drift@lund-tannklinikk-demo.no', phone: '380 11 220', address: 'Lundsiden 4, 4630 Kristiansand', area: 'Lund', company: 'Lund Tannklinikk Demo AS',
      jobType: 'naering', title: 'Egen kurs til kompressor', description: 'Ny kompressor i teknisk rom trenger egen kurs og jordfeilvern.', acceptedHoursAgo: 90, value: 12400,
      job: { stage: 'scheduled', technicianId: 'espen', scheduledDate: today, slot: 'ettermiddag', smallJob: false, plannedHours: 3, plannedMaterials: [mat('10 001 06', 1), mat('10 001 02', 15)] },
    },
    // Planlagt i morgen
    {
      id: 'c-163', number: 'UE-2026-0163', name: 'Arne Dahl', email: 'arne.dahl@eksempel.no', address: 'Kuholmsveien 20, 4630 Kristiansand', area: 'Lund',
      jobType: 'belysning', title: 'Montere taklampe', description: 'Ny taklampe i stua, eksisterende lampepunkt.', acceptedHoursAgo: 30, value: 1290,
      job: { stage: 'scheduled', technicianId: 'tobias', scheduledDate: tomorrow, slot: 'formiddag', smallJob: true, plannedHours: 0.75, fixedPrice: { label: T.billing.fixedPackages[1].label, amount: T.billing.fixedPackages[1].amount }, plannedMaterials: [], requiredDocs: [] },
    },
    {
      id: 'c-169', number: 'UE-2026-0169', name: 'Trygve Bakke', email: 'trygve.bakke@eksempel.no', address: 'Tollbodgata 30, 4611 Kristiansand', area: 'Kvadraturen',
      jobType: 'elbillader', title: 'Elbillader i bakgård', description: 'Elbillader på vegg i bakgården, 8 m fra skap.', acceptedHoursAgo: 60, value: 16900,
      job: { stage: 'scheduled', technicianId: 'sindre', scheduledDate: tomorrow, slot: 'formiddag', smallJob: false, plannedHours: 3.5, plannedMaterials: [mat('10 001 01', 1), mat('10 001 02', 8), mat('10 001 03', 1)] },
    },
    // Ikke planlagt, småjobber i kø
    {
      id: 'c-166', number: 'UE-2026-0166', name: 'Ane Brekke', email: 'ane.brekke@eksempel.no', address: 'Gimlevegen 6, 4630 Kristiansand', area: 'Lund',
      jobType: 'stikkontakter', title: 'USB-kontakter på soverom', description: 'Bytte tre kontakter til USB-C.', acceptedHoursAgo: 122, value: 2390,
      job: { stage: 'to_plan', smallJob: true, plannedHours: 1, fixedPrice: { label: T.billing.fixedPackages[2].label, amount: T.billing.fixedPackages[2].amount }, plannedMaterials: [mat('10 001 09', 3)] },
    },
    {
      id: 'c-167', number: 'UE-2026-0167', name: 'Bjørn Halvorsen', email: 'bjorn.halvorsen@eksempel.no', address: 'Vågsbygdveien 77, 4621 Kristiansand', area: 'Vågsbygd',
      jobType: 'belysning', title: 'Taklampe i gang', description: 'Montere ny lampe i gangen.', acceptedHoursAgo: 22, value: 1290,
      job: { stage: 'to_plan', smallJob: true, plannedHours: 0.75, fixedPrice: { label: T.billing.fixedPackages[1].label, amount: T.billing.fixedPackages[1].amount }, plannedMaterials: [], requiredDocs: [] },
    },
    {
      id: 'c-170', number: 'UE-2026-0170', name: 'Elin Fosse', email: 'elin.fosse@eksempel.no', address: 'Slettheia terrasse 2, 4626 Kristiansand', area: 'Slettheia',
      jobType: 'oppussing', title: 'El-arbeid kjøkkenoppussing', description: 'Nye kurser og uttak til nytt kjøkken, ca. 2 dager.', acceptedHoursAgo: 26, value: 28000,
      job: { stage: 'to_plan', smallJob: false, plannedHours: 14, plannedMaterials: [mat('10 001 04', 3), mat('10 001 08', 8), mat('10 001 02', 40)] },
    },
    // Kontrollert, men ikke sendt til Tripletex (AIHenrik flagger)
    {
      id: 'c-138', number: 'UE-2026-0138', name: 'Ragnhild Øye', email: 'ragnhild.oye@eksempel.no', phone: '455 66 778', address: 'Tunveien 8', area: 'Søm',
      jobType: 'feilsoking', title: 'Jordfeil i kjeller', description: 'Jordfeilbryter slår ut i kjeller.', acceptedHoursAgo: 68, value: 3400,
      job: {
        stage: 'controlled', technicianId: 'tobias', scheduledDate: dayStr(-3), slot: 'formiddag', smallJob: false, plannedHours: 1.5,
        plannedMaterials: [mat('10 001 10', 1)], startedAt: ago(54), controlledAt: ago(50),
        report: { at: ago(52), by: 'tobias', hoursReported: 1.5, note: 'Fuktig koblingsboks i kjeller. Byttet til IP55-boks. Målt og ok.', photos: [photo('koblingsboks_fuktig.jpg'), photo('ny_boks.jpg')], materials: [mat('10 001 10', 1, 1)], extraWork: [], docs: {} },
      },
    },
    // Fakturert
    {
      id: 'c-168', number: 'UE-2026-0168', name: 'Mona Sæther', email: 'mona.saether@eksempel.no', address: 'Sømsveien 14, 4637 Kristiansand', area: 'Søm',
      jobType: 'belysning', title: 'LED-spotter i stue', description: 'Ti dimbare spotter i stue.', acceptedHoursAgo: 260, value: 11200,
      job: {
        stage: 'invoiced', technicianId: 'sindre', scheduledDate: dayStr(-4), slot: 'formiddag', smallJob: false, plannedHours: 5,
        plannedMaterials: [mat('10 001 11', 10), mat('10 001 12', 1)], startedAt: ago(100), controlledAt: ago(94),
        report: { at: ago(96), by: 'sindre', hoursReported: 5.5, note: 'Ti spotter montert, dimmer på vegg.', photos: [photo('spotter_stue.jpg')], materials: [mat('10 001 11', 10, 10), mat('10 001 12', 1, 1)], extraWork: [], docs: { samsvarserklaering: true } },
      },
    },
  ];

  const tripletexHours: Record<string, number> = {
    'P-0160': 3.0, 'P-0161': 6, 'P-0162': 1, 'P-0164': 0, 'P-0150': 0, 'P-0168': 5.5, 'P-0138': 1.5, 'P-0165': 0, 'P-0163': 0, 'P-0169': 0, 'P-0166': 0, 'P-0167': 0, 'P-0170': 0,
  };

  const cases = specs.map((s) => make(s, messages));

  // AISofie har allerede kontrollert de som ble meldt for en stund siden (ikke c-162, den kontrolleres live).
  for (const c of cases) {
    const j = c.job!;
    if ((j.stage === 'reported' && c.id !== 'c-162') || j.stage === 'invoiced' || j.stage === 'controlled') {
      j.checks = runChecks(c, j, T, tripletexHours[j.tripletexProjectNo] ?? null);
      j.checkedAt = j.report!.at;
      j.invoice = { lines: buildInvoice(j, T, tripletexHours[j.tripletexProjectNo] ?? null) };
    }
    if (j.stage === 'invoiced') { j.invoice!.tripletexOrderNo = '10228'; j.invoice!.sentAt = ago(93); }
  }

  // Chat per jobb (det montøren ser)
  const post = (c: Case, at: string) => bot(at, `${c.customer.address} · ${c.customer.name}${c.customer.phone ? ` · ${c.customer.phone}` : ''}\n${c.description}`);
  for (const c of cases) {
    const j = c.job!;
    if (!j.technicianId || !j.scheduledDate) continue;
    const t: ChatMessage[] = [post(c, j.scheduledDate === today ? todayAt(6, 30) : ago(14))];
    if (j.startedAt) t.push(tech(j.startedAt, 'Startet.'));
    if (j.help) t.push(tech(j.help.at, j.help.text), bot(j.help.at, `Varslet ${T.owner.firstName}. Han ser det på dashboardet.`));
    if (j.report && j.stage !== 'invoiced') t.push(tech(j.report.at, j.report.note, j.report.photos), bot(j.report.at, 'Takk! Ferdigmelding mottatt. AISofie kontrollerer.'));
    j.thread = t;
  }

  const techChat: Record<string, ChatMessage[]> = {};
  for (const t of T.technicians) {
    const mine = cases.filter((c) => c.job?.technicianId === t.id && c.job.scheduledDate === today);
    techChat[t.id] = [bot(todayAt(6, 30), `God morgen ${t.firstName}! Du har ${mine.length} jobb${mine.length === 1 ? '' : 'er'} i dag. Svar i tråden til hver jobb med bilder og notater, så havner alt på riktig sak.`)];
  }
  void yesterday;

  const activities: Activity[] = [
    { id: uid('a'), at: ago(2), actor: 'control', caseId: 'c-161', text: 'AISofie kontrollerte UE-2026-0161: samsvarserklæring mangler.', tone: 'warning' },
    { id: uid('a'), at: ago(0.7), actor: 'control', caseId: 'c-160', text: 'AISofie fant 4 avvik på elbillader hos Liv Andersen.', tone: 'warning' },
    { id: uid('a'), at: ago(0.4), actor: 'coordinator', caseId: 'c-164', text: 'AIHenrik: Marius trenger hjelp hos Nina Kvam.', tone: 'danger' },
  ];
  const audit: AuditEntry[] = [
    { id: uid('au'), at: ago(93), actor: T.owner.email, role: 'owner', action: 'accounting.order_created', caseId: 'c-168', detail: 'Fakturagrunnlag sendt til Tripletex, ordre 10228 (simulert)' },
  ];

  return { cases, messages, activities, audit, tripletexHours, techChat };
}
