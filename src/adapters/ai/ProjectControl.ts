import type { Case, ControlCheck, InvoiceLine, Job } from '../../domain/types';
import { DOC_LABEL, type TenantConfig } from '../../config/tenant';

/**
 * AISofies kontrollregler. Selve kontrollen er deterministisk (regler, ikke modell), slik at
 * Espen alltid kan se hvorfor et punkt er grønt eller rødt. AI brukes til å tolke montørens
 * fritekst/talenotat til strukturerte linjer (materiell, tillegg) før reglene kjøres.
 */
const h = (n: number) => `${n.toLocaleString('nb-NO', { maximumFractionDigits: 2 })} t`;

export function runChecks(kase: Case, job: Job, tenant: TenantConfig, tripletexHours: number | null): ControlCheck[] {
  const r = job.report!;
  const checks: ControlCheck[] = [];
  const tol = tenant.billing.hoursTolerance;

  checks.push(r.photos.length === 0
    ? { id: 'photos', label: 'Bilder fra jobben', status: 'fail', detail: 'Ingen bilder lastet opp.', fix: 'nudge_photos' }
    : { id: 'photos', label: 'Bilder fra jobben', status: 'ok', detail: `${r.photos.length} bilde${r.photos.length > 1 ? 'r' : ''} lagt på saken.` });

  if (!tripletexHours) {
    checks.push({ id: 'hours', label: 'Timer i Tripletex', status: 'fail', detail: `Ingen timer ført på prosjekt ${job.tripletexProjectNo}. Montøren oppga ${h(r.hoursReported)}.`, fix: 'nudge_hours' });
  } else if (Math.abs(tripletexHours - r.hoursReported) > tol) {
    checks.push({ id: 'hours', label: 'Timer i Tripletex', status: 'warn', detail: `Montøren oppga ${h(r.hoursReported)}, Tripletex viser ${h(tripletexHours)}.`, fix: 'nudge_hours' });
  } else {
    const over = tripletexHours - job.plannedHours;
    checks.push({ id: 'hours', label: 'Timer i Tripletex', status: 'ok', detail: `${h(tripletexHours)} ført${over > tol ? ` (${h(over)} over plan på ${h(job.plannedHours)})` : `, plan var ${h(job.plannedHours)}`}.` });
  }

  const extraMat = r.materials.filter((m) => m.qty > m.plannedQty);
  checks.push(extraMat.length
    ? { id: 'materials', label: 'Materiell mot tilbud', status: 'warn', detail: `Mer enn tilbudt: ${extraMat.map((m) => `${m.qty - m.plannedQty} ${m.unit} ${m.name.replace(/ \(eksempel\)/, '')}`).join(', ')}. Tas med som tillegg.` }
    : { id: 'materials', label: 'Materiell mot tilbud', status: 'ok', detail: 'Stemmer med tilbudet.' });

  const open = r.extraWork.filter((e) => e.customerApproved === null);
  const declined = r.extraWork.filter((e) => e.customerApproved === false);
  if (open.length) checks.push({ id: 'extra', label: 'Tilleggsarbeid avklart', status: 'fail', detail: `Ikke avklart med kunden: ${open.map((e) => `${e.description} (${h(e.hours)})`).join('; ')}${open.some((e) => e.clarificationSentAt) ? '. Spørsmål er sendt kunden.' : '.'}`, fix: 'extra_work' });
  else if (declined.length) checks.push({ id: 'extra', label: 'Tilleggsarbeid avklart', status: 'warn', detail: `Kunden avslo: ${declined.map((e) => e.description).join('; ')}. Tas ikke med.` });
  else checks.push({ id: 'extra', label: 'Tilleggsarbeid avklart', status: 'ok', detail: r.extraWork.length ? 'Godkjent av kunden.' : 'Ingen tilleggsarbeid.' });

  const missing = job.requiredDocs.filter((d) => !r.docs[d]);
  const hard = missing.filter((d) => d !== 'nettselskap');
  if (hard.length) checks.push({ id: 'docs', label: 'El-dokumentasjon', status: 'fail', detail: `Mangler: ${hard.map((d) => DOC_LABEL[d]).join(', ')}.`, fix: 'nudge_docs' });
  else if (missing.length) checks.push({ id: 'docs', label: 'El-dokumentasjon', status: 'warn', detail: 'Melding til nettselskap er ikke registrert.', fix: 'mark_doc' });
  else checks.push({ id: 'docs', label: 'El-dokumentasjon', status: 'ok', detail: job.requiredDocs.length ? `${job.requiredDocs.map((d) => DOC_LABEL[d]).join(', ')} på plass.` : 'Ikke påkrevd for denne jobbtypen.' });

  const prelim = open.length > 0 || !tripletexHours;
  checks.push({ id: 'basis', label: 'Fakturagrunnlag', status: prelim ? 'warn' : 'ok', detail: (job.fixedPrice ? `Fastpris: ${job.fixedPrice.label}` : `Timer fra Tripletex à kr ${tenant.billing.hourlyRate} + materiell fra prisfil`) + (prelim ? '. Foreløpig til avvikene er løst.' : '.') });
  void kase;
  return checks;
}

export function buildInvoice(job: Job, tenant: TenantConfig, tripletexHours: number | null): InvoiceLine[] {
  const r = job.report!;
  const rate = tenant.billing.hourlyRate;
  const lines: InvoiceLine[] = [];
  const extraHours = r.extraWork.reduce((s, e) => s + e.hours, 0);
  if (job.fixedPrice) {
    lines.push({ label: job.fixedPrice.label, qty: 1, unit: 'stk', unitPrice: job.fixedPrice.amount, source: 'Fastprispakke' });
  } else {
    const base = Math.max(0, (tripletexHours ?? r.hoursReported) - extraHours);
    if (base > 0) lines.push({ label: 'Arbeid elektriker', qty: Math.round(base * 100) / 100, unit: 't', unitPrice: rate, source: tripletexHours ? 'Timer fra Tripletex' : 'Montørens oppgave (ikke ført i Tripletex)' });
  }
  for (const m of r.materials) {
    const qty = job.fixedPrice ? Math.max(0, m.qty - m.plannedQty) : m.qty;
    if (!qty) continue;
    const p = tenant.billing.materials[m.elnr];
    lines.push({ label: `${p?.name.replace(/ \(eksempel\)/, '') ?? m.name}${m.qty > m.plannedQty && !job.fixedPrice ? ` (${m.qty - m.plannedQty} utover tilbud)` : ''}`, qty, unit: m.unit, unitPrice: p?.price ?? 0, source: p ? `Prisfil, El-nr ${m.elnr}` : 'Ukjent El-nr – pris mangler' });
  }
  for (const e of r.extraWork.filter((x) => x.customerApproved === true)) {
    lines.push({ label: `Tillegg: ${e.description}`, qty: e.hours, unit: 't', unitPrice: rate, source: 'Godkjent av kunden' });
  }
  return lines;
}

export const invoiceTotal = (lines: InvoiceLine[]) => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
