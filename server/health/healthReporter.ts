import { randomUUID } from 'node:crypto';

/**
 * Helserapportering fra Agentkontoret til Agent Dashboard (svendgard/agent-dashboard).
 * Kontrakt: RIFF-INTEGRATION.md v1 i dashboard-repoet.
 *
 * Hva som rapporteres:
 *   Én overvåket "agent" per kunde (tenant): e-postsynkroniseringen. En "leveranse" (scan) er én
 *   fullført synkroniseringsrunde mot postkassen som er bekreftet lagret i databasen. Runder uten
 *   ny e-post teller også. Stopper synkroniseringen (f.eks. utløpt Microsoft-tilkobling), får
 *   dashboardet "delivery_missing". Stopper hele tjenesten, får det "report_missing".
 *
 * Garantier:
 *   - Kaster aldri. Alle feil logges, og rapporteringen påvirker ikke resten av systemet.
 *   - Retry bruker samme report_id og identisk payload. Ny rapport får alltid ny UUID.
 *   - started_at <= completed_at <= persisted_at <= reported_at.
 *   - Ingen persondata: bare agent-ID, kjøre-ID og tidspunkter.
 */

export interface DeliveredScan {
  /** Stabil ID for kjøringen. Samme ID må alltid ha samme tidspunkter. Ingen persondata. */
  scan_run_id: string;
  started_at: string | Date;
  completed_at: string | Date;
  persisted_at: string | Date;
}

export interface HealthReport {
  schema_version: 1;
  report_id: string;
  agent_id: string;
  source: string;
  reported_at: string;
  last_delivered_scan: { scan_run_id: string; started_at: string; completed_at: string; persisted_at: string } | null;
}

export interface AgentConfig { agent_id: string; reporting_enabled: boolean; report_interval_seconds: number }

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface HealthReporterOptions {
  /** F.eks. https://agent-dashboard.onrender.com (uten /api/v1). */
  baseUrl: string;
  apiKey: string;
  /** Source-ID som API-nøkkelen er registrert for i dashboardets Admin. */
  source: string;
  /** Agentene denne prosessen rapporterer for, med funksjon som henter siste leverte kjøring fra databasen. */
  agents: { agentId: string; latestDeliveredScan: () => Promise<DeliveredScan | null> }[];
  enabled?: boolean;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
  configRefreshMs?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: (attempt: number) => number;
}

const DEFAULT_INTERVAL_S = 1800;
const clampInterval = (s: number) => Math.min(3600, Math.max(60, Math.round(s)));
const iso = (v: string | Date) => new Date(v).toISOString();

const consoleLogger: Logger = {
  info: (m, x) => console.log(JSON.stringify({ level: 'info', component: 'health', msg: m, ...x })),
  warn: (m, x) => console.warn(JSON.stringify({ level: 'warn', component: 'health', msg: m, ...x })),
  error: (m, x) => console.error(JSON.stringify({ level: 'error', component: 'health', msg: m, ...x })),
};

type SendOutcome = 'accepted' | 'duplicate' | 'failed' | 'skipped';

export class HealthReporter {
  private readonly o: Required<Omit<HealthReporterOptions, 'logger' | 'fetchImpl' | 'now' | 'backoffMs'>> & Pick<HealthReporterOptions, 'logger'>;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly backoff: (attempt: number) => number;
  /** Siste gyldige konfigurasjon. Beholdes ved feil. null = ikke hentet ennå. */
  private config: Map<string, AgentConfig> | null = null;
  private configVersion: number | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private configTimer: ReturnType<typeof setInterval> | null = null;
  /** Lås per agent, så periodisk rapport og rapport etter kjøring ikke overlapper. */
  private inFlight = new Map<string, Promise<SendOutcome>>();
  /** En ny trigger mens en rapport er underveis gir én oppfølgingsrapport, ikke flere. */
  private pendingAfter = new Set<string>();
  private stopped = false;

  constructor(opts: HealthReporterOptions) {
    this.o = {
      baseUrl: opts.baseUrl.replace(/\/+$/, ''),
      apiKey: opts.apiKey,
      source: opts.source,
      agents: opts.agents,
      enabled: opts.enabled ?? true,
      configRefreshMs: opts.configRefreshMs ?? 5 * 60_000,
      requestTimeoutMs: opts.requestTimeoutMs ?? 10_000,
      maxAttempts: opts.maxAttempts ?? 4,
      logger: opts.logger,
    };
    this.log = opts.logger ?? consoleLogger;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.backoff = opts.backoffMs ?? ((a) => Math.min(30_000, 1000 * 2 ** (a - 1)) + Math.floor(Math.random() * 250));
  }

