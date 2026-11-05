import type { CaseStatus } from '../domain/types';

/**
 * Fem kategorier, like overalt: forsiden, Saker og nedtrekksmenyen i saken.
 * Statusene i databasen er finere inndelt; hver status hører til nøyaktig én kategori.
 * «Under arbeid» settes bare når eieren flytter saken selv.
 */
export type Category = 'owner' | 'working' | 'customer' | 'quote' | 'closed';

export const CATEGORY_ORDER: Category[] = ['owner', 'working', 'customer', 'quote', 'closed'];

const OF: Record<CaseStatus, Category> = {
  new: 'owner', ai_processing: 'owner', awaiting_approval: 'owner', ready_for_quote: 'owner', follow_up: 'owner',
  in_progress: 'working',
  awaiting_customer: 'customer',
  quote_sent: 'quote',
  won: 'closed', lost: 'closed',
};
export const categoryOf = (s: CaseStatus): Category => OF[s] ?? 'owner';

/** Status som settes når eieren flytter en sak til en kategori. Står saken allerede i kategorien, beholdes statusen. */
export function statusFor(cat: Category, current: CaseStatus): CaseStatus {
  if (categoryOf(current) === cat) return current;
  return ({ owner: 'awaiting_approval', working: 'in_progress', customer: 'awaiting_customer', quote: 'quote_sent', closed: 'lost' } as const)[cat];
}

export function categoryMeta(cat: Category, ownerFirstName: string) {
  return {
    owner: { label: `Venter på ${ownerFirstName}`, short: `Venter på ${ownerFirstName}`, tone: 'bg-accent-soft text-accent-ink', dot: 'bg-accent' },
    working: { label: 'Under arbeid', short: 'Under arbeid', tone: 'bg-violet-soft text-violet', dot: 'bg-violet' },
    customer: { label: 'Venter på kunde', short: 'Venter på kunde', tone: 'bg-sunk text-muted', dot: 'bg-faint' },
    quote: { label: 'Tilbud sendt', short: 'Tilbud sendt', tone: 'bg-info-soft text-info', dot: 'bg-info' },
    closed: { label: 'Avsluttet / ikke aktuell', short: 'Avsluttet', tone: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  }[cat];
}
