// Domenemodell for Agentkontoret. Uavhengig av UI, e-postleverandør og AI-modell.

export type AgentId = 'intake' | 'quote' | 'followup' | 'coordinator' | 'control';

export type AgentStatus = 'working' | 'waiting_owner' | 'waiting_customer' | 'idle' | 'needs_help' | 'error';

export interface AgentConfig {
  id: AgentId;
  name: string;
  title: string;
  specialty: string;
  responsibilities: string[];
  /** Parametre for den illustrerte portretten (ingen ekte personer). */
  portrait: { skin: string; hair: string; hairStyle: 'short' | 'bob' | 'long' | 'curly' | 'bun' | 'buzz'; shirt: string; glasses?: boolean; beard?: boolean };
}

export type CaseStatus =
  | 'new'
  | 'ai_processing'
  | 'awaiting_approval'
  | 'awaiting_customer'
  | 'ready_for_quote'
  | 'quote_sent'
  | 'follow_up'
  | 'won'
  | 'lost';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type JobType =
  | 'elbillader'
  | 'sikringsskap'
  | 'stikkontakter'
  | 'feilsoking'
  | 'belysning'
  | 'oppussing'
  | 'smarthus'
  | 'naering';

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeKb: number;
  /** Status fra vedleggsskanning. Ekte løsning: skann før visning. */
  scan: 'clean' | 'pending' | 'blocked';
  kind: 'image' | 'pdf' | 'other';
}

export interface EmailMessage {
  id: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc?: { name: string; email: string }[];
  subject: string;
  body: string;
  sentAt: string; // ISO
  attachments: Attachment[];
  /** Kun for utgående: bekreftet av e-postleverandør? */
  deliveryState?: 'queued' | 'sending' | 'confirmed' | 'failed';
  providerMessageId?: string;
  approvedBy?: string;
  draftedBy?: AgentId | 'owner';
}

export type DraftKind = 'reply' | 'quote' | 'follow_up' | 'info_request' | 'extra_work';

export interface Draft {
  id: string;
  caseId: string;
  kind: DraftKind;
  author: AgentId | 'owner';
  subject: string;
  body: string;
  /** Hvorfor agenten foreslår dette svaret. */
  rationale: string;
  /** Opplysninger som mangler for å kunne gi et komplett svar/tilbud. */
  missing: string[];
  /** Punkter Espen må ta stilling til (pris, teknisk vurdering osv.). */
  requiresHumanJudgement: string[];
  /** Prislinjer hentet fra godkjente prismaler. Aldri oppfunnet. */
  priceLines?: { label: string; amount: number; source: string }[];
  createdAt: string;
  version: number;
  state: 'pending' | 'approved' | 'rejected' | 'superseded' | 'sent' | 'send_failed';
  /** Idempotensnøkkel som hindrer dobbeltsending. */
  idempotencyKey: string;
}

export interface Customer {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  company?: string;
  orgNr?: string;
  type: 'privat' | 'naering';
}

export interface CaseEvent {
  id: string;
  at: string;
  actor: AgentId | 'owner' | 'customer' | 'system';
  kind: string;
  text: string;
}

export interface Case {
  id: string;
  number: string; // UE-2026-0142
  title: string;
  status: CaseStatus;
  priority: Priority;
  flagged?: { reason: string };
  jobType: JobType;
  customer: Customer;
  description: string;
  summary: string;
  nextAction: string;
  missingInfo: string[];
  assignedAgent: AgentId;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  /** Saken har fått nytt kundesvar som ikke er lest. */
  unreadCustomerReply?: boolean;
  estimatedValue?: number;
  events: CaseEvent[];
  /** Utførelse. Finnes når kunden har akseptert. */
  job?: Job;
}

export type ActivityActor = AgentId | 'owner' | 'customer' | 'system';

export interface Activity {
  id: string;
  at: string;
  actor: ActivityActor;
  caseId?: string;
  text: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  currentActivity: string;
  currentCaseId?: string;
  completedToday: number;
}