  /** Henter konfigurasjon, sender første rapport og starter periodisk rapportering. */
  async start(): Promise<void> {
    if (!this.o.enabled) { this.log.info('Helserapportering er slått av (MONITORING_ENABLED=false)'); return; }
    await this.refreshConfig();
    this.configTimer = setInterval(() => { void this.refreshConfig(); }, this.o.configRefreshMs);
    this.configTimer.unref?.();
    for (const a of this.o.agents) void this.runPeriodic(a.agentId);
  }

  stop(): void {
    this.stopped = true;
    if (this.configTimer) clearInterval(this.configTimer);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * Kall denne etter at en kjøring er fullført OG lagret (etter database-commit).
   * Returnerer umiddelbart. Kaster aldri.
   */
  notifyDelivered(agentId: string): void {
    if (!this.o.enabled || this.stopped) return;
    if (this.inFlight.has(agentId)) { this.pendingAfter.add(agentId); return; }
    void this.reportNow(agentId, 'after_delivery');
  }

  /** Sender én rapport for agenten. Brukes av periodisk rapportering og etter leveranse. */
  async reportNow(agentId: string, trigger: 'periodic' | 'after_delivery' = 'periodic'): Promise<SendOutcome> {
    const running = this.inFlight.get(agentId);
    if (running) return running;
    const p = this.doReport(agentId, trigger).catch((e) => {
      this.log.error('Uventet feil i helserapportering', { agent_id: agentId, error: String(e) });
      return 'failed' as const;
    }).finally(() => {
      this.inFlight.delete(agentId);
      if (this.pendingAfter.delete(agentId) && !this.stopped) void this.reportNow(agentId, 'after_delivery');
    });
    this.inFlight.set(agentId, p);
    return p;
  }

  private agentConfig(agentId: string): AgentConfig | null {
    if (!this.config) return null;
    return this.config.get(agentId) ?? null;
  }

  private async doReport(agentId: string, trigger: string): Promise<SendOutcome> {
    const cfg = this.agentConfig(agentId);
    if (!cfg) {
      this.log.warn('Ingen konfigurasjon for agenten ennå, rapport hoppes over', { agent_id: agentId, trigger });
      return 'skipped';
    }
    if (!cfg.reporting_enabled) return 'skipped';
    const agent = this.o.agents.find((a) => a.agentId === agentId);
    if (!agent) return 'skipped';

    let scan: DeliveredScan | null = null;
    try { scan = await agent.latestDeliveredScan(); }
    catch (e) { this.log.warn('Klarte ikke å lese siste leverte kjøring, rapporterer uten', { agent_id: agentId, error: String(e) }); }

    const report = buildReport({ agentId, source: this.o.source, scan, now: this.now() });
    return this.send(report, trigger);
  }

  /** Sender med begrenset retry. Samme payload på alle forsøk. */
  private async send(report: HealthReport, trigger: string): Promise<SendOutcome> {
    const body = JSON.stringify(report);
    const meta = { agent_id: report.agent_id, report_id: report.report_id, trigger };
    for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
      if (this.stopped) return 'failed';
      let status = 0;
      try {
        const res = await this.fetchImpl(`${this.o.baseUrl}/api/v1/health-reports`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.o.requestTimeoutMs),
        });
        status = res.status;
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as { duplicate?: boolean };
          if (json.duplicate) { this.log.info('Rapport var allerede mottatt', meta); return 'duplicate'; }
          return 'accepted';
        }
        const text = (await res.text().catch(() => '')).slice(0, 300);
        if (!isRetryable(status)) {
          this.log.error('Dashboardet avviste helserapporten. Må undersøkes, gjentas ikke.', { ...meta, status, response: text });
          return 'failed';
        }
        this.log.warn('Midlertidig feil fra dashboardet', { ...meta, status, attempt });
      } catch (e) {
        this.log.warn('Nettverksfeil mot dashboardet', { ...meta, attempt, error: String(e) });
      }
      if (attempt < this.o.maxAttempts) await sleep(this.backoff(attempt));
    }
    this.log.error('Ga opp helserapporten etter flere forsøk', meta);
    return 'failed';
  }

  async refreshConfig(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.o.baseUrl}/api/v1/config`, {
        headers: { Authorization: `Bearer ${this.o.apiKey}` },
        signal: AbortSignal.timeout(this.o.requestTimeoutMs),
      });
      if (!res.ok) {
        this.log.warn('Klarte ikke å hente konfigurasjon, beholder forrige', { status: res.status });
        return;
      }
      const json = (await res.json()) as { schema_version?: number; config_version?: number; source?: string; agents?: AgentConfig[] };
      if (json.schema_version !== 1 || !Array.isArray(json.agents)) {
        this.log.warn('Ukjent konfigurasjonsformat, beholder forrige', { schema_version: json.schema_version });
        return;
      }
      if (json.source && json.source !== this.o.source) {
        this.log.error('API-nøkkelen tilhører en annen source enn konfigurert', { expected: this.o.source, got: json.source });
      }
      const next = new Map<string, AgentConfig>();
      for (const a of json.agents) {
        if (!a || typeof a.agent_id !== 'string') continue;
        next.set(a.agent_id, {
          agent_id: a.agent_id,
          reporting_enabled: a.reporting_enabled === true,
          report_interval_seconds: clampInterval(Number(a.report_interval_seconds) || DEFAULT_INTERVAL_S),
        });
      }
      for (const a of this.o.agents) {
        if (!next.has(a.agentId)) this.log.warn('Agenten er ikke registrert på denne kilden i dashboardet', { agent_id: a.agentId, source: this.o.source });
      }
      const old = this.config;
      this.config = next;
      if (json.config_version !== this.configVersion) {
        this.log.info('Konfigurasjon oppdatert', { config_version: json.config_version });
        this.configVersion = json.config_version ?? null;
      }
      // Intervall endret: planlegg på nytt.
      if (old) for (const a of this.o.agents) {
        if (old.get(a.agentId)?.report_interval_seconds !== next.get(a.agentId)?.report_interval_seconds) this.schedule(a.agentId);
      }
    } catch (e) {
      this.log.warn('Feil ved henting av konfigurasjon, beholder forrige', { error: String(e) });
    }
  }

  private async runPeriodic(agentId: string): Promise<void> {
    if (this.stopped) return;
    await this.reportNow(agentId, 'periodic');
    this.schedule(agentId);
  }

  private schedule(agentId: string): void {
    if (this.stopped) return;
    const existing = this.timers.get(agentId);
    if (existing) clearTimeout(existing);
    const s = this.agentConfig(agentId)?.report_interval_seconds ?? DEFAULT_INTERVAL_S;
    const t = setTimeout(() => { void this.runPeriodic(agentId); }, s * 1000);
    t.unref?.();
    this.timers.set(agentId, t);
  }
}

/** Bygger en gyldig rapport. Retter opp klokkeforskjeller slik at tidsrekkefølgen alltid holder. */
export function buildReport(input: { agentId: string; source: string; scan: DeliveredScan | null; now: number }): HealthReport {
  let last: HealthReport['last_delivered_scan'] = null;
  let reported = input.now;
  if (input.scan) {
    const started = Date.parse(iso(input.scan.started_at));
    const completed = Math.max(started, Date.parse(iso(input.scan.completed_at)));
    const persisted = Math.max(completed, Date.parse(iso(input.scan.persisted_at)));
    reported = Math.max(reported, persisted);
    last = {
      scan_run_id: input.scan.scan_run_id,
      started_at: new Date(started).toISOString(),
      completed_at: new Date(completed).toISOString(),
      persisted_at: new Date(persisted).toISOString(),
    };
  }
  return {
    schema_version: 1,
    report_id: randomUUID(),
    agent_id: input.agentId,
    source: input.source,
    reported_at: new Date(reported).toISOString(),
    last_delivered_scan: last,
  };
}

/** Nettverksfeil, 429 og 5xx gjentas. 400/401/403/409/413/415 skal undersøkes. */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Leser innstillinger fra miljøvariabler. Returnerer null hvis rapportering ikke er konfigurert. */
export function healthReporterFromEnv(
  agents: HealthReporterOptions['agents'],
  env: Record<string, string | undefined> = process.env,
  logger?: Logger,
): HealthReporter | null {
  const enabled = (env.MONITORING_ENABLED ?? 'true').toLowerCase() !== 'false';
  const baseUrl = env.AGENT_DASHBOARD_URL;
  const apiKey = env.AGENT_DASHBOARD_API_KEY;
  const source = env.AGENT_DASHBOARD_SOURCE;
  if (!enabled) { (logger ?? consoleLogger).info('Helserapportering er slått av (MONITORING_ENABLED=false)'); return null; }
  if (!baseUrl || !apiKey || !source) {
    (logger ?? consoleLogger).warn('Helserapportering er ikke konfigurert. Mangler AGENT_DASHBOARD_URL, AGENT_DASHBOARD_API_KEY eller AGENT_DASHBOARD_SOURCE.');
    return null;
  }
  return new HealthReporter({ baseUrl, apiKey, source, agents, enabled, logger });
}
