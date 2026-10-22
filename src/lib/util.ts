export const id = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

export function fmtRelative(iso: string, now = Date.now()) {
  const d = (now - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'nå nettopp';
  if (d < 3600) return `${Math.floor(d / 60)} min siden`;
  if (d < 86400) return `${Math.floor(d / 3600)} t siden`;
  const days = Math.floor(d / 86400);
  return days === 1 ? 'i går' : `${days} dager siden`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? `i dag ${fmtTime(iso)}` : d.toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const kr = (n: number) => `kr ${n.toLocaleString('nb-NO')}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