export type AuditAction =
  | 'draft.created'
  | 'draft.edited'
  | 'draft.approved'
  | 'draft.rejected'
  | 'draft.regenerate_requested'
  | 'email.send_requested'
  | 'email.send_confirmed'
  | 'email.send_failed'
  | 'email.duplicate_blocked'
  | 'email.received'
  | 'case.created'
  | 'case.status_changed'
  | 'case.priority_changed'
  | 'case.flagged'
  | 'manual.message_sent'
  | 'security.prompt_injection_detected'
  | 'data.export'
  | 'data.delete'
  | 'job.planned'
  | 'job.started'
  | 'job.help_requested'
  | 'job.reported'
  | 'job.control_run'
  | 'job.controlled'
  | 'job.returned'
  | 'job.extra_confirmed'
  | 'job.doc_marked'
  | 'accounting.order_created';

export interface AuditEntry {
  id: string;
  at: string;
  actor: string; // 'espen@uvaagelektro.no' | 'agent:intake' | 'system'
  role: 'owner' | 'agent' | 'system';
  action: AuditAction;
  caseId?: string;
  detail: string;
}

/** Automatiseringsnivå. Kun nivå 1 er aktivt i prototypen. */
export type AutomationLevel = 1 | 2 | 3;

export type UserRole = 'owner' | 'staff' | 'viewer';

// ─── Utførelse og prosjektkontroll ─────────────────────────────────────────────

export interface Technician {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  color: string; // token-navn, f.eks. 'info'
  isOwner?: boolean;
}

/** Fasene et oppdrag går gjennom etter at kunden har takket ja. */
export type JobStage = 'to_plan' | 'scheduled' | 'in_progress' | 'reported' | 'controlled' | 'invoiced';

export interface MaterialLine {
  elnr: string; // El-nummer (EFObasen). Eksempelnumre i demoen.
  name: string;
  qty: number;
  unit: string;
  /** Planlagt i tilbudet? Ellers er det tillegg som må faktureres. */
  plannedQty: number;
}

export interface ExtraWork {
  id: string;
  description: string;
  hours: number;
  /** null = ikke avklart med kunden. */
  customerApproved: boolean | null;
  clarificationSentAt?: string;
}

export type DocKey = 'samsvarserklaering' | 'risikovurdering' | 'nettselskap';

export interface CompletionReport {
  at: string;
  by: string; // technician id
  note: string; // fritekst eller transkribert talenotat
  photos: Attachment[];
  materials: MaterialLine[];
  extraWork: ExtraWork[];
  hoursReported: number;
  docs: Partial<Record<DocKey, boolean>>;
}

export interface ControlCheck {
  id: 'photos' | 'hours' | 'materials' | 'extra' | 'docs' | 'basis';
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  /** Hva som kan gjøres for å løse punktet. */
  fix?: 'nudge_photos' | 'nudge_hours' | 'nudge_docs' | 'extra_work' | 'mark_doc';
}

export interface InvoiceLine { label: string; qty: number; unit: string; unitPrice: number; source: string }

export interface ChatMessage {
  id: string;
  at: string;
  from: 'bot' | 'tech';
  text: string;
  photos?: Attachment[];
  /** Knapper botten tilbyr (for løse bilder). */
  choices?: { caseId: string; label: string }[];
  resolved?: boolean;
}

export interface Job {
  stage: JobStage;
  technicianId?: string;
  scheduledDate?: string; // YYYY-MM-DD
  slot?: 'formiddag' | 'ettermiddag';
  area: string; // bydel, brukes til å samle småjobber
  smallJob: boolean;
  fixedPrice?: { label: string; amount: number };
  plannedHours: number;
  plannedMaterials: MaterialLine[];
  requiredDocs: DocKey[];
  tripletexProjectNo: string;
  startedAt?: string;
  report?: CompletionReport;
  checks?: ControlCheck[];
  checkedAt?: string;
  acknowledgedWarnings?: boolean;
  controlledAt?: string;
  invoice?: { lines: InvoiceLine[]; tripletexOrderNo?: string; sentAt?: string };
  help?: { text: string; at: string };
  acceptedAt: string;
  thread: ChatMessage[];
}
