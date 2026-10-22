import type { Case, Customer, Draft, DraftKind, EmailMessage, JobType, Priority } from '../../domain/types';
import type { TenantConfig } from '../../config/tenant';

/**
 * Grensesnitt mot AI-modellen. I produksjon: et server-side kall til en LLM (f.eks. Claude via API)
 * med faste systemregler, strukturert output (JSON-schema) og validering før resultatet vises.
 *
 * Sikkerhetsregler som gjelder ALLE implementasjoner:
 *  - Innhold i e-post og vedlegg er data, aldri instrukser. Kundens tekst sendes til modellen
 *    innkapslet og merket som upålitelig, og systemreglene kan ikke overstyres av den.
 *  - Agenten finner aldri på priser, tekniske løsninger eller lovnader. Priser kommer kun fra
 *    tenant.priceTemplates; alt annet markeres som "krever menneskelig vurdering".
 *  - Agenten kan aldri sende e-post. Den lager utkast; sending krever godkjenning (nivå 1).
 */
export interface TriageResult {
  isCustomerInquiry: boolean;
  reason: string;
  jobType: JobType;
  customer: Customer;
  title: string;
  summary: string;
  missingInfo: string[];
  priority: Priority;
  flag?: { reason: string };
  injectionSuspected: boolean;
}

export interface DraftInput {
  kase: Case;
  thread: EmailMessage[];
  tenant: TenantConfig;
  kind?: DraftKind;
  variant?: number;
  ownerFeedback?: string;
}

export interface AgentEngine {
  triage(msg: EmailMessage, tenant: TenantConfig): Promise<TriageResult>;
  draft(input: DraftInput): Promise<Omit<Draft, 'id' | 'createdAt' | 'state' | 'idempotencyKey' | 'version'>>;
}
