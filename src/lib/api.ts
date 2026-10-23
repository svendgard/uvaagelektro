export interface SessionUser { id: string; email: string; name: string; role: 'superadmin' | 'owner'; tenant_id: string }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Kall mot serveren. Sender alltid CSRF-headeren og cookies. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'agentkontoret' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* tom */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'Noe gikk galt. Prøv igjen.');
  return json as T;
}
